/**
 * Custom hook for managing execution flow state
 */

import { useState, useEffect } from 'react';
import { ExecutionArrayState } from '@dotbot/core/executionEngine/types';
import { ExecutionMessage, DotBot } from '@dotbot/core';
import { setupExecutionSubscription } from '../executionFlowUtils';
import { useWebSocket } from '../../../contexts/WebSocketContext';

/**
 * Hook to manage execution flow state with subscription
 * Supports both stateful (local) and stateless (backend polling/WebSocket) modes
 */
export function useExecutionFlowState(
  executionMessage: ExecutionMessage | undefined,
  dotbot: DotBot | undefined,
  legacyState: ExecutionArrayState | null | undefined,
  backendSessionId?: string | null
): ExecutionArrayState | null {
  const [liveExecutionState, setLiveExecutionState] = useState<ExecutionArrayState | null>(null);
  
  // Get WebSocket subscription function (optional - might not be connected)
  let wsSubscribe: ((executionId: string, callback: (state: ExecutionArrayState) => void) => (() => void)) | undefined;
  try {
    const { subscribeToExecution, isConnected } = useWebSocket();
    // Only use WebSocket if connected
    if (isConnected) {
      wsSubscribe = subscribeToExecution;
    }
  } catch (error) {
    // WebSocket context not available (not wrapped in provider)
    // This is OK - we'll fall back to polling
  }

  // Subscribe to execution updates when using new API
  useEffect(() => {
    if (!executionMessage || !dotbot) {
      return;
    }

    const cleanup = setupExecutionSubscription(
      executionMessage,
      dotbot,
      setLiveExecutionState,
      backendSessionId,
      wsSubscribe
    );

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executionMessage?.executionId, dotbot, backendSessionId, wsSubscribe]);

  // Use live state if available, otherwise fall back to snapshot or legacy state
  return liveExecutionState || executionMessage?.executionArray || legacyState || null;
}
