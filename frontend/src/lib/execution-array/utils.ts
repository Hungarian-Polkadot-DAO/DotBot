/**
 * Execution Array Utilities
 * 
 * Utilities for converting between prompt system types and runtime execution types.
 */

import { ExecutionStep, ExecutionArray as ExecutionArrayPlan } from '../prompts/system/execution/types';
import { ExecutionItem, ExecutionStatus } from './types';
import { AgentResult } from '../agents/types';

/**
 * Convert a prompt system ExecutionStatus to runtime ExecutionStatus
 * 
 * The prompt system uses simpler statuses for planning, while the runtime
 * uses more granular statuses for actual execution tracking.
 */
export function mapPromptStatusToRuntimeStatus(
  promptStatus: 'pending' | 'ready' | 'executing' | 'completed' | 'failed' | 'cancelled'
): ExecutionStatus {
  // Most statuses map directly
  if (promptStatus === 'pending' || promptStatus === 'ready' || 
      promptStatus === 'completed' || promptStatus === 'failed' || 
      promptStatus === 'cancelled') {
    return promptStatus;
  }
  
  // 'executing' from prompt system maps to 'executing' in runtime
  // (which will later transition to 'signing', 'broadcasting', etc. for extrinsics)
  if (promptStatus === 'executing') {
    return 'executing';
  }
  
  // Default fallback
  return 'pending';
}

/**
 * Convert a runtime ExecutionStatus to prompt system ExecutionStatus
 * 
 * Maps granular runtime statuses back to simpler prompt system statuses.
 */
export function mapRuntimeStatusToPromptStatus(
  runtimeStatus: ExecutionStatus
): 'pending' | 'ready' | 'executing' | 'completed' | 'failed' | 'cancelled' {
  // Direct mappings
  if (runtimeStatus === 'pending' || runtimeStatus === 'ready' || 
      runtimeStatus === 'completed' || runtimeStatus === 'failed' || 
      runtimeStatus === 'cancelled') {
    return runtimeStatus;
  }
  
  // Granular runtime statuses map to 'executing' in prompt system
  if (runtimeStatus === 'executing' || runtimeStatus === 'signing' || 
      runtimeStatus === 'broadcasting' || runtimeStatus === 'in_block' || 
      runtimeStatus === 'finalized') {
    return 'executing';
  }
  
  // Default fallback
  return 'pending';
}

/**
 * Create an ExecutionItem from an AgentResult
 * 
 * This is the primary way to convert agent results into execution items.
 */
export function createExecutionItemFromAgentResult(
  agentResult: AgentResult,
  index: number
): ExecutionItem {
  return {
    id: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    agentResult,
    status: 'pending',
    executionType: agentResult.executionType,
    description: agentResult.description,
    estimatedFee: agentResult.estimatedFee,
    warnings: agentResult.warnings,
    metadata: agentResult.metadata,
    createdAt: Date.now(),
    index,
  };
}

/**
 * Note on ExecutionStep vs ExecutionItem:
 * 
 * - ExecutionStep (from prompts/system/execution/types.ts):
 *   - Created by LLM as a plan
 *   - Contains: agentClassName, functionName, parameters
 *   - Represents "what to do"
 * 
 * - ExecutionItem (from execution-array/types.ts):
 *   - Created from AgentResult after agent execution
 *   - Contains: agentResult (with extrinsic/data)
 *   - Represents "what to execute"
 * 
 * Flow:
 * 1. LLM creates ExecutionStep[] (plan)
 * 2. System calls agents based on ExecutionStep
 * 3. Agents return AgentResult[]
 * 4. AgentResult[] converted to ExecutionItem[] via createExecutionItemFromAgentResult()
 * 5. ExecutionItem[] added to ExecutionArray (runtime class)
 * 6. Executioner executes ExecutionItem[]
 */

