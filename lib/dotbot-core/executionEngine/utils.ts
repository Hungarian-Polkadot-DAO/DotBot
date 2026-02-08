/**
 * Execution Array Utilities
 * 
 * Utilities for converting between prompt system types and runtime execution types.
 */

import { ExecutionStep as _ExecutionStep, ExecutionPlan as _ExecutionPlan } from '../prompts/system/execution/types';
import { ExecutionItem, ExecutionStatus, ExecutionArrayState } from './types';
import { AgentResult } from '../agents/types';
import { isSimulationEnabled } from './simulation/simulationConfig';

/** Terminal statuses: step is done (no further execution, no animation). */
const TERMINAL_STATUSES: ExecutionStatus[] = ['completed', 'failed', 'finalized', 'cancelled'];

/**
 * True if this step will not change anymore (completed, failed, finalized, cancelled).
 * Use to avoid showing spinning/in-progress UI for finalized steps.
 */
export function isStepFinalized(status: ExecutionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * True if the flow is fully terminal (all items finalized).
 * Used to skip restoring ExecutionArrays for historical completed/failed flows.
 */
export function isExecutionArrayStateTerminal(state: ExecutionArrayState): boolean {
  if (!state.items.length) return false;
  return state.items.every((item) => isStepFinalized(item.status));
}

/**
 * Get initial execution status based on simulation setting
 * 
 * This is the single source of truth for initial status logic.
 * Previously duplicated in 2 locations - now centralized here.
 * 
 * - If simulation is enabled: items start as 'pending' (will be simulated first)
 * - If simulation is disabled: items start as 'ready' (ready for immediate signing)
 * 
 * @returns Initial execution status
 */
export function getInitialExecutionStatus(): ExecutionStatus {
  return isSimulationEnabled() ? 'pending' : 'ready';
}

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
  const initialStatus = getInitialExecutionStatus();
  return {
    id: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    agentResult,
    status: initialStatus,
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
 * - ExecutionItem (from executionEngine/types.ts):
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

