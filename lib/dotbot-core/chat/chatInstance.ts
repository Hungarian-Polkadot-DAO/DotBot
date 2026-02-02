/**
 * ChatInstance Class
 * 
 * A conversation instance with built-in behavior.
 * This is the object that React components interact with.
 * 
 * Includes execution state - executions happen DURING conversations!
 */

import type {
  ChatInstanceData,
  ConversationItem,
  ExecutionMessage,
  Environment,
  CreateChatInstanceParams,
} from './types';
import { toConversationHistory } from './types';
import type { ConversationMessage } from '../dotbot';
import { ChatInstanceManager } from './chatInstanceManager';
import { ExecutionArray } from '../executionEngine/executionArray';
import type { ExecutionArrayState } from '../executionEngine/types';
import type { ExecutionOrchestrator } from '../executionEngine/orchestrator';
import type { ExecutionPlan } from '../prompts/system/execution/types';
import type { RpcManager } from '../rpcManager';
import { ExecutionStateManager } from './executionState';
import { ExecutionSessionManager } from './sessionManager';

/**
 * ChatInstance - A conversation with built-in methods and execution state
 * 
 * This wraps the ChatInstanceData type with behavior, making it easy for
 * React components to work with chats.
 * 
 * Manages multiple ExecutionArrays (one per ExecutionMessage in the conversation).
 */
export class ChatInstance {
  private data: ChatInstanceData;
  private manager: ChatInstanceManager;
  private persistenceEnabled: boolean;
  private executionStateManager: ExecutionStateManager;
  private sessionManager: ExecutionSessionManager;
  
  // Legacy: most recent execution (for backward compatibility)
  public get currentExecution(): ExecutionArray | null {
    // Return the most recent ExecutionArray
    const executionMessages = this.data.messages.filter(m => m.type === 'execution') as ExecutionMessage[];
    return this.executionStateManager.getCurrentExecution(executionMessages);
  }

  constructor(
    data: ChatInstanceData,
    manager: ChatInstanceManager,
    persistenceEnabled = true
  ) {
    this.data = data;
    this.manager = manager;
    this.persistenceEnabled = persistenceEnabled;
    
    // Initialize managers
    this.executionStateManager = new ExecutionStateManager();
    this.sessionManager = new ExecutionSessionManager(data.id);
    // Historical execution flows are not restored on load; they stay snapshot-only (frozen)
    // until the user clicks Restore, which uses rebuildExecutionArrays for that flow.
  }

  /**
   * Rebuild ExecutionArray instances by re-orchestrating from saved metadata
   * This restores working extrinsics that were lost during serialization
   */
  async rebuildExecutionArrays(orchestrator: ExecutionOrchestrator): Promise<void> {
    const executionMessages = this.data.messages.filter(
      m => m.type === 'execution'
    ) as ExecutionMessage[];
    
    await this.executionStateManager.rebuildExecutionArrays(executionMessages, orchestrator);
  }

  /**
   * Get the underlying data (for serialization)
   */
  getData(): ChatInstanceData {
    return this.data;
  }

  /**
   * Get conversation ID
   */
  get id(): string {
    return this.data.id;
  }

  /**
   * Get environment
   */
  get environment(): Environment {
    return this.data.environment;
  }

  /**
   * Get network
   */
  get network() {
    return this.data.network;
  }

  /**
   * Get title
   */
  get title(): string | undefined {
    return this.data.title;
  }

  /**
   * Get all messages
   */
  get messages(): ConversationItem[] {
    return this.data.messages;
  }

  /**
   * Add a message to this conversation
   * @param skipReload Skip reloading from disk (useful when adding multiple messages in batch)
   */
  async addMessage(message: ConversationItem, skipReload = false): Promise<void> {
    // Add to in-memory array IMMEDIATELY (synchronous)
    this.data.messages.push(message);
    console.log('[ChatInstance] Message pushed to array:', { type: message.type, id: message.id, count: this.data.messages.length });
    
    if (this.persistenceEnabled) {
      // Persistence happens after push, so messages are already in memory
      await this.manager.addMessage(this.data.id, message);
      if (!skipReload) {
        await this.reload();
      }
    }
  }

  /**
   * Add a user message (convenience method)
   * @param skipReload Skip reloading from disk (useful when adding multiple messages in batch)
   */
  async addUserMessage(content: string, skipReload = false): Promise<ConversationItem> {
    const message: ConversationItem = {
      id: this.generateMessageId(),
      type: 'user',
      content,
      timestamp: Date.now(),
    };
    
    await this.addMessage(message, skipReload);
    return message;
  }

  /**
   * Add a bot message (convenience method)
   * @param skipReload Skip reloading from disk (useful when adding multiple messages in batch)
   */
  async addBotMessage(content: string, skipReload = false): Promise<ConversationItem> {
    const message: ConversationItem = {
      id: this.generateMessageId(),
      type: 'bot',
      content,
      timestamp: Date.now(),
    };
    
    await this.addMessage(message, skipReload);
    return message;
  }

  /**
   * Add a system message (convenience method)
   */
  async addSystemMessage(
    content: string,
    variant?: 'info' | 'warning' | 'error' | 'success'
  ): Promise<ConversationItem> {
    const message: ConversationItem = {
      id: this.generateMessageId(),
      type: 'system',
      content,
      timestamp: Date.now(),
      variant,
    };
    
    await this.addMessage(message);
    return message;
  }

  /**
   * Add execution message to conversation
   * 
   * @param executionIdOrState Either an executionId string or ExecutionArrayState
   * @param executionPlan Optional execution plan
   * @param executionArrayState Optional execution array state (if executionId is provided as first arg)
   * @param skipReload Skip reloading from disk (useful when adding multiple messages in batch)
   */
  async addExecutionMessage(
    executionIdOrState: string | ExecutionArrayState,
    executionPlan?: ExecutionPlan,
    executionArrayState?: ExecutionArrayState,
    skipReload = false
  ): Promise<ExecutionMessage> {
    // Determine executionId and state based on arguments
    let executionId: string;
    let arrayState: ExecutionArrayState | undefined;
    
    if (typeof executionIdOrState === 'string') {
      executionId = executionIdOrState;
      arrayState = executionArrayState;
    } else {
      executionId = executionIdOrState.id;
      arrayState = executionIdOrState;
    }
    
    const message: ExecutionMessage = {
      id: `exec_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'execution',
      timestamp: Date.now(),
      executionId,
      executionArray: arrayState,
      executionPlan,
      status: 'pending',
    };
    
    console.log('[ChatInstance] Adding execution message:', { 
      messageId: message.id, 
      executionId, 
      hasExecutionArray: !!arrayState,
      hasExecutionPlan: !!executionPlan
    });
    
    await this.addMessage(message, skipReload);
    
    console.log('[ChatInstance] Execution message added. Current messages:', this.data.messages.map(m => ({ 
      type: m.type, 
      id: m.id,
      executionId: m.type === 'execution' ? (m as ExecutionMessage).executionId : undefined
    })));
    
    return message;
  }
  
  /**
   * Set ExecutionArray instance for a specific execution ID
   */
  setExecutionArray(executionId: string, executionArray: ExecutionArray): void {
    this.executionStateManager.setExecutionArray(executionId, executionArray);
  }
  
  /**
   * Get ExecutionArray instance by execution ID
   */
  getExecutionArray(executionId: string): ExecutionArray | undefined {
    return this.executionStateManager.getExecutionArray(executionId);
  }
  
  /**
   * Get all ExecutionArray instances
   */
  getAllExecutionArrays(): Map<string, ExecutionArray> {
    return this.executionStateManager.getAllExecutionArrays();
  }

  /**
   * Extract ExecutionPlan from saved ExecutionArrayState (used by executionRunner when rebuilding from state).
   */
  extractExecutionPlanFromState(state: ExecutionArrayState): ExecutionPlan | null {
    return this.executionStateManager.extractExecutionPlanFromState(state);
  }

  /**
   * Update an execution message (e.g., when execution state changes)
   */
  async updateExecutionMessage(messageId: string, updates: Partial<any>): Promise<void> {
    if (!this.persistenceEnabled) {
      // Just update in memory
      const message = this.data.messages.find(m => m.id === messageId);
      if (message) {
        Object.assign(message, updates);
      }
      return;
    }

    await this.manager.updateExecutionMessage(this.data.id, messageId, updates);
    
    // Reload to sync
    const updated = await this.manager.loadInstance(this.data.id);
    if (updated) {
      this.data = updated;
    }
  }

  /**
   * Get conversation history (for LLM context)
   */
  getHistory(): ConversationMessage[] {
    return toConversationHistory(this.data.messages);
  }

  /**
   * Get messages filtered by type
   */
  getMessagesByType(type: ConversationItem['type']): ConversationItem[] {
    return this.data.messages.filter(msg => msg.type === type);
  }

  /**
   * Get all conversation items for rendering (temporal sequence)
   * 
   * Returns the full mixed array of text messages + execution flows + system messages.
   * Each item should be rendered as its own component based on type:
   * - TextMessage → Message bubble
   * - ExecutionMessage → ExecutionFlow component (independent, interactive)
   * - SystemMessage → System notification
   * 
   * Multiple ExecutionFlows can exist in the conversation, each with its own state.
   * 
   * NOTE: Returns a new array reference to ensure React detects changes when messages are added.
   */
  getDisplayMessages(): ConversationItem[] {
    // Return a new array reference so React can detect changes
    return [...this.data.messages];
  }

  /**
   * @deprecated Use getDisplayMessages() instead
   * Get only text messages (user/bot) for simple message list rendering
   */
  getTextMessages(): Array<{ id: string; type: 'user' | 'bot'; content: string; timestamp: number }> {
    return this.data.messages
      .filter(msg => (msg.type === 'user' || msg.type === 'bot' || msg.type === 'system') && 'content' in msg)
      .map(msg => {
        const msgWithContent = msg as { id: string; type: 'user' | 'bot' | 'system'; content: string; timestamp: number };
        return {
          id: msgWithContent.id,
          type: msgWithContent.type === 'system' ? 'bot' : msgWithContent.type,
          content: msgWithContent.content,
          timestamp: msgWithContent.timestamp
        };
      });
  }

  /**
   * Auto-generate title from first message
   */
  async autoGenerateTitle(): Promise<string> {
    if (!this.persistenceEnabled) {
      return this.data.title || 'New Chat';
    }

    const title = await this.manager.autoGenerateTitle(this.data.id);
    await this.reload();
    return title;
  }

  /**
   * Update title
   */
  async setTitle(title: string): Promise<void> {
    this.data.title = title;
    
    if (this.persistenceEnabled) {
      await this.manager.updateInstance(this.data.id, { title });
      await this.reload();
    }
  }

  /**
   * Archive this conversation
   */
  async archive(): Promise<void> {
    if (this.persistenceEnabled) {
      await this.manager.updateInstance(this.data.id, { archived: true });
      await this.reload();
    }
  }

  /**
   * Unarchive this conversation
   */
  async unarchive(): Promise<void> {
    if (this.persistenceEnabled) {
      await this.manager.updateInstance(this.data.id, { archived: false });
      await this.reload();
    }
  }

  /**
   * Delete this conversation
   */
  async delete(): Promise<void> {
    if (this.persistenceEnabled) {
      await this.manager.deleteInstance(this.data.id);
    }
  }

  /**
   * Reload data from storage
   * Merges messages from storage with in-memory messages to avoid losing unsaved messages
   * IMPORTANT: Always preserves in-memory messages, even if they're not in storage yet
   */
  private async reload(): Promise<void> {
    if (this.persistenceEnabled) {
      // Save current in-memory messages before reloading
      const inMemoryMessages = [...this.data.messages];
      
      const updated = await this.manager.loadInstance(this.data.id);
      if (updated) {
        const storageMessageIds = new Set(updated.messages.map(m => m.id));
        
        // Find messages in memory that aren't in storage yet (unsaved messages)
        const unsavedMessages = inMemoryMessages.filter(m => !storageMessageIds.has(m.id));
        
        // Merge: combine storage messages with unsaved in-memory messages
        // Use a Map to deduplicate by ID and preserve order
        const messageMap = new Map<string, ConversationItem>();
        
        // First, add all storage messages (these are persisted)
        for (const msg of updated.messages) {
          messageMap.set(msg.id, msg);
        }
        
        // Then, add unsaved in-memory messages (these might not be persisted yet)
        for (const msg of unsavedMessages) {
          if (!messageMap.has(msg.id)) {
            messageMap.set(msg.id, msg);
          }
        }
        
        // Convert back to array, preserving temporal order by timestamp
        const mergedMessages = Array.from(messageMap.values()).sort((a, b) => a.timestamp - b.timestamp);
        
        // Update data with merged messages, preserving all other fields from storage
        this.data = {
          ...updated,
          messages: mergedMessages
        };
        
        console.log('[ChatInstance] Reloaded and merged messages:', {
          storageCount: updated.messages.length,
          unsavedCount: unsavedMessages.length,
          mergedCount: mergedMessages.length,
          messageTypes: mergedMessages.map(m => m.type)
        });
      }
    }
  }

  /**
   * Generate a unique message ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create a new ChatInstance
   */
  static async create(
    params: CreateChatInstanceParams,
    manager: ChatInstanceManager,
    persistenceEnabled = true
  ): Promise<ChatInstance> {
    const data = await manager.createInstance(params);
    return new ChatInstance(data, manager, persistenceEnabled);
  }

  /**
   * Load an existing ChatInstance
   */
  static async load(
    id: string,
    manager: ChatInstanceManager,
    persistenceEnabled = true
  ): Promise<ChatInstance | null> {
    const data = await manager.loadInstance(id);
    if (!data) return null;
    return new ChatInstance(data, manager, persistenceEnabled);
  }

  /**
   * Get message count
   */
  get messageCount(): number {
    return this.data.messages.length;
  }

  /**
   * Check if chat is empty
   */
  get isEmpty(): boolean {
    return this.data.messages.length === 0;
  }

  /**
   * Get last message timestamp
   */
  get lastActivity(): number {
    return this.data.updatedAt;
  }

  /**
   * Check if archived
   */
  get isArchived(): boolean {
    return this.data.archived || false;
  }

  // ============================================================================
  // Execution State (High-level API for React components)
  // ============================================================================

  /**
   * Check if a plan is currently executing
   */
  get isPlanExecuting(): boolean {
    return this.currentExecution?.getState().isExecuting || false;
  }

  /**
   * Check if execution is paused
   */
  get isPaused(): boolean {
    return this.currentExecution?.getState().isPaused || false;
  }

  /**
   * Get current execution progress (0-100)
   */
  get executionProgress(): number {
    if (!this.currentExecution) return 0;
    const state = this.currentExecution.getState();
    if (state.totalItems === 0) return 0;
    return Math.round((state.completedItems / state.totalItems) * 100);
  }

  /**
   * Get number of items in current plan
   */
  get planLength(): number {
    return this.currentExecution?.getState().totalItems || 0;
  }

  /**
   * Get number of completed items
   */
  get completedItems(): number {
    return this.currentExecution?.getState().completedItems || 0;
  }

  /**
   * Get number of failed items
   */
  get failedItems(): number {
    return this.currentExecution?.getState().failedItems || 0;
  }

  /**
   * Get full execution state (for detailed UI)
   */
  get executionState(): ExecutionArrayState | null {
    return this.currentExecution?.getState() || null;
  }

  /**
   * Set ExecutionArray by automatically extracting its ID
   * 
   * This is a convenience wrapper around setExecutionArray() that extracts
   * the execution ID from the ExecutionArray's state.
   * 
   * @param execution The ExecutionArray to add, or null to do nothing
   * @internal Called by DotBot during execution preparation
   */
  setExecution(execution: ExecutionArray | null): void {
    if (!execution) return;
    
    const state = execution.getState();
    this.setExecutionArray(state.id, execution);
  }

  /**
   * Subscribe to execution state changes for a specific execution
   */
  onExecutionUpdate(executionId: string, callback: (state: ExecutionArrayState) => void): () => void {
    return this.executionStateManager.onExecutionUpdate(executionId, callback);
  }
  
  /**
   * Initialize execution sessions for this chat
   * Creates and stores RPC sessions that will be reused for all executions in this chat
   */
  async initializeExecutionSessions(
    relayChainManager: RpcManager,
    assetHubManager: RpcManager
  ): Promise<void> {
    await this.sessionManager.initialize(relayChainManager, assetHubManager);
  }
  
  /**
   * Get execution sessions for this chat
   */
  getExecutionSessions() {
    return this.sessionManager.getSessions();
  }
  
  /**
   * Validate that execution sessions are still active and connected
   */
  async validateExecutionSessions(): Promise<boolean> {
    return this.sessionManager.validate();
  }
  
  /**
   * Clean up execution sessions
   * Called when chat is closed or destroyed
   */
  cleanupExecutionSessions(): void {
    this.sessionManager.cleanup();
    this.executionStateManager.cleanup();
  }
}
