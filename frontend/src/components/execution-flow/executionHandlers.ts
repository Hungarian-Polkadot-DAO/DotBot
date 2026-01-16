/**
 * Execution Flow Handlers
 * 
 */

import { ExecutionMessage, DotBot } from '@dotbot/core';
import { startExecution } from '../../services/dotbotApi';

/**
 * Start execution from backend (stateless mode)
 */
async function startBackendExecution(
  backendSessionId: string,
  executionId: string
): Promise<void> {
  console.info('[ExecutionFlow] Starting execution from backend');
  
  const backendPromise = startExecution(backendSessionId, executionId, false);
  const timeoutPromise = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error('Backend call timeout')), 2000)
  );
  
  try {
    const response = await Promise.race([backendPromise, timeoutPromise]);
    console.info('[ExecutionFlow] Backend execution started', response);
  } catch (error: any) {
    if (error.message?.includes('404') || 
        error.message?.includes('not found') || 
        error.message?.includes('timeout')) {
      console.log('[ExecutionFlow] Backend state not found or timeout, rebuilding locally');
    } else {
      console.warn('[ExecutionFlow] Failed to start execution on backend:', error);
    }
  }
}

/**
 * Start execution on frontend
 */
function startFrontendExecution(
  dotbot: DotBot,
  executionId: string
): void {
  dotbot.startExecution(executionId, { autoApprove: false })
    .catch(error => {
      console.error('[ExecutionFlow] Execution failed:', error);
    });
  console.log('[ExecutionFlow] Started execution on frontend...');
}

/**
 * Check if backend execution is needed
 */
function needsBackendExecution(
  backendSessionId: string | null | undefined,
  dotbot: DotBot | undefined,
  executionId: string
): boolean {
  if (!backendSessionId || !dotbot) return false;
  if (!dotbot.currentChat) return true;
  return !dotbot.currentChat.getExecutionArray(executionId);
}

/**
 * Handle accept and start execution
 */
export async function handleAcceptAndStart(
  executionMessage: ExecutionMessage | undefined,
  dotbot: DotBot | undefined,
  backendSessionId: string | null | undefined,
  onAcceptAndStart?: () => void
): Promise<void> {
  if (executionMessage && dotbot) {
    // Try backend execution if needed (stateless mode)
    if (needsBackendExecution(backendSessionId, dotbot, executionMessage.executionId)) {
      await startBackendExecution(backendSessionId!, executionMessage.executionId);
    }
    
    // Always execute on frontend
    startFrontendExecution(dotbot, executionMessage.executionId);
  } else if (onAcceptAndStart) {
    onAcceptAndStart();
  }
}
