/**
 * Execution State Management
 * 
 * Handles ExecutionArray lifecycle, callbacks, and subscriptions for ChatInstance
 */

import { ExecutionArray } from '../executionEngine/executionArray';
import type { ExecutionArrayState } from '../executionEngine/types';
import type { ExecutionOrchestrator } from '../executionEngine/orchestrator';
import type { ExecutionPlan, ExecutionStep } from '../prompts/system/execution/types';
import type { ExecutionMessage } from './types';
import { createSubsystemLogger, Subsystem } from '../services/logger';

/**
 * Execution State Manager
 * 
 * Manages ExecutionArray instances, callbacks, and subscriptions for a chat
 */
export class ExecutionStateManager {
  private executionArrays: Map<string, ExecutionArray> = new Map();
  private executionCallbacks: Map<string, Set<(state: ExecutionArrayState) => void>> = new Map();
  private executionSubscriptions: Map<string, () => void> = new Map();
  private chatLogger = createSubsystemLogger(Subsystem.CHAT);

  /**
   * Rebuild ExecutionArray instances by re-orchestrating from saved metadata
   */
  async rebuildExecutionArrays(
    executionMessages: ExecutionMessage[],
    orchestrator: ExecutionOrchestrator
  ): Promise<void> {
    for (const execMessage of executionMessages) {
      try {
        // Skip if executionArray is not yet available (still being prepared)
        if (!execMessage.executionArray) {
          continue;
        }
        
        // Use stored execution plan if available, otherwise try to extract from state
        let plan: ExecutionPlan | undefined = execMessage.executionPlan;
        if (!plan) {
          const extractedPlan = this.extractExecutionPlanFromState(execMessage.executionArray);
          if (!extractedPlan) {
            this.chatLogger.warn({ executionId: execMessage.executionId }, `Could not extract execution plan for ${execMessage.executionId}`);
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
          this.chatLogger.error({ 
            executionId: execMessage.executionId,
            errors: result.errors
          }, `Failed to re-orchestrate execution ${execMessage.executionId}`);
        }
      } catch (error) {
        this.chatLogger.error({ 
          executionId: execMessage.executionId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        }, `Failed to rebuild execution array ${execMessage.executionId}`);
      }
    }
  }

  /**
   * Extract ExecutionPlan from saved ExecutionArrayState (public for executionRunner when rebuilding from state).
   */
  extractExecutionPlanFromState(state: ExecutionArrayState): ExecutionPlan | null {
    try {
      const steps: ExecutionStep[] = [];
      
      for (const item of state.items) {
        // Extract step information from metadata
        const metadata = item.agentResult?.metadata || item.metadata || {};
        const agentClassName = metadata.agentClassName || metadata.agentClass;
        const functionName = metadata.functionName || metadata.function;
        const parameters = metadata.parameters || {};
        
        if (!agentClassName || !functionName) {
          this.chatLogger.warn({ metadata }, 'Missing agentClassName or functionName in metadata');
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
      this.chatLogger.error({ 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      }, 'Failed to extract execution plan from state');
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
   * Set ExecutionArray instance for a specific execution ID
   */
  setExecutionArray(executionId: string, executionArray: ExecutionArray): void {
    this.executionArrays.set(executionId, executionArray);
    
    // Clean up any existing subscription for this execution
    const existingUnsubscribe = this.executionSubscriptions.get(executionId);
    if (existingUnsubscribe) {
      existingUnsubscribe();
    }
    
    // Notify any existing callbacks immediately with current state (deferred to avoid blocking)
    const callbacks = this.executionCallbacks.get(executionId);
    if (callbacks && callbacks.size > 0) {
      const state = executionArray.getState();
      // Defer initial callback to avoid blocking UI during setup
      setTimeout(() => {
        callbacks.forEach(cb => {
          try {
            cb(state);
          } catch (error) {
            // Ignore errors in initial callback
          }
        });
      }, 0);
    }
    
    // Set up subscription to notify callbacks on future updates
    // Throttle callback invocations to prevent UI blocking
    let lastStateHash: string | null = null;
    let pendingUpdate: NodeJS.Timeout | null = null;
    
    // Helper to create a simple hash of state for change detection
    const getStateHash = (state: ExecutionArrayState): string => {
      // Create a hash from key state properties that change during execution
      const itemsHash = state.items.map(item => `${item.id}:${item.status}`).join('|');
      return `${state.isExecuting}:${state.completedItems}:${state.failedItems}:${itemsHash}`;
    };
    
    const notifyCallbacks = () => {
      const updatedState = executionArray.getState();
      const stateHash = getStateHash(updatedState);
      
      // Skip if state hasn't actually changed (content check, not reference)
      if (stateHash === lastStateHash) {
        return;
      }
      
      // Clear any pending update
      if (pendingUpdate) {
        clearTimeout(pendingUpdate);
        pendingUpdate = null;
      }
      
      // Defer callback invocation to avoid blocking UI thread
      // Use a small delay to batch rapid updates (16ms = ~60fps)
      pendingUpdate = setTimeout(() => {
        lastStateHash = stateHash;
        const callbacks = this.executionCallbacks.get(executionId);
        if (callbacks) {
          callbacks.forEach((cb) => {
            try {
              cb(updatedState);
            } catch (error) {
              this.chatLogger.error({ 
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
              }, 'Error in callback');
            }
          });
        }
        pendingUpdate = null;
      }, 16); // ~60fps - batches updates within a frame
    };
    
    // Only subscribe to onProgress - it covers all state changes
    const unsubscribeProgress = executionArray.onProgress(notifyCallbacks);
    
    // Store unsubscribe function
    const unsubscribe = () => {
      unsubscribeProgress();
      // Clear any pending update
      if (pendingUpdate) {
        clearTimeout(pendingUpdate);
        pendingUpdate = null;
      }
      lastStateHash = null;
    };
    
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
   * Get current execution (most recent)
   */
  getCurrentExecution(executionMessages: ExecutionMessage[]): ExecutionArray | null {
    if (executionMessages.length === 0) return null;
    
    const lastExecution = executionMessages[executionMessages.length - 1];
    return this.executionArrays.get(lastExecution.executionId) || null;
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

    // If execution array exists, call callback with current state (deferred to avoid blocking)
    const executionArray = this.executionArrays.get(executionId);
    if (executionArray) {
      const state = executionArray.getState();
      // Defer to avoid blocking UI during subscription setup
      setTimeout(() => {
        try {
          callback(state);
        } catch (error) {
          // Ignore errors in callback
        }
      }, 0);
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

  /**
   * Cleanup all subscriptions
   */
  cleanup(): void {
    this.executionSubscriptions.forEach(unsubscribe => unsubscribe());
    this.executionSubscriptions.clear();
    this.executionCallbacks.clear();
  }
}
