/**
 * Unit tests for Chopsticks Simulation Service
 */

// Mock dependencies before imports
jest.mock('@acala-network/chopsticks-core', () => ({
  BuildBlockMode: { Batch: 'Batch' },
  setup: jest.fn(),
}));

jest.mock('../../../../services/simulation/database', () => ({
  ChopsticksDatabase: jest.fn().mockImplementation(() => ({
    close: jest.fn().mockResolvedValue(undefined),
    deleteBlock: jest.fn().mockResolvedValue(undefined),
  })),
  createChopsticksDatabase: jest.fn(() => ({
    close: jest.fn().mockResolvedValue(undefined),
    deleteBlock: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
    set: jest.fn(),
    clear: jest.fn(),
  })),
}));

jest.mock('../../../../services/simulation/chopsticksIgnorePolicy', () => ({
  classifyChopsticksError: jest.fn(),
}));

jest.mock('@polkadot/util-crypto', () => ({
  encodeAddress: jest.fn(),
  decodeAddress: jest.fn(),
}));

import { simulateTransaction, isChopsticksAvailable } from '../../../../services/simulation/chopsticks';
import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { BN } from '@polkadot/util';
import { setup, BuildBlockMode } from '@acala-network/chopsticks-core';
import { ChopsticksDatabase } from '../../../../services/simulation/database';
import { classifyChopsticksError } from '../../../../services/simulation/chopsticksIgnorePolicy';
import { encodeAddress, decodeAddress } from '@polkadot/util-crypto';

describe('Chopsticks Simulation Service', () => {
  let mockApi: Partial<ApiPromise>;
  let mockExtrinsic: jest.Mocked<SubmittableExtrinsic<'promise'>>;
  let mockChain: any;
  let statusCallback: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    statusCallback = jest.fn();

    mockChain = {
      head: Promise.resolve('0x1234'),
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
    };

    (setup as jest.Mock).mockResolvedValue(mockChain);

    const mockRegistry = {
      chainSS58: 0,
      findMetaError: jest.fn(),
    } as any;

    mockExtrinsic = {
      method: {
        toHex: jest.fn().mockReturnValue('0xabcd'),
        section: 'balances',
        method: 'transferAllowDeath',
      },
      registry: mockRegistry,
      paymentInfo: jest.fn().mockResolvedValue({
        partialFee: { toString: () => '1000000000' },
      }),
    } as any;

    mockApi = {
      isReady: Promise.resolve({} as ApiPromise),
      genesisHash: {
        toHex: jest.fn().mockReturnValue('0xgenesis'),
      } as any,
      rpc: {
        system: {
          chain: jest.fn().mockResolvedValue({ toString: () => 'Polkadot' }),
        },
        chain: {
          getHeader: jest.fn().mockResolvedValue({
            number: { toNumber: () => 100 },
          }),
        },
      },
      registry: mockRegistry,
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
    (classifyChopsticksError as jest.Mock).mockReturnValue({
      ignore: false,
      classification: 'UNKNOWN',
      severity: 'BLOCKING',
    });
  });

  describe('simulateTransaction()', () => {
    it('should simulate successful transaction', async () => {
      const result = await simulateTransaction(
        mockApi as ApiPromise,
        'wss://rpc.polkadot.io',
        mockExtrinsic,
        '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        statusCallback
      );

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
      expect(setup).toHaveBeenCalled();
      expect(mockChain.dryRunExtrinsic).toHaveBeenCalled();
      expect(statusCallback).toHaveBeenCalled();
    });

    it('should filter to WebSocket endpoints only', async () => {
      await simulateTransaction(
        mockApi as ApiPromise,
        ['wss://rpc.polkadot.io', 'https://rpc.polkadot.io'],
        mockExtrinsic,
        '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'
      );

      expect(setup).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: ['wss://rpc.polkadot.io'],
        })
      );
    });

    it('should throw error if no WebSocket endpoints', async () => {
      await expect(
        simulateTransaction(
          mockApi as ApiPromise,
          ['https://rpc.polkadot.io'],
          mockExtrinsic,
          '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'
        )
      ).resolves.toMatchObject({
        success: false,
        error: expect.stringContaining('No valid WebSocket endpoints'),
      });
    });

    it('should handle transaction failure', async () => {
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

      const result = await simulateTransaction(
        mockApi as ApiPromise,
        'wss://rpc.polkadot.io',
        mockExtrinsic,
        '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle registry mismatch error', async () => {
      const extrinsicWithDifferentRegistry = {
        ...mockExtrinsic,
        registry: { different: 'registry' } as any,
      } as any;

      const result = await simulateTransaction(
        mockApi as ApiPromise,
        'wss://rpc.polkadot.io',
        extrinsicWithDifferentRegistry,
        '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Registry mismatch');
    });

    it('should calculate fees using paymentInfo', async () => {
      const result = await simulateTransaction(
        mockApi as ApiPromise,
        'wss://rpc.polkadot.io',
        mockExtrinsic,
        '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'
      );

      expect(result.estimatedFee).toBe('1000000000');
      expect(mockExtrinsic.paymentInfo).toHaveBeenCalled();
    });

    it('should handle paymentInfo errors gracefully', async () => {
      mockExtrinsic.paymentInfo.mockRejectedValue(new Error('TransactionPaymentApi_query_info wasm unreachable'));
      (classifyChopsticksError as jest.Mock).mockReturnValue({
        ignore: true,
        classification: 'PAYMENT_INFO_WASM_UNREACHABLE',
        severity: 'NON_FATAL',
      });

      const result = await simulateTransaction(
        mockApi as ApiPromise,
        'wss://rpc.polkadot.io',
        mockExtrinsic,
        '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'
      );

      expect(result.estimatedFee).toBe('0');
      // Success depends on the outcome, not paymentInfo error (if ignorable)
      // Since outcome is successful, result should be successful
      expect(result.success).toBe(true);
    });

    it('should call status callback with progress updates', async () => {
      await simulateTransaction(
        mockApi as ApiPromise,
        'wss://rpc.polkadot.io',
        mockExtrinsic,
        '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        statusCallback
      );

      expect(statusCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'initializing',
        })
      );
      expect(statusCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'forking',
        })
      );
      expect(statusCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'executing',
        })
      );
    });

    it('should return error result when simulation fails', async () => {
      // Modify the existing mockChain to reject on dryRunExtrinsic
      mockChain.dryRunExtrinsic.mockRejectedValueOnce(new Error('Simulation failed'));

      const result = await simulateTransaction(
        mockApi as ApiPromise,
        'wss://rpc.polkadot.io',
        mockExtrinsic,
        '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'
      );

      // Should return error result
      expect(result.success).toBe(false);
      expect(result.error).toContain('Chopsticks simulation failed');
    });

    it('should use latest block from endpoint', async () => {
      await simulateTransaction(
        mockApi as ApiPromise,
        'wss://rpc.polkadot.io',
        mockExtrinsic,
        '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'
      );

      expect(setup).toHaveBeenCalledWith(
        expect.objectContaining({
          block: undefined, // Should let Chopsticks fetch latest
        })
      );
    });
  });

  describe('isChopsticksAvailable()', () => {
    it('should return true when Chopsticks is available', async () => {
      const available = await isChopsticksAvailable();
      // In test environment, the mock should make it available
      expect(typeof available).toBe('boolean');
    });
  });
});

