/**
 * Unit tests for ExecutionOrchestrator
 */

import { ExecutionOrchestrator } from '../../../executionEngine/orchestrator';
import { ExecutionPlan, ExecutionStep } from '../../../prompts/system/execution/types';
import { ApiPromise } from '@polkadot/api';
import { createMockAgentResult } from './fixturesTestHelpers';

// Mock agent registry
jest.mock('../../../agents', () => ({
  createAgent: jest.fn(),
  getAgentByClassName: jest.fn(),
}));

import { createAgent, getAgentByClassName } from '../../../agents';

describe('ExecutionOrchestrator', () => {
  let orchestrator: ExecutionOrchestrator;
  let mockApi: Partial<ApiPromise>;
  let mockAgent: any;

  beforeEach(() => {
    orchestrator = new ExecutionOrchestrator();
    mockApi = {} as ApiPromise;

    // Mock agent
    mockAgent = {
      initialize: jest.fn(),
      transfer: jest.fn(),
      getBalance: jest.fn(),
    };

    // Reset mocks
    jest.clearAllMocks();
    (getAgentByClassName as jest.Mock).mockReturnValue({
      agentClass: jest.fn().mockReturnValue(mockAgent),
      className: 'AssetTransferAgent',
      displayName: 'Asset Transfer Agent',
    });
    (createAgent as jest.Mock).mockReturnValue(mockAgent);
  });

  describe('Initialization', () => {
    it('should initialize with API', () => {
      orchestrator.initialize(mockApi as ApiPromise);
      // Should not throw
      expect(() => {
        orchestrator.initialize(mockApi as ApiPromise);
      }).not.toThrow();
    });

    it('should throw error if not initialized before orchestrate', async () => {
      const plan: ExecutionPlan = {
        id: 'test-plan',
        originalRequest: 'test',
        steps: [],
        status: 'pending',
        requiresApproval: false,
        createdAt: Date.now(),
      };

      await expect(
        orchestrator.orchestrate(plan)
      ).rejects.toThrow('Orchestrator not initialized');
    });
  });

  describe('Orchestration', () => {
    beforeEach(() => {
      orchestrator.initialize(mockApi as ApiPromise);
    });

    it('should orchestrate empty plan', async () => {
      const plan: ExecutionPlan = {
        id: 'test-plan',
        originalRequest: 'test',
        steps: [],
        status: 'pending',
        requiresApproval: false,
        createdAt: Date.now(),
      };

      const result = await orchestrator.orchestrate(plan);

      expect(result.success).toBe(true);
      expect(result.executionArray.isEmpty()).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should orchestrate plan with single step', async () => {
      const agentResult = createMockAgentResult({
        description: 'Transfer 1 DOT',
        executionType: 'extrinsic',
      });

      mockAgent.transfer.mockResolvedValue(agentResult);

      const plan: ExecutionPlan = {
        id: 'test-plan',
        originalRequest: 'Transfer 1 DOT',
        steps: [
          {
            id: 'step-1',
            stepNumber: 1,
            agentClassName: 'AssetTransferAgent',
            functionName: 'transfer',
            parameters: { address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', recipient: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', amount: '1000000000000' },
            executionType: 'extrinsic',
            status: 'pending',
            description: 'Transfer 1 DOT',
            requiresConfirmation: true,
            createdAt: Date.now(),
          },
        ],
        status: 'pending',
        requiresApproval: true,
        createdAt: Date.now(),
      };

      const result = await orchestrator.orchestrate(plan);

      expect(result.success).toBe(true);
      expect(result.executionArray.getLength()).toBe(1);
      expect(mockAgent.transfer).toHaveBeenCalledWith(plan.steps[0].parameters);
      expect(mockAgent.initialize).toHaveBeenCalledWith(mockApi);
    });

    it('should orchestrate plan with multiple steps', async () => {
      const agentResult1 = createMockAgentResult({
        description: 'Transfer 1 DOT',
        executionType: 'extrinsic',
      });
      const agentResult2 = createMockAgentResult({
        description: 'Get balance',
        executionType: 'data_fetch',
      });

      mockAgent.transfer.mockResolvedValue(agentResult1);
      mockAgent.getBalance.mockResolvedValue(agentResult2);

      const plan: ExecutionPlan = {
        id: 'test-plan',
        originalRequest: 'Transfer and check balance',
        steps: [
          {
            id: 'step-1',
            stepNumber: 1,
            agentClassName: 'AssetTransferAgent',
            functionName: 'transfer',
            parameters: { address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', recipient: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', amount: '1000000000000' },
            executionType: 'extrinsic',
            status: 'pending',
            description: 'Transfer 1 DOT',
            requiresConfirmation: true,
            createdAt: Date.now(),
          },
          {
            id: 'step-2',
            stepNumber: 2,
            agentClassName: 'AssetTransferAgent',
            functionName: 'getBalance',
            parameters: { address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY' },
            executionType: 'data_fetch',
            status: 'pending',
            description: 'Get balance',
            requiresConfirmation: false,
            createdAt: Date.now(),
          },
        ],
        status: 'pending',
        requiresApproval: true,
        createdAt: Date.now(),
      };

      const result = await orchestrator.orchestrate(plan);

      expect(result.success).toBe(true);
      expect(result.executionArray.getLength()).toBe(2);
      expect(result.metadata.successfulSteps).toBe(2);
      expect(result.metadata.totalSteps).toBe(2);
    });

    it('should handle agent errors', async () => {
      mockAgent.transfer.mockRejectedValue(new Error('Agent error'));

      const plan: ExecutionPlan = {
        id: 'test-plan',
        originalRequest: 'Transfer',
        steps: [
          {
            id: 'step-1',
            stepNumber: 1,
            agentClassName: 'AssetTransferAgent',
            functionName: 'transfer',
            parameters: { address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', recipient: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', amount: '1000000000000' },
            executionType: 'extrinsic',
            status: 'pending',
            description: 'Transfer',
            requiresConfirmation: true,
            createdAt: Date.now(),
          },
        ],
        status: 'pending',
        requiresApproval: true,
        createdAt: Date.now(),
      };

      const result = await orchestrator.orchestrate(plan);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('Agent error');
      expect(result.executionArray.isEmpty()).toBe(true);
    });

    it('should stop on error when stopOnError is true', async () => {
      // First call fails, second should not be called
      mockAgent.transfer.mockRejectedValue(new Error('First error'));
      mockAgent.getBalance.mockResolvedValue(createMockAgentResult());

      const plan: ExecutionPlan = {
        id: 'test-plan',
        originalRequest: 'Test',
        steps: [
          {
            id: 'step-1',
            stepNumber: 1,
            agentClassName: 'AssetTransferAgent',
            functionName: 'transfer',
            parameters: { address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', recipient: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', amount: '1000000000000' },
            executionType: 'extrinsic',
            status: 'pending',
            description: 'Transfer',
            requiresConfirmation: true,
            createdAt: Date.now(),
          },
          {
            id: 'step-2',
            stepNumber: 2,
            agentClassName: 'AssetTransferAgent',
            functionName: 'getBalance',
            parameters: { address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY' },
            executionType: 'data_fetch',
            status: 'pending',
            description: 'Get balance',
            requiresConfirmation: false,
            createdAt: Date.now(),
          },
        ],
        status: 'pending',
        requiresApproval: true,
        createdAt: Date.now(),
      };

      const result = await orchestrator.orchestrate(plan, { stopOnError: true, validateFirst: false });

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(mockAgent.getBalance).not.toHaveBeenCalled(); // Should stop after first error
    });

    it('should call progress callbacks', async () => {
      const agentResult = createMockAgentResult();
      mockAgent.transfer.mockResolvedValue(agentResult);

      const onProgress = jest.fn();

      const plan: ExecutionPlan = {
        id: 'test-plan',
        originalRequest: 'Test',
        steps: [
          {
            id: 'step-1',
            stepNumber: 1,
            agentClassName: 'AssetTransferAgent',
            functionName: 'transfer',
            parameters: {},
            executionType: 'extrinsic',
            status: 'pending',
            description: 'Transfer',
            requiresConfirmation: true,
            createdAt: Date.now(),
          },
        ],
        status: 'pending',
        requiresApproval: true,
        createdAt: Date.now(),
      };

      await orchestrator.orchestrate(plan, { onProgress });

      expect(onProgress).toHaveBeenCalled();
      expect(onProgress.mock.calls[0][0]).toEqual(plan.steps[0]);
    });

    it('should validate steps before execution', async () => {
      (getAgentByClassName as jest.Mock).mockReturnValue(undefined);

      const plan: ExecutionPlan = {
        id: 'test-plan',
        originalRequest: 'Test',
        steps: [
          {
            id: 'step-1',
            stepNumber: 1,
            agentClassName: 'NonExistentAgent',
            functionName: 'doSomething',
            parameters: {},
            executionType: 'extrinsic',
            status: 'pending',
            description: 'Test',
            requiresConfirmation: true,
            createdAt: Date.now(),
          },
        ],
        status: 'pending',
        requiresApproval: true,
        createdAt: Date.now(),
      };

      const result = await orchestrator.orchestrate(plan, { validateFirst: true });

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].error).toContain('not found');
    });
  });

  describe('Agent Caching', () => {
    beforeEach(() => {
      orchestrator.initialize(mockApi as ApiPromise);
    });

    it('should cache agent instances', async () => {
      const agentResult = createMockAgentResult();
      mockAgent.transfer.mockResolvedValue(agentResult);

      const plan: ExecutionPlan = {
        id: 'test-plan',
        originalRequest: 'Test',
        steps: [
          {
            id: 'step-1',
            stepNumber: 1,
            agentClassName: 'AssetTransferAgent',
            functionName: 'transfer',
            parameters: {},
            executionType: 'extrinsic',
            status: 'pending',
            description: 'Transfer 1',
            requiresConfirmation: true,
            createdAt: Date.now(),
          },
          {
            id: 'step-2',
            stepNumber: 2,
            agentClassName: 'AssetTransferAgent',
            functionName: 'transfer',
            parameters: {},
            executionType: 'extrinsic',
            status: 'pending',
            description: 'Transfer 2',
            requiresConfirmation: true,
            createdAt: Date.now(),
          },
        ],
        status: 'pending',
        requiresApproval: true,
        createdAt: Date.now(),
      };

      await orchestrator.orchestrate(plan);

      // Should only create agent once
      expect(createAgent).toHaveBeenCalledTimes(1);
      expect(mockAgent.initialize).toHaveBeenCalledTimes(1);
    });

    it('should clear cache', () => {
      orchestrator.clearCache();
      // Should not throw
      expect(() => orchestrator.clearCache()).not.toThrow();
    });
  });
});

