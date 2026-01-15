import pino from 'pino';
import { Subsystem, ErrorType } from './types/logging';
import { isBrowser, isNode } from '../env';
import { getConfiguredLogLevel } from '../utils/logLevel';

// Read version from package.json with fallback
// Note: After compilation to dist/, relative paths to package.json don't work
// Use environment variable or hardcode version (matches package.json version)
let LIB_VERSION = process.env.DOTBOT_CORE_VERSION || "0.5.0";

// Detect environment
const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';

// Determine log level using shared utility
const getLogLevel = (): string => {
  return getConfiguredLogLevel();
};

// Helper function to dynamically detect backend context
// This is called on every log to ensure we check the latest env var value
function getBackendContext(): boolean {
  if (!isNode() || isBrowser()) {
    return false;
  }
  // Check if DOTBOT_BACKEND is set (supports both 'true' string and truthy values)
  const backendFlag = process.env.DOTBOT_BACKEND;
  return backendFlag === 'true' || backendFlag === '1' || backendFlag === 'yes';
}

// Logger configuration - matches backend format but works in browser too
// In Node.js development, use pino-pretty for readable output (like dotbot-express)
// In browser or production, output JSON
// Service name and version are set dynamically via mixin to check DOTBOT_BACKEND at log time
const loggerConfig: pino.LoggerOptions = {
  level: getLogLevel(),
  base: {
    // Don't set service or version here - mixin will set them dynamically
    environment: process.env.NODE_ENV || 'development',
    // Browser-specific context (only if in browser)
    ...(isBrowser() && typeof navigator !== 'undefined' && { userAgent: navigator.userAgent }),
    ...(isBrowser() && typeof window !== 'undefined' && { url: window.location.href }),
    // Node.js-specific context (only if in Node.js)
    ...(isNode() && { userAgent: `Node.js/${process.version}` }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label };
    },
    // Use formatters.log to dynamically set service and version on every log
    // This is more reliable than mixin for dynamic values
    log(object: any) {
      const isBackend = getBackendContext();
      // Override service and version dynamically based on current env var
      object.service = isBackend ? 'DotBot-Backend' : 'DotBot-Services';
      object.version = isBackend ? (process.env.DOTBOT_EXPRESS_VERSION || LIB_VERSION) : LIB_VERSION;
      return object;
    },
  },
  // In Node.js development, use pino-pretty for pretty printing (like dotbot-express)
  // In browser or production, output JSON
  // Pino will gracefully fall back to JSON if pino-pretty is not available
  ...(isNode() && !isBrowser() && isDevelopment && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
        singleLine: false,
        messageFormat: '{msg}',
        hideObject: false,
        // Better formatting for nested objects
        crlf: false,
        errorLikeObjectKeys: ['err', 'error'],
        // Format output more consistently
        customColors: 'info:blue,warn:yellow,error:red',
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

