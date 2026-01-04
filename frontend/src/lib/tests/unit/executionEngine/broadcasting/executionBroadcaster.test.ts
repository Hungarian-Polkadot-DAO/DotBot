/**
 * Unit tests for Execution Broadcaster
 */

import { broadcastTransaction, monitorTransaction } from '../../../../executionEngine/broadcasting/executionBroadcaster';
import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { ExecutionResult } from '../../../../executionEngine/types';

describe('Execution Broadcaster', () => {
  let mockApi: Partial<ApiPromise>;
  let mockExtrinsic: jest.Mocked<SubmittableExtrinsic<'promise'>>;
  let mockSendCallback: ((result: any) => void) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Create mock API with events
    mockApi = {
      events: {
        system: {
          ExtrinsicFailed: {
            is: jest.fn((event: any) => {
              return event && event.section === 'system' && event.method === 'ExtrinsicFailed';
            }),
          },
        },
      },
      registry: {
        findMetaError: jest.fn((error: any) => ({
          section: 'balances',
          name: 'InsufficientBalance',
          docs: ['Insufficient balance to complete transaction'],
        })),
      },
    } as any;

    // Create mock extrinsic
    mockExtrinsic = {
      hash: {
        toString: jest.fn().mockReturnValue('0x1234567890abcdef'),
      },
      send: jest.fn((callback: (result: any) => void) => {
        mockSendCallback = callback;
        return Promise.resolve();
      }),
    } as any;
  });

  afterEach(() => {
    jest.useRealTimers();
    mockSendCallback = null;
  });

  describe('broadcastTransaction()', () => {
    it('should resolve with success when transaction is finalized', async () => {
      const timeout = 60000;

      const promise = broadcastTransaction(mockExtrinsic, mockApi as ApiPromise, timeout);

      // Simulate finalized transaction with success
      if (mockSendCallback) {
        mockSendCallback({
          status: {
            isFinalized: true,
            asFinalized: {
              toString: jest.fn().mockReturnValue('0xblockhash123'),
            },
          },
          events: [
            {
              event: {
                section: 'system',
                method: 'ExtrinsicSuccess',
                toHuman: jest.fn().mockReturnValue({ section: 'system', method: 'ExtrinsicSuccess' }),
              },
            },
          ],
        });
      }

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.txHash).toBe('0x1234567890abcdef');
      expect(result.blockHash).toBe('0xblockhash123');
      expect(result.events).toBeDefined();
      expect(mockExtrinsic.send).toHaveBeenCalled();
    });

    it('should resolve with failure when ExtrinsicFailed event is present', async () => {
      const timeout = 60000;

      const promise = broadcastTransaction(mockExtrinsic, mockApi as ApiPromise, timeout);

      // Simulate finalized transaction with failure
      if (mockSendCallback) {
        const failedEvent = {
          event: {
            section: 'system',
            method: 'ExtrinsicFailed',
            toHuman: jest.fn().mockReturnValue({
              section: 'system',
              method: 'ExtrinsicFailed',
              data: [],
            }),
            data: [
              {
                isModule: true,
                asModule: { index: 2, error: 1 },
              },
            ],
          },
        };

        mockSendCallback({
          status: {
            isFinalized: true,
            asFinalized: {
              toString: jest.fn().mockReturnValue('0xblockhash123'),
            },
          },
          events: [failedEvent],
        });
      }

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('balances.InsufficientBalance');
      expect(result.errorCode).toBe('EXTRINSIC_FAILED');
      expect(result.rawError).toBeDefined();
    });

    it('should handle ExtrinsicFailed without decodable error', async () => {
      const timeout = 60000;

      const promise = broadcastTransaction(mockExtrinsic, mockApi as ApiPromise, timeout);

      if (mockSendCallback) {
        const failedEvent = {
          event: {
            section: 'system',
            method: 'ExtrinsicFailed',
            toHuman: jest.fn().mockReturnValue({
              section: 'system',
              method: 'ExtrinsicFailed',
              data: [],
            }),
            data: [
              {
                isModule: false,
              },
            ],
          },
        };

        mockSendCallback({
          status: {
            isFinalized: true,
            asFinalized: {
              toString: jest.fn().mockReturnValue('0xblockhash123'),
            },
          },
          events: [failedEvent],
        });
      }

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Transaction failed');
      expect(result.errorCode).toBe('EXTRINSIC_FAILED');
    });

    it('should handle ExtrinsicFailed with error decoding failure', async () => {
      // Mock findMetaError to throw
      (mockApi.registry!.findMetaError as jest.Mock).mockImplementation(() => {
        throw new Error('Cannot decode error');
      });

      const timeout = 60000;
      const promise = broadcastTransaction(mockExtrinsic, mockApi as ApiPromise, timeout);

      if (mockSendCallback) {
        const failedEvent = {
          event: {
            section: 'system',
            method: 'ExtrinsicFailed',
            toHuman: jest.fn().mockReturnValue({
              section: 'system',
              method: 'ExtrinsicFailed',
              data: [],
            }),
            data: [
              {
                isModule: true,
                asModule: { index: 2, error: 1 },
              },
            ],
          },
        };

        mockSendCallback({
          status: {
            isFinalized: true,
            asFinalized: {
              toString: jest.fn().mockReturnValue('0xblockhash123'),
            },
          },
          events: [failedEvent],
        });
      }

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Transaction failed');
      expect(result.errorCode).toBe('EXTRINSIC_FAILED');
    });

    it('should handle invalid transaction status', async () => {
      const timeout = 60000;
      const promise = broadcastTransaction(mockExtrinsic, mockApi as ApiPromise, timeout);

      if (mockSendCallback) {
        mockSendCallback({
          status: {
            isFinalized: false,
            isInvalid: true,
            isDropped: false,
            isUsurped: false,
          },
          events: [],
        });
      }

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Transaction Invalid');
      expect(result.errorCode).toBe('INVALID');
    });

    it('should handle dropped transaction status', async () => {
      const timeout = 60000;
      const promise = broadcastTransaction(mockExtrinsic, mockApi as ApiPromise, timeout);

      if (mockSendCallback) {
        mockSendCallback({
          status: {
            isFinalized: false,
            isInvalid: false,
            isDropped: true,
            isUsurped: false,
          },
          events: [],
        });
      }

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Transaction Dropped');
      expect(result.errorCode).toBe('DROPPED');
    });

    it('should handle usurped transaction status', async () => {
      const timeout = 60000;
      const promise = broadcastTransaction(mockExtrinsic, mockApi as ApiPromise, timeout);

      if (mockSendCallback) {
        mockSendCallback({
          status: {
            isFinalized: false,
            isInvalid: false,
            isDropped: false,
            isUsurped: true,
          },
          events: [],
        });
      }

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Transaction Usurped');
      expect(result.errorCode).toBe('USURPED');
    });

    it('should reject on timeout', async () => {
      const timeout = 5000;

      const promise = broadcastTransaction(mockExtrinsic, mockApi as ApiPromise, timeout);

      // Fast-forward time past timeout
      jest.advanceTimersByTime(timeout + 1000);

      await expect(promise).rejects.toThrow('Transaction timeout');
    });

    it('should clear timeout when transaction finalizes', async () => {
      const timeout = 60000;
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      const promise = broadcastTransaction(mockExtrinsic, mockApi as ApiPromise, timeout);

      // Simulate finalized transaction
      if (mockSendCallback) {
        mockSendCallback({
          status: {
            isFinalized: true,
            asFinalized: {
              toString: jest.fn().mockReturnValue('0xblockhash123'),
            },
          },
          events: [],
        });
      }

      await promise;

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('should handle send() promise rejection', async () => {
      const sendError = new Error('Network error');
      (mockExtrinsic.send as jest.Mock).mockRejectedValue(sendError);

      const timeout = 60000;
      const promise = broadcastTransaction(mockExtrinsic, mockApi as ApiPromise, timeout);

      await expect(promise).rejects.toThrow('Network error');
    });

    it('should handle send() throwing synchronously', async () => {
      const sendError = new Error('Invalid extrinsic');
      (mockExtrinsic.send as jest.Mock).mockImplementation(() => {
        throw sendError;
      });

      const timeout = 60000;
      const promise = broadcastTransaction(mockExtrinsic, mockApi as ApiPromise, timeout);

      await expect(promise).rejects.toThrow('Invalid extrinsic');
    });

    it('should map events to human-readable format', async () => {
      const timeout = 60000;
      const promise = broadcastTransaction(mockExtrinsic, mockApi as ApiPromise, timeout);

      const mockEvent1 = {
        event: {
          section: 'balances',
          method: 'Transfer',
          toHuman: jest.fn().mockReturnValue({ section: 'balances', method: 'Transfer' }),
        },
      };

      const mockEvent2 = {
        event: {
          section: 'system',
          method: 'ExtrinsicSuccess',
          toHuman: jest.fn().mockReturnValue({ section: 'system', method: 'ExtrinsicSuccess' }),
        },
      };

      if (mockSendCallback) {
        mockSendCallback({
          status: {
            isFinalized: true,
            asFinalized: {
              toString: jest.fn().mockReturnValue('0xblockhash123'),
            },
          },
          events: [mockEvent1, mockEvent2],
        });
      }

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.events).toHaveLength(2);
      expect(result.events![0]).toEqual({ section: 'balances', method: 'Transfer' });
      expect(result.events![1]).toEqual({ section: 'system', method: 'ExtrinsicSuccess' });
    });

    it('should handle non-finalized status updates without resolving', async () => {
      const timeout = 60000;
      const promise = broadcastTransaction(mockExtrinsic, mockApi as ApiPromise, timeout);

      // Send non-finalized status (should not resolve)
      if (mockSendCallback) {
        mockSendCallback({
          status: {
            isFinalized: false,
            isInvalid: false,
            isDropped: false,
            isUsurped: false,
            isInBlock: true,
          },
          events: [],
        });
      }

      // Verify promise hasn't resolved by checking it's still pending
      // We'll use a flag to track if it resolved
      let resolved = false;
      promise.then(() => {
        resolved = true;
      }).catch(() => {
        resolved = true;
      });

      // Wait a bit to ensure it doesn't resolve immediately
      await new Promise(resolve => {
        setTimeout(resolve, 10);
        jest.advanceTimersByTime(10);
      });

      // Should still be pending
      expect(resolved).toBe(false);

      // Now finalize it
      if (mockSendCallback) {
        mockSendCallback({
          status: {
            isFinalized: true,
            asFinalized: {
              toString: jest.fn().mockReturnValue('0xblockhash123'),
            },
          },
          events: [],
        });
      }

      // Now the promise should resolve
      const result = await promise;
      expect(result.success).toBe(true);
    });
  });

  describe('monitorTransaction()', () => {
    it('should be a no-op placeholder', async () => {
      const txHash = '0x1234567890abcdef';
      
      // Should not throw
      await expect(
        monitorTransaction(txHash, mockApi as ApiPromise)
      ).resolves.toBeUndefined();
    });
  });
});

