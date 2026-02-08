/**
 * Unit tests for Executioner
 */

import { Executioner } from '../../../executionEngine/executioner';
import { ExecutionArray } from '../../../executionEngine/executionArray';
import { Signer } from '../../../executionEngine/signers/types';
import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import {
  createMockAgentResult,
  createMockAgentResults,
  wait,
} from './fixturesTestHelpers';

// Mock Polkadot API
jest.mock('@polkadot/api', () => ({
  ApiPromise: jest.fn(),
}));

// Mock web3FromAddress
jest.mock('@polkadot/extension-dapp', () => ({
  web3FromAddress: jest.fn(),
}));

// Mock @polkadot/util-crypto for dynamic imports
jest.mock('@polkadot/util-crypto', () => ({
  decodeAddress: (address: string) => {
    if (!address || address.length === 0) {
      throw new Error('Invalid address');
    }
    // Return a valid 32-byte array
    return new Uint8Array(32);
  },
  encodeAddress: (publicKey: Uint8Array, ss58Format?: number) => {
    // Return a mock address
    return '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';
  },
}));

describe('Executioner', () => {
  let executioner: Executioner;
  let executionArray: ExecutionArray;
  let mockApi: Partial<ApiPromise>;
  let mockAccount: { address: string; name?: string; source: string };
  let mockSigner: Signer;
  let mockExtrinsic: Partial<SubmittableExtrinsic<'promise'>>;

  beforeEach(() => {
    // Disable simulation by default for tests
    const { disableSimulation } = require('../../../executionEngine/simulation/simulationConfig');
    disableSimulation();
    executioner = new Executioner();
    executionArray = new ExecutionArray();

    // Mock account
    mockAccount = {
      address: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
      name: 'Test Account',
      source: 'polkadot-js',
    };

    // Mock extrinsic
    mockExtrinsic = {
      signAsync: jest.fn().mockResolvedValue({} as any),
      signAndSend: jest.fn().mockImplementation((address, options, callback) => {
        // Simulate successful transaction
        setTimeout(() => {
          callback({
            status: {
              isFinalized: true,
              asFinalized: { toString: () => '0x123' },
            },
            events: [],
          });
        }, 10);
        return Promise.resolve();
      }),
      send: jest.fn().mockImplementation((callback) => {
        setTimeout(() => {
          callback({
            status: {
              isFinalized: true,
              asFinalized: { toString: () => '0x123' },
            },
            events: [],
          });
        }, 10);
        return Promise.resolve();
      }),
      hash: { toString: () => '0xabc123' },
    } as any;

    // Mock API
    const mockRegistry = {
      chainSS58: 0,
    };
    mockApi = {
      tx: {
        utility: {
          batchAll: jest.fn().mockReturnValue(mockExtrinsic),
        },
      },
      events: {
        system: {
          ExtrinsicFailed: {
            is: jest.fn().mockReturnValue(false),
          },
        },
      },
      registry: mockRegistry,
    } as any;
    
    // Mock extrinsic registry to match API registry
    (mockExtrinsic as any).registry = mockRegistry;

    // Mock signer
    mockSigner = {
      signExtrinsic: jest.fn().mockResolvedValue(mockExtrinsic as any),
      getType: jest.fn().mockReturnValue('test-signer'),
      requestApproval: jest.fn().mockResolvedValue(true),
    };
  });

  describe('Initialization', () => {
    it('should initialize with API and account', () => {
      executioner.initialize(mockApi as ApiPromise, mockAccount);
      // Should not throw
      expect(() => {
        executioner.initialize(mockApi as ApiPromise, mockAccount);
      }).not.toThrow();
    });

    it('should initialize with signer', () => {
      executioner.initialize(mockApi as ApiPromise, mockAccount, mockSigner);
      // Should not throw
      expect(() => {
        executioner.initialize(mockApi as ApiPromise, mockAccount, mockSigner);
      }).not.toThrow();
    });

    it('should throw error if not initialized before execute', async () => {
      await expect(
        executioner.execute(executionArray)
      ).rejects.toThrow('Executioner not initialized');
    });
  });

  describe('Execution Flow', () => {
    beforeEach(() => {
      executioner.initialize(mockApi as ApiPromise, mockAccount, mockSigner);
    });

    it('should execute empty array without error', async () => {
      await executioner.execute(executionArray);
      expect(executionArray.getState().isExecuting).toBe(false);
    });

    it('should set executing flag during execution', async () => {
      const item = executionArray.add(
        createMockAgentResult({ executionType: 'data_fetch' })
      );

      const executePromise = executioner.execute(executionArray);
      
      // Check that executing flag is set
      expect(executionArray.getState().isExecuting).toBe(true);
      
      await executePromise;
      expect(executionArray.getState().isExecuting).toBe(false);
    });

    it('should execute data_fetch operations', async () => {
      const agentResult = createMockAgentResult({
        executionType: 'data_fetch',
        data: { balance: '100' },
      });
      const id = executionArray.add(agentResult);

      await executioner.execute(executionArray);

      const item = executionArray.getItem(id);
      expect(item?.status).toBe('completed');
      expect(item?.result?.success).toBe(true);
      expect(item?.result?.data).toEqual({ balance: '100' });
    });

    it('should execute validation operations', async () => {
      const agentResult = createMockAgentResult({
        executionType: 'validation',
        data: { valid: true },
      });
      const id = executionArray.add(agentResult);

      await executioner.execute(executionArray);

      const item = executionArray.getItem(id);
      expect(item?.status).toBe('completed');
      expect(item?.result?.success).toBe(true);
    });

    it('should mark user_input operations as ready', async () => {
      const agentResult = createMockAgentResult({
        executionType: 'user_input',
      });
      const id = executionArray.add(agentResult);

      await executioner.execute(executionArray);

      const item = executionArray.getItem(id);
      expect(item?.status).toBe('ready');
    });
  });

  describe('Extrinsic Execution', () => {
    beforeEach(() => {
      executioner.initialize(mockApi as ApiPromise, mockAccount, mockSigner);
    });

    it('should execute extrinsic with auto-approve', async () => {
      const agentResult = createMockAgentResult({
        executionType: 'extrinsic',
        extrinsic: mockExtrinsic as any,
      });
      const id = executionArray.add(agentResult);

      await executioner.execute(executionArray, { autoApprove: true });

      const item = executionArray.getItem(id);
      expect(mockSigner.signExtrinsic).toHaveBeenCalled();
      expect(item?.status).toBe('finalized');
    });

    it('should request approval when autoApprove is false', async () => {
      const agentResult = createMockAgentResult({
        executionType: 'extrinsic',
        extrinsic: mockExtrinsic as any,
      });
      const id = executionArray.add(agentResult);

      // Mock approval request
      (mockSigner.requestApproval as jest.Mock).mockResolvedValue(true);

      await executioner.execute(executionArray, { autoApprove: false });

      expect(mockSigner.requestApproval).toHaveBeenCalled();
      const item = executionArray.getItem(id);
      expect(item?.status).toBe('finalized');
    });

    it('should cancel when user rejects', async () => {
      const agentResult = createMockAgentResult({
        executionType: 'extrinsic',
        extrinsic: mockExtrinsic as any,
      });
      const id = executionArray.add(agentResult);

      // Mock rejection
      (mockSigner.requestApproval as jest.Mock).mockResolvedValue(false);

      await executioner.execute(executionArray, { autoApprove: false });

      const item = executionArray.getItem(id);
      expect(item?.status).toBe('cancelled');
      expect(item?.error).toContain('rejected');
    });

    it('should update status through execution lifecycle', async () => {
      const statusUpdates: string[] = [];
      
      // Register callback BEFORE adding item to catch status updates
      executionArray.onStatusUpdate((item) => {
        statusUpdates.push(item.status);
      });

      const agentResult = createMockAgentResult({
        executionType: 'extrinsic',
        extrinsic: mockExtrinsic as any,
      });
      const id = executionArray.add(agentResult);

      await executioner.execute(executionArray, { autoApprove: true });

      // Wait for all deferred notifications to fire
      await wait(100);

      // Deferred notifications batch rapid updates; we may not see every transition
      // (ready/signing can be coalesced). Assert we receive updates and reach finalized.
      expect(statusUpdates.length).toBeGreaterThanOrEqual(1);
      expect(statusUpdates).toContain('finalized');
      expect(executionArray.getItem(id)?.status).toBe('finalized');
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      executioner.initialize(mockApi as ApiPromise, mockAccount, mockSigner);
    });

    it('should handle errors and mark item as failed', async () => {
      const agentResult = createMockAgentResult({
        executionType: 'extrinsic',
        extrinsic: mockExtrinsic as any,
      });
      const id = executionArray.add(agentResult);

      // Mock signer to throw error
      (mockSigner.signExtrinsic as jest.Mock).mockRejectedValue(
        new Error('Signing failed')
      );

      await expect(
        executioner.execute(executionArray, { autoApprove: true })
      ).rejects.toThrow();

      const item = executionArray.getItem(id);
      expect(item?.status).toBe('failed');
      expect(item?.error).toContain('Signing failed');
    });

    it('should continue on error when continueOnError is true', async () => {
      const id1 = executionArray.add(
        createMockAgentResult({
          executionType: 'extrinsic',
          extrinsic: mockExtrinsic as any,
        })
      );
      const id2 = executionArray.add(
        createMockAgentResult({ executionType: 'data_fetch' })
      );

      // First item fails
      (mockSigner.signExtrinsic as jest.Mock).mockRejectedValueOnce(
        new Error('First failed')
      );
      // Second signer call succeeds (for second item if it were extrinsic)
      (mockSigner.signExtrinsic as jest.Mock).mockResolvedValue(mockExtrinsic as any);

      await executioner.execute(executionArray, {
        continueOnError: true,
        autoApprove: true,
      });

      const item1 = executionArray.getItem(id1);
      const item2 = executionArray.getItem(id2);
      expect(item1?.status).toBe('failed');
      expect(item2?.status).toBe('completed');
    });

    it('should stop on error when continueOnError is false', async () => {
      const id1 = executionArray.add(
        createMockAgentResult({
          executionType: 'extrinsic',
          extrinsic: mockExtrinsic as any,
        })
      );
      const id2 = executionArray.add(
        createMockAgentResult({ executionType: 'data_fetch' })
      );

      // First item fails
      (mockSigner.signExtrinsic as jest.Mock).mockRejectedValueOnce(
        new Error('First failed')
      );

      await expect(
        executioner.execute(executionArray, {
          continueOnError: false,
          autoApprove: true,
        })
      ).rejects.toThrow();

      const item1 = executionArray.getItem(id1);
      const item2 = executionArray.getItem(id2);
      expect(item1?.status).toBe('failed');
      // Second item should not be executed - remains in initial state (ready when simulation disabled)
      expect(item2?.status).toBe('ready');
    });
  });

  describe('Execution Options', () => {
    beforeEach(() => {
      executioner.initialize(mockApi as ApiPromise, mockAccount, mockSigner);
    });

    it('should execute sequentially by default', async () => {
      const id1 = executionArray.add(
        createMockAgentResult({ executionType: 'data_fetch' })
      );
      const id2 = executionArray.add(
        createMockAgentResult({ executionType: 'data_fetch' })
      );

      await executioner.execute(executionArray, { sequential: true });

      const item1 = executionArray.getItem(id1);
      const item2 = executionArray.getItem(id2);
      expect(item1?.status).toBe('completed');
      expect(item2?.status).toBe('completed');
    });

    it('should handle timeout', async () => {
      const agentResult = createMockAgentResult({
        executionType: 'extrinsic',
        extrinsic: mockExtrinsic as any,
      });
      const id = executionArray.add(agentResult);

      // Mock a transaction that never finalizes
      (mockExtrinsic.send as jest.Mock).mockImplementation(() => {
        return Promise.resolve(); // Never calls callback
      });

      await expect(
        executioner.execute(executionArray, {
          autoApprove: true,
          timeout: 100, // Short timeout
        })
      ).rejects.toThrow('timeout');
    });
  });

  describe('Signer Integration', () => {
    it('should use custom signer when provided', async () => {
      executioner.initialize(mockApi as ApiPromise, mockAccount, mockSigner);

      const agentResult = createMockAgentResult({
        executionType: 'extrinsic',
        extrinsic: mockExtrinsic as any,
      });
      const id = executionArray.add(agentResult);

      await executioner.execute(executionArray, { autoApprove: true });

      expect(mockSigner.signExtrinsic).toHaveBeenCalledWith(
        mockExtrinsic,
        mockAccount.address
      );
    });

    it('should call requestApproval when signer supports it', async () => {
      executioner.initialize(mockApi as ApiPromise, mockAccount, mockSigner);

      const agentResult = createMockAgentResult({
        executionType: 'extrinsic',
        extrinsic: mockExtrinsic as any,
      });
      executionArray.add(agentResult);

      (mockSigner.requestApproval as jest.Mock).mockResolvedValue(true);

      await executioner.execute(executionArray, { autoApprove: false });

      expect(mockSigner.requestApproval).toHaveBeenCalled();
    });
  });
});

