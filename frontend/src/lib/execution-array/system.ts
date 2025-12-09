/**
 * Complete Execution System
 * 
 * Turnkey solution that requires minimal frontend wiring.
 * Frontend just passes LLM output and everything is handled automatically.
 */

import { ApiPromise } from '@polkadot/api';
import { ExecutionArray as ExecutionArrayPlan } from '../prompts/system/execution/types';
import { ExecutionOrchestrator } from './orchestrator';
import { Executioner } from './executioner';
import { ExecutionOptions, SigningRequest, BatchSigningRequest } from './types';
import { WalletAccount } from '../../types/wallet';
import { Signer } from './signers/types';

/**
 * Complete Execution System
 * 
 * This is the recommended way to use the execution system.
 * Handles everything from LLM output to blockchain execution.
 * 
 * @example
 * ```typescript
 * const system = new ExecutionSystem();
 * system.initialize(api, account);
 * 
 * // Set up signing handler
 * system.setSigningHandler((request) => {
 *   showSigningModal(request);
 * });
 * 
 * // Execute LLM plan - that's it!
 * await system.execute(llmPlan);
 * ```
 */
export class ExecutionSystem {
  private orchestrator: ExecutionOrchestrator;
  private executioner: Executioner;
  
  constructor() {
    this.orchestrator = new ExecutionOrchestrator();
    this.executioner = new Executioner();
  }
  
  /**
   * Initialize the system
   * 
   * @param api Polkadot API instance
   * @param account Account information
   * @param signer Optional: Pluggable signer (for portability)
   */
  initialize(api: ApiPromise, account: WalletAccount, signer?: Signer): void {
    this.orchestrator.initialize(api);
    this.executioner.initialize(api, account, signer);
  }
  
  /**
   * Set signing handler (REQUIRED)
   */
  setSigningHandler(handler: (request: SigningRequest) => void): void {
    this.executioner.setSigningRequestHandler(handler);
  }
  
  /**
   * Set batch signing handler (optional)
   */
  setBatchSigningHandler(handler: (request: BatchSigningRequest) => void): void {
    this.executioner.setBatchSigningRequestHandler(handler);
  }
  
  /**
   * Execute LLM plan - complete flow from plan to blockchain
   * 
   * This is the main entry point. Pass LLM output and everything is handled:
   * 1. Orchestrator converts ExecutionStep[] to agent calls
   * 2. Agents create extrinsics
   * 3. ExecutionArray manages the queue
   * 4. Executioner handles signing and broadcasting
   * 
   * @param plan ExecutionArrayPlan from LLM
   * @param options Execution options
   * @param callbacks Progress callbacks for LLM feedback
   */
  async execute(
    plan: ExecutionArrayPlan,
    options: ExecutionOptions = {},
    callbacks?: {
      /** Called while preparing operations */
      onPreparingStep?: (description: string, current: number, total: number) => void;
      /** Called during execution */
      onExecutingStep?: (description: string, status: string) => void;
      /** Called on error */
      onError?: (error: string) => void;
      /** Called on completion */
      onComplete?: (success: boolean, completed: number, failed: number) => void;
    }
  ): Promise<void> {
    // Phase 1: Orchestrate (convert LLM plan to agent calls)
    const orchestrationResult = await this.orchestrator.orchestrate(plan, {
      onProgress: (step, index, total) => {
        if (callbacks?.onPreparingStep) {
          callbacks.onPreparingStep(step.description, index + 1, total);
        }
      },
      onError: (step, error) => {
        if (callbacks?.onError) {
          callbacks.onError(`Failed to prepare ${step.description}: ${error.message}`);
        }
      }
    });
    
    if (!orchestrationResult.success && callbacks?.onError) {
      callbacks.onError(
        `Orchestration completed with ${orchestrationResult.errors.length} error(s)`
      );
    }
    
    const { executionArray } = orchestrationResult;
    
    if (executionArray.isEmpty()) {
      if (callbacks?.onError) {
        callbacks.onError('No operations to execute');
      }
      return;
    }
    
    // Subscribe to execution status
    const unsubscribe = executionArray.onStatusUpdate((item) => {
      if (callbacks?.onExecutingStep) {
        callbacks.onExecutingStep(item.description, item.status);
      }
    });
    
    try {
      // Phase 2: Execute
      await this.executioner.execute(executionArray, options);
      
      const state = executionArray.getState();
      if (callbacks?.onComplete) {
        callbacks.onComplete(
          state.failedItems === 0,
          state.completedItems,
          state.failedItems
        );
      }
    } finally {
      unsubscribe();
    }
  }
}

