/**
 * Shared state utilities for execution flow
 * 
 * DRY: Eliminates duplication of state comparison and update logic
 */

import { ExecutionArrayState } from '@dotbot/core/executionEngine/types';

/**
 * Check if execution state actually changed
 * Prevents unnecessary re-renders by comparing state structure
 */
export function hasStateChanged(
  newState: ExecutionArrayState,
  oldState: ExecutionArrayState | null
): boolean {
  if (!oldState) return true;
  
  // Quick reference check first
  if (newState === oldState) return false;
  
  // Check if items count changed
  if (newState.items.length !== oldState.items.length) return true;
  
  // Check if any item status or ID changed
  for (let i = 0; i < newState.items.length; i++) {
    const newItem = newState.items[i];
    const oldItem = oldState.items[i];
    if (!oldItem || newItem.status !== oldItem.status || newItem.id !== oldItem.id) {
      return true;
    }
  }
  
  // Check if execution status changed
  if (newState.isExecuting !== oldState.isExecuting) return true;
  
  return false;
}

/**
 * Defer state update to avoid blocking UI thread
 * Uses requestIdleCallback if available, otherwise setTimeout
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
