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
import { getConfiguredLogLevel } from '@dotbot/core/utils/logLevel';

/**
 * API Init Message Collector
 * Collects and summarizes noisy Polkadot.js API/INIT messages
 */
interface ApiInitMessages {
  rpcMethods: Set<string>;
  runtimeApis: Map<string, Set<string>>;
  unknownApis: Set<string>;
}

/**
 * Clean message by removing timestamps and prefixes
 */
function cleanMessage(message: string): string {
  return message.replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+/, '').trim();
}

/**
 * Handle RPC methods not decorated message
 */
function handleRpcMethodsMessage(
  cleanMessage: string,
  messages: ApiInitMessages,
  onSummary: () => void
): boolean {
  if (!cleanMessage.includes('API/INIT:') || !cleanMessage.includes('RPC methods not decorated')) {
    return false;
  }
  
  const methods = cleanMessage.match(/RPC methods not decorated:\s*(.+)/)?.[1];
  if (methods) {
    const methodList = methods.split(',').map(m => m.trim()).filter(m => m);
    methodList.forEach(m => messages.rpcMethods.add(m));
    onSummary();
  }
  return true;
}

/**
 * Handle runtime API version mismatch message
 */
function handleRuntimeApiMessage(
  cleanMessage: string,
  messages: ApiInitMessages,
  onSummary: () => void
): boolean {
  const match = cleanMessage.match(/API\/INIT:\s*(.+?):\s*Not decorating runtime apis without matching versions:\s*(.+)/);
  if (!match) return false;
  
  const [, chain, apis] = match;
  if (!messages.runtimeApis.has(chain)) {
    messages.runtimeApis.set(chain, new Set());
  }
  const apiNames = apis.split(',').map(a => a.trim().split('/')[0]).filter(a => a);
  apiNames.forEach(api => messages.runtimeApis.get(chain)!.add(api));
  onSummary();
  return true;
}

/**
 * Handle unknown runtime APIs message
 */
function handleUnknownApiMessage(
  cleanMessage: string,
  messages: ApiInitMessages,
  onSummary: () => void
): boolean {
  const match = cleanMessage.match(/API\/INIT:\s*(.+?):\s*Not decorating unknown runtime apis:/);
  if (!match) return false;
  
  const [, chain] = match;
  messages.unknownApis.add(chain);
  onSummary();
  return true;
}

/**
 * Create debounced summary function
 */
function createDebouncedSummary(
  delay: number,
  callback: () => void
): () => void {
  let timeout: NodeJS.Timeout | null = null;
  let called = false;
  
  return () => {
    if (timeout) clearTimeout(timeout);
    if (called) return;
    
    timeout = setTimeout(() => {
      callback();
      called = true;
    }, delay);
  };
}

/**
 * Create RPC methods summary callback
 */
function createRpcSummaryCallback(
  messages: ApiInitMessages,
  originalConsoleInfo: typeof console.info
): () => void {
  return () => {
    if (messages.rpcMethods.size > 0) {
      originalConsoleInfo(
        `[Polkadot] API initialized (${messages.rpcMethods.size} RPC methods not decorated - expected)`
      );
      messages.rpcMethods.clear();
    }
  };
}

/**
 * Create runtime API summary callback
 */
function createRuntimeApiSummaryCallback(
  messages: ApiInitMessages,
  originalConsoleInfo: typeof console.info
): () => void {
  return () => {
    messages.runtimeApis.forEach((apis, chain) => {
      const apiList = Array.from(apis).join(', ');
      originalConsoleInfo(`[Polkadot] ${chain}: Runtime API version mismatches: ${apiList} (expected)`);
    });
    messages.runtimeApis.clear();
  };
}

/**
 * Create unknown API summary callback
 */
function createUnknownApiSummaryCallback(
  messages: ApiInitMessages,
  originalConsoleInfo: typeof console.info
): () => void {
  return () => {
    if (messages.unknownApis.size > 0) {
      const chains = Array.from(messages.unknownApis).join(', ');
      originalConsoleInfo(`[Polkadot] ${chains}: Unknown runtime APIs (expected)`);
      messages.unknownApis.clear();
    }
  };
}

/**
 * Shorten API/INIT messages to one line
 * Collects similar messages and shows a summary
 */
function createApiInitShortener(
  originalConsoleInfo: typeof console.info
): (message: string) => string | null {
  const messages: ApiInitMessages = {
    rpcMethods: new Set(),
    runtimeApis: new Map(),
    unknownApis: new Set(),
  };
  
  const showRpcSummary = createDebouncedSummary(1000, createRpcSummaryCallback(messages, originalConsoleInfo));
  const showRuntimeApiSummary = createDebouncedSummary(1000, createRuntimeApiSummaryCallback(messages, originalConsoleInfo));
  const showUnknownApiSummary = createDebouncedSummary(1000, createUnknownApiSummaryCallback(messages, originalConsoleInfo));
  
  return (message: string): string | null => {
    const cleaned = cleanMessage(message);
    
    if (handleRpcMethodsMessage(cleaned, messages, showRpcSummary)) {
      return null;
    }
    if (handleRuntimeApiMessage(cleaned, messages, showRuntimeApiSummary)) {
      return null;
    }
    if (handleUnknownApiMessage(cleaned, messages, showUnknownApiSummary)) {
      return null;
    }
    
    return null;
  };
}

/**
 * Handle Polkadot version warnings
 * Collects multiple version warnings and shows a single summary
 */
function createVersionWarningHandler(
  originalConsoleWarn: typeof console.warn
): (message: string) => boolean {
  const versionWarnings = new Set<string>();
  const showSummary = createDebouncedSummary(1000, () => {
    if (versionWarnings.size > 0) {
      const packages = Array.from(versionWarnings).sort().join(', ');
      originalConsoleWarn(
        `[Polkadot] Version conflicts: ${packages} (${versionWarnings.size} packages). Run 'npm dedupe' to resolve.`
      );
      versionWarnings.clear();
    }
  });
  
  return (message: string): boolean => {
    const match = message.match(/@polkadot\/([^\s]+) has multiple versions/);
    if (match) {
      versionWarnings.add(match[1]);
      showSummary();
      return true; // Suppress individual message
    }
    return false;
  };
}

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
  
  const shortenApiInit = createApiInitShortener(originalConsoleInfo);
  const handleVersionWarning = createVersionWarningHandler(originalConsoleWarn);
  
  console.log = (...args: any[]) => {
    const message = String(args[0] || '');
    const shortened = shortenApiInit(message);
    if (shortened) {
      originalConsoleLog(shortened);
    } else {
      originalConsoleLog.apply(console, args);
    }
  };
  
  console.info = (...args: any[]) => {
    const message = String(args[0] || '');
    const shortened = shortenApiInit(message);
    if (shortened) {
      originalConsoleInfo(shortened);
    } else {
      originalConsoleInfo.apply(console, args);
    }
  };
  
  console.warn = (...args: any[]) => {
    const message = String(args[0] || '');
    
    if (handleVersionWarning(message)) {
      return; // Suppress this message
    }
    
    const apiShortened = shortenApiInit(message);
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

// Determine log level using shared utility
const getLogLevel = (): string => {
  return getConfiguredLogLevel();
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
