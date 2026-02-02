/**
 * Execution Flow Handlers
 *
 * Handlers for Accept & Start, Restore, and Rerun.
 */

import { ExecutionMessage, DotBot } from '@dotbot/core';

export async function handleAcceptAndStart(
  executionMessage: ExecutionMessage | undefined,
  dotbot: DotBot | undefined,
  onAcceptAndStart?: () => void
): Promise<void> {
  if (executionMessage && dotbot) {
    try {
      await dotbot.startExecution(executionMessage.executionId, { autoApprove: false });
    } catch (error) {
      console.error('[ExecutionFlow] Execution failed:', error);
    }
  } else if (onAcceptAndStart) {
    onAcceptAndStart();
  }
}

export async function handleRestore(
  executionMessage: ExecutionMessage | undefined,
  dotbot: DotBot | undefined
): Promise<void> {
  if (!executionMessage || !dotbot) return;
  try {
    await dotbot.restoreExecution(executionMessage.executionId);
  } catch (error) {
    console.error('[ExecutionFlow] Restore failed:', error);
  }
}

export async function handleRerun(
  executionMessage: ExecutionMessage | undefined,
  dotbot: DotBot | undefined
): Promise<void> {
  if (!executionMessage || !dotbot) return;
  try {
    await dotbot.rerunExecution(executionMessage, { autoApprove: false });
  } catch (error) {
    console.error('[ExecutionFlow] Rerun failed:', error);
  }
}
