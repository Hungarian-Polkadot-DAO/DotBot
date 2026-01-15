/**
 * Execution Flow Utilities
 * 
 * Helper functions for ExecutionFlow component.
 * KISS: Keeps component logic simple and focused.
 * 
 * WEBSOCKET STRATEGY:
 * - Use WebSocket if available (Socket.IO auto-falls back to polling if WebSocket fails)
 * - Fall back to HTTP polling only if WebSocketContext not available (edge case)
 * - Polling uses idle timeout (stops if no changes for 2 minutes)
 */

import { ExecutionArrayState } from '@dotbot/core/executionEngine/types';
import { ExecutionMessage, DotBot } from '@dotbot/core';
import { getExecutionState } from '../../services/dotbotApi';

/**
 * Setup WebSocket subscription for execution updates
 */
function setupWebSocketSubscription(
  executionId: string,
  executionMessage: ExecutionMessage,
  wsSubscribe: (executionId: string, callback: (state: ExecutionArrayState) => void) => (() => void),
  setLiveExecutionState: (state: ExecutionArrayState | null) => void
): (() => void) {
  console.log('[ExecutionFlow] Using WebSocket for execution updates');
  
  return wsSubscribe(executionId, (state) => {
    setLiveExecutionState(state);
    executionMessage.executionArray = state;
    
    // Log completion (subscription continues until cleanup)
    const isComplete = state.items.every(item => 
      item.status === 'completed' || 
      item.status === 'finalized' || 
      item.status === 'failed' || 
      item.status === 'cancelled'
    );
    
    if (isComplete) {
      console.log('[ExecutionFlow] Execution completed via WebSocket');
    }
  });
}

/**
 * Setup HTTP polling fallback for execution updates
 * Only used if WebSocket unavailable (edge case - shouldn't happen in production)
 */
function setupPollingFallback(
  executionId: string,
  executionMessage: ExecutionMessage,
  backendSessionId: string,
  dotbot: DotBot,
  setLiveExecutionState: (state: ExecutionArrayState | null) => void,
  onLocalSubscriptionAvailable: (unsubscribe: () => void) => void
): () => void {
  console.warn('[ExecutionFlow] WebSocket unavailable, using HTTP polling fallback');
  
  const POLL_INTERVAL_MS = 1000;
  let pollInterval: NodeJS.Timeout | null = null;
  let isPolling = true;
  
  const pollExecutionState = async () => {
    if (!isPolling) return;
    
    try {
      const response = await getExecutionState(backendSessionId, executionId);
      if (response.success && response.state) {
        const newState = response.state as ExecutionArrayState;
        setLiveExecutionState(newState);
        executionMessage.executionArray = newState;
        
        // Check if execution is complete
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
    }
    
    // Switch to local subscription if ExecutionArray becomes available
    if (dotbot.currentChat && dotbot.currentChat.getExecutionArray(executionId)) {
      console.log('[ExecutionFlow] ExecutionArray available locally, switching to local updates');
      isPolling = false;
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      const unsubscribe = dotbot.currentChat.onExecutionUpdate(executionId, setLiveExecutionState);
      onLocalSubscriptionAvailable(unsubscribe);
    }
  };
  
  // Start polling
  pollExecutionState();
  pollInterval = setInterval(pollExecutionState, POLL_INTERVAL_MS);
  
  // Return cleanup function
  return () => {
    isPolling = false;
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  };
}

/**
 * Setup execution state subscription
 * Handles both stateful (local ExecutionArray) and stateless (backend polling/WebSocket) modes
 * 
 * STRATEGY:
 * 1. Try WebSocket first (if available)
 * 2. Fall back to HTTP polling if WebSocket unavailable (edge case)
 * 3. Use local subscription if ExecutionArray available
 * 
 * @param wsSubscribe Optional WebSocket subscription function
 */
export function setupExecutionSubscription(
  executionMessage: ExecutionMessage,
  dotbot: DotBot,
  setLiveExecutionState: (state: ExecutionArrayState | null) => void,
  backendSessionId?: string | null,
  wsSubscribe?: (executionId: string, callback: (state: ExecutionArrayState) => void) => (() => void)
): () => void {
  const executionId = executionMessage.executionId;
  let unsubscribe: (() => void) | null = null;
  let wsUnsubscribe: (() => void) | null = null;
  let pollCleanup: (() => void) | null = null;

  // Try to get initial state
  if (dotbot.currentChat) {
    const executionArray = dotbot.currentChat.getExecutionArray(executionId);
    if (executionArray) {
      setLiveExecutionState(executionArray.getState());
    }
  } else if (executionMessage.executionArray) {
    setLiveExecutionState(executionMessage.executionArray);
  }

  // Check if we need backend updates (stateless mode: execution on backend)
  const needsBackendUpdates = 
    backendSessionId &&
    (!dotbot.currentChat || !dotbot.currentChat.getExecutionArray(executionId));

  if (needsBackendUpdates) {
    // Try WebSocket first (real-time, efficient)
    if (wsSubscribe) {
      wsUnsubscribe = setupWebSocketSubscription(
        executionId,
        executionMessage,
        wsSubscribe,
        setLiveExecutionState
      );
    } else {
      // Fallback to HTTP polling (edge case - WebSocketContext not available)
      pollCleanup = setupPollingFallback(
        executionId,
        executionMessage,
        backendSessionId,
        dotbot,
        setLiveExecutionState,
        (unsub) => { unsubscribe = unsub; }
      );
    }
  } else if (dotbot.currentChat) {
    // Stateful mode: subscribe to local ExecutionArray updates
    unsubscribe = dotbot.currentChat.onExecutionUpdate(executionId, setLiveExecutionState);
  }

  // Cleanup function
  return () => {
    if (pollCleanup) pollCleanup();
    if (unsubscribe) unsubscribe();
    if (wsUnsubscribe) wsUnsubscribe();
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

