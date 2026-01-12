/**
 * Unit tests for Sequential Transaction Simulation
 */

// Mock dependencies before imports
jest.mock('@acala-network/chopsticks-core', () => ({
  BuildBlockMode: { Batch: 'Batch' },
  setup: jest.fn(),
}));

jest.mock('../../../../services/simulation/database', () => ({
  ChopsticksDatabase: jest.fn().mockImplementation(() => ({
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('@polkadot/util-crypto', () => ({
  encodeAddress: jest.fn(),
  decodeAddress: jest.fn(),
}));

import { simulateSequentialTransactions } from '../../../../services/simulation/sequentialSimulation';
import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { BN } from '@polkadot/util';
import { setup } from '@acala-network/chopsticks-core';
import { encodeAddress, decodeAddress } from '@polkadot/util-crypto';

describe('Sequential Transaction Simulation', () => {
  let mockApi: Partial<ApiPromise>;
  let mockChain: any;
  let mockExtrinsics: jest.Mocked<SubmittableExtrinsic<'promise'>>[];
  let statusCallback: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    statusCallback = jest.fn();

    mockChain = {
      _currentHead: '0x1234',
      get head() {
        return Promise.resolve(this._currentHead);
      },
      close: jest.fn().mockResolvedValue(undefined),
      dryRunExtrinsic: jest.fn().mockResolvedValue({
        outcome: {
          isOk: true,
          asOk: {
            isOk: true,
          },
        },
        storageDiff: [],
      }),
      newBlock: jest.fn().mockImplementation(async function(this: any, options: any) {
        // Simulate block building by updating head
        this._currentHead = `0x${Math.random().toString(16).slice(2, 10)}`;
        // Return a block-like structure with successful outcome (default)
        // Can be overridden with mockResolvedValueOnce in individual tests
        return {
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
        };
      }),
      query: jest.fn().mockResolvedValue(null),
    };

    (setup as jest.Mock).mockResolvedValue(mockChain);

    // Create a shared registry object so extrinsic.registry === api.registry
    const sharedRegistry = {
      chainSS58: 0,
      findMetaError: jest.fn(),
    };

    mockExtrinsics = [
      {
        method: {
          toHex: jest.fn().mockReturnValue('0xabcd1'),
        },
        toHex: jest.fn().mockReturnValue('0xfull1'),
        registry: sharedRegistry,
        paymentInfo: jest.fn().mockResolvedValue({
          partialFee: { toString: () => '1000000000' },
        }),
      },
      {
        method: {
          toHex: jest.fn().mockReturnValue('0xabcd2'),
        },
        toHex: jest.fn().mockReturnValue('0xfull2'),
        registry: sharedRegistry,
        paymentInfo: jest.fn().mockResolvedValue({
          partialFee: { toString: () => '2000000000' },
        }),
      },
    ] as any;

    mockApi = {
      isReady: Promise.resolve({} as ApiPromise),
      genesisHash: {
        toHex: jest.fn().mockReturnValue('0xgenesis'),
      } as any,
      registry: sharedRegistry,
      rpc: {
        chain: {
          getFinalizedHead: jest.fn().mockResolvedValue({
            toHex: jest.fn().mockReturnValue('0xfinalized'),
          }),
        },
      },
      query: {
        system: {
          account: Object.assign(
            jest.fn().mockResolvedValue({
              data: {
                free: new BN(0),
                reserved: new BN(0),
              },
            }),
            {
              key: jest.fn().mockReturnValue('0xaccountkey'),
            }
          ),
        },
      },
      createType: jest.fn().mockReturnValue({
        data: {
          free: new BN(0),
          reserved: new BN(0),
        },
      }),
    } as any;

    (decodeAddress as jest.Mock).mockReturnValue(new Uint8Array([1, 2, 3]));
    (encodeAddress as jest.Mock).mockReturnValue('15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5');
  });

  describe('simulateSequentialTransactions()', () => {
    it('should simulate multiple transactions sequentially', async () => {
      const items = [
        {
          extrinsic: mockExtrinsics[0],
          description: 'Transfer 100 DOT',
          senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        },
        {
          extrinsic: mockExtrinsics[1],
          description: 'Stake 50 DOT',
          senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        },
      ];

      const result = await simulateSequentialTransactions(
        mockApi as ApiPromise,
        'wss://rpc.polkadot.io',
        items,
        statusCallback
      );

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].description).toBe('Transfer 100 DOT');
      expect(result.results[1].description).toBe('Stake 50 DOT');
      expect(mockChain.newBlock).toHaveBeenCalledTimes(2);
    });

    it('should stop on first failure', async () => {
      // Override the default mockImplementation with specific return values
      mockChain.newBlock
        .mockImplementationOnce(async function(this: any, options: any) {
          this._currentHead = `0x${Math.random().toString(16).slice(2, 10)}`;
          return {
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
          };
        })
        .mockImplementationOnce(async function(this: any, options: any) {
          this._currentHead = `0x${Math.random().toString(16).slice(2, 10)}`;
          return {
            result: {
              isOk: false,
              asErr: {
                type: 'InvalidTransaction',
              },
            },
            extrinsics: [{
              result: {
                isOk: false,
                asErr: {
                  type: 'InvalidTransaction',
                },
              },
            }],
          };
        });

      const items = [
        {
          extrinsic: mockExtrinsics[0],
          description: 'Transfer 100 DOT',
          senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        },
        {
          extrinsic: mockExtrinsics[1],
          description: 'Stake 50 DOT',
          senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        },
      ];

      const result = await simulateSequentialTransactions(
        mockApi as ApiPromise,
        'wss://rpc.polkadot.io',
        items
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Transaction 2');
      expect(result.results).toHaveLength(2);
      expect(result.results[0].result.success).toBe(true);
      expect(result.results[1].result.success).toBe(false);
    });

    it('should calculate total fee across all transactions', async () => {
      const items = [
        {
          extrinsic: mockExtrinsics[0],
          description: 'Transfer 100 DOT',
          senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        },
        {
          extrinsic: mockExtrinsics[1],
          description: 'Stake 50 DOT',
          senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        },
      ];

      const result = await simulateSequentialTransactions(
        mockApi as ApiPromise,
        'wss://rpc.polkadot.io',
        items
      );

      expect(result.totalEstimatedFee).toBe('3000000000'); // 1 + 2 DOT
    });

    it('should filter to WebSocket endpoints only', async () => {
      const items = [
        {
          extrinsic: mockExtrinsics[0],
          description: 'Transfer 100 DOT',
          senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        },
      ];

      await simulateSequentialTransactions(
        mockApi as ApiPromise,
        ['wss://rpc.polkadot.io', 'https://rpc.polkadot.io'],
        items
      );

      expect(setup).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: ['wss://rpc.polkadot.io'],
        })
      );
    });

    it('should return error result if no WebSocket endpoints', async () => {
      const items = [
        {
          extrinsic: mockExtrinsics[0],
          description: 'Transfer 100 DOT',
          senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        },
      ];

      const result = await simulateSequentialTransactions(
        mockApi as ApiPromise,
        ['https://rpc.polkadot.io'],
        items
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No valid WebSocket endpoints');
    });

    it('should call status callback with progress updates', async () => {
      const items = [
        {
          extrinsic: mockExtrinsics[0],
          description: 'Transfer 100 DOT',
          senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        },
      ];

      await simulateSequentialTransactions(
        mockApi as ApiPromise,
        'wss://rpc.polkadot.io',
        items,
        statusCallback
      );

      expect(statusCallback).toHaveBeenCalled();
      expect(statusCallback.mock.calls.some(call => 
        call[0]?.phase === 'initializing'
      )).toBe(true);
    });

    it('should handle fee calculation failures gracefully', async () => {
      mockExtrinsics[0].paymentInfo.mockRejectedValue(new Error('Fee calculation failed'));

      const items = [
        {
          extrinsic: mockExtrinsics[0],
          description: 'Transfer 100 DOT',
          senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        },
      ];

      const result = await simulateSequentialTransactions(
        mockApi as ApiPromise,
        'wss://rpc.polkadot.io',
        items
      );

      // Should still succeed even if fee calculation fails
      expect(result.success).toBe(true);
      expect(result.results[0].result.estimatedFee).toBe('0');
    });

    it('should use same fork for all transactions', async () => {
      const items = [
        {
          extrinsic: mockExtrinsics[0],
          description: 'Transfer 100 DOT',
          senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        },
        {
          extrinsic: mockExtrinsics[1],
          description: 'Stake 50 DOT',
          senderAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        },
      ];

      await simulateSequentialTransactions(
        mockApi as ApiPromise,
        'wss://rpc.polkadot.io',
        items
      );

      // Should call setup once to create fork
      expect(setup).toHaveBeenCalledTimes(1);
      // Should simulate both transactions on same fork
      expect(mockChain.newBlock).toHaveBeenCalledTimes(2);
    });
  });
});

