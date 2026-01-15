/**
 * WebSocket Manager
 * 
 * Progressive WebSocket architecture for DotBot real-time features.
 * Uses Socket.IO with room-based channels for isolation and scalability.
 * 
 * ARCHITECTURE:
 * - One WebSocket connection per session (wallet + environment)
 * - Multiple "rooms" for different features (low overhead, event-driven)
 * - Easy to add new features progressively without refactoring
 * 
 * ROOMS:
 * - `execution:${executionId}` - Execution progress updates ✅ IMPLEMENTED
 * 
 * FUTURE (if needed):
 * - `system:${sessionId}` - Backend health, RPC status, maintenance notifications
 * - `rpc:${sessionId}` - RPC endpoint health and failover events
 * - `notifications:${sessionId}` - On-chain events (governance, staking rewards)
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { ExecutionArrayState } from '@dotbot/core/executionEngine/types';
import { logger } from '../utils/logger';

export interface WebSocketManagerConfig {
  httpServer: HttpServer;
  corsOrigins?: string | string[];
  path?: string;
}

export interface ClientToServerEvents {
  // Execution subscriptions
  'subscribe-execution': (data: { sessionId: string; executionId: string }) => void;
  'unsubscribe-execution': (data: { sessionId: string; executionId: string }) => void;
  
  // Future: System notifications
  // 'subscribe-system': (data: { sessionId: string }) => void;
  // 'subscribe-rpc': (data: { sessionId: string }) => void;
  // 'subscribe-notifications': (data: { sessionId: string }) => void;
}

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
 * WebSocket Manager
 * 
 * Manages Socket.IO connections and room-based event broadcasting.
 * Designed for progressive enhancement - start with execution updates,
 * add more features (chat, balance, etc.) without refactoring.
 */
export class WebSocketManager {
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  private connectedClients: Map<string, Socket> = new Map();
  
  constructor(config: WebSocketManagerConfig) {
    // Initialize Socket.IO with CORS configuration
    this.io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(config.httpServer, {
      cors: {
        origin: config.corsOrigins || '*',
        credentials: true,
        methods: ['GET', 'POST'],
      },
      path: config.path || '/socket.io',
      transports: ['websocket', 'polling'], // WebSocket preferred, polling fallback
      pingTimeout: 60000, // 60 seconds
      pingInterval: 25000, // 25 seconds
    });
    
    this.setupConnectionHandlers();
    
    logger.info({
      subsystem: 'websocket',
      corsOrigins: config.corsOrigins,
      path: config.path || '/socket.io'
    }, 'WebSocket Manager initialized');
  }
  
  /**
   * Setup connection handlers for all clients
   */
  private setupConnectionHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      const sessionId = socket.handshake.query.sessionId as string;
      const clientId = socket.id;
      
      logger.info({
        subsystem: 'websocket',
        clientId,
        sessionId,
        transport: socket.conn.transport.name
      }, 'Client connected');
      
      // Track connected client
      this.connectedClients.set(clientId, socket);
      
      // Send connection confirmation
      socket.emit('connected', { 
        message: 'WebSocket connection established' 
      });
      
      // Setup execution subscription handlers
      this.setupExecutionHandlers(socket, sessionId);
      
      // Future: System notification handlers (if needed)
      // this.setupSystemHandlers(socket, sessionId);
      // this.setupRpcHealthHandlers(socket, sessionId);
      // this.setupNotificationHandlers(socket, sessionId);
      
      // Handle disconnection
      socket.on('disconnect', (reason) => {
        logger.info({
          subsystem: 'websocket',
          clientId,
          sessionId,
          reason
        }, 'Client disconnected');
        
        this.connectedClients.delete(clientId);
      });
      
      // Handle connection errors
      socket.on('error', (error) => {
        logger.error({
          subsystem: 'websocket',
          clientId,
          sessionId,
          error: error.message
        }, 'Socket error');
      });
    });
  }
  
  /**
   * Setup execution subscription handlers
   * 
   * Clients subscribe to specific execution IDs to receive real-time updates
   * during simulation, signing, broadcasting, and finalization.
   */
  private setupExecutionHandlers(socket: Socket, sessionId: string): void {
    // Subscribe to execution updates
    socket.on('subscribe-execution', ({ sessionId: requestSessionId, executionId }) => {
      // Validate session ID matches
      if (requestSessionId !== sessionId) {
        logger.warn({
          subsystem: 'websocket',
          clientId: socket.id,
          requestSessionId,
          actualSessionId: sessionId
        }, 'Session ID mismatch on execution subscription');
        return;
      }
      
      const room = `execution:${executionId}`;
      socket.join(room);
      
      logger.debug({
        subsystem: 'websocket',
        clientId: socket.id,
        sessionId,
        executionId,
        room
      }, 'Client subscribed to execution updates');
    });
    
    // Unsubscribe from execution updates
    socket.on('unsubscribe-execution', ({ sessionId: requestSessionId, executionId }) => {
      // Validate session ID matches
      if (requestSessionId !== sessionId) {
        return;
      }
      
      const room = `execution:${executionId}`;
      socket.leave(room);
      
      logger.debug({
        subsystem: 'websocket',
        clientId: socket.id,
        sessionId,
        executionId,
        room
      }, 'Client unsubscribed from execution updates');
    });
  }
  
  /**
   * Broadcast execution state update to all subscribers
   * 
   * This is called by the backend when ExecutionArray state changes.
   * All clients subscribed to this execution will receive the update.
   */
  broadcastExecutionUpdate(executionId: string, state: ExecutionArrayState): void {
    const room = `execution:${executionId}`;
    
    logger.debug({
      subsystem: 'websocket',
      executionId,
      room,
      currentIndex: state.currentIndex,
      isExecuting: state.isExecuting,
      completedItems: state.completedItems,
      totalItems: state.totalItems
    }, 'Broadcasting execution update');
    
    this.io.to(room).emit('execution-update', {
      executionId,
      state
    });
  }
  
  /**
   * Broadcast execution completion
   */
  broadcastExecutionComplete(executionId: string, success: boolean): void {
    const room = `execution:${executionId}`;
    
    logger.info({
      subsystem: 'websocket',
      executionId,
      room,
      success
    }, 'Broadcasting execution completion');
    
    this.io.to(room).emit('execution-complete', {
      executionId,
      success
    });
  }
  
  /**
   * Broadcast execution error
   */
  broadcastExecutionError(executionId: string, error: string): void {
    const room = `execution:${executionId}`;
    
    logger.error({
      subsystem: 'websocket',
      executionId,
      room,
      error
    }, 'Broadcasting execution error');
    
    this.io.to(room).emit('execution-error', {
      executionId,
      error
    });
  }
  
  /**
   * Get number of clients subscribed to an execution
   */
  getExecutionSubscriberCount(executionId: string): number {
    const room = `execution:${executionId}`;
    const sockets = this.io.sockets.adapter.rooms.get(room);
    return sockets ? sockets.size : 0;
  }
  
  /**
   * Get total number of connected clients
   */
  getConnectedClientCount(): number {
    return this.connectedClients.size;
  }
  
  /**
   * Get Socket.IO server instance (for advanced usage)
   */
  getIOServer(): SocketIOServer<ClientToServerEvents, ServerToClientEvents> {
    return this.io;
  }
  
  /**
   * Close WebSocket server
   */
  async close(): Promise<void> {
    logger.info({ subsystem: 'websocket' }, 'Closing WebSocket server...');
    
    // Close all client connections
    this.connectedClients.forEach((socket) => {
      socket.disconnect(true);
    });
    
    this.connectedClients.clear();
    
    // Close Socket.IO server
    await new Promise<void>((resolve) => {
      this.io.close(() => {
        logger.info({ subsystem: 'websocket' }, 'WebSocket server closed');
        resolve();
      });
    });
  }
}
