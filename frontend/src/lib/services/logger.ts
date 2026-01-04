import pino from 'pino';
import { Subsystem, ErrorType } from './types/logging';

// Read version from package.json with fallback
let LIB_VERSION = "0.1.0-fallback";
try {
  // Try to read from frontend package.json
  const packageJson = require("../../package.json");
  LIB_VERSION = packageJson.version;
} catch (error) {
  // Silently use fallback version
}

// Detect environment
const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';

// Browser-compatible logger configuration
const loggerConfig = {
  level: process.env.DOTBOT_LOG_LEVEL || process.env.REACT_APP_LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  // Browser transport - pino automatically uses console in browser
  browser: {
    asObject: isDevelopment, // Pretty objects in dev, strings in prod
  },
  // Base fields to include in all logs
  base: {
    service: 'DotBot-Services',
    version: LIB_VERSION,
    environment: process.env.NODE_ENV || 'development',
    // Browser-specific context (only if in browser)
    ...(typeof navigator !== 'undefined' && { userAgent: navigator.userAgent }),
    ...(typeof window !== 'undefined' && { url: window.location.href }),
  },
  // Timestamp format
  timestamp: pino.stdTimeFunctions.isoTime,
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

