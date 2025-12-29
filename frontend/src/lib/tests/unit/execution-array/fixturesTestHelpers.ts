/**
 * Test fixtures and helpers for ExecutionArray tests
 */

import { AgentResult } from '../../../agents/types';
import { ExecutionStatus } from '../../../execution-array/types';

/**
 * Create a mock AgentResult for testing
 */
export function createMockAgentResult(overrides?: Partial<AgentResult>): AgentResult {
  return {
    description: 'Test operation',
    resultType: 'extrinsic',
    requiresConfirmation: true,
    executionType: 'extrinsic',
    ...overrides,
  };
}

/**
 * Create multiple mock AgentResults
 */
export function createMockAgentResults(count: number): AgentResult[] {
  return Array.from({ length: count }, (_, i) =>
    createMockAgentResult({
      description: `Test operation ${i + 1}`,
      metadata: { index: i },
    })
  );
}

/**
 * Wait for a short time (for async operations)
 */
export function wait(ms: number = 10): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}


