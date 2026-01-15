/**
 * WebSocket Context
 * 
 * Provides WebSocket connection management for real-time features.
 * Uses Socket.IO with automatic reconnection and polling fallback.
 * 
 * ARCHITECTURE:
 * - One connection per session (wallet + environment)
 * - Room-based subscriptions (execution, chat, balance, etc.)
 * - Progressive enhancement - add features without refactoring
 * - Automatic fallback to HTTP polling if WebSocket fails
 */

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { ExecutionArrayState } from '@dotbot/core/executionEngine/types';

const WS_URL = process.env.REACT_APP_WS_URL || process.env.REACT_APP_API_URL || 'http://localhost:8000';

interface WebSocketContextValue {
  // Connection state
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  
  // Execution subscriptions
  subscribeToExecution: (executionId: string, callback: (state: ExecutionArrayState) => void) => () => void;
  
  // Future: Chat subscriptions
  // subscribeToChat: (chatId: string) => () => void;
  
  // Future: Balance subscriptions
  // subscribeToBalance: (callback: (balance: string) => void) => () => void;
  
  // Connection management
  connect: () => void;
  disconnect: () => void;
  reconnect: () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export interface WebSocketProviderProps {
  sessionId: string | null;
  children: React.ReactNode;
  autoConnect?: boolean;
  fallbackToPolling?: boolean;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({
  sessionId,
  children,
  autoConnect = true,
  fallbackToPolling = true
}) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  
  const socketRef = useRef<Socket | null>(null);
  const executionCallbacksRef = useRef<Map<string, Set<(state: ExecutionArrayState) => void>>>(new Map());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  /**
   * Resubscribe to all active executions after reconnection
   */
  const resubscribeAll = useCallback((socket: Socket) => {
    const executionIds = Array.from(executionCallbacksRef.current.keys());
    
    if (executionIds.length > 0) {
      console.log('[WebSocket] Resubscribing to executions:', executionIds);
      
      executionIds.forEach(executionId => {
        socket.emit('subscribe-execution', {
          sessionId: sessionId!,
          executionId
        });
      });
    }
  }, [sessionId]);
  
  /**
   * Connect to WebSocket server
   */
  const connect = useCallback(() => {
    if (!sessionId) {
      console.log('[WebSocket] No session ID, skipping connection');
      return;
    }
    
    if (socketRef.current?.connected) {
      console.log('[WebSocket] Already connected');
      return;
    }
    
    // Clean up existing socket before creating new one
    // This prevents memory leaks from accumulating event listeners
    if (socketRef.current) {
      console.log('[WebSocket] Cleaning up existing socket before reconnecting');
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    
    setIsConnecting(true);
    setConnectionError(null);
    
    console.log('[WebSocket] Connecting to', WS_URL, 'with session:', sessionId);
    
    // Create Socket.IO client
    const socket = io(WS_URL, {
      query: { sessionId },
      transports: fallbackToPolling ? ['websocket', 'polling'] : ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 10,
      timeout: 10000,
    });
    
    // Connection event handlers
    socket.on('connect', () => {
      console.log('[WebSocket] Connected', {
        id: socket.id,
        transport: socket.io.engine.transport.name
      });
      setIsConnected(true);
      setIsConnecting(false);
      setConnectionError(null);
      
      // Re-subscribe to all active executions
      resubscribeAll(socket);
    });
    
    socket.on('connected', (data) => {
      console.log('[WebSocket] Server confirmation:', data.message);
    });
    
    socket.on('disconnect', (reason) => {
      console.log('[WebSocket] Disconnected:', reason);
      setIsConnected(false);
      setIsConnecting(false);
      
      // Auto-reconnect for certain disconnect reasons
      if (reason === 'io server disconnect') {
        // Server disconnected us - try to reconnect after a delay
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('[WebSocket] Attempting manual reconnection...');
          socket.connect();
        }, 2000);
      }
    });
    
    socket.on('connect_error', (error) => {
      console.error('[WebSocket] Connection error:', error.message);
      setIsConnecting(false);
      setConnectionError(error.message);
      
      // If WebSocket fails, Socket.IO will automatically try polling fallback
    });
    
    socket.on('error', (data) => {
      console.error('[WebSocket] Error:', data.message);
      setConnectionError(data.message);
    });
    
    // Execution update handlers
    socket.on('execution-update', ({ executionId, state }) => {
      console.log('[WebSocket] Execution update:', {
        executionId,
        status: state.status,
        currentIndex: state.currentIndex
      });
      
      // Notify all callbacks for this execution
      const callbacks = executionCallbacksRef.current.get(executionId);
      if (callbacks) {
        callbacks.forEach(callback => {
          try {
            callback(state);
          } catch (error) {
            console.error('[WebSocket] Error in execution callback:', error);
          }
        });
      }
    });
    
    socket.on('execution-complete', ({ executionId, success }) => {
      console.log('[WebSocket] Execution complete:', {
        executionId,
        success
      });
    });
    
    socket.on('execution-error', ({ executionId, error }) => {
      console.error('[WebSocket] Execution error:', {
        executionId,
        error
      });
    });
    
    socketRef.current = socket;
  }, [sessionId, fallbackToPolling, resubscribeAll]);
  
  /**
   * Disconnect from WebSocket server
   */
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (socketRef.current) {
      console.log('[WebSocket] Disconnecting...');
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    
    setIsConnected(false);
    setIsConnecting(false);
  }, []);
  
  /**
   * Reconnect to WebSocket server
   */
  const reconnect = useCallback(() => {
    disconnect();
    setTimeout(() => {
      connect();
    }, 100);
  }, [connect, disconnect]);
  
  /**
   * Subscribe to execution updates
   */
  const subscribeToExecution = useCallback((
    executionId: string,
    callback: (state: ExecutionArrayState) => void
  ): (() => void) => {
    console.log('[WebSocket] Subscribing to execution:', executionId);
    
    // Add callback to map
    if (!executionCallbacksRef.current.has(executionId)) {
      executionCallbacksRef.current.set(executionId, new Set());
    }
    executionCallbacksRef.current.get(executionId)!.add(callback);
    
    // Subscribe via Socket.IO (if connected)
    if (socketRef.current?.connected && sessionId) {
      socketRef.current.emit('subscribe-execution', {
        sessionId,
        executionId
      });
    }
    
    // Return unsubscribe function
    return () => {
      console.log('[WebSocket] Unsubscribing from execution:', executionId);
      
      // Remove callback
      const callbacks = executionCallbacksRef.current.get(executionId);
      if (callbacks) {
        callbacks.delete(callback);
        
        // If no more callbacks, unsubscribe from server
        if (callbacks.size === 0) {
          executionCallbacksRef.current.delete(executionId);
          
          if (socketRef.current?.connected && sessionId) {
            socketRef.current.emit('unsubscribe-execution', {
              sessionId,
              executionId
            });
          }
        }
      }
    };
  }, [sessionId]);
  
  // Auto-connect on mount (if enabled and sessionId available)
  useEffect(() => {
    if (autoConnect && sessionId) {
      connect();
    }
    
    return () => {
      disconnect();
    };
  }, [autoConnect, sessionId, connect, disconnect]);
  
  const value: WebSocketContextValue = {
    isConnected,
    isConnecting,
    connectionError,
    subscribeToExecution,
    connect,
    disconnect,
    reconnect,
  };
  
  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
};

/**
 * Hook to access WebSocket context
 */
export const useWebSocket = (): WebSocketContextValue => {
  const context = useContext(WebSocketContext);
  
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  
  return context;
};
