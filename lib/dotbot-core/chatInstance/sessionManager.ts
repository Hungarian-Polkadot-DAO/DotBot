/**
 * Execution Session Manager
 * 
 * Manages RPC execution sessions for ChatInstance
 */

import type { ExecutionSession, RpcManager } from '../rpcManager';
import { createSubsystemLogger, Subsystem } from '../services/logger';

/**
 * Execution Session Manager
 * 
 * Handles RPC session lifecycle for a chat instance
 */
export class ExecutionSessionManager {
  private relayChainSession: ExecutionSession | null = null;
  private assetHubSession: ExecutionSession | null = null;
  private sessionsInitialized = false;
  private chatId: string;
  private chatLogger = createSubsystemLogger(Subsystem.CHAT);

  constructor(chatId: string) {
    this.chatId = chatId;
  }

  /**
   * Initialize execution sessions for this chat
   * Creates and stores RPC sessions that will be reused for all executions in this chat
   */
  async initialize(
    relayChainManager: RpcManager,
    assetHubManager: RpcManager
  ): Promise<void> {
    if (this.sessionsInitialized) {
      return;
    }
    
    try {
      // Create Relay Chain session
      this.relayChainSession = await relayChainManager.createExecutionSession();
      
      // Create Asset Hub session (optional)
      try {
        this.assetHubSession = await assetHubManager.createExecutionSession();
      } catch (error) {
        // Asset Hub session creation failed - this is expected in some cases
        this.assetHubSession = null;
      }
      
      this.sessionsInitialized = true;
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }
  
  /**
   * Get execution sessions for this chat
   */
  getSessions(): { relayChain: ExecutionSession | null; assetHub: ExecutionSession | null } {
    return {
      relayChain: this.relayChainSession,
      assetHub: this.assetHubSession,
    };
  }
  
  /**
   * Validate that execution sessions are still active and connected
   * 
   * CRITICAL: This ensures sessions are valid before simulation/execution.
   * With lazy-loaded RPC connections, sessions may be created but APIs may not be connected yet.
   */
  async validate(): Promise<boolean> {
    if (!this.sessionsInitialized || !this.relayChainSession) {
      this.chatLogger.debug({ chatId: this.chatId }, 'Execution sessions not initialized');
      return false;
    }
    
    // Check if session API is connected
    const isConnected = await this.relayChainSession.isConnected();
    if (!isConnected) {
      this.chatLogger.warn({ 
        chatId: this.chatId,
        endpoint: this.relayChainSession.endpoint
      }, 'Execution session API is not connected');
      return false;
    }
    
    // Also check if the API instance itself is connected (double-check)
    const api = this.relayChainSession.api;
    if (!api || !api.isConnected) {
      this.chatLogger.warn({ 
        chatId: this.chatId,
        endpoint: this.relayChainSession.endpoint,
        hasApi: !!api,
        apiConnected: api?.isConnected
      }, 'Execution session API instance is not connected');
      return false;
    }
    
    return true;
  }
  
  /**
   * Clean up execution sessions
   * Called when chat is closed or destroyed
   */
  cleanup(): void {
    if (this.relayChainSession) {
      this.relayChainSession.markInactive();
      this.relayChainSession = null;
    }
    if (this.assetHubSession) {
      this.assetHubSession.markInactive();
      this.assetHubSession = null;
    }
    this.sessionsInitialized = false;
    this.chatLogger.debug({ chatId: this.chatId }, 'Cleaned up execution sessions for chat');
  }

  /**
   * Check if sessions are initialized
   */
  get isInitialized(): boolean {
    return this.sessionsInitialized;
  }
}
