/**
 * Custom hook for managing execution flow state
 * 
 * Simple version: Only handles stateful mode (local ExecutionArray)
 * Subscribes to local DotBot ExecutionArray updates
 */

import { useState, useEffect, useRef, startTransition } from 'react';
import { ExecutionArrayState } from '@dotbot/core/executionEngine/types';
import { ExecutionMessage, DotBot } from '@dotbot/core';

/**
 * Hook to manage execution flow state with local subscription
 * 
 * - Subscribes to local ExecutionArray updates
 * - React 18 automatically batches state updates
 * - All updates (including progress) propagate immediately
 */
export function useExecutionFlowState(
  executionMessage: ExecutionMessage | undefined,
  dotbot: DotBot | undefined,
  legacyState: ExecutionArrayState | null | undefined
): ExecutionArrayState | null {
  const [liveExecutionState, setLiveExecutionState] = useState<ExecutionArrayState | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const currentExecutionIdRef = useRef<string | null>(null);

  // Subscribe to local ExecutionArray updates
  // This effect re-runs when executionMessage changes, but uses refs to prevent
  // unnecessary re-subscriptions to the same executionId
  useEffect(() => {
    // Require executionMessage and dotbot with currentChat
    if (!executionMessage || !dotbot || !dotbot.currentChat) {
      return;
    }

    const executionId = executionMessage.executionId;
    
    // If we're already subscribed to this exact executionId, don't do anything
    // This prevents re-subscription when executionMessage object changes but executionId stays the same
    if (currentExecutionIdRef.current === executionId && unsubscribeRef.current) {
      return;
    }

    // If switching to a different executionId, cleanup the old subscription
    if (currentExecutionIdRef.current !== executionId && unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
      currentExecutionIdRef.current = null;
    }

    const executionArray = dotbot.currentChat.getExecutionArray(executionId);
    if (!executionArray) {
      // No ExecutionArray yet, use snapshot from message if available
      if (executionMessage.executionArray) {
        setLiveExecutionState(executionMessage.executionArray);
      }
      return;
    }

    // Set initial state from ExecutionArray
    const initialState = executionArray.getState();
    setLiveExecutionState(initialState);
    
    // Subscribe to updates - React 18 will automatically batch rapid updates
    const unsubscribe = dotbot.currentChat.onExecutionUpdate(
      executionId,
      (state) => {
        // Use startTransition to mark as non-urgent, allowing React to batch
        // This prevents blocking while still showing all updates
        startTransition(() => {
          setLiveExecutionState(state);
        });
      }
    );

    unsubscribeRef.current = unsubscribe;
    currentExecutionIdRef.current = executionId;
  }, [executionMessage, dotbot]);

  // Cleanup only on unmount
  // Empty dependency array ensures this cleanup only runs when component unmounts
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
        currentExecutionIdRef.current = null;
      }
    };
  }, []);

  // Return live state (if available) or fallback to snapshot or legacy state
  return liveExecutionState || executionMessage?.executionArray || legacyState || null;
}
