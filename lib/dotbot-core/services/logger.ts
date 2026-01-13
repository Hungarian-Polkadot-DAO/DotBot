import pino from 'pino';
import { Subsystem, ErrorType } from './types/logging';
import { getEnv } from '../env';

// Read version from package.json with fallback
// Note: After compilation to dist/, relative paths to package.json don't work
// Use environment variable or hardcode version (matches package.json version)
let LIB_VERSION = process.env.DOTBOT_CORE_VERSION || "0.5.0";

// Detect environment
const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';
const isBrowser = typeof window !== 'undefined';

// Determine log level
const getLogLevel = (): string => {
  const envLevel = getEnv('LOG_LEVEL') || getEnv('DOTBOT_LOG_LEVEL');
  if (envLevel) return envLevel;
  
  // Default levels by environment
  if (isProduction) return 'info';
  if (process.env.NODE_ENV === 'test') return 'warn';
  return 'debug'; // development
};

// Logger configuration - matches backend format but works in browser too
const loggerConfig: pino.LoggerOptions = {
  level: getLogLevel(),
  base: {
    service: 'DotBot-Services',
    version: LIB_VERSION,
    environment: process.env.NODE_ENV || 'development',
    // Browser-specific context (only if in browser)
    ...(isBrowser && typeof navigator !== 'undefined' && { userAgent: navigator.userAgent }),
    ...(isBrowser && typeof window !== 'undefined' && { url: window.location.href }),
    // Node.js-specific context (only if in Node.js)
    ...(!isBrowser && typeof process !== 'undefined' && { userAgent: `Node.js/${process.version}` }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  // In browser, use console transport (pino default)
  // In Node.js development, use pretty printing (like backend)
  ...(!isBrowser && isDevelopment && {
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

// Create the base logger instance
const baseLogger = pino(loggerConfig);

// Create subsystem loggers
export const createSubsystemLogger = (subsystem: Subsystem) => {
  return baseLogger.child({ subsystem });
};

// Helper function for critical errors with types
export const logError = (
  subsystemLogger: pino.Logger, 
  context: Record<string, any>, 
  message: string, 
  errorType?: ErrorType
) => {
  const logContext = errorType ? { ...context, type: errorType } : context;
  subsystemLogger.error(logContext, message);
};

// Export the base logger and convenience logger
export const logger = baseLogger;
export default baseLogger;

// Re-export types for convenience
export { Subsystem, ErrorType } from './types/logging';

