/**
 * Session Route Utilities
 * 
 */

import { Response } from 'express';
import { DotBotSession } from '../sessionManager';
import { sendSuccess, sendNotFound as _sendNotFound, handleRouteError } from './routeUtils';

/**
 * Get session data for response
 */
function getSessionResponseData(session: DotBotSession): any {
  return {
    sessionId: session.sessionId,
    environment: session.environment,
    network: session.network,
    wallet: session.wallet,
    currentChatId: session.dotbot.currentChat?.id || null,
    createdAt: session.createdAt.toISOString(),
    lastAccessed: session.lastAccessed.toISOString(),
  };
}

/**
 * Handle get session route
 */
export async function handleGetSession(
  res: Response,
  session: DotBotSession | null,
  sessionId: string
): Promise<void> {
  if (!session) {
    res.status(404).json({
      error: 'Session not found',
      message: `No DotBot session found for ID: ${sessionId}`,
    });
    return;
  }

  sendSuccess(res, getSessionResponseData(session));
}

/**
 * Handle delete session route
 */
export async function handleDeleteSession(
  res: Response,
  sessionManager: any,
  sessionId: string
): Promise<void> {
  try {
    const session = await sessionManager.getSession(sessionId);
    const existed = session !== null;
    
    if (existed) {
      await sessionManager.deleteSession(sessionId);
    }

    sendSuccess(res, {
      success: existed,
      message: existed ? 'Session deleted' : 'Session not found',
    });
  } catch (error: any) {
    handleRouteError(res, error, 'deleting session', sessionId);
  }
}
