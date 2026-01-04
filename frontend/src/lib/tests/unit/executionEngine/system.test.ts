/**
 * Unit tests for ExecutionSystem
 */

// Mock dependencies before imports
jest.mock('../../../executionEngine/orchestrator');
jest.mock('../../../executionEngine/executioner');

import { ExecutionSystem } from '../../../executionEngine/system';
import { ExecutionOrchestrator } from '../../../executionEngine/orchestrator';
import { Executioner } from '../../../executionEngine/executioner';
import { ExecutionArray } from '../../../executionEngine/executionArray';
import { ExecutionPlan, ExecutionStep } from '../../../prompts/system/execution/types';
import { ApiPromise } from '@polkadot/api';
import { WalletAccount } from '../../../types/wallet';
import { Signer } from '../../../executionEngine/signers/types';
import { RpcManager } from '../../../rpcManager';
import { SimulationStatusCallback } from '../../../agents/types';
import { ExecutionOptions, SigningRequest, BatchSigningRequest } from '../../../executionEngine/types';

describe('ExecutionSystem', () => {
  let system: ExecutionSystem;
  let mockOrchestrator: jest.Mocked<ExecutionOrchestrator>;
  let mockExecutioner: jest.Mocked<Executioner>;
  let mockApi: Partial<ApiPromise>;
  let mockAssetHubApi: Partial<ApiPromise>;
  let mockAccount: WalletAccount;
  let mockSigner: jest.Mocked<Signer>;
  let mockRelayChainManager: jest.Mocked<RpcManager>;
  let mockAssetHubManager: jest.Mocked<RpcManager>;
  let mockExecutionArray: jest.Mocked<ExecutionArray>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock API
    mockApi = {
      isReady: Promise.resolve({} as ApiPromise),
      isConnected: true,
    } as Partial<ApiPromise>;

    mockAssetHubApi = {
      isReady: Promise.resolve({} as ApiPromise),
      isConnected: true,
    } as Partial<ApiPromise>;

    // Create mock account
    mockAccount = {
      address: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
      name: 'Test Account',
      source: 'polkadot-js',
    };

    // Create mock signer
    mockSigner = {
      signExtrinsic: jest.fn(),
    } as any;

    // Create mock RPC managers
    mockRelayChainManager = {} as jest.Mocked<RpcManager>;
    mockAssetHubManager = {} as jest.Mocked<RpcManager>;

    // Create mock execution array
    mockExecutionArray = {
      isEmpty: jest.fn().mockReturnValue(false),
      onStatusUpdate: jest.fn().mockReturnValue(() => {}),
      getState: jest.fn().mockReturnValue({
        completedItems: 2,
        failedItems: 0,
        totalItems: 2,
      }),
    } as any;

    // Mock orchestrator
    mockOrchestrator = {
      initialize: jest.fn(),
      orchestrate: jest.fn().mockResolvedValue({
        success: true,
        executionArray: mockExecutionArray,
        errors: [],
        metadata: {
          totalSteps: 2,
          successfulSteps: 2,
          failedSteps: 0,
          duration: 100,
        },
      }),
    } as any;

    // Mock executioner
    mockExecutioner = {
      initialize: jest.fn(),
      setSigningRequestHandler: jest.fn(),
      setBatchSigningRequestHandler: jest.fn(),
      execute: jest.fn().mockResolvedValue(undefined),
    } as any;

    // Mock constructors
    (ExecutionOrchestrator as jest.Mock).mockImplementation(() => mockOrchestrator);
    (Executioner as jest.Mock).mockImplementation(() => mockExecutioner);

    // Create system instance
    system = new ExecutionSystem();
  });

  describe('Constructor', () => {
    it('should create orchestrator and executioner instances', () => {
      expect(ExecutionOrchestrator).toHaveBeenCalledTimes(1);
      expect(Executioner).toHaveBeenCalledTimes(1);
    });
  });

  describe('initialize()', () => {
    it('should initialize orchestrator with API and optional parameters', () => {
      const onSimulationStatus: SimulationStatusCallback = jest.fn();

      system.initialize(
        mockApi as ApiPromise,
        mockAccount,
        mockSigner,
        mockAssetHubApi as ApiPromise,
        mockRelayChainManager,
        mockAssetHubManager,
        onSimulationStatus
      );

      expect(mockOrchestrator.initialize).toHaveBeenCalledWith(
        mockApi,
        mockAssetHubApi,
        onSimulationStatus,
        mockRelayChainManager,
        mockAssetHubManager
      );
    });

    it('should initialize executioner with API, account, and optional parameters', () => {
      const onSimulationStatus: SimulationStatusCallback = jest.fn();

      system.initialize(
        mockApi as ApiPromise,
        mockAccount,
        mockSigner,
        mockAssetHubApi as ApiPromise,
        mockRelayChainManager,
        mockAssetHubManager,
        onSimulationStatus
      );

      expect(mockExecutioner.initialize).toHaveBeenCalledWith(
        mockApi,
        mockAccount,
        mockSigner,
        mockAssetHubApi,
        mockRelayChainManager,
        mockAssetHubManager,
        onSimulationStatus
      );
    });

    it('should handle null optional parameters', () => {
      system.initialize(
        mockApi as ApiPromise,
        mockAccount,
        undefined,
        null,
        null,
        null,
        null
      );

      expect(mockOrchestrator.initialize).toHaveBeenCalledWith(
        mockApi,
        null,
        null,
        null,
        null
      );

      expect(mockExecutioner.initialize).toHaveBeenCalledWith(
        mockApi,
        mockAccount,
        undefined,
        null,
        null,
        null,
        undefined
      );
    });
  });

  describe('setSigningHandler()', () => {
    it('should delegate to executioner setSigningRequestHandler', () => {
      const handler = jest.fn();

      system.setSigningHandler(handler);

      expect(mockExecutioner.setSigningRequestHandler).toHaveBeenCalledWith(handler);
      expect(mockExecutioner.setSigningRequestHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('setBatchSigningHandler()', () => {
    it('should delegate to executioner setBatchSigningRequestHandler', () => {
      const handler = jest.fn();

      system.setBatchSigningHandler(handler);

      expect(mockExecutioner.setBatchSigningRequestHandler).toHaveBeenCalledWith(handler);
      expect(mockExecutioner.setBatchSigningRequestHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('execute()', () => {
    let mockPlan: ExecutionPlan;
    let mockStep1: ExecutionStep;
    let mockStep2: ExecutionStep;

    beforeEach(() => {
      mockStep1 = {
        id: 'step-1',
        stepNumber: 1,
        agentClassName: 'AssetTransferAgent',
        functionName: 'transfer',
        parameters: { recipient: '14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3', amount: '1' },
        executionType: 'extrinsic',
        status: 'pending',
        description: 'Transfer 1 DOT',
        requiresConfirmation: true,
        createdAt: Date.now(),
      };

      mockStep2 = {
        id: 'step-2',
        stepNumber: 2,
        agentClassName: 'AssetTransferAgent',
        functionName: 'transfer',
        parameters: { recipient: '14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3', amount: '2' },
        executionType: 'extrinsic',
        status: 'pending',
        description: 'Transfer 2 DOT',
        requiresConfirmation: true,
        createdAt: Date.now(),
      };

      mockPlan = {
        id: 'test-plan',
        originalRequest: 'Send 3 DOT',
        steps: [mockStep1, mockStep2],
        status: 'pending',
        requiresApproval: true,
        createdAt: Date.now(),
      };
    });

    it('should orchestrate plan and execute with tracking', async () => {
      const options: ExecutionOptions = {};
      const onPreparingStep = jest.fn();
      const onExecutingStep = jest.fn();
      const onComplete = jest.fn();

      await system.execute(mockPlan, options, {
        onPreparingStep,
        onExecutingStep,
        onComplete,
      });

      // Should call orchestrator
      expect(mockOrchestrator.orchestrate).toHaveBeenCalledWith(mockPlan, {
        onProgress: expect.any(Function),
        onError: expect.any(Function),
      });

      // Should subscribe to execution array updates
      expect(mockExecutionArray.onStatusUpdate).toHaveBeenCalled();

      // Should call executioner
      expect(mockExecutioner.execute).toHaveBeenCalledWith(mockExecutionArray, options);

      // Should call onComplete with success
      expect(onComplete).toHaveBeenCalledWith(true, 2, 0);
    });

    it('should call onPreparingStep callback during orchestration', async () => {
      const onPreparingStep = jest.fn();

      // Mock orchestrate to call onProgress
      (mockOrchestrator.orchestrate as jest.Mock).mockImplementation((plan, options) => {
        // Simulate progress callback
        if (options.onProgress) {
          options.onProgress(mockStep1, 0, 2);
          options.onProgress(mockStep2, 1, 2);
        }
        return Promise.resolve({
          success: true,
          executionArray: mockExecutionArray,
          errors: [],
          metadata: {
            totalSteps: 2,
            successfulSteps: 2,
            failedSteps: 0,
            duration: 100,
          },
        });
      });

      await system.execute(mockPlan, {}, { onPreparingStep });

      expect(onPreparingStep).toHaveBeenCalledWith('Transfer 1 DOT', 1, 2);
      expect(onPreparingStep).toHaveBeenCalledWith('Transfer 2 DOT', 2, 2);
    });

    it('should call onError callback when orchestration has errors', async () => {
      const onError = jest.fn();
      const orchestrationErrors = [
        { stepId: 'step-1', error: 'Agent error', step: mockStep1 },
      ];

      (mockOrchestrator.orchestrate as jest.Mock).mockResolvedValue({
        success: false,
        executionArray: mockExecutionArray,
        errors: orchestrationErrors,
        metadata: {
          totalSteps: 2,
          successfulSteps: 1,
          failedSteps: 1,
          duration: 100,
        },
      });

      await system.execute(mockPlan, {}, { onError });

      expect(onError).toHaveBeenCalledWith('Orchestration completed with 1 error(s)');
    });

    it('should call onError callback when step preparation fails', async () => {
      const onError = jest.fn();
      const testError = new Error('Agent failed');

      (mockOrchestrator.orchestrate as jest.Mock).mockImplementation((plan, options) => {
        // Simulate error callback
        if (options.onError) {
          options.onError(mockStep1, testError);
        }
        return Promise.resolve({
          success: true,
          executionArray: mockExecutionArray,
          errors: [],
          metadata: {
            totalSteps: 2,
            successfulSteps: 2,
            failedSteps: 0,
            duration: 100,
          },
        });
      });

      await system.execute(mockPlan, {}, { onError });

      expect(onError).toHaveBeenCalledWith('Failed to prepare Transfer 1 DOT: Agent failed');
    });

    it('should return early if execution array is empty', async () => {
      const onError = jest.fn();
      (mockExecutionArray.isEmpty as jest.Mock).mockReturnValue(true);

      (mockOrchestrator.orchestrate as jest.Mock).mockResolvedValue({
        success: true,
        executionArray: mockExecutionArray,
        errors: [],
        metadata: {
          totalSteps: 0,
          successfulSteps: 0,
          failedSteps: 0,
          duration: 0,
        },
      });

      await system.execute(mockPlan, {}, { onError });

      expect(onError).toHaveBeenCalledWith('No operations to execute');
      expect(mockExecutioner.execute).not.toHaveBeenCalled();
    });

    it('should call onExecutingStep callback when execution array updates', async () => {
      const onExecutingStep = jest.fn();
      let statusUpdateCallback: ((item: any) => void) | undefined;

      // Capture the status update callback
      (mockExecutionArray.onStatusUpdate as jest.Mock).mockImplementation((callback) => {
        statusUpdateCallback = callback;
        return () => {}; // Return unsubscribe function
      });

      await system.execute(mockPlan, {}, { onExecutingStep });

      // Simulate status update
      if (statusUpdateCallback) {
        statusUpdateCallback({
          description: 'Transfer 1 DOT',
          status: 'executing',
        });
      }

      expect(onExecutingStep).toHaveBeenCalledWith('Transfer 1 DOT', 'executing');
    });

    it('should unsubscribe from execution array updates after execution', async () => {
      const unsubscribe = jest.fn();
      (mockExecutionArray.onStatusUpdate as jest.Mock).mockReturnValue(unsubscribe);

      await system.execute(mockPlan, {}, {});

      expect(unsubscribe).toHaveBeenCalled();
    });

    it('should call onComplete with failure count when items fail', async () => {
      const onComplete = jest.fn();
      (mockExecutionArray.getState as jest.Mock).mockReturnValue({
        completedItems: 1,
        failedItems: 1,
        totalItems: 2,
      });

      await system.execute(mockPlan, {}, { onComplete });

      expect(onComplete).toHaveBeenCalledWith(false, 1, 1);
    });

    it('should handle execution errors gracefully', async () => {
      const onError = jest.fn();
      const executionError = new Error('Execution failed');
      (mockExecutioner.execute as jest.Mock).mockRejectedValue(executionError);

      await expect(system.execute(mockPlan, {}, { onError })).rejects.toThrow('Execution failed');

      // Should still unsubscribe
      expect(mockExecutionArray.onStatusUpdate).toHaveBeenCalled();
    });

    it('should work without callbacks', async () => {
      await system.execute(mockPlan, {}, undefined);

      expect(mockOrchestrator.orchestrate).toHaveBeenCalled();
      expect(mockExecutioner.execute).toHaveBeenCalled();
    });

    it('should pass execution options to executioner', async () => {
      const options: ExecutionOptions = {
        timeout: 60000,
        autoApprove: false,
      };

      await system.execute(mockPlan, options, {});

      expect(mockExecutioner.execute).toHaveBeenCalledWith(mockExecutionArray, options);
    });
  });
});

