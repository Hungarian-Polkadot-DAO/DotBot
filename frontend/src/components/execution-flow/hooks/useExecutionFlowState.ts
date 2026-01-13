/**
 * Custom hook for managing execution flow state
 */

import { useState, useEffect } from 'react';
import { ExecutionArrayState } from '@dotbot/core/executionEngine/types';
import { ExecutionMessage, DotBot } from '@dotbot/core';
import { setupExecutionSubscription } from '../executionFlowUtils';

/**
 * Hook to manage execution flow state with subscription
 */
export function useExecutionFlowState(
  executionMessage: ExecutionMessage | undefined,
  dotbot: DotBot | undefined,
  legacyState: ExecutionArrayState | null | undefined
): ExecutionArrayState | null {
  const [liveExecutionState, setLiveExecutionState] = useState<ExecutionArrayState | null>(null);

  // Subscribe to execution updates when using new API
  useEffect(() => {
    if (!executionMessage || !dotbot) {
      return;
    }

    const cleanup = setupExecutionSubscription(
      executionMessage,
      dotbot,
      setLiveExecutionState
    );

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executionMessage?.executionId, dotbot]);

  // Use live state if available, otherwise fall back to snapshot or legacy state
  return liveExecutionState || executionMessage?.executionArray || legacyState || null;
}
