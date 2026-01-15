/**
 * Test utilities - Fixtures
 */

import type { ChatResult, ExecutionArrayState, ExecutionPlan, ExecutionStep } from '@dotbot/core';

/**
 * Create a mock ChatResult with execution plan
 */
export function createChatResultWithExecution(overrides?: Partial<ChatResult>): ChatResult {
  const step: ExecutionStep = {
    id: 'step-1',
    stepNumber: 0,
    agentClassName: 'AssetTransferAgent',
    functionName: 'transfer',
    parameters: {
      from: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
      to: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
      amount: '1000000000000',
    },
    executionType: 'extrinsic',
    status: 'pending',
    description: 'Transfer 1000000000000 from 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY to 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
    requiresConfirmation: true,
    createdAt: Date.now(),
  };

  const plan: ExecutionPlan = {
    id: 'plan-123',
    originalRequest: 'Transfer DOT',
    steps: [step],
    status: 'pending',
    requiresApproval: true,
    createdAt: Date.now(),
  };

  const executionArrayState: ExecutionArrayState = {
    id: 'exec-123',
    items: [],
    isExecuting: false,
    isPaused: false,
    currentIndex: 0,
    totalItems: 0,
    completedItems: 0,
    failedItems: 0,
    cancelledItems: 0,
  };

  return {
    response: 'I will help you transfer DOT',
    executed: false,
    success: true,
    completed: 0,
    failed: 0,
    executionId: 'exec-123',
    plan,
    executionArrayState,
    ...overrides,
  };
}

/**
 * Create a mock ChatResult without execution plan
 */
export function createChatResultWithoutExecution(overrides?: Partial<ChatResult>): ChatResult {
  return {
    response: 'Hello! How can I help you?',
    executed: false,
    success: true,
    completed: 0,
    failed: 0,
    ...overrides,
  };
}
