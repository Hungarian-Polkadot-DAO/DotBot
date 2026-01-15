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
import type { ClientToServerEvents, ServerToClientEvents } from '@dotbot/core';
import type { ExecutionArrayState } from '@dotbot/core/executionEngine/types';
import { logger } from '../utils/logger';

export interface WebSocketManagerConfig {
  httpServer: HttpServer;
  corsOrigins?: string | string[];
  path?: string;
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
    // In development or if CORS_ORIGINS is '*', allow all origins
    // Otherwise use the configured origins
    const isDevelopment = process.env.NODE_ENV === 'development';
    const allowAllOrigins = isDevelopment || config.corsOrigins === '*' || !config.corsOrigins;
    
    // Normalize corsOrigins to array format
    let corsOrigin: string | string[] | boolean = true;
    if (!allowAllOrigins && config.corsOrigins) {
      if (Array.isArray(config.corsOrigins)) {
        corsOrigin = config.corsOrigins;
      } else {
        corsOrigin = config.corsOrigins.split(',').map((o: string) => o.trim());
      }
    }
    
    this.io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(config.httpServer, {
      cors: {
        origin: corsOrigin,
        credentials: true,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
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
   * Clients can subscribe to:
   * 1. Specific execution IDs (for targeted updates)
   * 2. All executions for a session (for early subscription before executionId is known)
   * 
   * This enables subscribing BEFORE the executionId is available, catching all updates
   * including early simulation progress.
   */
  private setupExecutionHandlers(socket: Socket, sessionId: string): void {
    // Subscribe to specific execution updates
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
    
    // Unsubscribe from specific execution updates
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
    
    // Subscribe to all executions for this session (session-level room)
    socket.on('subscribe-session-executions', ({ sessionId: requestSessionId }) => {
      // Validate session ID matches
      if (requestSessionId !== sessionId) {
        logger.warn({
          subsystem: 'websocket',
          clientId: socket.id,
          requestSessionId,
          actualSessionId: sessionId
        }, 'Session ID mismatch on session-level execution subscription');
        return;
      }
      
      const room = `session:${sessionId}:executions`;
      socket.join(room);
      
      logger.debug({
        subsystem: 'websocket',
        clientId: socket.id,
        sessionId,
        room
      }, 'Client subscribed to all session execution updates');
    });
    
    // Unsubscribe from all executions for this session
    socket.on('unsubscribe-session-executions', ({ sessionId: requestSessionId }) => {
      // Validate session ID matches
      if (requestSessionId !== sessionId) {
        return;
      }
      
      const room = `session:${sessionId}:executions`;
      socket.leave(room);
      
      logger.debug({
        subsystem: 'websocket',
        clientId: socket.id,
        sessionId,
        room
      }, 'Client unsubscribed from session execution updates');
    });
  }
  
  /**
   * Broadcast execution state update to all subscribers
   * 
   * This is called by the backend when ExecutionArray state changes.
   * Broadcasts to both:
   * 1. Execution-specific room (for targeted subscriptions)
   * 2. Session-level room (for early subscriptions before executionId is known)
   * 
   * @param executionId The execution ID
   * @param state The execution state
   * @param sessionId Optional session ID for session-level broadcasting
   */
  broadcastExecutionUpdate(executionId: string, state: ExecutionArrayState, sessionId?: string): void {
    const executionRoom = `execution:${executionId}`;
    
    logger.debug({
      subsystem: 'websocket',
      executionId,
      executionRoom,
      sessionId,
      currentIndex: state.currentIndex,
      isExecuting: state.isExecuting,
      completedItems: state.completedItems,
      totalItems: state.totalItems
    }, 'Broadcasting execution update');
    
    // Broadcast to execution-specific room
    this.io.to(executionRoom).emit('execution-update', {
      executionId,
      state
    });
    
    // Also broadcast to session-level room if sessionId provided
    // This allows clients to receive updates even if they subscribed before executionId was known
    if (sessionId) {
      const sessionRoom = `session:${sessionId}:executions`;
      this.io.to(sessionRoom).emit('execution-update', {
        executionId,
        state
      });
    }
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
