/**
 * WebSocket Event Types
 * 
 * Shared types for WebSocket communication between frontend and backend.
 * These types ensure type safety and consistency across the entire stack.
 */

import { ExecutionArrayState } from '../executionEngine/types';

/**
 * Events sent from client to server
 */
export interface ClientToServerEvents {
  // Execution subscriptions
  'subscribe-execution': (data: { sessionId: string; executionId: string }) => void;
  'unsubscribe-execution': (data: { sessionId: string; executionId: string }) => void;
  'subscribe-session-executions': (data: { sessionId: string }) => void;
  'unsubscribe-session-executions': (data: { sessionId: string }) => void;
  
  // Future: System notifications
  // 'subscribe-system': (data: { sessionId: string }) => void;
  // 'subscribe-rpc': (data: { sessionId: string }) => void;
  // 'subscribe-notifications': (data: { sessionId: string }) => void;
}

/**
 * Events sent from server to client
 */
export interface ServerToClientEvents {
  // Execution updates
  'execution-update': (data: { executionId: string; state: ExecutionArrayState }) => void;
  'execution-complete': (data: { executionId: string; success: boolean }) => void;
  'execution-error': (data: { executionId: string; error: string }) => void;
  
  // Future: System notifications (low overhead, event-driven)
  // 'system-notification': (data: { level: 'info' | 'warning' | 'error'; message: string; action?: string }) => void;
  // 'rpc-health-change': (data: { chain: 'relay' | 'assetHub'; status: string; endpoint: string }) => void;
  // 'execution-session-lost': (data: { executionId: string; reason: string }) => void;
  
  // Connection events
  'connected': (data: { message: string }) => void;
  'error': (data: { message: string }) => void;
}

/**
 * WebSocket event names (for type safety and autocomplete)
 */
export const WebSocketEvents = {
  // Client to Server
  SUBSCRIBE_EXECUTION: 'subscribe-execution',
  UNSUBSCRIBE_EXECUTION: 'unsubscribe-execution',
  SUBSCRIBE_SESSION_EXECUTIONS: 'subscribe-session-executions',
  UNSUBSCRIBE_SESSION_EXECUTIONS: 'unsubscribe-session-executions',
  
  // Server to Client
  EXECUTION_UPDATE: 'execution-update',
  EXECUTION_COMPLETE: 'execution-complete',
  EXECUTION_ERROR: 'execution-error',
  CONNECTED: 'connected',
  ERROR: 'error',
} as const;
