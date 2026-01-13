/**
 * Execution Flow Types
 * 
 * Consolidated type definitions for execution flow components
 */

import { ExecutionMessage, DotBot } from '@dotbot/core';

/**
 * Main ExecutionFlow component props
 */
export interface ExecutionFlowProps {
  // New API: Pass ExecutionMessage + DotBot instance
  executionMessage?: ExecutionMessage;
  dotbot?: DotBot;
}

/**
 * Flow state information
 */
export interface FlowState {
  waitingForApproval: boolean;
  isComplete: boolean;
  isExecuting: boolean;
  flowSuccessful: boolean;
  flowFailed: boolean;
}

/**
 * Simulation state information
 */
export interface SimulationState {
  enabled: boolean;
  isSimulating: boolean;
  allSimulationsComplete: boolean;
}
