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
} from './types/chatInstance';
import { toConversationHistory } from './types/chatInstance';
import type { ConversationMessage } from './dotbot';
import { ChatInstanceManager } from './chatInstanceManager';
import type { ExecutionArray } from './executionEngine/executionArray';
import type { ExecutionArrayState } from './executionEngine/types';

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
  
  // Track multiple ExecutionArrays by their ID
  private executionArrays: Map<string, ExecutionArray> = new Map();
  private executionCallbacks: Map<string, Set<(state: ExecutionArrayState) => void>> = new Map();
  
  // Legacy: most recent execution (for backward compatibility)
  public get currentExecution(): ExecutionArray | null {
    // Return the most recent ExecutionArray
    const executionMessages = this.data.messages.filter(m => m.type === 'execution') as ExecutionMessage[];
    if (executionMessages.length === 0) return null;
    
    const lastExecution = executionMessages[executionMessages.length - 1];
    return this.executionArrays.get(lastExecution.executionId) || null;
  }

  constructor(
    data: ChatInstanceData,
    manager: ChatInstanceManager,
    persistenceEnabled: boolean = true
  ) {
    this.data = data;
    this.manager = manager;
    this.persistenceEnabled = persistenceEnabled;
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
   */
  async addMessage(message: ConversationItem): Promise<void> {
    this.data.messages.push(message);
    
    if (this.persistenceEnabled) {
      await this.manager.addMessage(this.data.id, message);
      await this.reload();
    }
  }

  /**
   * Add a user message (convenience method)
   */
  async addUserMessage(content: string): Promise<ConversationItem> {
    const message: ConversationItem = {
      id: this.generateMessageId(),
      type: 'user',
      content,
      timestamp: Date.now(),
    };
    
    await this.addMessage(message);
    return message;
  }

  /**
   * Add a bot message (convenience method)
   */
  async addBotMessage(content: string): Promise<ConversationItem> {
    const message: ConversationItem = {
      id: this.generateMessageId(),
      type: 'bot',
      content,
      timestamp: Date.now(),
    };
    
    await this.addMessage(message);
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
   */
  async addExecutionMessage(executionArrayState: ExecutionArrayState): Promise<ExecutionMessage> {
    const message: ExecutionMessage = {
      id: `exec_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'execution',
      timestamp: Date.now(),
      executionId: executionArrayState.id,
      executionArray: executionArrayState,
      status: 'pending',
    };
    
    await this.addMessage(message);
    return message;
  }
  
  /**
   * Set ExecutionArray instance for a specific execution ID
   */
  setExecutionArray(executionId: string, executionArray: ExecutionArray): void {
    this.executionArrays.set(executionId, executionArray);
  }
  
  /**
   * Get ExecutionArray instance by execution ID
   */
  getExecutionArray(executionId: string): ExecutionArray | undefined {
    return this.executionArrays.get(executionId);
  }
  
  /**
   * Get all ExecutionArray instances
   */
  getAllExecutionArrays(): Map<string, ExecutionArray> {
    return this.executionArrays;
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
   */
  getDisplayMessages(): ConversationItem[] {
    return this.data.messages;
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
   */
  private async reload(): Promise<void> {
    if (this.persistenceEnabled) {
      const updated = await this.manager.loadInstance(this.data.id);
      if (updated) {
        this.data = updated;
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
    persistenceEnabled: boolean = true
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
    persistenceEnabled: boolean = true
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
    
    // Notify subscribers for this execution
    const callbacks = this.executionCallbacks.get(state.id);
    if (callbacks) {
      callbacks.forEach(cb => cb(state));
    }
  }

  /**
   * Subscribe to execution state changes for a specific execution
   */
  onExecutionUpdate(executionId: string, callback: (state: ExecutionArrayState) => void): () => void {
    // Get or create callback set for this execution
    if (!this.executionCallbacks.has(executionId)) {
      this.executionCallbacks.set(executionId, new Set());
    }
    const callbacks = this.executionCallbacks.get(executionId)!;
    callbacks.add(callback);

    // Subscribe to execution array if it exists
    const executionArray = this.executionArrays.get(executionId);
    if (executionArray) {
      const unsubscribe = executionArray.onStatusUpdate(() => {
        const state = executionArray.getState();
        callbacks.forEach(cb => cb(state));
      });

      // Call immediately with current state
      callback(executionArray.getState());

      return () => {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.executionCallbacks.delete(executionId);
        }
        unsubscribe();
      };
    }

    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.executionCallbacks.delete(executionId);
      }
    };
  }
}

