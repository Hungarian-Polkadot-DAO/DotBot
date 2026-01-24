/**
 * Execution Route Utilities
 */

import { Response } from 'express';
import { ExecutionArrayState } from '@dotbot/core';
import { DotBotSession } from '../sessionManager';
import { sendSuccess, sendNotFound as _sendNotFound, handleRouteError } from './routeUtils';

/**
 * Get execution state from session
 */
export function getExecutionStateFromSession(
  session: DotBotSession,
  executionId: string
): ExecutionArrayState | null {
  // Try stateful mode first
  if (session.dotbot.currentChat) {
    const executionArray = session.dotbot.currentChat.getExecutionArray(executionId);
    if (executionArray) {
      return executionArray.getState();
    }
  }
  
  // Try stateless mode
  return session.dotbot.getExecutionState(executionId);
}

/**
 * Handle get execution state route
 */
export function handleGetExecutionState(
  res: Response,
  session: DotBotSession,
  executionId: string
): void {
  const state = getExecutionStateFromSession(session, executionId);

  if (!state) {
    res.status(404).json({
      error: 'Execution not found',
      message: `Execution ${executionId} not found. It may not have been prepared yet or may have expired.`,
      timestamp: new Date().toISOString()
    });
    return;
  }

  sendSuccess(res, { executionId, state });
}

/**
 * Handle approve execution step route
 */
export function handleApproveExecutionStep(
  res: Response,
  session: DotBotSession,
  executionId: string,
  stepIndex?: number
): void {
  if (!session.dotbot.currentChat) {
    handleRouteError(res, new Error('No active chat'), 'approving execution step');
    return;
  }

  const executionArray = session.dotbot.currentChat.getExecutionArray(executionId);
  if (!executionArray) {
    res.status(404).json({
      error: 'Execution not found',
      message: `Execution ${executionId} not found. It may not have been prepared yet or may have expired.`,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (stepIndex !== undefined) {
    const item = executionArray.getItems()[stepIndex];
    if (item && item.status === 'ready') {
      executionArray.updateStatus(item.id, 'executing');
    }
  } else {
    const state = executionArray.getState();
    const currentItem = state.items[state.currentIndex];
    if (currentItem && currentItem.status === 'ready') {
      executionArray.updateStatus(currentItem.id, 'executing');
    }
  }

  const state = executionArray.getState();
  sendSuccess(res, { state });
}

/**
 * Handle reject execution step route
 */
export function handleRejectExecutionStep(
  res: Response,
  session: DotBotSession,
  executionId: string,
  stepIndex: number | undefined,
  reason?: string
): void {
  if (!session.dotbot.currentChat) {
    handleRouteError(res, new Error('No active chat'), 'rejecting execution step');
    return;
  }

  const executionArray = session.dotbot.currentChat.getExecutionArray(executionId);
  if (!executionArray) {
    res.status(404).json({
      error: 'Execution not found',
      message: `Execution ${executionId} not found. It may not have been prepared yet or may have expired.`,
      timestamp: new Date().toISOString()
    });
    return;
  }

  const rejectReason = reason || 'User rejected';

  if (stepIndex !== undefined) {
    const item = executionArray.getItems()[stepIndex];
    if (item) {
      executionArray.updateStatus(item.id, 'cancelled', rejectReason);
    }
  } else {
    const state = executionArray.getState();
    const currentItem = state.items[state.currentIndex];
    if (currentItem) {
      executionArray.updateStatus(currentItem.id, 'cancelled', rejectReason);
    }
  }

  const state = executionArray.getState();
  sendSuccess(res, { state });
}
