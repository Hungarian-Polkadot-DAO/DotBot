/**
 * DotBot Route Utilities
 * 
 * Extracted utilities for DotBot route handlers.
 */

import { Request, Response } from 'express';
import { ChatOptions, ChatResult, Environment, Network, AIProviderType, ChatInstance, ExecutionItem, ExecutionArrayState } from '@dotbot/core';
import { DotBotSession } from '../sessionManager';
import { broadcastExecutionUpdates as _broadcastExecutionUpdates } from '../websocket/executionBroadcaster';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { dotbotLogger, errorLogger } from './logger';

export interface DotBotChatRequest {
  message: string;
  sessionId?: string;
  wallet: {
    address: string;
    name?: string;
    source: string;
  };
  environment?: Environment;
  network?: Network;
  options?: {
    systemPrompt?: string;
    conversationHistory?: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp?: number }>;
    executionOptions?: any;
  };
  provider?: AIProviderType;
}

/**
 * Validate chat request
 */
export function validateChatRequest(req: Request): { valid: boolean; error?: string } {
  const { message, wallet } = req.body as DotBotChatRequest;

  if (!message || typeof message !== 'string') {
    return {
      valid: false,
      error: 'Message field is required and must be a string'
    };
  }

  if (!wallet || !wallet.address) {
    return {
      valid: false,
      error: 'Wallet address is required'
    };
  }

  return { valid: true };
}

/**
 * Generate effective session ID
 */
export function generateSessionId(
  sessionId: string | undefined,
  walletAddress: string,
  environment: Environment
): string {
  return sessionId || `wallet:${walletAddress}:${environment}`;
}

/**
 * Setup WebSocket broadcasting for execution
 * 
 * SIMPLIFIED: Subscribe directly to ExecutionArray.onProgress() - no ChatInstance needed!
 */
export function setupWebSocketBroadcasting(
  dotbot: any,
  wsManager: WebSocketManager | undefined,
  effectiveSessionId: string
): void {
  if (!wsManager) {
    return;
  }

  const dotbotInternal = dotbot as any;
  if (!dotbotInternal.config) {
    return;
  }

  const originalOnExecutionReady = dotbotInternal.config.onExecutionReady;
  
  // Subscribe directly to ExecutionArray when it's ready (no ChatInstance needed)
  dotbotInternal.config.onExecutionReady = (executionId: string, chat: ChatInstance | null) => {
    if (originalOnExecutionReady) {
      originalOnExecutionReady(executionId, chat);
    }
    
    // Get ExecutionArray directly from DotBot (no ChatInstance needed)
    const executionArray = dotbot.getExecutionArray(executionId);
    if (executionArray) {
      // Subscribe directly to ExecutionArray.onProgress() for WebSocket broadcasting
      const _unsubscribe = executionArray.onProgress((state: ExecutionArrayState) => {
        wsManager.broadcastExecutionUpdate(executionId, state, effectiveSessionId);
        
        // Check if execution is complete
        const isComplete = state.items.length > 0 && state.items.every((item: ExecutionItem) => 
          item.status === 'completed' || 
          item.status === 'finalized' || 
          item.status === 'failed' || 
          item.status === 'cancelled'
        );
        
        if (isComplete) {
          const success = state.items.length > 0 && state.items.every((item: ExecutionItem) =>
            item.status === 'completed' || item.status === 'finalized'
          );
          wsManager.broadcastExecutionComplete(executionId, success);
        }
      });
      
      // Store unsubscribe function (could be stored in dotbot for cleanup, but for now just let it run)
      dotbotLogger.debug({
        executionId,
        sessionId: effectiveSessionId
      }, 'WebSocket broadcasting enabled for execution (direct ExecutionArray subscription)');
    } else {
      dotbotLogger.warn({
        executionId
      }, 'ExecutionArray not found for WebSocket broadcasting');
    }
  };
}

/**
 * Prepare chat request (setup WebSocket broadcasting)
 * 
 * SIMPLIFIED: No ChatInstance needed - WebSocket subscribes directly to ExecutionArray
 */
async function prepareChatRequest(
  dotbot: any,
  wsManager: WebSocketManager | undefined,
  effectiveSessionId: string,
  _walletAddress: string
): Promise<void> {
  setupWebSocketBroadcasting(dotbot, wsManager, effectiveSessionId);
  // No need to create ChatInstance - WebSocket subscribes directly to ExecutionArray
}

/**
 * Execute chat and handle result
 */
async function executeChat(
  dotbot: any,
  message: string,
  chatOptions: ChatOptions,
  effectiveSessionId: string
): Promise<ChatResult> {
  dotbotLogger.info({
    sessionId: effectiveSessionId,
    messageLength: message.length,
    messagePreview: message.substring(0, 100),
    hasConversationHistory: !!chatOptions.conversationHistory,
    historyLength: chatOptions.conversationHistory?.length || 0,
    currentChatId: dotbot.currentChat?.id || null
  }, 'Processing DotBot chat request');

  try {
    const result = await dotbot.chat(message, chatOptions);
    
    dotbotLogger.info({
      sessionId: effectiveSessionId,
      executed: result.executed,
      success: result.success,
      executionId: result.executionId
    }, 'DotBot chat completed successfully');
    
    return result;
  } catch (chatError: any) {
    errorLogger.error({
      error: chatError.message,
      stack: chatError.stack,
      sessionId: effectiveSessionId
    }, 'DotBot.chat() failed');
    throw chatError;
  }
}

/**
 * Handle chat request
 */
export async function handleChatRequest(
  req: Request,
  res: Response,
  session: DotBotSession
): Promise<void> {
  const {
    message,
    options = {},
    provider: _provider
  }: DotBotChatRequest = req.body;

  const effectiveSessionId = generateSessionId(
    req.body.sessionId,
    session.wallet.address,
    session.environment
  );

  const dotbot = session.dotbot;
  const wsManager: WebSocketManager | undefined = req.app.locals.wsManager;

  await prepareChatRequest(dotbot, wsManager, effectiveSessionId, session.wallet.address);

  const chatOptions: ChatOptions = { ...options };
  const result = await executeChat(dotbot, message, chatOptions, effectiveSessionId);

  res.json({
    success: true,
    result,
    sessionId: effectiveSessionId,
    chatId: dotbot.currentChat?.id || null,
    timestamp: new Date().toISOString()
  });
}

/**
 * Handle error and send error response
 */
export function handleError(
  res: Response,
  error: any,
  sessionId?: string
): void {
  errorLogger.error({
    error: error.message,
    stack: error.stack,
    sessionId,
    errorName: error.name,
    errorCode: error.code
  }, 'Error processing request');

  res.status(500).json({
    error: 'Internal server error',
    message: error.message || 'Failed to process request',
    timestamp: new Date().toISOString()
  });
}
