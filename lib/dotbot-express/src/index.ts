/**
 * @dotbot/express
 * Express.js integration layer for DotBot
 * Provides routes, middleware, and utilities to use DotBot via HTTP API
 */

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
