/**
 * Centralized error handling middleware
 * Provides consistent error responses across the API
 */

import { Request, Response, NextFunction } from 'express';

export interface APIError extends Error {
  statusCode?: number;
  code?: string;
}

/**
 * Global error handler middleware
 * Should be registered last in the middleware chain
 */
export function errorHandler(
  err: APIError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';
  
  console.error('[Error Handler]', {
    method: req.method,
    path: req.path,
    error: message,
    code: err.code,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });

  res.status(statusCode).json({
    error: true,
    message,
    code: err.code,
    path: req.path,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

/**
 * 404 Not Found handler
 */
export function notFoundHandler(
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  res.status(404).json({
    error: true,
    message: `Route not found: ${req.method} ${req.path}`,
    code: 'NOT_FOUND',
    timestamp: new Date().toISOString()
  });
}
