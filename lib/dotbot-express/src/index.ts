/**
 * @dotbot/express
 * Express.js integration layer for DotBot
 * Provides routes, middleware, and utilities to use DotBot via HTTP API
 */

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
