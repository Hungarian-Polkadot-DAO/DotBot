/**
 * Route Utilities
 */

import { Response } from 'express';
import { sessionLogger as _sessionLogger, errorLogger } from './logger';

/**
 * Send 404 not found response
 */
export function sendNotFound(res: Response, resource: string, id: string): void {
  res.status(404).json({
    error: `${resource} not found`,
    message: `No ${resource} found for ID: ${id}`,
    timestamp: new Date().toISOString()
  });
}

/**
 * Send 400 bad request response
 */
export function sendBadRequest(res: Response, message: string): void {
  res.status(400).json({
    error: 'Invalid request',
    message,
    timestamp: new Date().toISOString()
  });
}

/**
 * Send success response
 */
export function sendSuccess(res: Response, data: any): void {
  res.json({
    success: true,
    ...data,
    timestamp: new Date().toISOString()
  });
}

/**
 * Handle route error with logging
 */
export function handleRouteError(
  res: Response,
  error: any,
  context: string,
  sessionId?: string,
  additionalContext?: Record<string, any>
): void {
  errorLogger.error({
    error: error.message,
    stack: error.stack,
    sessionId,
    ...additionalContext
  }, `Error ${context}`);

  res.status(500).json({
    error: 'Internal server error',
    message: error.message || `Failed to ${context}`,
    timestamp: new Date().toISOString()
  });
}

/**
 * Get session or return 404
 */
export async function getSessionOr404(
  sessionManager: any,
  sessionId: string,
  res: Response
): Promise<any | null> {
  try {
    const session = await sessionManager.getSession(sessionId);
    if (!session) {
      res.status(404).json({
        error: 'Session not found',
        message: `No DotBot session found for ID: ${sessionId}`,
        timestamp: new Date().toISOString()
      });
      return null;
    }
    return session;
  } catch (error: any) {
    handleRouteError(res, error, 'getting session', sessionId);
    return null;
  }
}
