/**
 * WebSocket Utilities
 * 
 * Shared utilities for WebSocket connection management
 */

import { Socket } from 'socket.io-client';
import { ExecutionArrayState, ServerToClientEvents, ClientToServerEvents, WebSocketEvents } from '@dotbot/core';

/**
 * Setup connection event handlers
 */
export function setupConnectionHandlers(
  socket: Socket<ServerToClientEvents, ClientToServerEvents>,
  setIsConnected: (value: boolean) => void,
  setIsConnecting: (value: boolean) => void,
  setConnectionError: (error: string | null) => void,
  resubscribeAll: (socket: Socket<ServerToClientEvents, ClientToServerEvents>) => void,
  reconnectTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>
): void {
  socket.on('connect', () => {
    console.log('[WebSocket] Connected', {
      id: socket.id,
      transport: socket.io.engine.transport.name
    });
    setIsConnected(true);
    setIsConnecting(false);
    setConnectionError(null);
    resubscribeAll(socket);
  });

  socket.on(WebSocketEvents.CONNECTED, (data) => {
    console.log('[WebSocket] Server confirmation:', data.message);
  });

  socket.on('disconnect', (reason) => {
    console.log('[WebSocket] Disconnected:', reason);
    setIsConnected(false);
    setIsConnecting(false);
    
    if (reason === 'io server disconnect') {
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
  });

  socket.on(WebSocketEvents.ERROR, (data) => {
    console.error('[WebSocket] Error:', data.message);
    setConnectionError(data.message);
  });
}

/**
 * Setup execution update handlers
 */
export function setupExecutionHandlers(
  socket: Socket<ServerToClientEvents, ClientToServerEvents>,
  executionCallbacksRef: React.MutableRefObject<Map<string, Set<(state: ExecutionArrayState) => void>>>,
  sessionExecutionCallbacksRef: React.MutableRefObject<Set<(executionId: string, state: ExecutionArrayState) => void>>
): void {
  socket.on(WebSocketEvents.EXECUTION_UPDATE, ({ executionId, state }) => {
    console.log('[WebSocket] Execution update received:', {
      executionId,
      itemsCount: state.items.length,
      currentIndex: state.currentIndex,
      isExecuting: state.isExecuting
    });
    
    // Notify session-level callbacks
    sessionExecutionCallbacksRef.current.forEach(callback => {
      try {
        callback(executionId, state);
      } catch (error) {
        console.error('[WebSocket] Error in session execution callback:', error);
      }
    });
    
    // Notify execution-specific callbacks
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

  socket.on(WebSocketEvents.EXECUTION_COMPLETE, ({ executionId, success }) => {
    console.log('[WebSocket] Execution complete:', { executionId, success });
  });

  socket.on(WebSocketEvents.EXECUTION_ERROR, ({ executionId, error }) => {
    console.error('[WebSocket] Execution error:', { executionId, error });
  });
}
