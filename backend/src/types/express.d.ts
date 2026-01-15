/**
 * Type declarations for Express app.locals
 * Extends Express types to include WebSocketManager
 */

import { WebSocketManager } from '@dotbot/express';

declare global {
  namespace Express {
    interface Application {
      locals: {
        wsManager?: WebSocketManager;
      };
    }
  }
}

export {};
