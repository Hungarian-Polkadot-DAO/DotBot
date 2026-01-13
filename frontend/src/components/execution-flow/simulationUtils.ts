/**
 * Simulation Utilities
 * 
 * Shared utilities for simulation status checks and calculations.
 * DRY: Centralizes repeated simulation phase checks across components.
 */

import { ExecutionItem } from '@dotbot/core/executionEngine/types';
import { ExecutionArrayState } from '@dotbot/core/executionEngine/types';

/**
 * Active simulation phases - phases that indicate simulation is in progress
 */
export type ActiveSimulationPhase = 
  | 'initializing'
  | 'simulating'
  | 'validating'
  | 'analyzing'
  | 'retrying'
  | 'forking'
  | 'executing';

/**
 * Terminal simulation phases - phases that indicate simulation is complete
 */
export type TerminalSimulationPhase = 'complete' | 'error';

/**
 * All simulation phases
 */
export type SimulationPhase = ActiveSimulationPhase | TerminalSimulationPhase;

/**
 * Check if a simulation phase is active (simulation in progress)
 */
export function isActiveSimulationPhase(phase: string | undefined): phase is ActiveSimulationPhase {
  if (!phase) return false;
  const activePhases: ActiveSimulationPhase[] = [
    'initializing',
    'simulating',
    'validating',
    'analyzing',
    'retrying',
    'forking',
    'executing'
  ];
  return activePhases.includes(phase as ActiveSimulationPhase);
}

/**
 * Check if a simulation phase is terminal (simulation complete)
 */
export function isTerminalSimulationPhase(phase: string | undefined): phase is TerminalSimulationPhase {
  if (!phase) return false;
  return phase === 'complete' || phase === 'error';
}

/**
 * Check if an item is currently being simulated
 */
export function isItemSimulating(item: ExecutionItem): boolean {
  if (!item.simulationStatus) return false;
  
  return (
    item.status === 'pending' ||
    isActiveSimulationPhase(item.simulationStatus.phase)
  );
}

/**
 * Check if an item has completed simulation successfully
 */
export function isItemSimulationSuccess(item: ExecutionItem): boolean {
  if (!item.simulationStatus) return false;
  
  return (
    item.simulationStatus.phase === 'complete' ||
    (item.simulationStatus.result?.success === true && item.status === 'ready')
  );
}

/**
 * Check if an item has failed simulation
 */
export function isItemSimulationFailure(item: ExecutionItem): boolean {
  if (!item.simulationStatus) return false;
  
  return (
    item.simulationStatus.phase === 'error' ||
    (item.simulationStatus.result?.success === false && item.status === 'failed')
  );
}

/**
 * Check if simulation has started for an item (any phase including terminal)
 */
export function hasSimulationStarted(item: ExecutionItem): boolean {
  if (!item.simulationStatus) return false;
  
  return (
    isActiveSimulationPhase(item.simulationStatus.phase) ||
    isTerminalSimulationPhase(item.simulationStatus.phase)
  );
}

/**
 * Check if all simulations are complete
 */
export function areAllSimulationsComplete(
  items: ExecutionItem[],
  isSimulating: boolean
): boolean {
  const simulatedItems = items.filter(item => item.simulationStatus);
  
  if (simulatedItems.length === 0) return false;
  if (isSimulating) return false;
  
  return simulatedItems.every(item => 
    isTerminalSimulationPhase(item.simulationStatus?.phase) ||
    item.status === 'ready' ||
    item.status === 'failed'
  );
}

/**
 * Get simulation statistics from execution state
 */
export function getSimulationStats(executionState: ExecutionArrayState) {
  const simulatedItems = executionState.items.filter(item => item.simulationStatus);
  const simulatingItems = simulatedItems.filter(isItemSimulating);
  const completedItems = simulatedItems.filter(isItemSimulationSuccess);
  const failedItems = simulatedItems.filter(isItemSimulationFailure);
  
  return {
    simulatedItems,
    simulatingItems,
    completedItems,
    failedItems,
    totalSimulated: simulatedItems.length,
    totalSimulating: simulatingItems.length,
    totalCompleted: completedItems.length,
    totalFailed: failedItems.length
  };
}

