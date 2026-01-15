/**
 * Backend Logger for dotbot-express
 * 
 * Provides structured logging specifically for backend/Express.js usage.
 * Uses pino for high-performance logging with JSON output.
 * 
 * This logger is safe to use in both backend and frontend (won't break frontend),
 * but is optimized for backend usage with proper log levels and formatting.
 * 
 * Also shortens noisy Polkadot.js console output (API/INIT messages) to one-line summaries.
 */

import pino from 'pino';
import { getEnv } from '@dotbot/core/env';

/**
 * Shorten noisy Polkadot.js console messages
 * Instead of filtering them out, condense them to one line with just the essence
 */
function setupConsoleShortener() {
  // Only set up once
  if ((console as any).__dotbotShortened) {
    return;
  }
  
  const originalConsoleLog = console.log;
  const originalConsoleInfo = console.info;
  const originalConsoleWarn = console.warn;
  
  /**
   * Shorten API/INIT messages to one line
   * Collects similar messages and shows a summary
   */
  const apiInitMessages = {
    rpcMethods: new Set<string>(),
    runtimeApis: new Map<string, Set<string>>(), // chain -> Set of API names
    unknownApis: new Set<string>(), // chain names
  };
  let apiInitTimeout: NodeJS.Timeout | null = null;
  let apiInitSummaryShown = false;
  
  function shortenApiInitMessage(message: string): string | null {
    // Extract just the message part (ignore timestamps/prefixes)
    const cleanMessage = message.replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+/, '').trim();
    
    // RPC methods not decorated - collect and show summary
    if (cleanMessage.includes('API/INIT:') && cleanMessage.includes('RPC methods not decorated')) {
      const methods = cleanMessage.match(/RPC methods not decorated:\s*(.+)/)?.[1];
      if (methods) {
        const methodList = methods.split(',').map(m => m.trim()).filter(m => m);
        methodList.forEach(m => apiInitMessages.rpcMethods.add(m));
      }
      
      // Debounce summary
      if (apiInitTimeout) clearTimeout(apiInitTimeout);
      apiInitTimeout = setTimeout(() => {
        if (apiInitMessages.rpcMethods.size > 0 && !apiInitSummaryShown) {
          originalConsoleInfo(`[Polkadot] API initialized (${apiInitMessages.rpcMethods.size} RPC methods not decorated - expected)`);
          apiInitSummaryShown = true;
          apiInitMessages.rpcMethods.clear();
        }
      }, 1000);
      
      return null; // Suppress individual message
    }
    
    // Runtime APIs - collect by chain
    const runtimeApiMatch = cleanMessage.match(/API\/INIT:\s*(.+?):\s*Not decorating runtime apis without matching versions:\s*(.+)/);
    if (runtimeApiMatch) {
      const [, chain, apis] = runtimeApiMatch;
      if (!apiInitMessages.runtimeApis.has(chain)) {
        apiInitMessages.runtimeApis.set(chain, new Set());
      }
      const apiNames = apis.split(',').map(a => a.trim().split('/')[0]).filter(a => a);
      apiNames.forEach(api => apiInitMessages.runtimeApis.get(chain)!.add(api));
      
      if (apiInitTimeout) clearTimeout(apiInitTimeout);
      apiInitTimeout = setTimeout(() => {
        if (!apiInitSummaryShown) {
          apiInitMessages.runtimeApis.forEach((apis, chain) => {
            const apiList = Array.from(apis).join(', ');
            originalConsoleInfo(`[Polkadot] ${chain}: Runtime API version mismatches: ${apiList} (expected)`);
          });
          apiInitSummaryShown = true;
          apiInitMessages.runtimeApis.clear();
        }
      }, 1000);
      
      return null; // Suppress individual message
    }
    
    // Unknown runtime APIs - collect by chain
    const unknownApiMatch = cleanMessage.match(/API\/INIT:\s*(.+?):\s*Not decorating unknown runtime apis:/);
    if (unknownApiMatch) {
      const [, chain] = unknownApiMatch;
      apiInitMessages.unknownApis.add(chain);
      
      if (apiInitTimeout) clearTimeout(apiInitTimeout);
      apiInitTimeout = setTimeout(() => {
        if (apiInitMessages.unknownApis.size > 0 && !apiInitSummaryShown) {
          const chains = Array.from(apiInitMessages.unknownApis).join(', ');
          originalConsoleInfo(`[Polkadot] ${chains}: Unknown runtime APIs (expected)`);
          apiInitSummaryShown = true;
          apiInitMessages.unknownApis.clear();
        }
      }, 1000);
      
      return null; // Suppress individual message
    }
    
    return null;
  }
  
  /**
   * Collect and summarize Polkadot version warnings
   * Multiple versions can cause subtle bugs, so we collect them and show a single summary
   */
  const versionWarnings = new Set<string>();
  let versionWarningTimeout: NodeJS.Timeout | null = null;
  let versionWarningShown = false;
  
  function handleVersionWarning(message: string): boolean {
    const match = message.match(/@polkadot\/([^\s]+) has multiple versions/);
    if (match) {
      const packageName = match[1];
      versionWarnings.add(packageName);
      
      // Debounce: show summary after collecting warnings for 1 second
      if (versionWarningTimeout) {
        clearTimeout(versionWarningTimeout);
      }
      
      versionWarningTimeout = setTimeout(() => {
        if (versionWarnings.size > 0 && !versionWarningShown) {
          const packages = Array.from(versionWarnings).sort().join(', ');
          originalConsoleWarn(`[Polkadot] Version conflicts: ${packages} (${versionWarnings.size} packages). Run 'npm dedupe' to resolve.`);
          versionWarningShown = true;
          versionWarnings.clear();
        }
      }, 1000); // Wait 1 second to collect all warnings
      
      // Suppress individual messages
      return true; // Return true to suppress
    }
    return false;
  }
  
  console.log = (...args: any[]) => {
    const message = String(args[0] || '');
    const shortened = shortenApiInitMessage(message);
    if (shortened) {
      originalConsoleLog(shortened);
    } else {
      originalConsoleLog.apply(console, args);
    }
  };
  
  console.info = (...args: any[]) => {
    const message = String(args[0] || '');
    const shortened = shortenApiInitMessage(message);
    if (shortened) {
      originalConsoleInfo(shortened);
    } else {
      originalConsoleInfo.apply(console, args);
    }
  };
  
  console.warn = (...args: any[]) => {
    const message = String(args[0] || '');
    
    // Handle version warnings (suppresses individual messages, shows summary)
    if (handleVersionWarning(message)) {
      return; // Suppress this message
    }
    
    // Try API init message shortening
    const apiShortened = shortenApiInitMessage(message);
    if (apiShortened) {
      originalConsoleWarn(apiShortened);
    } else {
      originalConsoleWarn.apply(console, args);
    }
  };
  
  // Mark as shortened to prevent double setup
  (console as any).__dotbotShortened = true;
}

// Setup console shortener on module load (before any Polkadot.js code runs)
setupConsoleShortener();

// Read version from package.json or environment
const EXPRESS_VERSION = process.env.DOTBOT_EXPRESS_VERSION || '0.1.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Determine log level
const getLogLevel = (): string => {
  const envLevel = getEnv('LOG_LEVEL') || getEnv('DOTBOT_LOG_LEVEL');
  if (envLevel) {
    // Normalize log level to pino's expected format (lowercase, trim whitespace)
    const normalized = String(envLevel).toLowerCase().trim();
    // Map common variations to pino levels
    // Pino standard levels: trace, debug, info, warn, error, fatal
    const levelMap: Record<string, string> = {
      'warning': 'warn',
      'warn': 'warn',
      'error': 'error',
      'info': 'info',
      'debug': 'debug',
      'trace': 'trace',
      'fatal': 'fatal',
    };
    const mappedLevel = levelMap[normalized];
    if (mappedLevel) {
      return mappedLevel;
    }
    // If not in map, check if it's a valid pino level
    const validPinoLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    if (validPinoLevels.includes(normalized)) {
      return normalized;
    }
    // Invalid level - fall back to default
    console.warn(`[Logger] Invalid log level "${envLevel}", falling back to default`);
  }
  
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
  // In development, use pretty printing with improved formatting
  // Pino will gracefully fall back to JSON if pino-pretty is not available
  ...(NODE_ENV === 'development' && {
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
