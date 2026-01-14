/**
 * Execution Flow Utilities
 * 
 * Helper functions for ExecutionFlow component.
 * KISS: Keeps component logic simple and focused.
 */

import { ExecutionArrayState } from '@dotbot/core/executionEngine/types';
import { ExecutionMessage, DotBot } from '@dotbot/core';
import { getExecutionState } from '../../services/dotbotApi';

/**
 * Setup execution state subscription
 * Handles both stateful (local ExecutionArray) and stateless (backend polling) modes
 */
export function setupExecutionSubscription(
  executionMessage: ExecutionMessage,
  dotbot: DotBot,
  setLiveExecutionState: (state: ExecutionArrayState | null) => void,
  backendSessionId?: string | null
): () => void {
  const executionId = executionMessage.executionId;
  let pollInterval: NodeJS.Timeout | null = null;
  let unsubscribe: (() => void) | null = null;

  // Function to update state from ExecutionArray or executionMessage
  const updateState = (): boolean => {
    if (dotbot.currentChat) {
      const executionArray = dotbot.currentChat.getExecutionArray(executionId);
      if (executionArray) {
        setLiveExecutionState(executionArray.getState());
        return true;
      }
    }
    
    // Fallback to stored state in execution message
    if (executionMessage.executionArray) {
      setLiveExecutionState(executionMessage.executionArray);
      return true;
    }
    
    return false;
  };

  // Try to get state immediately
  updateState();

  // Check if we need to poll backend (stateless mode: has state but no ExecutionArray instance)
  const needsBackendPolling = 
    executionMessage.executionArray && 
    backendSessionId &&
    (!dotbot.currentChat || !dotbot.currentChat.getExecutionArray(executionId));

  if (needsBackendPolling) {
    // Poll backend for simulation progress during preparation
    let pollCount = 0;
    const maxPolls = 300; // 30 seconds max (300 * 100ms)
    pollInterval = setInterval(async () => {
      pollCount++;
      
      try {
        const response = await getExecutionState(backendSessionId, executionId);
        if (response.success && response.state) {
          setLiveExecutionState(response.state);
          // Update execution message with latest state
          if (executionMessage) {
            executionMessage.executionArray = response.state;
          }
        }
      } catch (error) {
        console.warn('[ExecutionFlow] Failed to poll execution state:', error);
      }
      
      // Stop polling if we have ExecutionArray locally or max polls reached
      if (updateState() || pollCount >= maxPolls) {
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      }
    }, 100); // Poll every 100ms for responsive updates
  } else if (dotbot.currentChat) {
    // Stateful mode: subscribe to local ExecutionArray updates
    unsubscribe = dotbot.currentChat.onExecutionUpdate(executionId, (updatedState) => {
      setLiveExecutionState(updatedState);
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    });
  }

  // Cleanup function
  return () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
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

