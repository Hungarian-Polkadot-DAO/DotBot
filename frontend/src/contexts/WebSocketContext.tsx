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
import { ExecutionArrayState, ClientToServerEvents, ServerToClientEvents, WebSocketEvents } from '@dotbot/core';
import { setupConnectionHandlers, setupExecutionHandlers } from './websocketUtils';

const WS_URL = process.env.REACT_APP_WS_URL || process.env.REACT_APP_API_URL || 'http://localhost:8000';

interface WebSocketContextValue {
  // Connection state
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  
  // Execution subscriptions
  subscribeToExecution: (executionId: string, callback: (state: ExecutionArrayState) => void) => () => void;
  subscribeToSessionExecutions: (callback: (executionId: string, state: ExecutionArrayState) => void) => () => void;
  
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
  
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const executionCallbacksRef = useRef<Map<string, Set<(state: ExecutionArrayState) => void>>>(new Map());
  const sessionExecutionCallbacksRef = useRef<Set<(executionId: string, state: ExecutionArrayState) => void>>(new Set());
  const isSessionSubscribedRef = useRef<boolean>(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  /**
   * Resubscribe to all active subscriptions after reconnection
   */
  const resubscribeAll = useCallback((socket: Socket<ServerToClientEvents, ClientToServerEvents>) => {
    // Resubscribe to session-level executions if we had a subscription
    if (isSessionSubscribedRef.current && sessionId) {
      console.log('[WebSocket] Resubscribing to session-level executions');
      socket.emit(WebSocketEvents.SUBSCRIBE_SESSION_EXECUTIONS, {
        sessionId: sessionId!
      });
    }
    
    // Resubscribe to specific executions
    const executionIds = Array.from(executionCallbacksRef.current.keys());
    if (executionIds.length > 0) {
      console.log('[WebSocket] Resubscribing to executions:', executionIds);
      
      executionIds.forEach(executionId => {
        socket.emit(WebSocketEvents.SUBSCRIBE_EXECUTION, {
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
    
    // Create Socket.IO client with proper types
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(WS_URL, {
      query: { sessionId },
      transports: fallbackToPolling ? ['websocket', 'polling'] : ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 10,
      timeout: 10000,
    });
    
    // Setup event handlers
    setupConnectionHandlers(
      socket,
      setIsConnected,
      setIsConnecting,
      setConnectionError,
      resubscribeAll,
      reconnectTimeoutRef
    );
    
    setupExecutionHandlers(
      socket,
      executionCallbacksRef,
      sessionExecutionCallbacksRef
    );
    
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
            socketRef.current.emit(WebSocketEvents.UNSUBSCRIBE_EXECUTION, {
              sessionId,
              executionId
            });
          }
        }
      }
    };
  }, [sessionId]);
  
  /**
   * Subscribe to all execution updates for this session
   * 
   * This allows subscribing BEFORE the executionId is known, catching all updates
   * including early simulation progress. The callback receives both executionId and state.
   */
  const subscribeToSessionExecutions = useCallback((
    callback: (executionId: string, state: ExecutionArrayState) => void
  ): (() => void) => {
    console.log('[WebSocket] Subscribing to session-level executions');
    
    // Add callback to set
    sessionExecutionCallbacksRef.current.add(callback);
    
    // Subscribe via Socket.IO (if connected and not already subscribed)
    if (socketRef.current?.connected && sessionId && !isSessionSubscribedRef.current) {
      socketRef.current.emit(WebSocketEvents.SUBSCRIBE_SESSION_EXECUTIONS, {
        sessionId
      });
      isSessionSubscribedRef.current = true;
    }
    
    // Return unsubscribe function
    return () => {
      console.log('[WebSocket] Unsubscribing from session-level executions');
      
      // Remove callback
      sessionExecutionCallbacksRef.current.delete(callback);
      
      // If no more callbacks, unsubscribe from server
      if (sessionExecutionCallbacksRef.current.size === 0 && isSessionSubscribedRef.current) {
        isSessionSubscribedRef.current = false;
        
        if (socketRef.current?.connected && sessionId) {
          socketRef.current.emit(WebSocketEvents.UNSUBSCRIBE_SESSION_EXECUTIONS, {
            sessionId
          });
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
    subscribeToSessionExecutions,
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
