/**
 * Execution Broadcaster
 * 
 * Subscribes to ChatInstance execution updates and broadcasts them via WebSocket.
 * This bridges the gap between DotBot's EventEmitter and Socket.IO.
 */

import { ChatInstance } from '@dotbot/core';
import { WebSocketManager } from './WebSocketManager';
import { createSubsystemLogger, Subsystem } from '@dotbot/core/services/logger';

const logger = createSubsystemLogger(Subsystem.SOCKET_IO);

/**
 * Setup WebSocket broadcasting for a ChatInstance
 * 
 * This subscribes to all execution updates in the chat and broadcasts them
 * via WebSocket to all subscribed clients.
 * 
 * @param chat ChatInstance to monitor
 * @param wsManager WebSocket manager to broadcast through
 * @returns Cleanup function to stop broadcasting
 */
export function setupExecutionBroadcasting(
  chat: ChatInstance,
  wsManager: WebSocketManager
): () => void {
  const subscriptions: (() => void)[] = [];
  
  // Get all execution messages in the chat
  const messages = chat.getDisplayMessages();
  const executionMessages = messages.filter(m => m.type === 'execution');
  
  logger.debug({
    chatId: chat.id,
    executionCount: executionMessages.length
  }, 'Setting up WebSocket broadcasting for existing executions');
  
  // Subscribe to each execution
  for (const execMsg of executionMessages) {
    if (execMsg.type === 'execution') {
      const executionId = execMsg.executionId;
      
      // Subscribe to updates for this execution
      const unsubscribe = chat.onExecutionUpdate(executionId, (state) => {
        // Broadcast state update via WebSocket
        wsManager.broadcastExecutionUpdate(executionId, state);
        
        // Check if execution is complete
        // Empty array means no items executed yet, so not complete
        const isComplete = state.items.length > 0 && state.items.every(item => 
          item.status === 'completed' || 
          item.status === 'finalized' || 
          item.status === 'failed' || 
          item.status === 'cancelled'
        );
        
        if (isComplete) {
          // Empty array cannot be successful (nothing executed)
          const success = state.items.length > 0 && state.items.every(item =>
            item.status === 'completed' || item.status === 'finalized'
          );
          
          wsManager.broadcastExecutionComplete(executionId, success);
          
          logger.info({
            executionId,
            success,
            completedItems: state.completedItems,
            totalItems: state.totalItems
          }, 'Execution completed, final broadcast sent');
        }
      });
      
      subscriptions.push(unsubscribe);
    }
  }
  
  logger.info({
    chatId: chat.id,
    subscriptionCount: subscriptions.length
  }, 'WebSocket broadcasting set up for chat');
  
  // Return cleanup function
  return () => {
    logger.debug({
      chatId: chat.id,
      subscriptionCount: subscriptions.length
    }, 'Cleaning up WebSocket broadcasting');
    
    subscriptions.forEach(unsub => unsub());
    subscriptions.length = 0;
  };
}

/**
 * Subscribe to a single execution and broadcast updates
 * 
 * Use this when a new execution is created after the chat is already set up.
 * 
 * @param chat ChatInstance containing the execution
 * @param executionId Execution ID to subscribe to
 * @param wsManager WebSocket manager to broadcast through
 * @param sessionId Optional session ID for session-level broadcasting
 * @returns Cleanup function
 */
export function broadcastExecutionUpdates(
  chat: ChatInstance,
  executionId: string,
  wsManager: WebSocketManager,
  sessionId?: string
): () => void {
  logger.debug({
    chatId: chat.id,
    executionId,
    sessionId
  }, 'Setting up WebSocket broadcasting for execution');
  
  const unsubscribe = chat.onExecutionUpdate(executionId, (state) => {
    // Broadcast state update via WebSocket (to both execution-specific and session-level rooms)
    wsManager.broadcastExecutionUpdate(executionId, state, sessionId);
    
    // Check if execution is complete
    // Empty array means no items executed yet, so not complete
    const isComplete = state.items.length > 0 && state.items.every(item => 
      item.status === 'completed' || 
      item.status === 'finalized' || 
      item.status === 'failed' || 
      item.status === 'cancelled'
    );
    
    if (isComplete) {
      // Empty array cannot be successful (nothing executed)
      const success = state.items.length > 0 && state.items.every(item =>
        item.status === 'completed' || item.status === 'finalized'
      );
      
      wsManager.broadcastExecutionComplete(executionId, success);
      
      logger.info({
        executionId,
        success,
        completedItems: state.completedItems,
        totalItems: state.totalItems
      }, 'Execution completed, final broadcast sent');
    }
  });
  
  return unsubscribe;
}
