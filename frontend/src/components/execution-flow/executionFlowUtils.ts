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

  // Check if we need to poll backend (stateless mode: execution on backend)
  const needsBackendPolling = 
    backendSessionId &&
    (!dotbot.currentChat || !dotbot.currentChat.getExecutionArray(executionId));

  if (needsBackendPolling) {
    // Poll backend for execution progress (both during preparation and execution)
    // This handles stateless mode where execution happens on the backend
    const POLL_INTERVAL_MS = 1000; // Poll every 1 second
    const MAX_POLL_DURATION_MS = 10 * 60 * 1000; // 10 minutes max
    const maxPolls = Math.floor(MAX_POLL_DURATION_MS / POLL_INTERVAL_MS);
    let pollCount = 0;
    let isPolling = true;
    
    const pollExecutionState = async () => {
      if (!isPolling) return;
      
      pollCount++;
      
      try {
        const response = await getExecutionState(backendSessionId, executionId);
        if (response.success && response.state) {
          const newState = response.state as ExecutionArrayState;
          setLiveExecutionState(newState);
          
          // Update execution message with latest state
          if (executionMessage) {
            executionMessage.executionArray = newState;
          }
          
          // Check if execution is complete (stop polling)
          const isComplete = newState.items.every(item => 
            item.status === 'completed' || 
            item.status === 'finalized' || 
            item.status === 'failed' || 
            item.status === 'cancelled'
          );
          
          if (isComplete) {
            console.log('[ExecutionFlow] Execution completed, stopping polling');
            isPolling = false;
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }
            return;
          }
        }
      } catch (error) {
        console.warn('[ExecutionFlow] Failed to poll execution state:', error);
        // Continue polling even on error (might be temporary network issue)
      }
      
      // Stop polling if we have ExecutionArray locally (switched to stateful mode)
      if (dotbot.currentChat && dotbot.currentChat.getExecutionArray(executionId)) {
        console.log('[ExecutionFlow] ExecutionArray available locally, switching to local updates');
        isPolling = false;
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        // Switch to local subscription
        unsubscribe = dotbot.currentChat.onExecutionUpdate(executionId, (updatedState) => {
          setLiveExecutionState(updatedState);
        });
        return;
      }
      
      // Stop polling if max polls reached (safety timeout)
      if (pollCount >= maxPolls) {
        console.warn('[ExecutionFlow] Max polling duration reached (10 minutes), stopping');
        isPolling = false;
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      }
    };
    
    // Initial poll immediately
    pollExecutionState();
    
    // Set up polling interval
    pollInterval = setInterval(pollExecutionState, POLL_INTERVAL_MS);
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

