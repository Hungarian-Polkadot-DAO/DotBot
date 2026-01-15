/**
 * @dotbot/express
 * Express.js integration layer for DotBot
 * Provides routes, middleware, and utilities to use DotBot via HTTP API
 */

// CRITICAL: Set backend context BEFORE any other imports
// This ensures dotbot-core logger uses "DotBot-Backend" service name
if (typeof process !== 'undefined') {
  process.env.DOTBOT_BACKEND = 'true';
  process.env.DOTBOT_EXPRESS_VERSION = process.env.DOTBOT_EXPRESS_VERSION || '0.1.0';
}

// Import logger early to set up console filters (must be before other imports)
import './utils/logger';

export { default as chatRouter } from './routes/chat';
export { default as dotbotRouter } from './routes/dotbot';
export { errorHandler, notFoundHandler } from './middleware/errorHandler';
export { requestLogger } from './middleware/requestLogger';
export { 
  logger, 
  createLogger, 
  requestLogger as httpLogger,
  apiLogger, 
  dotbotLogger, 
  sessionLogger, 
  errorLogger 
} from './utils/logger';

// Session Manager (for multi-user/multi-session support)
export { 
  DotBotSessionManager, 
  createSessionManager,
  createRedisSessionManager,
  InMemorySessionStore,
  RedisSessionStore
} from './sessionManager';
export type { 
  SessionConfig, 
  DotBotSession,
  SessionStore
} from './sessionManager';

// WebSocket Manager (for real-time updates)
export { WebSocketManager } from './websocket/WebSocketManager';
export type { 
  WebSocketManagerConfig,
  ClientToServerEvents,
  ServerToClientEvents
} from './websocket/WebSocketManager';
export { 
  setupExecutionBroadcasting,
  broadcastExecutionUpdates
} from './websocket/executionBroadcaster';
