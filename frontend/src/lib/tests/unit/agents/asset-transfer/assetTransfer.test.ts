/**
 * Unit tests for AssetTransferAgent
 */

// Mock Polkadot modules before imports
// Note: jest.mock() calls are hoisted, so they run before imports

jest.mock('@polkadot/util-crypto', () => {
  // Valid test addresses - Polkadot SS58 format (prefix 0)
  const VALID_TEST_ADDRESSES = [
    '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
    '14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3',
    '14Gjs1TD93gnwEBfDMHoCgsuf1s2TVKUP6Z1qKmAZnZ8cW5q',
  ];
  
  // Track the mapping between decoded public keys and original addresses
  // Since all addresses decode to the same 32-byte array in our mock,
  // we'll use a simple counter to distinguish them
  let decodeCounter = 0;
  const addressMap = new Map<number, string>();
  
  return {
    isAddress: (address: string) => {
      if (!address || typeof address !== 'string' || address.trim().length === 0) {
        return false;
      }
      // Check if it's one of our known test addresses
      if (VALID_TEST_ADDRESSES.includes(address)) {
        return true;
      }
      // Basic SS58 format check - be permissive for tests
      // Polkadot addresses start with '1' and are typically 47-48 characters
      if (address.startsWith('1') && address.length >= 40 && address.length <= 50) {
        return true;
      }
      return false;
    },
    decodeAddress: (address: string) => {
      if (!address || address.length === 0) {
        throw new Error('Invalid address');
      }
      // Find the index of this address in our test addresses
      const addressIndex = VALID_TEST_ADDRESSES.indexOf(address);
      const key = addressIndex >= 0 ? addressIndex : decodeCounter++;
      
      // Store the mapping
      addressMap.set(key, address);
      
      // Return a 32-byte array with the key encoded in the first byte
      const publicKey = new Uint8Array(32);
      publicKey[0] = key;
      return publicKey;
    },
    encodeAddress: (publicKey: Uint8Array, ss58Format?: number) => {
      // Extract the key from the first byte
      const key = publicKey[0];
      // Return the original address if we have it, otherwise return the first test address
      return addressMap.get(key) || VALID_TEST_ADDRESSES[0];
    },
  };
});

jest.mock('@polkadot/keyring', () => {
  return {
    decodeAddress: (address: string) => {
      if (!address || address.length === 0) {
        throw new Error('Invalid address');
      }
      // Return a valid 32-byte array
      return new Uint8Array(32);
    },
    encodeAddress: () => '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
  };
});

import { AssetTransferAgent } from '../../../../agents/asset-transfer/agent';
import { AgentError } from '../../../../agents/types';
import { ApiPromise } from '@polkadot/api';
import { BN } from '@polkadot/util';
import {
  TEST_ADDRESSES,
  INVALID_ADDRESSES,
  TEST_AMOUNTS,
  TEST_AMOUNTS_HUMAN,
  createMockApi,
  createMockExtrinsic,
  createMockBalanceData,
  createMockInsufficientBalance,
} from './fixturesTestHelpers';

describe('AssetTransferAgent', () => {
  let agent: AssetTransferAgent;
  let mockApi: Partial<ApiPromise>;
  let mockAssetHubApi: Partial<ApiPromise>;

  beforeEach(() => {
    agent = new AssetTransferAgent();
    mockApi = createMockApi(false); // Relay chain
    mockAssetHubApi = createMockApi(true); // Asset Hub
    agent.initialize(mockApi as ApiPromise, mockAssetHubApi as ApiPromise);
  });

  describe('transfer()', () => {
    describe('Happy Paths', () => {
      it('should create a standard DOT transfer extrinsic', async () => {
        const result = await agent.transfer({
          address: TEST_ADDRESSES.ALICE,
          recipient: TEST_ADDRESSES.BOB,
          amount: TEST_AMOUNTS.ONE_DOT,
        });

        expect(result.extrinsic).toBeDefined();
        expect(result.resultType).toBe('extrinsic');
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionType).toBe('extrinsic');
        expect(result.description).toContain('Transfer');
        expect(result.description).toContain('DOT');
        expect(result.metadata?.amount).toBe(TEST_AMOUNTS.ONE_DOT);
        expect(result.metadata?.sender).toBe(TEST_ADDRESSES.ALICE);
        expect(result.metadata?.recipient).toBe(TEST_ADDRESSES.BOB);
        expect(result.metadata?.keepAlive).toBe(false);
        // Asset Hub with DOT prefers transferKeepAlive even when keepAlive is false
        // (see shouldUseKeepAlive logic in transferCapabilities.ts)
        expect(mockAssetHubApi.tx?.balances?.transferKeepAlive).toHaveBeenCalledWith(
          TEST_ADDRESSES.BOB,
          expect.any(Object) // BN object
        );
      });

      it('should create a transferKeepAlive extrinsic when keepAlive is true', async () => {
        const result = await agent.transfer({
          address: TEST_ADDRESSES.ALICE,
          recipient: TEST_ADDRESSES.BOB,
          amount: TEST_AMOUNTS.ONE_DOT,
          keepAlive: true,
        });

        expect(result.extrinsic).toBeDefined();
        expect(result.metadata?.keepAlive).toBe(true);
        expect(result.warnings).toContain('Using transferKeepAlive - sender account will remain alive');
        expect(mockAssetHubApi.tx?.balances?.transferKeepAlive).toHaveBeenCalledWith(
          TEST_ADDRESSES.BOB,
          expect.any(Object) // BN object
        );
      });

      it('should parse human-readable amounts correctly', async () => {
        const result = await agent.transfer({
          address: TEST_ADDRESSES.ALICE,
          recipient: TEST_ADDRESSES.BOB,
          amount: TEST_AMOUNTS_HUMAN.ONE_DOT,
        });

        // 1.0 DOT = 10000000000 Planck
        expect(result.metadata?.amount).toBe(TEST_AMOUNTS.ONE_DOT);
        // formatAmount returns 10 decimal places: "1.0000000000"
        expect(result.metadata?.formattedAmount).toBe('1.0000000000');
      });

      it('should include estimated fee in result', async () => {
        const result = await agent.transfer({
          address: TEST_ADDRESSES.ALICE,
          recipient: TEST_ADDRESSES.BOB,
          amount: TEST_AMOUNTS.ONE_DOT,
        });

        expect(result.estimatedFee).toBeDefined();
        expect(result.estimatedFee).toBeTruthy();
      });
    });

    describe('Validation Failures', () => {
      it('should throw AgentError for invalid sender address', async () => {
        const error = await agent.transfer({
          address: INVALID_ADDRESSES.EMPTY,
          recipient: TEST_ADDRESSES.BOB,
          amount: TEST_AMOUNTS.ONE_DOT,
        }).catch((e: unknown) => e) as AgentError;

        expect(error).toBeInstanceOf(AgentError);
        expect(error.code).toBe('INVALID_SENDER_ADDRESS');
      });

      it('should throw AgentError for invalid recipient address', async () => {
        const error = await agent.transfer({
          address: TEST_ADDRESSES.ALICE,
          recipient: INVALID_ADDRESSES.EMPTY,
          amount: TEST_AMOUNTS.ONE_DOT,
        }).catch(e => e);

        expect(error).toBeInstanceOf(AgentError);
        expect(error.code).toBe('INVALID_RECIPIENT_ADDRESS');
      });

      it('should throw AgentError when sender and recipient are the same', async () => {
        const error = await agent.transfer({
          address: TEST_ADDRESSES.ALICE,
          recipient: TEST_ADDRESSES.ALICE,
          amount: TEST_AMOUNTS.ONE_DOT,
        }).catch(e => e);

        expect(error).toBeInstanceOf(AgentError);
        expect(error.code).toBe('SAME_SENDER_RECIPIENT');
      });

      it('should throw AgentError for zero amount', async () => {
        const error = await agent.transfer({
          address: TEST_ADDRESSES.ALICE,
          recipient: TEST_ADDRESSES.BOB,
          amount: TEST_AMOUNTS.ZERO,
        }).catch(e => e);

        expect(error).toBeInstanceOf(AgentError);
        expect(error.code).toBe('INVALID_AMOUNT');
      });

      it('should throw AgentError for negative amount', async () => {
        const error = await agent.transfer({
          address: TEST_ADDRESSES.ALICE,
          recipient: TEST_ADDRESSES.BOB,
          amount: TEST_AMOUNTS.NEGATIVE,
        }).catch(e => e);

        expect(error).toBeInstanceOf(AgentError);
        expect(error.code).toBe('INVALID_AMOUNT');
      });

      it('should throw AgentError for insufficient balance', async () => {
        // Mock insufficient balance on Asset Hub API (used for transfers)
        const mockAccountQuery = mockAssetHubApi.query?.system?.account as jest.MockedFunction<any>;
        mockAccountQuery.mockResolvedValue(createMockInsufficientBalance());

        const error = await agent.transfer({
          address: TEST_ADDRESSES.ALICE,
          recipient: TEST_ADDRESSES.BOB,
          amount: TEST_AMOUNTS.ONE_DOT, // 1 DOT, but only 0.1 DOT available
        }).catch(e => e);

        expect(error).toBeInstanceOf(AgentError);
        expect(error.code).toBe('INSUFFICIENT_BALANCE');
      });

      it('should skip balance validation when validateBalance is false', async () => {
        // Mock insufficient balance on Asset Hub API (used for transfers)
        const mockAccountQuery = mockAssetHubApi.query?.system?.account as jest.MockedFunction<any>;
        mockAccountQuery.mockResolvedValue(createMockInsufficientBalance());

        // Should not throw when validateBalance is false
        const result = await agent.transfer({
          address: TEST_ADDRESSES.ALICE,
          recipient: TEST_ADDRESSES.BOB,
          amount: TEST_AMOUNTS.ONE_DOT,
          validateBalance: false,
        });

        expect(result.extrinsic).toBeDefined();
      });
    });

    describe('Error Handling', () => {
      it('should throw AgentError if agent is not initialized', async () => {
        const uninitializedAgent = new AssetTransferAgent();

        const error = await uninitializedAgent.transfer({
          address: TEST_ADDRESSES.ALICE,
          recipient: TEST_ADDRESSES.BOB,
          amount: TEST_AMOUNTS.ONE_DOT,
        }).catch(e => e);

        expect(error).toBeInstanceOf(AgentError);
        expect(error.code).toBe('NOT_INITIALIZED');
      });

      it('should handle API query errors gracefully', async () => {
        // Mock API query to throw error on Asset Hub API (used for transfers)
        const mockAccountQuery = mockAssetHubApi.query?.system?.account as jest.MockedFunction<any>;
        mockAccountQuery.mockRejectedValue(new Error('RPC connection failed'));

        const error = await agent.transfer({
          address: TEST_ADDRESSES.ALICE,
          recipient: TEST_ADDRESSES.BOB,
          amount: TEST_AMOUNTS.ONE_DOT,
        }).catch(e => e);

        expect(error).toBeInstanceOf(AgentError);
        expect(error.code).toBe('TRANSFER_ERROR');
      });
    });
  });

  describe('batchTransfer()', () => {
    describe('Happy Path', () => {
      it('should create a batch transfer extrinsic with multiple recipients', async () => {
        const result = await agent.batchTransfer({
          address: TEST_ADDRESSES.ALICE,
          transfers: [
            { recipient: TEST_ADDRESSES.BOB, amount: TEST_AMOUNTS.ONE_DOT },
            { recipient: TEST_ADDRESSES.CHARLIE, amount: TEST_AMOUNTS.HALF_DOT },
          ],
        });

        expect(result.extrinsic).toBeDefined();
        expect(result.resultType).toBe('extrinsic');
        expect(result.metadata?.transferCount).toBe(2);
        expect(result.metadata?.transfers).toHaveLength(2);
        expect(result.warnings).toContain('Using batchAll - all transfers must succeed or entire batch fails');
        expect(mockAssetHubApi.tx?.utility?.batchAll).toHaveBeenCalled();
      });

      it('should calculate total amount correctly', async () => {
        const result = await agent.batchTransfer({
          address: TEST_ADDRESSES.ALICE,
          transfers: [
            { recipient: TEST_ADDRESSES.BOB, amount: TEST_AMOUNTS.ONE_DOT },
            { recipient: TEST_ADDRESSES.CHARLIE, amount: TEST_AMOUNTS.HALF_DOT },
          ],
        });

        // 1 DOT + 0.5 DOT = 1.5 DOT = 15000000000 Planck
        const expectedTotal = new BN(TEST_AMOUNTS.ONE_DOT)
          .add(new BN(TEST_AMOUNTS.HALF_DOT))
          .toString();
        expect(result.metadata?.totalAmount).toBe(expectedTotal);
      });
    });

    describe('Validation Failures', () => {
      it('should throw AgentError for empty transfers array', async () => {
        const error = await agent.batchTransfer({
          address: TEST_ADDRESSES.ALICE,
          transfers: [],
        }).catch(e => e);

        expect(error).toBeInstanceOf(AgentError);
        expect(error.code).toBe('NO_TRANSFERS');
      });

      it('should throw AgentError for more than 100 transfers', async () => {
        const tooManyTransfers = Array.from({ length: 101 }, (_, i) => ({
          recipient: TEST_ADDRESSES.BOB,
          amount: TEST_AMOUNTS.ONE_PLANCK,
        }));

        const error = await agent.batchTransfer({
          address: TEST_ADDRESSES.ALICE,
          transfers: tooManyTransfers,
        }).catch(e => e);

        expect(error).toBeInstanceOf(AgentError);
        expect(error.code).toBe('TOO_MANY_TRANSFERS');
      });

      it('should throw AgentError for invalid recipient in batch with index', async () => {
        const error = await agent.batchTransfer({
          address: TEST_ADDRESSES.ALICE,
          transfers: [
            { recipient: TEST_ADDRESSES.BOB, amount: TEST_AMOUNTS.ONE_DOT },
            { recipient: INVALID_ADDRESSES.EMPTY, amount: TEST_AMOUNTS.ONE_DOT },
          ],
        }).catch(e => e);

        expect(error).toBeInstanceOf(AgentError);
        expect(error.code).toBe('INVALID_RECIPIENT_ADDRESS');
      });

      it('should throw AgentError when sender equals recipient in batch', async () => {
        const error = await agent.batchTransfer({
          address: TEST_ADDRESSES.ALICE,
          transfers: [
            { recipient: TEST_ADDRESSES.BOB, amount: TEST_AMOUNTS.ONE_DOT },
            { recipient: TEST_ADDRESSES.ALICE, amount: TEST_AMOUNTS.ONE_DOT },
          ],
        }).catch(e => e);

        expect(error).toBeInstanceOf(AgentError);
        expect(error.code).toBe('SAME_SENDER_RECIPIENT');
      });

      it('should throw AgentError for zero amount in batch', async () => {
        const error = await agent.batchTransfer({
          address: TEST_ADDRESSES.ALICE,
          transfers: [
            { recipient: TEST_ADDRESSES.BOB, amount: TEST_AMOUNTS.ZERO },
          ],
        }).catch(e => e);

        expect(error).toBeInstanceOf(AgentError);
        expect(error.code).toBe('INVALID_AMOUNT');
      });

      it('should throw AgentError for insufficient balance for total batch amount', async () => {
        // Mock insufficient balance on Asset Hub API (used for transfers)
        const mockAccountQuery = mockAssetHubApi.query?.system?.account as jest.MockedFunction<any>;
        mockAccountQuery.mockResolvedValue(createMockInsufficientBalance());

        const error = await agent.batchTransfer({
          address: TEST_ADDRESSES.ALICE,
          transfers: [
            { recipient: TEST_ADDRESSES.BOB, amount: TEST_AMOUNTS.ONE_DOT },
            { recipient: TEST_ADDRESSES.CHARLIE, amount: TEST_AMOUNTS.ONE_DOT },
          ],
        }).catch(e => e);

        expect(error).toBeInstanceOf(AgentError);
        expect(error.code).toBe('INSUFFICIENT_BALANCE');
      });
    });

    describe('Error Handling', () => {
      it('should throw AgentError if agent is not initialized', async () => {
        const uninitializedAgent = new AssetTransferAgent();

        const error = await uninitializedAgent.batchTransfer({
          address: TEST_ADDRESSES.ALICE,
          transfers: [
            { recipient: TEST_ADDRESSES.BOB, amount: TEST_AMOUNTS.ONE_DOT },
          ],
        }).catch(e => e);

        expect(error).toBeInstanceOf(AgentError);
        expect(error.code).toBe('NOT_INITIALIZED');
      });

      it('should handle batch extrinsic creation failure', async () => {
        // Mock batchAll creation to throw error on Asset Hub API (used for transfers)
        const mockBatchAll = mockAssetHubApi.tx?.utility?.batchAll as jest.MockedFunction<any>;
        mockBatchAll.mockImplementation(() => {
          throw new Error('Batch creation failed');
        });

        const error = await agent.batchTransfer({
          address: TEST_ADDRESSES.ALICE,
          transfers: [
            { recipient: TEST_ADDRESSES.BOB, amount: TEST_AMOUNTS.ONE_DOT },
          ],
        }).catch(e => e);

        expect(error).toBeInstanceOf(AgentError);
        expect(error.code).toBe('BATCH_TRANSFER_ERROR');
      });
    });
  });
});


