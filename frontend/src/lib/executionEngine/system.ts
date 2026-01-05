/**
 * Execution System
 * 
 * Lower-level execution system for advanced use cases.
 * For most users, use DotBot instead - it's the turnkey solution that handles
 * everything including LLM integration, system prompts, and execution.
 * 
 * Use ExecutionSystem when you:
 * - Already have an ExecutionPlan from an LLM
 * - Want to execute plans without LLM integration
 * - Need fine-grained control over the execution flow
 */

import { ApiPromise } from '@polkadot/api';
import { ExecutionPlan } from '../prompts/system/execution/types';
import { ExecutionOrchestrator } from './orchestrator';
import { Executioner } from './executioner';
import { ExecutionOptions, SigningRequest, BatchSigningRequest } from './types';
import { WalletAccount } from '../types/wallet';
import { Signer } from './signers/types';
import type { RpcManager } from '../rpcManager';
import { SimulationStatusCallback } from '../agents/types';

/**
 * Execution System
 * 
 * Lower-level execution system for advanced use cases.
 * Handles execution of ExecutionPlans (from LLM) to blockchain operations.
 * 
 * For turnkey usage, see DotBot class instead.
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
   * @param api Polkadot Relay Chain API instance
   * @param account Account information
   * @param signer Optional: Pluggable signer (for portability)
   * @param assetHubApi Optional: Asset Hub API instance (recommended for DOT transfers)
   * @param relayChainManager Optional: RPC manager for Relay Chain endpoints
   * @param assetHubManager Optional: RPC manager for Asset Hub endpoints
   * @param onSimulationStatus Optional: Callback for simulation status updates
   */
  initialize(
    api: ApiPromise, 
    account: WalletAccount, 
    signer?: Signer, 
    assetHubApi?: ApiPromise | null,
    relayChainManager?: RpcManager | null,
    assetHubManager?: RpcManager | null,
    onSimulationStatus?: SimulationStatusCallback | null
  ): void {
    this.orchestrator.initialize(api, assetHubApi, onSimulationStatus, relayChainManager, assetHubManager);
    this.executioner.initialize(api, account, signer, assetHubApi, relayChainManager, assetHubManager, onSimulationStatus || undefined);
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
   * Get orchestrator instance (for advanced usage)
   */
  getOrchestrator(): ExecutionOrchestrator {
    return this.orchestrator;
  }
  
  /**
   * Get executioner instance (for advanced usage)
   */
  getExecutioner(): Executioner {
    return this.executioner;
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
   * @param plan ExecutionPlan from LLM
   * @param options Execution options
   * @param callbacks Progress callbacks for LLM feedback
   */
  async execute(
    plan: ExecutionPlan,
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

