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
import { hasStateChanged, updateStateDeferred } from './stateUtils';

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
  
  let lastState: ExecutionArrayState | null = null;
  
  return wsSubscribe(executionId, (state) => {
    // Log all updates to debug simulation progress
    console.log('[ExecutionFlow] WebSocket update received:', {
      executionId,
      itemsCount: state.items.length,
      hasSimulationStatus: state.items.some(item => item.simulationStatus),
      simulationPhases: state.items.map(item => item.simulationStatus?.phase).filter(Boolean),
    });
    
    // Only update state if it actually changed (prevents unnecessary re-renders)
    if (hasStateChanged(state, lastState)) {
      lastState = state;
      updateStateDeferred(() => setLiveExecutionState(state));
      executionMessage.executionArray = state;
      
      // Log completion (subscription continues until cleanup)
      // Use helper function to handle empty arrays correctly
      if (isFlowComplete(state)) {
        console.log('[ExecutionFlow] Execution completed via WebSocket');
      }
    } else {
      console.log('[ExecutionFlow] WebSocket update ignored (state unchanged)');
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
  
  // Use longer interval during preparation to avoid UI blocking
  // Increase to 2-3 seconds during preparation, then 1 second during execution
  const POLL_INTERVAL_PREPARATION_MS = 2000; // 2 seconds during preparation
  const POLL_INTERVAL_EXECUTION_MS = 1000; // 1 second during execution
  let pollInterval: NodeJS.Timeout | null = null;
  let isPolling = true;
  let lastState: ExecutionArrayState | null = null;
  let pollCount = 0;
  
  const pollExecutionState = async () => {
    if (!isPolling) return;
    pollCount++;
    
    try {
      const response = await getExecutionState(backendSessionId, executionId);
      if (response.success && response.state) {
        const newState = response.state as ExecutionArrayState;
        
        // Only update state if it actually changed (prevents unnecessary re-renders)
        if (hasStateChanged(newState, lastState)) {
          lastState = newState;
          updateStateDeferred(() => setLiveExecutionState(newState));
          executionMessage.executionArray = newState;
        }
        
        // Check if execution is complete (use helper function to handle empty arrays correctly)
        if (isFlowComplete(newState)) {
          console.log('[ExecutionFlow] Execution completed, stopping polling');
          isPolling = false;
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
          return;
        }
        
        // Adjust polling interval based on execution phase
        // During preparation (items are pending/ready), use longer interval
        // During execution (items are executing), use shorter interval
        const isExecuting = newState.isExecuting || newState.items.some(item => 
          item.status === 'executing' || item.status === 'signing' || item.status === 'broadcasting'
        );
        // Empty array means no items yet, so not preparing (use false to avoid unnecessary interval changes)
        const isPreparing = newState.items.length > 0 && newState.items.every(item => 
          item.status === 'pending' || item.status === 'ready'
        );
        
        // Restart polling with appropriate interval if phase changed
        if (pollInterval && ((isPreparing && pollCount % 3 === 0) || isExecuting)) {
          clearInterval(pollInterval);
          const newInterval = isPreparing ? POLL_INTERVAL_PREPARATION_MS : POLL_INTERVAL_EXECUTION_MS;
          pollInterval = setInterval(pollExecutionState, newInterval);
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
  
  // Start polling with preparation interval
  pollExecutionState();
  pollInterval = setInterval(pollExecutionState, POLL_INTERVAL_PREPARATION_MS);
  
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
    } else if (executionMessage.executionArray) {
      // Fallback to executionMessage.executionArray if local ExecutionArray not available
      setLiveExecutionState(executionMessage.executionArray);
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
      console.log('[ExecutionFlow] Setting up WebSocket subscription for execution:', executionId);
      wsUnsubscribe = setupWebSocketSubscription(
        executionId,
        executionMessage,
        wsSubscribe,
        setLiveExecutionState
      );
      console.log('[ExecutionFlow] WebSocket subscription active for execution:', executionId);
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
    // Use deferred updates to prevent UI blocking
    let lastLocalState: ExecutionArrayState | null = null;
    
    unsubscribe = dotbot.currentChat.onExecutionUpdate(executionId, (state) => {
      // Only update if state actually changed
      if (hasStateChanged(state, lastLocalState)) {
        lastLocalState = state;
        updateStateDeferred(() => setLiveExecutionState(state));
      }
    });
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
  // Empty array means no items to approve yet
  if (executionState.items.length === 0) return false;
  return executionState.items.every(item => 
    item.status === 'pending' || item.status === 'ready'
  );
}

/**
 * Check if flow is complete
 */
export function isFlowComplete(executionState: ExecutionArrayState): boolean {
  // Empty array means no items executed yet, so not complete
  if (executionState.items.length === 0) return false;
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
  // Empty array cannot have failed items
  if (executionState.items.length === 0) return false;
  
  return executionState.items.some(item => item.status === 'failed');
}

