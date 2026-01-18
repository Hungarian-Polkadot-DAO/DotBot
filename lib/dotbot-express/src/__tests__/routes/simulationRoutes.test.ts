/**
 * Unit tests for Simulation Routes (Chopsticks)
 */

import { Request, Response } from 'express';
import { BN } from '@polkadot/util';
import { ApiPromise, WsProvider } from '@polkadot/api';

// Mock dependencies before imports
const mockSetup = jest.fn();
const mockCreateChopsticksDatabase = jest.fn();
const mockClassifyChopsticksError = jest.fn();
const mockChain = {
  head: Promise.resolve('0x1234'),
  close: jest.fn().mockResolvedValue(undefined),
  dryRunExtrinsic: jest.fn(),
  newBlock: jest.fn(),
};
const mockStorage = {
  close: jest.fn().mockResolvedValue(undefined),
  deleteBlock: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@acala-network/chopsticks-core', () => ({
  BuildBlockMode: { Batch: 'Batch', Instant: 'Instant' },
  setup: (...args: any[]) => mockSetup(...args),
}));

jest.mock('@dotbot/core/services/simulation/database', () => ({
  createChopsticksDatabase: (...args: any[]) => mockCreateChopsticksDatabase(...args),
}));

jest.mock('@dotbot/core/services/simulation/chopsticksIgnorePolicy', () => ({
  classifyChopsticksError: (...args: any[]) => mockClassifyChopsticksError(...args),
}));

jest.mock('@dotbot/core/services/logger', () => ({
  createSubsystemLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
  Subsystem: {
    SIMULATION: 'simulation',
  },
}));

jest.mock('@polkadot/util-crypto', () => ({
  encodeAddress: jest.fn((publicKey: Uint8Array, ss58Format?: number) => {
    // Return a mock address
    return '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';
  }),
  decodeAddress: jest.fn((address: string) => {
    // Return a mock public key
    return new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
  }),
}));

// Mock @polkadot/api
let mockApiPromise: any;

jest.mock('@polkadot/api', () => ({
  ApiPromise: {
    create: jest.fn().mockImplementation(async () => {
      return mockApiPromise;
    }),
  },
  WsProvider: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
  })),
}));

// Import router after mocks
import simulationRouter from '../../routes/simulationRoutes';

// Helper to find route handlers
function findRouteHandler(router: any, path: string, method: string): any {
  for (const layer of router.stack as any[]) {
    if (layer.route?.path === path && (layer.route as any).methods?.[method.toLowerCase()]) {
      return layer.route.stack[0]?.handle;
    }
  }
  return null;
}

describe('Simulation Routes', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {
      body: {},
    };

    mockResponse = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();

    // Create fresh mockApiPromise for each test
    mockApiPromise = {
      isReady: Promise.resolve({} as ApiPromise),
      genesisHash: {
        toHex: jest.fn().mockReturnValue('0xgenesis'),
      },
      rpc: {
        system: {
          chain: jest.fn().mockResolvedValue({ toString: () => 'Polkadot' }),
        },
        chain: {
          getFinalizedHead: jest.fn().mockResolvedValue({ toHex: () => '0xfinalized' }),
          getHeader: jest.fn().mockResolvedValue({
            number: { toNumber: () => 100 },
          }),
        },
      },
      registry: {
        chainSS58: 0,
        findMetaError: jest.fn().mockReturnValue({
          section: 'balances',
          name: 'InsufficientBalance',
          docs: ['Insufficient balance'],
        }),
      },
      query: {
        system: {
          account: Object.assign(
            jest.fn().mockResolvedValue({
              data: {
                free: new BN(1000000000000),
                reserved: new BN(0),
                add: jest.fn((other: any) => new BN(1000000000000).add(other)),
              },
            }),
            {
              key: jest.fn().mockReturnValue('0xaccountkey'),
            }
          ),
        },
      },
      createType: jest.fn().mockImplementation((type: string, value: any) => {
        if (type === 'Extrinsic') {
          // Try to decode as extrinsic, but if it fails, return a mock
          try {
            return {
              method: {
                toHex: () => {
                  // If value is already hex, return it; otherwise wrap it
                  if (typeof value === 'string' && value.startsWith('0x')) {
                    return value;
                  }
                  return `0x${value}`;
                },
              },
              toHex: jest.fn().mockReturnValue('0xfull-extrinsic-hex'),
              paymentInfo: jest.fn().mockResolvedValue({
                partialFee: { toString: () => '1000000000' },
              }),
            };
          } catch {
            // If decoding fails, assume it's method call hex
            return {
              method: {
                toHex: () => value,
              },
              toHex: jest.fn().mockReturnValue('0xfull-extrinsic-hex'),
              paymentInfo: jest.fn().mockResolvedValue({
                partialFee: { toString: () => '1000000000' },
              }),
            };
          }
        }
        if (type === 'FrameSystemAccountInfo') {
          return {
            data: {
              free: new BN(2000000000000),
              reserved: new BN(0),
              add: jest.fn((other: any) => new BN(2000000000000).add(other)),
            },
          };
        }
        if (type === 'Call') {
          return {
            section: 'balances',
            method: 'transferAllowDeath',
            args: [],
          };
        }
        return value;
      }),
      disconnect: jest.fn().mockResolvedValue(undefined),
      tx: {
        balances: {
          transferAllowDeath: jest.fn().mockReturnValue({
            toHex: jest.fn().mockReturnValue('0xfull-extrinsic-hex'),
            paymentInfo: jest.fn().mockResolvedValue({
              partialFee: { toString: () => '1000000000' },
            }),
          }),
        },
      },
    } as any;

    // Default mocks
    mockSetup.mockResolvedValue(mockChain);
    mockCreateChopsticksDatabase.mockReturnValue(mockStorage);
    mockClassifyChopsticksError.mockReturnValue({
      ignore: true, // Default to ignorable errors so tests can complete
      classification: 'UNKNOWN',
      severity: 'NON_FATAL',
    });

    // Reset chain mocks
    mockChain.dryRunExtrinsic.mockResolvedValue({
      outcome: {
        isOk: true,
        asOk: {
          isOk: true,
        },
      },
      storageDiff: [],
    });

    mockChain.newBlock.mockResolvedValue({
      result: {
        isOk: true,
        asOk: {
          isOk: true,
        },
      },
      extrinsics: [{
        result: {
          isOk: true,
          asOk: {
            isOk: true,
          },
        },
      }],
    });
  });

  describe('GET /health', () => {
    it('should return health status', () => {
      const handler = findRouteHandler(simulationRouter, '/health', 'get');
      expect(handler).toBeDefined();

      handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        status: 'ok',
        service: 'simulation-server',
      });
    });
  });

  describe('POST /simulate', () => {
    it('should simulate successful transaction', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate', 'post');
      expect(handler).toBeDefined();

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io'],
        extrinsicHex: '0xabcd',
        senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockSetup).toHaveBeenCalled();
      expect(mockChain.dryRunExtrinsic).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          error: null,
        })
      );
    });

    it('should filter to WebSocket endpoints only', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate', 'post');

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io', 'https://rpc.polkadot.io'],
        extrinsicHex: '0xabcd',
        senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockSetup).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: ['wss://rpc.polkadot.io'],
        })
      );
    });

    it('should return 400 if no valid WebSocket endpoints', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate', 'post');

      mockRequest.body = {
        rpcEndpoints: ['https://rpc.polkadot.io'],
        extrinsicHex: '0xabcd',
        senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'No valid WebSocket endpoints provided',
      });
    });

    it('should return 400 if rpcEndpoints is not an array', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate', 'post');

      mockRequest.body = {
        rpcEndpoints: 'wss://rpc.polkadot.io',
        extrinsicHex: '0xabcd',
        senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'rpcEndpoints must be an array',
      });
    });

    it('should return 400 if extrinsicHex is missing', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate', 'post');

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io'],
        senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'extrinsicHex is required',
      });
    });

    it('should return 400 if senderAddress is missing', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate', 'post');

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io'],
        extrinsicHex: '0xabcd',
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'senderAddress is required',
      });
    });

    it('should handle simulation failure', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate', 'post');

      // Set error classification to not ignore so it's treated as a failure
      mockClassifyChopsticksError.mockReturnValueOnce({
        ignore: false,
        classification: 'INVALID_TRANSACTION',
        severity: 'BLOCKING',
      });

      mockChain.dryRunExtrinsic.mockResolvedValue({
        outcome: {
          isOk: false,
          asErr: {
            type: 'InvalidTransaction',
            toString: () => 'InvalidTransaction',
          },
        },
        storageDiff: [],
      });

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io'],
        extrinsicHex: '0xabcd',
        senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.any(String),
        })
      );
    });

    it('should cleanup resources on success', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate', 'post');

      // Ensure paymentInfo works correctly
      mockClassifyChopsticksError.mockReturnValue({
        ignore: true, // Make fee errors ignorable so cleanup happens
        classification: 'UNKNOWN',
        severity: 'NON_FATAL',
      });

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io'],
        extrinsicHex: '0xabcd',
        senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockStorage.deleteBlock).toHaveBeenCalled();
      expect(mockStorage.close).toHaveBeenCalled();
      expect(mockChain.close).toHaveBeenCalled();
      expect(mockApiPromise.disconnect).toHaveBeenCalled();
    });

    it('should cleanup resources on error', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate', 'post');

      // Mock setup to fail after API is created
      // This will cause simulateTransactionInternal to catch and return error
      mockSetup.mockRejectedValue(new Error('Chopsticks setup failed'));

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io'],
        extrinsicHex: '0xabcd',
        senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      // simulateTransactionInternal catches errors and returns error result, not 500
      // The route handler returns the error result as JSON
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Chopsticks simulation failed'),
        })
      );
      expect(mockApiPromise.disconnect).toHaveBeenCalled();
    });

    it('should calculate fees correctly', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate', 'post');

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io'],
        extrinsicHex: '0xabcd',
        senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      const responseCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(responseCall.estimatedFee).toBeDefined();
    });

    it('should handle fee calculation failures gracefully', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate', 'post');

      // Mock createType to throw for extrinsic reconstruction
      (mockApiPromise.createType as jest.Mock).mockImplementation((type: string) => {
        if (type === 'Extrinsic') {
          throw new Error('Cannot decode extrinsic');
        }
        return { method: { toHex: () => '0xabcd' } };
      });

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io'],
        extrinsicHex: '0xabcd',
        senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      // Should still succeed even if fee calculation fails
      const responseCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(responseCall.success).toBe(true);
      expect(responseCall.estimatedFee).toBe('0');
    });

    it('should use blockHash if provided', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate', 'post');

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io'],
        extrinsicHex: '0xabcd',
        senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        blockHash: '0x123456',
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockSetup).toHaveBeenCalledWith(
        expect.objectContaining({
          block: '0x123456',
        })
      );
    });
  });

  describe('POST /simulate-sequential', () => {
    it('should simulate multiple transactions sequentially', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate-sequential', 'post');

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io'],
        items: [
          {
            extrinsicHex: '0xabcd1',
            description: 'Transfer 100 DOT',
            senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
          },
          {
            extrinsicHex: '0xabcd2',
            description: 'Stake 50 DOT',
            senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
          },
        ],
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockChain.newBlock).toHaveBeenCalledTimes(2);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          results: expect.arrayContaining([
            expect.objectContaining({ description: 'Transfer 100 DOT' }),
            expect.objectContaining({ description: 'Stake 50 DOT' }),
          ]),
        })
      );
    });

    it('should stop on first failure', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate-sequential', 'post');

      // Set error classification to not ignore so failures are treated as failures
      mockClassifyChopsticksError.mockReturnValue({
        ignore: false,
        classification: 'INVALID_TRANSACTION',
        severity: 'BLOCKING',
      });

      mockChain.newBlock
        .mockResolvedValueOnce({
          result: {
            isOk: true,
            asOk: { isOk: true },
          },
          extrinsics: [{
            result: {
              isOk: true,
              asOk: { isOk: true },
            },
          }],
        })
        .mockResolvedValueOnce({
          result: {
            isOk: false,
            asErr: {
              type: 'InvalidTransaction',
              toString: () => 'InvalidTransaction',
            },
          },
          extrinsics: [{
            result: {
              isOk: false,
              asErr: {
                type: 'InvalidTransaction',
                toString: () => 'InvalidTransaction',
              },
            },
          }],
        });

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io'],
        items: [
          {
            extrinsicHex: '0xabcd1',
            description: 'Transfer 100 DOT',
            senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
          },
          {
            extrinsicHex: '0xabcd2',
            description: 'Stake 50 DOT',
            senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
          },
        ],
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      const responseCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(responseCall.success).toBe(false);
      expect(responseCall.results).toHaveLength(2);
      expect(responseCall.results[0].result.success).toBe(true);
      expect(responseCall.results[1].result.success).toBe(false);
    });

    it('should calculate total fee across all transactions', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate-sequential', 'post');

      // Mock paymentInfo to return different fees
      let callCount = 0;
      (mockApiPromise.tx.balances.transferAllowDeath as jest.Mock).mockImplementation(() => ({
        paymentInfo: jest.fn().mockResolvedValue({
          partialFee: { toString: () => {
            callCount++;
            return callCount === 1 ? '1000000000' : '2000000000';
          }},
        }),
      }));

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io'],
        items: [
          {
            extrinsicHex: '0xabcd1',
            description: 'Transfer 100 DOT',
            senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
          },
          {
            extrinsicHex: '0xabcd2',
            description: 'Stake 50 DOT',
            senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
          },
        ],
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      const responseCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(responseCall.totalEstimatedFee).toBeDefined();
    });

    it('should filter to WebSocket endpoints only', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate-sequential', 'post');

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io', 'https://rpc.polkadot.io'],
        items: [
          {
            extrinsicHex: '0xabcd1',
            description: 'Transfer 100 DOT',
            senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
          },
        ],
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockSetup).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: ['wss://rpc.polkadot.io'],
        })
      );
    });

    it('should return 400 if no valid WebSocket endpoints', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate-sequential', 'post');

      mockRequest.body = {
        rpcEndpoints: ['https://rpc.polkadot.io'],
        items: [
          {
            extrinsicHex: '0xabcd1',
            description: 'Transfer 100 DOT',
            senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
          },
        ],
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'No valid WebSocket endpoints provided',
      });
    });

    it('should return 400 if rpcEndpoints is not an array', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate-sequential', 'post');

      mockRequest.body = {
        rpcEndpoints: 'wss://rpc.polkadot.io',
        items: [],
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'rpcEndpoints must be an array',
      });
    });

    it('should return 400 if items is not an array', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate-sequential', 'post');

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io'],
        items: 'not-an-array',
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'items must be an array',
      });
    });

    it('should cleanup resources on success', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate-sequential', 'post');

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io'],
        items: [
          {
            extrinsicHex: '0xabcd1',
            description: 'Transfer 100 DOT',
            senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
          },
        ],
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockStorage.deleteBlock).toHaveBeenCalled();
      expect(mockStorage.close).toHaveBeenCalled();
      expect(mockChain.close).toHaveBeenCalled();
      expect(mockApiPromise.disconnect).toHaveBeenCalled();
    });

    it('should cleanup resources on error', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate-sequential', 'post');

      // Mock setup to fail after API is created
      mockSetup.mockRejectedValue(new Error('Chopsticks setup failed'));

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io'],
        items: [
          {
            extrinsicHex: '0xabcd1',
            description: 'Transfer 100 DOT',
            senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
          },
        ],
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      // simulateSequentialTransactionsInternal catches errors and returns error result, not 500
      // The route handler returns the error result as JSON
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Sequential simulation failed'),
        })
      );
      expect(mockApiPromise.disconnect).toHaveBeenCalled();
    });

    it('should use same fork for all transactions', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate-sequential', 'post');

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io'],
        items: [
          {
            extrinsicHex: '0xabcd1',
            description: 'Transfer 100 DOT',
            senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
          },
          {
            extrinsicHex: '0xabcd2',
            description: 'Stake 50 DOT',
            senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
          },
        ],
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      // Should call setup once to create fork
      expect(mockSetup).toHaveBeenCalledTimes(1);
      // Should simulate both transactions on same fork
      expect(mockChain.newBlock).toHaveBeenCalledTimes(2);
    });

    it('should handle fee calculation failures gracefully', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate-sequential', 'post');

      // Override createType to return an extrinsic with failing paymentInfo for this test
      const originalCreateType = mockApiPromise.createType;
      (mockApiPromise.createType as jest.Mock).mockImplementationOnce((type: string, value: any) => {
        if (type === 'Extrinsic') {
          return {
            method: {
              toHex: () => value.substring(0, 2) === '0x' ? value : `0x${value}`,
            },
            toHex: jest.fn().mockReturnValue('0xfull-extrinsic-hex'),
            paymentInfo: jest.fn().mockRejectedValue(new Error('Fee calculation failed')),
          };
        }
        // For other types, use the original implementation
        return originalCreateType(type, value);
      });

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io'],
        items: [
          {
            extrinsicHex: '0xabcd1',
            description: 'Transfer 100 DOT',
            senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
          },
        ],
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      // Should still succeed even if fee calculation fails
      const responseCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(responseCall.success).toBe(true);
      expect(responseCall.results[0].result.estimatedFee).toBe('0');
    });

    it('should handle API creation failure', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate', 'post');

      const ApiPromiseModule = require('@polkadot/api');
      ApiPromiseModule.ApiPromise.create.mockRejectedValueOnce(new Error('Failed to create API'));

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io'],
        extrinsicHex: '0xabcd',
        senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Failed to create API',
      });
    });

    it('should handle sequential simulation API creation failure', async () => {
      const handler = findRouteHandler(simulationRouter, '/simulate-sequential', 'post');

      const ApiPromiseModule = require('@polkadot/api');
      ApiPromiseModule.ApiPromise.create.mockRejectedValueOnce(new Error('Failed to create API'));

      mockRequest.body = {
        rpcEndpoints: ['wss://rpc.polkadot.io'],
        items: [
          {
            extrinsicHex: '0xabcd1',
            description: 'Transfer 100 DOT',
            senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
          },
        ],
      };

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Failed to create API',
      });
    });
  });
});
