/**
 * Log Level Utilities
 * 
 * Provides shared utilities for normalizing and validating log levels
 * across all DotBot packages. Ensures consistent log level handling.
 */

/**
 * Valid Pino log levels in order of severity
 */
export const VALID_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = typeof VALID_LOG_LEVELS[number];

/**
 * Map common variations to standard pino levels
 */
const LOG_LEVEL_ALIASES: Record<string, LogLevel> = {
  'warning': 'warn',
  'err': 'error',
  'critical': 'fatal',
};

/**
 * Normalize log level to pino's expected format
 * - Converts to lowercase
 * - Trims whitespace
 * - Maps common aliases (e.g., 'WARNING' -> 'warn')
 * 
 * @param level - Raw log level string from environment
 * @returns Normalized log level or null if invalid
 */
export function normalizeLogLevel(level: string): LogLevel | null {
  const normalized = level.toLowerCase().trim() as LogLevel;
  
  // Check if it's a direct match
  if (VALID_LOG_LEVELS.includes(normalized)) {
    return normalized;
  }
  
  // Check if it's an alias
  if (normalized in LOG_LEVEL_ALIASES) {
    return LOG_LEVEL_ALIASES[normalized];
  }
  
  // Invalid level
  return null;
}

/**
 * Get default log level based on environment
 */
function getDefaultLogLevel(nodeEnv?: string): LogLevel {
  if (nodeEnv === 'production') return 'info';
  if (nodeEnv === 'test') return 'warn';
  return 'debug'; // development
}

/**
 * Get log level from environment with fallback to default
 * 
 * @param defaultLevel - Default level if not configured (optional, will use env-based default)
 * @returns Validated log level
 */
export function getConfiguredLogLevel(defaultLevel?: LogLevel): LogLevel {
  const envLevel = process.env.LOG_LEVEL || process.env.DOTBOT_LOG_LEVEL;
  
  if (envLevel) {
    const normalized = normalizeLogLevel(envLevel);
    if (normalized) {
      return normalized;
    }
    console.warn(
      `[Logger] Invalid LOG_LEVEL="${envLevel}". ` +
      `Valid levels: ${VALID_LOG_LEVELS.join(', ')}. ` +
      `Using default: ${defaultLevel || getDefaultLogLevel(process.env.NODE_ENV)}`
    );
  }
  
  return defaultLevel || getDefaultLogLevel(process.env.NODE_ENV);
}
