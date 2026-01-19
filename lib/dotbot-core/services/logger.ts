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

// Determine if pretty printing should be enabled
// Default to true (human-readable) for all environments unless explicitly disabled
// Only applies to Node.js (not browser)
const shouldUsePretty = isNode() && !isBrowser() && process.env.LOG_FORMAT !== 'json';

// Determine if metadata fields should be shown
// Default to false (completely excluded) - set LOG_SHOW_METADATA=true to include them
const showMetadata = process.env.LOG_SHOW_METADATA === 'true' || process.env.LOG_SHOW_METADATA === '1';

// Build ignore list for pino-pretty (only pid and hostname, since metadata is excluded from base)
const ignoreFields = 'pid,hostname';

// Logger configuration - matches backend format but works in browser too
// In Node.js, use pino-pretty for readable output by default
// In browser, output JSON (pino-pretty doesn't work in browser)
// Service name and version are set dynamically via mixin to check DOTBOT_BACKEND at log time
const loggerConfig: pino.LoggerOptions = {
  level: getLogLevel(),
  base: showMetadata ? {
    // Only include metadata fields when LOG_SHOW_METADATA is enabled
    environment: process.env.NODE_ENV || 'development',
    // Browser-specific context (only if in browser)
    ...(isBrowser() && typeof navigator !== 'undefined' && { userAgent: navigator.userAgent }),
    ...(isBrowser() && typeof window !== 'undefined' && { url: window.location.href }),
    // Node.js-specific context (only if in Node.js)
    ...(isNode() && { userAgent: `Node.js/${process.version}` }),
  } : {},
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label };
    },
    // Use formatters.log to dynamically set service and version on every log
    // Also filter out metadata fields when LOG_SHOW_METADATA is disabled
    log(object: any) {
      if (showMetadata) {
        const isBackend = getBackendContext();
        // Override service and version dynamically based on current env var
        object.service = isBackend ? 'DotBot-Backend' : 'DotBot-Services';
        object.version = isBackend ? (process.env.DOTBOT_EXPRESS_VERSION || LIB_VERSION) : LIB_VERSION;
      } else {
        // Remove metadata fields when LOG_SHOW_METADATA is disabled
        delete object.service;
        delete object.version;
        delete object.environment;
        delete object.userAgent;
        delete object.subsystem;
        delete object.endpoint;
        delete object.chain;
      }
      return object;
    },
  },
  // Use pino-pretty for pretty printing in Node.js (all environments by default)
  // Set LOG_FORMAT=json to disable pretty printing
  // Set LOG_SHOW_METADATA=true to show metadata fields (environment, service, version, etc.)
  // Pino will gracefully fall back to JSON if pino-pretty is not available
  ...(shouldUsePretty && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: ignoreFields,
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

