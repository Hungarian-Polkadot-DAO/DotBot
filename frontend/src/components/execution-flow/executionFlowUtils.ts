/**
 * Execution Flow Utilities
 * 
 * Helper functions for ExecutionFlow component.
 * KISS: Keeps component logic simple and focused.
 */

import React from 'react';
import { ExecutionArrayState } from '../../lib/executionEngine/types';
import { ExecutionMessage, DotBot } from '../../lib';

/**
 * Setup execution state subscription
 */
export function setupExecutionSubscription(
  executionMessage: ExecutionMessage,
  dotbot: DotBot,
  setLiveExecutionState: (state: ExecutionArrayState | null) => void
): () => void {
  if (!dotbot.currentChat) {
    return () => {}; // No-op cleanup
  }

  const chatInstance = dotbot.currentChat;
  const executionId = executionMessage.executionId;

  // Function to update state from ExecutionArray or executionMessage
  const updateState = (): boolean => {
    const executionArray = chatInstance.getExecutionArray(executionId);
    if (executionArray) {
      setLiveExecutionState(executionArray.getState());
      return true;
    } else if (executionMessage.executionArray) {
      setLiveExecutionState(executionMessage.executionArray);
      return true;
    }
    return false;
  };

  // Try to get state immediately
  const initialStateFound = updateState();

  // Poll for ExecutionArray if it doesn't exist yet
  // Use timeout and max attempts to prevent infinite polling
  let pollInterval: NodeJS.Timeout | null = null;
  if (!initialStateFound) {
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds max (50 * 100ms)
    
    pollInterval = setInterval(() => {
      attempts++;
      const found = updateState();
      
      if (found || attempts >= maxAttempts) {
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      }
    }, 100);
  }

  // Subscribe to execution updates
  const unsubscribe = chatInstance.onExecutionUpdate(executionId, (updatedState) => {
    setLiveExecutionState(updatedState);
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  });

  // Cleanup function
  return () => {
    if (pollInterval) {
      clearInterval(pollInterval);
    }
    unsubscribe();
  };
}

/**
 * Check if flow is waiting for user approval
 */
export function isWaitingForApproval(executionState: ExecutionArrayState): boolean {
  return executionState.items.every(item => 
    item.status === 'pending' || item.status === 'ready'
  );
}

/**
 * Check if flow is complete
 */
export function isFlowComplete(executionState: ExecutionArrayState): boolean {
  return executionState.items.every(item => 
    item.status === 'completed' || 
    item.status === 'finalized' || 
    item.status === 'failed' || 
    item.status === 'cancelled'
  );
}

/**
 * Check if flow is executing
 */
export function isFlowExecuting(executionState: ExecutionArrayState): boolean {
  if (isFlowComplete(executionState)) return false;
  
  return (
    executionState.isExecuting || 
    executionState.items.some(item => 
      item.status === 'executing' || 
      item.status === 'signing' || 
      item.status === 'broadcasting'
    )
  );
}

/**
 * Determine if flow is successful
 */
export function isFlowSuccessful(executionState: ExecutionArrayState): boolean {
  if (!isFlowComplete(executionState)) return false;
  
  return executionState.items.every(item =>
    item.status === 'completed' || item.status === 'finalized'
  );
}

/**
 * Determine if flow failed
 */
export function isFlowFailed(executionState: ExecutionArrayState): boolean {
  if (!isFlowComplete(executionState)) return false;
  
  return executionState.items.some(item => item.status === 'failed');
}

/**
 * Get simulation banner type based on state
 */
export function getSimulationBannerType(
  simulationEnabled: boolean,
  allSimulationsComplete: boolean,
  hasSimulationSuccess: boolean,
  hasSimulationFailure: boolean,
  isExecuting: boolean,
  isWaitingForApproval: boolean
): 'success' | 'failure' | 'disabled' | null {
  if (simulationEnabled && allSimulationsComplete && hasSimulationSuccess && !hasSimulationFailure && !isExecuting) {
    return 'success';
  }
  if (simulationEnabled && allSimulationsComplete && hasSimulationFailure) {
    return 'failure';
  }
  if (!simulationEnabled && isWaitingForApproval) {
    return 'disabled';
  }
  return null;
}

/**
 * Get simulation banner props based on type
 */
export function getSimulationBannerProps(
  bannerType: 'success' | 'failure' | 'disabled' | null,
  successCount: number,
  failureCount: number
): { type: 'success' | 'failure' | 'disabled'; successCount?: number; failureCount?: number } | null {
  if (!bannerType) return null;
  
  if (bannerType === 'success') {
    return { type: 'success', successCount };
  }
  if (bannerType === 'failure') {
    return { type: 'failure', failureCount };
  }
  return { type: 'disabled' };
}

