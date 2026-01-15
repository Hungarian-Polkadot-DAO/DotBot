/**
 * Custom hook for managing execution flow state
 */

import { useState, useEffect, useRef } from 'react';
import { ExecutionArrayState } from '@dotbot/core/executionEngine/types';
import { ExecutionMessage, DotBot } from '@dotbot/core';
import { useExecutionState } from '../../../App';

/**
 * Hook to manage execution flow state with subscription
 * Supports both stateful (local) and stateless (backend polling/WebSocket) modes
 * 
 * STRATEGY:
 * - For stateless mode (backend execution): Gets state from ExecutionStateContext
 *   which is updated by EarlyExecutionSubscriber's WebSocket subscription
 * - For stateful mode (local ExecutionArray): Subscribes to local updates
 * 
 * This avoids duplicate WebSocket subscriptions and the unsubscribe/resubscribe cycle
 */
export function useExecutionFlowState(
  executionMessage: ExecutionMessage | undefined,
  dotbot: DotBot | undefined,
  legacyState: ExecutionArrayState | null | undefined,
  backendSessionId?: string | null
): ExecutionArrayState | null {
  const [liveExecutionState, setLiveExecutionState] = useState<ExecutionArrayState | null>(null);
  
  // Track previous executionId to detect changes
  const prevExecutionIdRef = useRef<string | undefined>(executionMessage?.executionId);
  
  // Get state from context (updated by EarlyExecutionSubscriber)
  const contextState = useExecutionState(executionMessage?.executionId);
  
  // Sync context state to local state when it changes (triggers re-render)
  // This ensures ExecutionFlow updates when WebSocket updates arrive
  // Works even if executionMessage doesn't exist yet (uses executionId from contextState)
  useEffect(() => {
    if (contextState) {
      // Get executionId from contextState or executionMessage
      const executionId = executionMessage?.executionId;
      
      // Update local state when context state changes
      setLiveExecutionState(prevState => {
        // Only update if state actually changed (avoid unnecessary re-renders)
        // Use JSON comparison to detect actual state changes, not just reference changes
        const stateChanged = prevState !== contextState && (
          !prevState || 
          prevState.items.length !== contextState.items.length ||
          prevState.currentIndex !== contextState.currentIndex ||
          prevState.isExecuting !== contextState.isExecuting
        );
        
        if (stateChanged) {
          console.log('[useExecutionFlowState] Context state updated, syncing:', {
            executionId,
            itemsCount: contextState.items.length,
            hadPreviousState: !!prevState,
            currentIndex: contextState.currentIndex,
            isExecuting: contextState.isExecuting
          });
          return contextState;
        }
        return prevState;
      });
    }
  }, [contextState, executionMessage?.executionId]);

  // Reset state when executionId changes
  useEffect(() => {
    const currentExecutionId = executionMessage?.executionId;
    if (prevExecutionIdRef.current !== currentExecutionId) {
      // Only reset live state if we're switching to a different execution
      // Don't reset if we're just initializing (prevExecutionIdRef is undefined)
      if (prevExecutionIdRef.current !== undefined) {
        setLiveExecutionState(null);
      }
      prevExecutionIdRef.current = currentExecutionId;
    }
  }, [executionMessage?.executionId]);

  // For stateful mode (local ExecutionArray), subscribe to local updates
  useEffect(() => {
    if (!executionMessage || !dotbot || !dotbot.currentChat) {
      return;
    }

    const executionArray = dotbot.currentChat.getExecutionArray(executionMessage.executionId);
    if (!executionArray) {
      // No local ExecutionArray - stateless mode (use context state)
      return;
    }

    console.log('[useExecutionFlowState] Using stateful mode - subscribing to local ExecutionArray');
    
    // Set initial state
    setLiveExecutionState(executionArray.getState());
    
    // Subscribe to local updates
    const unsubscribe = dotbot.currentChat.onExecutionUpdate(
      executionMessage.executionId,
      (state) => {
        setLiveExecutionState(state);
      }
    );

    return unsubscribe;
  }, [executionMessage?.executionId, dotbot]);

  // Priority: live state (stateful) > context state (stateless) > snapshot > legacy
  return liveExecutionState || contextState || executionMessage?.executionArray || legacyState || null;
}
