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
import { ExecutionOrchestrator, OrchestrationResult } from './orchestrator';
import { Executioner } from './executioner';
import { ExecutionOptions, SigningRequest, BatchSigningRequest, ExecutionItem } from './types';
import { ExecutionArray } from './executionArray';
import { WalletAccount } from '../types/wallet';
import { Signer } from './signers/types';
import type { RpcManager, ExecutionSession } from '../rpcManager';
import { SimulationStatusCallback } from '../agents/types';
import { isSimulationEnabled } from './simulation/simulationConfig';
import { createSimulationContext, findMatchingApi } from './simulation/simulationHelpers';

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
  
  // Store initialization state for re-initialization with sessions
  private initializedAccount: WalletAccount | null = null;
  private initializedSigner: Signer | null = null;
  private initializedOnSimulationStatus: SimulationStatusCallback | undefined = undefined;
  
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
    // Store for later re-initialization with sessions
    this.initializedAccount = account;
    this.initializedSigner = signer || null;
    this.initializedOnSimulationStatus = onSimulationStatus || undefined;
    
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
   * Orchestrate execution plan (creates ExecutionArray with items)
   * This is called before adding to chat so UI can show simulation progress
   * 
   * @param plan ExecutionPlan from LLM
   * @param relayChainSession Relay Chain execution session (from ChatInstance)
   * @param assetHubSession Asset Hub execution session (from ChatInstance)
   * @param executionId Optional execution ID to preserve when rebuilding
   * @returns ExecutionArray with items (ready for simulation)
   */
  async orchestrateExecutionArray(
    plan: ExecutionPlan,
    relayChainSession: ExecutionSession,
    assetHubSession: ExecutionSession | null,
    executionId?: string
  ): Promise<ExecutionArray> {
    this.initializeWithSessions(relayChainSession, assetHubSession);
    
    const result = await this.orchestrator.orchestrate(plan, {}, executionId);
    if (!result.success && result.errors.length > 0) {
      const errorMessages = result.errors.map(e => `• ${e.error}`).join('\n');
      throw new Error(`Failed to prepare transaction:\n\n${errorMessages}`);
    }
    
    return result.executionArray;
  }

  /**
   * Run simulation for execution array (called after adding to chat)
   * 
   * @param executionArray ExecutionArray to simulate
   * @param accountAddress Account address for simulation
   * @param relayChainSession Relay Chain execution session (from ChatInstance)
   * @param assetHubSession Asset Hub execution session (from ChatInstance)
   * @param relayChainManager RPC manager for Relay Chain (for simulation endpoints)
   * @param assetHubManager RPC manager for Asset Hub (for simulation endpoints)
   * @param onSimulationStatus Optional callback for simulation status
   */
  async runSimulation(
    executionArray: ExecutionArray,
    accountAddress: string,
    relayChainSession: ExecutionSession,
    assetHubSession: ExecutionSession | null,
    relayChainManager: RpcManager,
    assetHubManager: RpcManager,
    onSimulationStatus?: SimulationStatusCallback
  ): Promise<void> {
    const simulationEnabled = isSimulationEnabled();
    console.log('[ExecutionSystem] 🎯 runSimulation called:', {
      simulationEnabled,
      itemsCount: executionArray.getState().items.length,
      accountAddress,
      hasRelaySession: !!relayChainSession,
      hasAssetHubSession: !!assetHubSession
    });

    if (simulationEnabled) {
      await this.runSimulationForExecutionArray(
        executionArray,
        accountAddress,
        relayChainSession,
        assetHubSession,
        relayChainManager,
        assetHubManager,
        onSimulationStatus
      );
    } else {
      console.log('[ExecutionSystem] ⏭️ Simulation disabled, skipping');
    }
  }

  /**
   * Prepare execution array: orchestrate plan and run simulation if enabled
   * 
   * This is the two-phase execution pattern:
   * 1. Prepare: Orchestrate + simulate (if enabled)
   * 2. Execute: User approves → sign → broadcast (via startExecution)
   * 
   * @param plan ExecutionPlan from LLM
   * @param relayChainSession Relay Chain execution session (from ChatInstance)
   * @param assetHubSession Asset Hub execution session (from ChatInstance)
   * @param relayChainManager RPC manager for Relay Chain (for simulation endpoints)
   * @param assetHubManager RPC manager for Asset Hub (for simulation endpoints)
   * @param accountAddress Account address for simulation
   * @param onSimulationStatus Optional callback for simulation status
   * @param executionId Optional execution ID to preserve when rebuilding (prevents duplicate ExecutionMessages)
   * @returns ExecutionArray ready for execution
   */
  async prepareExecutionArray(
    plan: ExecutionPlan,
    relayChainSession: ExecutionSession,
    assetHubSession: ExecutionSession | null,
    relayChainManager: RpcManager,
    assetHubManager: RpcManager,
    accountAddress: string,
    onSimulationStatus?: SimulationStatusCallback,
    executionId?: string
  ): Promise<ExecutionArray> {
    const executionArray = await this.orchestrateExecutionArray(
      plan,
      relayChainSession,
      assetHubSession,
      executionId
    );
    
    await this.runSimulation(
      executionArray,
      accountAddress,
      relayChainSession,
      assetHubSession,
      relayChainManager,
      assetHubManager,
      onSimulationStatus
    );
    
    return executionArray;
  }
  
  /**
   * Initialize orchestrator and executioner with session APIs
   * 
   * CRITICAL: Clears agent cache to ensure agents use the new session APIs.
   * Cached agents would use old API instances, causing registry mismatches.
   */
  private initializeWithSessions(
    relayChainSession: ExecutionSession,
    assetHubSession: ExecutionSession | null
  ): void {
    if (!this.initializedAccount) {
      throw new Error('System not initialized - call initialize() first');
    }
    
    // CRITICAL: Clear agent cache before re-initializing
    // Cached agents would use old API instances, causing registry mismatches
    this.orchestrator.clearCache();
    
    // Re-initialize orchestrator with session APIs
    this.orchestrator.initialize(
      relayChainSession.api,
      assetHubSession?.api || null,
      this.initializedOnSimulationStatus || undefined,
      null, // RPC managers not needed (using session APIs)
      null
    );
    
    // Re-initialize executioner with session APIs
    this.executioner.initialize(
      relayChainSession.api,
      this.initializedAccount,
      this.initializedSigner || undefined,
      assetHubSession?.api || null,
      null, // RPC managers not needed (using session APIs)
      null,
      this.initializedOnSimulationStatus
    );
  }
  
  /**
   * Run simulation for all items in execution array
   * 
   * CRITICAL: 
   * - Uses session APIs (not orchestrator APIs) because extrinsics were created with session APIs
   * - For multi-transaction flows: uses sequential simulation on a single fork (transactions build on each other)
   * - For single transactions: uses standard simulation
   */
  private async runSimulationForExecutionArray(
    executionArray: ExecutionArray,
    accountAddress: string,
    relayChainSession: ExecutionSession,
    assetHubSession: ExecutionSession | null,
    relayChainManager: RpcManager,
    assetHubManager: RpcManager,
    onSimulationStatus?: SimulationStatusCallback
  ): Promise<void> {
    const sessionRelayApi = relayChainSession.api;
    const sessionAssetHubApi = assetHubSession?.api || null;
    
    const items = executionArray.getState().items
      .filter((item: ExecutionItem) => item.executionType === 'extrinsic' && item.agentResult.extrinsic);
    
    console.log('[ExecutionSystem] 📋 Running simulation for items:', {
      totalItems: executionArray.getState().items.length,
      itemsToSimulate: items.length,
      itemIds: items.map(item => item.id)
    });
    
    if (items.length === 0) {
      console.log('[ExecutionSystem] ⏭️ No items to simulate');
      return;
    }
    
    // For multi-transaction flows, use sequential simulation on a single fork
    // so each transaction sees the state changes from previous transactions
    if (items.length > 1) {
      await this.simulateMultipleItemsSequentially(
        items,
        sessionRelayApi,
        sessionAssetHubApi,
        executionArray,
        accountAddress,
        relayChainManager,
        assetHubManager,
        relayChainSession,
        assetHubSession,
        onSimulationStatus
      );
    } else {
      // Single transaction - use standard simulation
      await this.simulateItem(
        items[0],
        sessionRelayApi,
        sessionAssetHubApi,
        executionArray,
        accountAddress,
        relayChainManager,
        assetHubManager,
        relayChainSession,
        assetHubSession,
        onSimulationStatus
      );
    }
    
    console.log('[ExecutionSystem] ✅ All simulations completed');
  }
  
  /**
   * Simulate multiple items sequentially on a single fork
   * 
   * CRITICAL: All transactions are simulated on the same fork, so each sees state changes from previous ones.
   * This is essential for multi-transaction flows (e.g., transfer → stake → vote).
   */
  private async simulateMultipleItemsSequentially(
    items: ExecutionItem[],
    relayApi: ApiPromise,
    assetHubApi: ApiPromise | null,
    executionArray: ExecutionArray,
    accountAddress: string,
    relayChainManager: RpcManager,
    assetHubManager: RpcManager,
    relayChainSession: ExecutionSession,
    assetHubSession: ExecutionSession | null,
    onSimulationStatus?: SimulationStatusCallback
  ): Promise<void> {
    console.log('[ExecutionSystem] 🔗 Starting sequential simulation for', items.length, 'transactions on single fork');
    
    // Group items by chain (all should be on same chain for now)
    const firstExtrinsic = items[0].agentResult.extrinsic!;
    const apiForExtrinsics = findMatchingApi(firstExtrinsic, relayApi, assetHubApi);
    
    if (!apiForExtrinsics) {
      console.error('[ExecutionSystem] ❌ Cannot determine API for sequential simulation');
      for (const item of items) {
        executionArray.updateSimulationStatus(item.id, {
          phase: 'error',
          message: 'Cannot determine chain for simulation',
          result: { success: false, error: 'Cannot determine chain', wouldSucceed: false },
        });
        executionArray.updateStatus(item.id, 'failed', 'Cannot determine chain for simulation');
      }
      return;
    }
    
    // Check if Chopsticks is available
    const { isChopsticksAvailable, simulateSequentialTransactions } = await import('../services/simulation');
    const chopsticksAvailable = await isChopsticksAvailable();
    
    if (!chopsticksAvailable) {
      console.warn('[ExecutionSystem] ⚠️ Chopsticks not available, falling back to individual simulations');
      // Fall back to individual simulations (won't see each other's state changes)
      for (const item of items) {
        await this.simulateItem(
          item,
          relayApi,
          assetHubApi,
          executionArray,
          accountAddress,
          relayChainManager,
          assetHubManager,
          relayChainSession,
          assetHubSession,
          onSimulationStatus
        );
      }
      return;
    }
    
    // Get RPC endpoints for this chain
    const isAssetHub = apiForExtrinsics.registry.chainSS58 === 0;
    const manager = isAssetHub ? assetHubManager : relayChainManager;
    
    // CRITICAL FIX: Use session endpoint first (for metadata consistency), fallback to manager endpoints
    const sessionEndpoint = isAssetHub ? assetHubSession?.endpoint : relayChainSession.endpoint;
    let rpcEndpoints: string[];
    if (sessionEndpoint) {
      const managerEndpoints = this.getRpcEndpointsFromManager(manager, isAssetHub);
      rpcEndpoints = [sessionEndpoint, ...managerEndpoints.filter(e => e !== sessionEndpoint)];
      console.log(`[ExecutionSystem] Using session endpoint for sequential simulation: ${sessionEndpoint}`);
    } else {
      rpcEndpoints = this.getRpcEndpointsFromManager(manager, isAssetHub);
      console.warn('[ExecutionSystem] ⚠️ No session endpoint available, using manager endpoints (may cause metadata mismatch)');
    }
    
    // Set initial status for all items
    for (const item of items) {
      executionArray.updateSimulationStatus(item.id, {
        phase: 'initializing',
        message: 'Waiting for sequential simulation...',
        progress: 0,
      });
    }
    
    // Prepare items for sequential simulation
    const sequentialItems = items.map(item => ({
      extrinsic: item.agentResult.extrinsic!,
      description: item.description,
      senderAddress: accountAddress,
    }));
    
    // Create status callback that updates individual items
    const itemStatusCallback = (status: any) => {
      // Broadcast to all items (they'll show overall progress)
      for (const item of items) {
        executionArray.updateSimulationStatus(item.id, status);
      }
      if (onSimulationStatus) {
        onSimulationStatus(status);
      }
    };
    
    try {
      // Run sequential simulation
      const result = await simulateSequentialTransactions(
        apiForExtrinsics,
        rpcEndpoints,
        sequentialItems,
        itemStatusCallback
      );
      
      // Update each item with its specific result
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const itemResult = result.results[i];
        
        if (itemResult && itemResult.result.success) {
          // Convert BN values to strings and null to undefined for ExecutionArray
          const convertedResult = {
            success: itemResult.result.success,
            estimatedFee: itemResult.result.estimatedFee,
            validationMethod: 'chopsticks' as const,
            balanceChanges: itemResult.result.balanceChanges.map(bc => ({
              value: bc.value.toString(),
              change: bc.change,
            })),
            error: itemResult.result.error || undefined,
            wouldSucceed: true,
          };
          
          executionArray.updateSimulationStatus(item.id, {
            phase: 'complete',
            message: 'Simulation completed successfully',
            result: convertedResult,
          });
          executionArray.updateStatus(item.id, 'ready');
        } else {
          const error = itemResult?.result.error || 'Simulation failed';
          executionArray.updateSimulationStatus(item.id, {
            phase: 'error',
            message: `Simulation failed: ${error}`,
            result: {
              success: false,
              error,
              wouldSucceed: false,
            },
          });
          executionArray.updateStatus(item.id, 'failed', error);
          
          // If one fails, mark remaining as failed too (can't continue the chain)
          for (let j = i + 1; j < items.length; j++) {
            const failedItem = items[j];
            executionArray.updateSimulationStatus(failedItem.id, {
              phase: 'error',
              message: 'Skipped due to previous transaction failure',
              result: {
                success: false,
                error: 'Previous transaction in sequence failed',
                wouldSucceed: false,
              },
            });
            executionArray.updateStatus(failedItem.id, 'failed', 'Previous transaction failed');
          }
          break;
        }
      }
      
      console.log('[ExecutionSystem] ✅ Sequential simulation completed:', {
        totalItems: items.length,
        success: result.success,
      });
    } catch (error) {
      console.error('[ExecutionSystem] ❌ Sequential simulation failed:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // Mark all items as failed
      for (const item of items) {
        executionArray.updateSimulationStatus(item.id, {
          phase: 'error',
          message: `Sequential simulation failed: ${errorMsg}`,
          result: {
            success: false,
            error: errorMsg,
            wouldSucceed: false,
          },
        });
        executionArray.updateStatus(item.id, 'failed', errorMsg);
      }
    }
  }
  
  /**
   * Get RPC endpoints from manager with failover logic
   */
  private getRpcEndpointsFromManager(manager: RpcManager | null, isAssetHub: boolean): string[] {
    if (manager) {
      const healthStatus = manager.getHealthStatus();
      const currentEndpoint = manager.getCurrentEndpoint();
      const now = Date.now();
      const failoverTimeout = 5 * 60 * 1000;

      const orderedEndpoints = healthStatus
        .filter(h => {
          if (h.healthy) return true;
          if (!h.lastFailure) return true;
          return (now - h.lastFailure) >= failoverTimeout;
        })
        .sort((a, b) => {
          if (a.endpoint === currentEndpoint) return -1;
          if (b.endpoint === currentEndpoint) return 1;
          if (a.healthy !== b.healthy) return a.healthy ? -1 : 1;
          return (a.failureCount || 0) - (b.failureCount || 0);
        })
        .map(h => h.endpoint);

      if (orderedEndpoints.length > 0) {
        return orderedEndpoints;
      }

      return healthStatus.map(h => h.endpoint);
    }

    // Fallback to Polkadot mainnet endpoints if no manager available
    const { RpcEndpoints } = require('../rpcManager');
    return isAssetHub
      ? RpcEndpoints.POLKADOT_ASSET_HUB.slice(0, 2)
      : RpcEndpoints.POLKADOT_RELAY_CHAIN.slice(0, 2);
  }
  
  /**
   * Simulate a single execution item
   * 
   * CRITICAL: Must use the exact API instance that created the extrinsic to avoid registry mismatch.
   * Since orchestrator is initialized with session APIs, extrinsics should match session API registries.
   */
  private async simulateItem(
    item: ExecutionItem,
    relayApi: ApiPromise,
    assetHubApi: ApiPromise | null,
    executionArray: ExecutionArray,
    accountAddress: string,
    relayChainManager: RpcManager,
    assetHubManager: RpcManager,
    relayChainSession: ExecutionSession,
    assetHubSession: ExecutionSession | null,
    onSimulationStatus?: SimulationStatusCallback
  ): Promise<void> {
    const extrinsic = item.agentResult.extrinsic!;
    
    // CRITICAL: Use the extrinsic's own registry to find matching API
    // The extrinsic was created with session APIs (via orchestrator), so it should match
    const apiForExtrinsic = findMatchingApi(extrinsic, relayApi, assetHubApi);
    
    if (!apiForExtrinsic) {
      const errorMsg = `Cannot determine API for item ${item.id}`;
      executionArray.updateSimulationStatus(item.id, {
        phase: 'error',
        message: errorMsg,
        result: {
          success: false,
          error: errorMsg,
          wouldSucceed: false,
        },
      });
      console.error(errorMsg);
      return;
    }
    
    // Log warning if registries don't match (shouldn't happen if orchestration used session APIs)
    if (apiForExtrinsic.registry !== extrinsic.registry) {
      console.warn(
        `Registry mismatch for item ${item.id}: extrinsic registry does not match session API registry. ` +
        `This may cause simulation to fail. Extrinsic was likely created before session APIs were initialized.`
      );
    }
    
    // CRITICAL FIX: Get the session endpoint for metadata consistency
    // Use the endpoint from the session that matches the API
    const isAssetHub = apiForExtrinsic === assetHubApi;
    const sessionEndpoint = isAssetHub ? assetHubSession?.endpoint : relayChainSession.endpoint;
    
    const { runSimulation } = await import('./simulation/executionSimulator');
    const simulationContext = createSimulationContext(
      apiForExtrinsic,
      accountAddress,
      assetHubManager,
      relayChainManager,
      sessionEndpoint, // Pass session endpoint for metadata consistency
      onSimulationStatus
    );
    
    try {
      await runSimulation(extrinsic, simulationContext, executionArray, item);
    } catch (error) {
      this.handleSimulationError(error, item, extrinsic, apiForExtrinsic);
    }
  }
  
  /**
   * Log registry mismatch warning if needed
   */
  private logRegistryMismatchIfNeeded(
    item: ExecutionItem,
    extrinsic: any,
    apiForExtrinsic: ApiPromise
  ): void {
    if (apiForExtrinsic.registry !== extrinsic.registry) {
      const isAssetHubMethod = extrinsic.method.section === 'assets' || 
                               extrinsic.method.section === 'foreignAssets';
      console.warn(
        `Registry mismatch for item ${item.id}: extrinsic registry does not match orchestrator API registries. ` +
        `Using ${isAssetHubMethod ? 'Asset Hub' : 'Relay Chain'} API based on method section. ` +
        `This may cause metadata mismatch errors.`
      );
    }
  }
  
  /**
   * Handle simulation errors with detailed logging
   */
  private handleSimulationError(
    error: unknown,
    item: ExecutionItem,
    extrinsic: any,
    apiForExtrinsic: ApiPromise
  ): void {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`Simulation failed for item ${item.id}:`, errorMsg);
    
    if (errorMsg.includes('Unable to find Call') || errorMsg.includes('findMetaCall')) {
      console.error(
        `Metadata mismatch detected. Extrinsic registry: ${extrinsic.registry.constructor.name}, ` +
        `API registry: ${apiForExtrinsic.registry.constructor.name}, ` +
        `Call index: [${extrinsic.method.callIndex[0]}, ${extrinsic.method.callIndex[1]}]`
      );
    }
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
    const orchestrationResult = await this.orchestrateWithCallbacks(plan, callbacks);
    const executionArray = this.processOrchestrationResult(orchestrationResult, callbacks);
    
    if (!executionArray) {
      return;
    }
    
    await this.executeWithCallbacks(executionArray, options, callbacks);
  }
  
  /**
   * Orchestrate plan with callback handling
   */
  private async orchestrateWithCallbacks(
    plan: ExecutionPlan,
    callbacks?: {
      onPreparingStep?: (description: string, current: number, total: number) => void;
      onError?: (error: string) => void;
    }
  ) {
    return await this.orchestrator.orchestrate(plan, {
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
  }
  
  /**
   * Process orchestration result and handle errors
   */
  private processOrchestrationResult(
    orchestrationResult: OrchestrationResult,
    callbacks?: {
      onError?: (error: string) => void;
    }
  ): ExecutionArray | null {
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
      return null;
    }
    
    return executionArray;
  }
  
  /**
   * Execute with callback handling
   */
  private async executeWithCallbacks(
    executionArray: ExecutionArray,
    options: ExecutionOptions,
    callbacks?: {
      onExecutingStep?: (description: string, status: string) => void;
      onComplete?: (success: boolean, completed: number, failed: number) => void;
    }
  ): Promise<void> {
    const unsubscribe = executionArray.onStatusUpdate((item) => {
      if (callbacks?.onExecutingStep) {
        callbacks.onExecutingStep(item.description, item.status);
      }
    });
    
    try {
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

