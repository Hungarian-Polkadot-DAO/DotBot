/**
 * Shared state utilities for execution flow
 * 
 */

import { ExecutionArrayState } from '@dotbot/core/executionEngine/types';

/**
 * Check if execution state changed
 * Filters out rapid updates during simulation (e.g., progress-only changes)
 */
export function hasStateChanged(
  newState: ExecutionArrayState,
  oldState: ExecutionArrayState | null
): boolean {
  if (!oldState) return true;
  if (newState === oldState) return false;
  if (newState.items.length !== oldState.items.length) return true;
  
  for (let i = 0; i < newState.items.length; i++) {
    const newItem = newState.items[i];
    const oldItem = oldState.items[i];
    
    if (!oldItem || newItem.status !== oldItem.status || newItem.id !== oldItem.id) {
      return true;
    }
    
    if (newItem.simulationStatus?.phase !== oldItem.simulationStatus?.phase) {
      return true;
    }
    
    if (newItem.estimatedFee !== oldItem.estimatedFee) {
      return true;
    }
    
    if (newItem.simulationStatus?.result?.estimatedFee !== oldItem.simulationStatus?.result?.estimatedFee) {
      return true;
    }
  }
  
  if (newState.isExecuting !== oldState.isExecuting) return true;
  
  return false;
}

/**
 * Defer state update to avoid blocking UI thread
 */
export function updateStateDeferred(
  callback: () => void,
  timeout: number = 100
): void {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(callback, { timeout });
  } else {
    setTimeout(callback, 0);
  }
}
