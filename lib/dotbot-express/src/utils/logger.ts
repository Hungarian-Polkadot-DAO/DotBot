/**
 * Backend Logger for dotbot-express
 * 
 * Provides structured logging specifically for backend/Express.js usage.
 * Uses pino for high-performance logging with JSON output.
 * 
 * This logger is safe to use in both backend and frontend (won't break frontend),
 * but is optimized for backend usage with proper log levels and formatting.
 */

import pino from 'pino';
import { getEnv } from '@dotbot/core/env';

// Read version from package.json or environment
const EXPRESS_VERSION = process.env.DOTBOT_EXPRESS_VERSION || '0.1.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Determine log level
const getLogLevel = (): string => {
  const envLevel = getEnv('LOG_LEVEL') || getEnv('DOTBOT_LOG_LEVEL');
  if (envLevel) return envLevel;
  
  // Default levels by environment
  if (NODE_ENV === 'production') return 'info';
  if (NODE_ENV === 'test') return 'warn';
  return 'debug'; // development
};

// Create backend logger configuration
const loggerConfig: pino.LoggerOptions = {
  level: getLogLevel(),
  base: {
    service: 'DotBot-Backend',
    version: EXPRESS_VERSION,
    environment: NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  // In development, use pretty printing
  ...(NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
        singleLine: false,
      },
    },
  }),
};

// Create the base logger
const baseLogger = pino(loggerConfig);

/**
 * Create a child logger with additional context
 */
export const createLogger = (context: Record<string, any> = {}) => {
  return baseLogger.child(context);
};

/**
 * Request logger - logs HTTP requests with context
 */
export const requestLogger = createLogger({ subsystem: 'http' });

/**
 * API logger - logs API-specific events
 */
export const apiLogger = createLogger({ subsystem: 'api' });

/**
 * Error logger - logs errors with stack traces
 */
export const errorLogger = createLogger({ subsystem: 'error' });

/**
 * DotBot logger - logs DotBot-specific operations
 */
export const dotbotLogger = createLogger({ subsystem: 'dotbot' });

/**
 * Session logger - logs session management
 */
export const sessionLogger = createLogger({ subsystem: 'session' });

// Export the base logger
export const logger = baseLogger;
export default baseLogger;
