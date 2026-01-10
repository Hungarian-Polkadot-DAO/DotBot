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
import { ExecutionArray } from './executionEngine/executionArray';
import type { ExecutionArrayState } from './executionEngine/types';
import type { ExecutionOrchestrator } from './executionEngine/orchestrator';
import type { ExecutionPlan, ExecutionStep } from './prompts/system/execution/types';

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
  // Track subscription cleanup functions per execution array
  private executionSubscriptions: Map<string, () => void> = new Map();
  
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
    
    // Restore ExecutionArray instances from execution messages
    this.restoreExecutionArrays();
  }

  /**
   * Restore ExecutionArray instances from execution messages
   * This is called when loading a chat instance
   */
  private restoreExecutionArrays(): void {
    const executionMessages = this.data.messages.filter(
      m => m.type === 'execution'
    ) as ExecutionMessage[];
    
    for (const execMessage of executionMessages) {
      try {
        const executionArray = ExecutionArray.fromState(execMessage.executionArray);
        this.executionArrays.set(execMessage.executionId, executionArray);
      } catch (error) {
        console.error(`Failed to restore execution array ${execMessage.executionId}:`, error);
      }
    }
  }

  /**
   * Rebuild ExecutionArray instances by re-orchestrating from saved metadata
   * This restores working extrinsics that were lost during serialization
   */
  async rebuildExecutionArrays(orchestrator: ExecutionOrchestrator): Promise<void> {
    const executionMessages = this.data.messages.filter(
      m => m.type === 'execution'
    ) as ExecutionMessage[];
    
    for (const execMessage of executionMessages) {
      try {
        // Use stored execution plan if available, otherwise try to extract from state
        let plan: ExecutionPlan | undefined = execMessage.executionPlan;
        if (!plan) {
          const extractedPlan = this.extractExecutionPlanFromState(execMessage.executionArray);
          if (!extractedPlan) {
            console.warn(`Could not extract execution plan for ${execMessage.executionId}`);
            continue;
          }
          plan = extractedPlan;
        }
        
        // Re-orchestrate to get fresh ExecutionArray with working extrinsics
        const result = await orchestrator.orchestrate(plan, {
          stopOnError: false,
          validateFirst: false, // Skip validation since we're restoring
        });
        
        if (result.success && result.executionArray) {
          // Preserve the original ID and state
          const restoredArray = result.executionArray;
          // Copy over status information from saved state
          this.restoreExecutionArrayState(restoredArray, execMessage.executionArray);
          this.executionArrays.set(execMessage.executionId, restoredArray);
        } else {
          console.error(`Failed to re-orchestrate execution ${execMessage.executionId}:`, result.errors);
        }
      } catch (error) {
        console.error(`Failed to rebuild execution array ${execMessage.executionId}:`, error);
      }
    }
  }

  /**
   * Extract ExecutionPlan from saved ExecutionArrayState
   */
  private extractExecutionPlanFromState(state: ExecutionArrayState): ExecutionPlan | null {
    try {
      const steps: ExecutionStep[] = [];
      
      for (const item of state.items) {
        // Extract step information from metadata
        const metadata = item.agentResult?.metadata || item.metadata || {};
        const agentClassName = metadata.agentClassName || metadata.agentClass;
        const functionName = metadata.functionName || metadata.function;
        const parameters = metadata.parameters || {};
        
        if (!agentClassName || !functionName) {
          console.warn('Missing agentClassName or functionName in metadata:', metadata);
          continue;
        }
        
        steps.push({
          id: item.id,
          stepNumber: item.index + 1,
          agentClassName,
          functionName,
          parameters,
          executionType: item.executionType || 'extrinsic',
          status: this.mapStatusToPromptStatus(item.status),
          description: item.description,
          requiresConfirmation: item.agentResult?.requiresConfirmation ?? true,
          createdAt: item.createdAt,
        });
      }
      
      if (steps.length === 0) {
        return null;
      }
      
      return {
        id: state.id,
        originalRequest: steps[0]?.description || 'Restored execution',
        steps,
        status: 'pending',
        requiresApproval: true,
        createdAt: state.items[0]?.createdAt || Date.now(),
      };
    } catch (error) {
      console.error('Failed to extract execution plan from state:', error);
      return null;
    }
  }

  /**
   * Map runtime execution status to prompt system status
   */
  private mapStatusToPromptStatus(status: string): 'pending' | 'ready' | 'executing' | 'completed' | 'failed' | 'cancelled' {
    if (status === 'completed' || status === 'finalized') return 'completed';
    if (status === 'failed') return 'failed';
    if (status === 'cancelled') return 'cancelled';
    if (status === 'executing' || status === 'signing' || status === 'broadcasting') return 'executing';
    if (status === 'ready') return 'ready';
    return 'pending';
  }

  /**
   * Restore execution state (status, results, etc.) to rebuilt ExecutionArray
   */
  private restoreExecutionArrayState(executionArray: ExecutionArray, savedState: ExecutionArrayState): void {
    const items = executionArray.getItems();
    
    for (let i = 0; i < items.length && i < savedState.items.length; i++) {
      const savedItem = savedState.items[i];
      const currentItem = items[i];
      
      // Restore status if execution was already started/completed
      if (savedItem.status !== 'ready' && savedItem.status !== 'pending') {
        executionArray.updateStatus(currentItem.id, savedItem.status as any, savedItem.error);
      }
      
      // Restore results if execution completed
      if (savedItem.result) {
        executionArray.updateResult(currentItem.id, savedItem.result);
      }
    }
    
    // Restore execution state
    if (savedState.isExecuting) {
      executionArray.setCurrentIndex(savedState.currentIndex);
    }
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
  async addExecutionMessage(
    executionArrayState: ExecutionArrayState,
    executionPlan?: ExecutionPlan
  ): Promise<ExecutionMessage> {
    const message: ExecutionMessage = {
      id: `exec_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'execution',
      timestamp: Date.now(),
      executionId: executionArrayState.id,
      executionArray: executionArrayState,
      executionPlan,
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
    
    // Clean up any existing subscription for this execution
    const existingUnsubscribe = this.executionSubscriptions.get(executionId);
    if (existingUnsubscribe) {
      existingUnsubscribe();
    }
    
    // Notify any existing callbacks immediately with current state
    const callbacks = this.executionCallbacks.get(executionId);
    if (callbacks && callbacks.size > 0) {
      const state = executionArray.getState();
      callbacks.forEach(cb => cb(state));
    }
    
    // Set up subscription to notify callbacks on future updates
    // This subscription will be cleaned up when the execution array is removed or when all callbacks are removed
    const unsubscribe = executionArray.onStatusUpdate(() => {
      const updatedState = executionArray.getState();
      const callbacks = this.executionCallbacks.get(executionId);
      if (callbacks) {
        callbacks.forEach(cb => cb(updatedState));
      }
    });
    
    this.executionSubscriptions.set(executionId, unsubscribe);
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

    // If execution array exists, call callback immediately with current state
    // Subscription is already set up in setExecutionArray, so we don't need to set it up here
    const executionArray = this.executionArrays.get(executionId);
    if (executionArray) {
      callback(executionArray.getState());
    }

    // Return cleanup function
    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.executionCallbacks.delete(executionId);
        // Clean up subscription if no more callbacks
        const unsubscribe = this.executionSubscriptions.get(executionId);
        if (unsubscribe) {
          unsubscribe();
          this.executionSubscriptions.delete(executionId);
        }
      }
    };
  }
}

