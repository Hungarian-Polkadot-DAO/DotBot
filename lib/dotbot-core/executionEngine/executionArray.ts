/**
 * Execution Array
 * 
 * Manages a queue of operations to be executed in order.
 * Handles status tracking, ordering, and provides real-time feedback.
 */

import { AgentResult } from '../agents/types';
import {
  ExecutionItem,
  ExecutionArrayState,
  ExecutionStatus,
  StatusCallback,
  ProgressCallback,
  ErrorCallback,
  CompletionCallback,
  SimulationStatus,
} from './types';
import { getInitialExecutionStatus } from './utils';

/**
 * Execution Array class
 * 
 * Manages execution queue and provides status tracking.
 */
export class ExecutionArray {
  private id: string;
  private items: ExecutionItem[] = [];
  private currentIndex = -1;
  private isExecuting = false;
  private isPaused = false;
  
  // Callbacks
  private statusCallbacks: Set<StatusCallback> = new Set();
  private progressCallbacks: Set<ProgressCallback> = new Set();
  private errorCallbacks: Set<ErrorCallback> = new Set();
  private completionCallbacks: Set<CompletionCallback> = new Set();
  
  constructor(id?: string) {
    this.id = id || `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Add an agent result to the execution array
   */
  add(agentResult: AgentResult): string {
    const id = this.generateId();
    const initialStatus = getInitialExecutionStatus();
    const item: ExecutionItem = {
      id,
      agentResult,
      status: initialStatus,
      executionType: agentResult.executionType,
      description: agentResult.description,
      estimatedFee: agentResult.estimatedFee,
      warnings: agentResult.warnings,
      metadata: agentResult.metadata,
      createdAt: Date.now(),
      index: this.items.length,
    };
    
    this.items.push(item);
    
    // Notify both progress and status so UI updates (deferred to prevent blocking)
    this.notifyStatusDeferred(item);
    this.notifyProgressDeferred();
    
    return id;
  }
  
  /**
   * Add multiple agent results to the execution array
   */
  addMultiple(agentResults: AgentResult[]): string[] {
    return agentResults.map(result => this.add(result));
  }
  
  /**
   * Get an execution item by ID
   */
  getItem(id: string): ExecutionItem | undefined {
    return this.items.find(item => item.id === id);
  }
  
  /**
   * Get all execution items
   */
  getItems(): ExecutionItem[] {
    return [...this.items];
  }
  
  /**
   * Get current execution state
   */
  getState(): ExecutionArrayState {
    const completedItems = this.items.filter(item => 
      item.status === 'completed' || item.status === 'finalized'
    ).length;
    
    const failedItems = this.items.filter(item => 
      item.status === 'failed'
    ).length;
    
    const cancelledItems = this.items.filter(item => 
      item.status === 'cancelled'
    ).length;
    
    return {
      id: this.id,
      items: [...this.items],
      currentIndex: this.currentIndex,
      isExecuting: this.isExecuting,
      isPaused: this.isPaused,
      totalItems: this.items.length,
      completedItems,
      failedItems,
      cancelledItems,
    };
  }

  /**
   * Restore ExecutionArray from saved state
   * Used when loading a chat instance that has execution messages
   * 
   * Note: This creates a basic ExecutionArray from state, but extrinsics will be broken.
   * For resuming interrupted flows, rebuild from ExecutionPlan instead.
   */
  static fromState(state: ExecutionArrayState): ExecutionArray {
    const executionArray = new ExecutionArray(state.id);
    executionArray.items = [...state.items];
    executionArray.currentIndex = state.currentIndex;
    executionArray.isExecuting = state.isExecuting;
    executionArray.isPaused = state.isPaused;
    return executionArray;
  }

  /**
   * Check if this ExecutionArray is in an interrupted state (can be resumed)
   * 
   * Interrupted states: pending, ready, executing, signing, broadcasting, in_block
   * Terminal states: completed, failed, finalized, cancelled
   */
  isInterrupted(): boolean {
    const state = this.getState();
    
    // If all items are terminal, not interrupted
    const terminalStatuses: ExecutionStatus[] = ['completed', 'failed', 'finalized', 'cancelled'];
    const allTerminal = state.items.length > 0 && state.items.every(item => 
      terminalStatuses.includes(item.status)
    );
    if (allTerminal) {
      return false;
    }
    
    // If there are any non-terminal items, it's interrupted
    return state.items.some(item => !terminalStatuses.includes(item.status));
  }

  /**
   * Restore execution state from a saved ExecutionArrayState
   * Used when resuming interrupted flows after rebuilding from ExecutionPlan
   * 
   * @param savedState The saved state to restore from
   */
  restoreState(savedState: ExecutionArrayState): void {
    this.currentIndex = savedState.currentIndex;
    this.isPaused = savedState.isPaused;
    
    // Restore item statuses for completed/finalized items (skip them in execution)
    for (let i = 0; i < Math.min(this.items.length, savedState.items.length); i++) {
      const savedItem = savedState.items[i];
      const currentItem = this.items[i];
      
      // Only restore status if item was completed/finalized (skip it)
      // Otherwise keep the fresh status from orchestration
      if (savedItem.status === 'completed' || savedItem.status === 'finalized') {
        this.updateStatus(currentItem.id, savedItem.status);
      }
    }
    
    this.notifyProgress();
  }
  
  /**
   * Update status of an execution item
   */
  updateStatus(id: string, status: ExecutionStatus, error?: string): void {
    const item = this.getItem(id);
    if (!item) {
      return;
    }
    
    const previousStatus = item.status;
    item.status = status;
    
    if (error) {
      item.error = error;
    }
    
    if (status === 'signing' || status === 'broadcasting') {
      if (!item.startedAt) {
        item.startedAt = Date.now();
      }
    }
    
    if (status === 'completed' || status === 'finalized' || status === 'failed' || status === 'cancelled') {
      item.completedAt = Date.now();
    }
    
    // Notify callbacks
    this.notifyStatus(item);
    this.notifyProgress();
    
    // If status changed to failed, notify error callbacks
    if (status === 'failed' && previousStatus !== 'failed' && error) {
      this.notifyError(item, new Error(error));
    }
  }

  /**
   * Update simulation status for an execution item
   */
  updateSimulationStatus(id: string, simulationStatus: SimulationStatus | undefined): void {
    const item = this.getItem(id);
    if (!item) {
      console.warn('[ExecutionArray] ⚠️ Cannot update simulation status - item not found:', id);
      return;
    }
    
    item.simulationStatus = simulationStatus;
    
    // Defer notifications to prevent UI blocking during rapid updates
    this.notifyStatusDeferred(item);
    this.notifyProgressDeferred();
  }
  
  /**
   * Update execution result for an item
   */
  updateResult(id: string, result: any): void {
    const item = this.getItem(id);
    if (!item) {
      return;
    }
    
    item.result = result;
    this.notifyStatusDeferred(item);
    this.notifyProgressDeferred();
  }
  
  /**
   * Set current execution index
   */
  setCurrentIndex(index: number): void {
    this.currentIndex = index;
    this.notifyProgressDeferred();
  }
  
  /**
   * Set execution state
   */
  setExecuting(executing: boolean): void {
    this.isExecuting = executing;
    this.notifyProgressDeferred();
  }
  
  /**
   * Pause execution
   */
  pause(): void {
    this.isPaused = true;
    this.notifyProgressDeferred();
  }
  
  /**
   * Resume execution
   */
  resume(): void {
    this.isPaused = false;
    this.notifyProgressDeferred();
  }
  
  /**
   * Clear all items
   */
  clear(): void {
    this.items = [];
    this.currentIndex = -1;
    this.isExecuting = false;
    this.isPaused = false;
    this.notifyProgressDeferred();
  }
  
  /**
   * Remove an item by ID
   */
  remove(id: string): boolean {
    const index = this.items.findIndex(item => item.id === id);
    if (index === -1) {
      return false;
    }
    
    this.items.splice(index, 1);
    // Update indices
    this.items.forEach((item, idx) => {
      item.index = idx;
    });
    
    this.notifyProgressDeferred();
    return true;
  }
  
  /**
   * Get pending items
   */
  getPendingItems(): ExecutionItem[] {
    return this.items.filter(item => item.status === 'pending');
  }
  
  /**
   * Get ready items (pending items that are ready for execution)
   */
  getReadyItems(): ExecutionItem[] {
    return this.items.filter(item => item.status === 'pending' || item.status === 'ready');
  }
  
  /**
   * Get items by status
   */
  getItemsByStatus(status: ExecutionStatus): ExecutionItem[] {
    return this.items.filter(item => item.status === status);
  }
  
  /**
   * Get items by execution type
   */
  getItemsByType(type: string): ExecutionItem[] {
    return this.items.filter(item => item.executionType === type);
  }
  
  /**
   * Check if array is empty
   */
  isEmpty(): boolean {
    return this.items.length === 0;
  }
  
  /**
   * Get array length
   */
  getLength(): number {
    return this.items.length;
  }
  
  /**
   * Subscribe to status updates
   */
  onStatusUpdate(callback: StatusCallback): () => void {
    this.statusCallbacks.add(callback);
    return () => {
      this.statusCallbacks.delete(callback);
    };
  }
  
  /**
   * Subscribe to progress updates
   */
  onProgress(callback: ProgressCallback): () => void {
    this.progressCallbacks.add(callback);
    return () => {
      this.progressCallbacks.delete(callback);
    };
  }
  
  /**
   * Subscribe to error events
   */
  onError(callback: ErrorCallback): () => void {
    this.errorCallbacks.add(callback);
    return () => {
      this.errorCallbacks.delete(callback);
    };
  }
  
  /**
   * Subscribe to completion events
   */
  onCompletion(callback: CompletionCallback): () => void {
    this.completionCallbacks.add(callback);
    return () => {
      this.completionCallbacks.delete(callback);
    };
  }
  
  /**
   * Notify status callbacks
   */
  // Batch notifications to prevent UI blocking
  private pendingStatusNotifications: Set<ExecutionItem> = new Set();
  private pendingProgressNotification = false;
  private notificationTimeout: NodeJS.Timeout | null = null;

  private notifyStatusDeferred(item: ExecutionItem): void {
    this.pendingStatusNotifications.add(item);
    this.scheduleNotification();
  }

  private notifyProgressDeferred(): void {
    this.pendingProgressNotification = true;
    this.scheduleNotification();
  }

  private scheduleNotification(): void {
    // Clear existing timeout
    if (this.notificationTimeout) {
      clearTimeout(this.notificationTimeout);
    }

    // Schedule notification in next event loop tick to batch updates
    this.notificationTimeout = setTimeout(() => {
      this.flushNotifications();
    }, 0);
  }

  private flushNotifications(): void {
    // Flush status notifications
    if (this.pendingStatusNotifications.size > 0) {
      const items = Array.from(this.pendingStatusNotifications);
      this.pendingStatusNotifications.clear();
      
      // Use requestIdleCallback if available, otherwise setTimeout
      const notify = () => {
        items.forEach((item) => {
          this.notifyStatus(item);
        });
      };

      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(notify, { timeout: 50 });
      } else {
        setTimeout(notify, 0);
      }
    }

    // Flush progress notification
    if (this.pendingProgressNotification) {
      this.pendingProgressNotification = false;
      
      const notify = () => {
        this.notifyProgress();
      };

      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(notify, { timeout: 50 });
      } else {
        setTimeout(notify, 0);
      }
    }

    this.notificationTimeout = null;
  }

  private notifyStatus(item: ExecutionItem): void {
    this.statusCallbacks.forEach((callback) => {
      try {
        callback(item);
      } catch (error) {
        console.error('[ExecutionArray] ❌ Error in status callback:', error);
      }
    });
  }

  /**
   * Notify progress callbacks
   */
  private notifyProgress(): void {
    const state = this.getState();
    this.progressCallbacks.forEach((callback) => {
      try {
        callback(state);
      } catch (error) {
        console.error('[ExecutionArray] ❌ Error in progress callback:', error);
      }
    });
  }
  
  /**
   * Notify error callbacks
   */
  private notifyError(item: ExecutionItem, error: Error): void {
    this.errorCallbacks.forEach(callback => {
      try {
        callback(item, error);
      } catch (error) {
        console.error('Error in error callback:', error);
      }
    });
  }
  
  /**
   * Notify completion callbacks
   */
  notifyCompletion(): void {
    const state = this.getState();
    this.completionCallbacks.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Error in completion callback:', error);
      }
    });
  }
  
  /**
   * Generate unique ID for execution item
   */
  private generateId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}


