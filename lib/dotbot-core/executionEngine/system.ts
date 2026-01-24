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
import { RpcEndpoints } from '../rpcManager';
import { SimulationStatusCallback } from '../agents/types';
import { isSimulationEnabled } from './simulation/simulationConfig';
import { createSimulationContext, findMatchingApi } from './simulation/simulationHelpers';
import { createSubsystemLogger, Subsystem } from '../services/logger';

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
 * // Modern approach: Use Signer
 * const signer = new BrowserWalletSigner();
 * signer.setSigningRequestHandler((request) => {
 *   showSigningModal(request);
 * });
 * 
 * const system = new ExecutionSystem();
 * system.initialize(api, account, signer);
 * 
 * // Execute LLM plan - that's it!
 * await system.execute(llmPlan);
 * ```
 * 
 * @example
 * ```typescript
 * // Legacy approach (deprecated)
 * const system = new ExecutionSystem();
 * system.initialize(api, account);
 * system.setSigningHandler((request) => {
 *   showSigningModal(request);
 * });
 * ```
 */
export class ExecutionSystem {
  private orchestrator: ExecutionOrchestrator;
  private executioner: Executioner;
  private executionLogger = createSubsystemLogger(Subsystem.EXECUTION);
  
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
   * Set signing handler (legacy - for backwards compatibility)
   * 
   * @deprecated Use initialize() with a Signer (e.g., BrowserWalletSigner) instead.
   * Pass the signer to initialize() and set handlers on the signer directly.
   * 
   * @example
   * ```typescript
   * const signer = new BrowserWalletSigner();
   * signer.setSigningRequestHandler(handler);
   * system.initialize(api, account, signer);
   * ```
   */
  setSigningHandler(handler: (request: SigningRequest) => void): void {
    this.executioner.setSigningRequestHandler(handler);
  }
  
  /**
   * Set batch signing handler (legacy - for backwards compatibility)
   * 
   * @deprecated Use initialize() with a Signer (e.g., BrowserWalletSigner) instead.
   * Pass the signer to initialize() and set handlers on the signer directly.
   * 
   * @example
   * ```typescript
   * const signer = new BrowserWalletSigner();
   * signer.setBatchSigningRequestHandler(handler);
   * system.initialize(api, account, signer);
   * ```
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
    this.executionLogger.debug({ 
      simulationEnabled,
      itemsCount: executionArray.getState().items.length,
      accountAddress,
      hasRelaySession: !!relayChainSession,
      hasAssetHubSession: !!assetHubSession
    }, 'runSimulation called');

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
      this.executionLogger.debug({}, 'Simulation disabled, skipping');
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
   * Clears agent cache to ensure agents use the new session APIs.
   * Cached agents would use old API instances, causing registry mismatches.
   */
  private initializeWithSessions(
    relayChainSession: ExecutionSession,
    assetHubSession: ExecutionSession | null
  ): void {
    if (!this.initializedAccount) {
      throw new Error('System not initialized - call initialize() first');
    }
    
    // Clear agent cache before re-initializing
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
    
    this.executionLogger.debug({ 
      totalItems: executionArray.getState().items.length,
      itemsToSimulate: items.length,
      itemIds: items.map(item => item.id)
    }, 'Running simulation for items');
    
    if (items.length === 0) {
      this.executionLogger.debug({}, 'No items to simulate');
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
    
    this.executionLogger.info({}, 'All simulations completed');
  }
  
  /**
   * Simulate multiple items sequentially on a single fork
   * 
   * All transactions are simulated on the same fork, so each sees state changes from previous ones.
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
    this.executionLogger.info({ itemsCount: items.length }, 'Starting sequential simulation for transactions on single fork');
    
    const apiForExtrinsics = this.validateApiForSequentialSimulation(items, executionArray, relayApi, assetHubApi);
    if (!apiForExtrinsics) return;
    
    const simulateSequentialTransactions = await this.checkChopsticksAvailability();
    if (!simulateSequentialTransactions) {
      await this.fallbackToIndividualSimulations(items, relayApi, assetHubApi, executionArray, accountAddress, relayChainManager, assetHubManager, relayChainSession, assetHubSession, onSimulationStatus);
      return;
    }
    
    const rpcEndpoints = this.prepareSequentialSimulationEndpoints(apiForExtrinsics, relayChainManager, assetHubManager, relayChainSession, assetHubSession);
    this.setInitialSimulationStatus(items, executionArray);
    const sequentialItems = this.createSequentialSimulationItems(items, accountAddress);
    const itemStatusCallback = this.createItemStatusCallback(items, executionArray, onSimulationStatus);
    
    try {
      const result = await simulateSequentialTransactions(apiForExtrinsics, rpcEndpoints, sequentialItems, itemStatusCallback);
      this.processSequentialSimulationResults(items, executionArray, result);
      this.executionLogger.info({ totalItems: items.length, success: result.success }, 'Sequential simulation completed');
    } catch (error) {
      this.handleSequentialSimulationError(error, items, executionArray);
    }
  }
  
  /**
   * Validate API for sequential simulation
   */
  private validateApiForSequentialSimulation(
    items: ExecutionItem[],
    executionArray: ExecutionArray,
    relayApi: ApiPromise,
    assetHubApi: ApiPromise | null
  ): ApiPromise | null {
    const firstExtrinsic = items[0].agentResult.extrinsic!;
    const apiForExtrinsics = findMatchingApi(firstExtrinsic, relayApi, assetHubApi);
    
    if (!apiForExtrinsics) {
      this.executionLogger.error({}, 'Cannot determine API for sequential simulation');
      this.markItemsAsFailed(items, executionArray, 'Cannot determine chain for simulation');
      return null;
    }
    
    return apiForExtrinsics;
  }
  
  /**
   * Check if Chopsticks is available (server-only)
   */
  private async checkChopsticksAvailability(): Promise<any> {
    if (typeof window === 'undefined') {
      const simulationModule = await import('../services/simulation');
      const isChopsticksAvailable = simulationModule.isChopsticksAvailable;
      const simulateSequentialTransactions = simulationModule.simulateSequentialTransactions;
      const available = await isChopsticksAvailable();
      return available ? simulateSequentialTransactions : null;
    }
    
    this.executionLogger.debug({}, 'Skipping simulation import in browser - prevents blocking availability check');
    return null;
  }
  
  /**
   * Fallback to individual simulations when sequential simulation is unavailable
   */
  private async fallbackToIndividualSimulations(
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
    this.executionLogger.warn({}, 'Chopsticks not available, falling back to individual simulations');
    for (const item of items) {
      await this.simulateItem(item, relayApi, assetHubApi, executionArray, accountAddress, relayChainManager, assetHubManager, relayChainSession, assetHubSession, onSimulationStatus);
    }
  }
  
  /**
   * Prepare RPC endpoints for sequential simulation
   */
  private prepareSequentialSimulationEndpoints(
    apiForExtrinsics: ApiPromise,
    relayChainManager: RpcManager,
    assetHubManager: RpcManager,
    relayChainSession: ExecutionSession,
    assetHubSession: ExecutionSession | null
  ): string[] {
    const isAssetHub = apiForExtrinsics.registry.chainSS58 === 0;
    const manager = isAssetHub ? assetHubManager : relayChainManager;
    const sessionEndpoint = isAssetHub ? assetHubSession?.endpoint : relayChainSession.endpoint;
    
    if (sessionEndpoint) {
      const managerEndpoints = this.getRpcEndpointsFromManager(manager, isAssetHub);
      const rpcEndpoints = [sessionEndpoint, ...managerEndpoints.filter(e => e !== sessionEndpoint)];
      this.executionLogger.debug({ endpoint: sessionEndpoint }, 'Using session endpoint for sequential simulation');
      return rpcEndpoints;
    }
    
    const rpcEndpoints = this.getRpcEndpointsFromManager(manager, isAssetHub);
    this.executionLogger.warn({}, 'No session endpoint available, using manager endpoints (may cause metadata mismatch)');
    return rpcEndpoints;
  }
  
  /**
   * Set initial simulation status for all items
   */
  private setInitialSimulationStatus(items: ExecutionItem[], executionArray: ExecutionArray): void {
    for (const item of items) {
      executionArray.updateSimulationStatus(item.id, {
        phase: 'initializing',
        message: 'Waiting for sequential simulation...',
        progress: 0,
      });
    }
  }
  
  /**
   * Create items for sequential simulation
   */
  private createSequentialSimulationItems(items: ExecutionItem[], accountAddress: string): any[] {
    return items.map(item => ({
      extrinsic: item.agentResult.extrinsic!,
      description: item.description,
      senderAddress: accountAddress,
    }));
  }
  
  /**
   * Create status callback for sequential simulation
   */
  private createItemStatusCallback(
    items: ExecutionItem[],
    executionArray: ExecutionArray,
    onSimulationStatus?: SimulationStatusCallback
  ): (status: any) => void {
    return (status: any) => {
      for (const item of items) {
        executionArray.updateSimulationStatus(item.id, status);
      }
      if (onSimulationStatus) {
        onSimulationStatus(status);
      }
    };
  }
  
  /**
   * Process results from sequential simulation
   */
  private processSequentialSimulationResults(items: ExecutionItem[], executionArray: ExecutionArray, result: any): void {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const itemResult = result.results[i];
      
      if (itemResult && itemResult.result.success) {
        this.markItemAsSuccessful(item, executionArray, itemResult);
      } else {
        this.markItemAsFailed(item, executionArray, itemResult?.result.error || 'Simulation failed');
        this.markRemainingItemsAsFailed(items, executionArray, i);
        break;
      }
    }
  }
  
  /**
   * Mark item as successful
   */
  private markItemAsSuccessful(item: ExecutionItem, executionArray: ExecutionArray, itemResult: any): void {
    const convertedResult = {
      success: itemResult.result.success,
      estimatedFee: itemResult.result.estimatedFee,
      validationMethod: 'chopsticks' as const,
      balanceChanges: itemResult.result.balanceChanges.map((bc: any) => ({
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
  }
  
  /**
   * Mark item as failed
   */
  private markItemAsFailed(item: ExecutionItem, executionArray: ExecutionArray, error: string): void {
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
  }
  
  /**
   * Mark remaining items as failed after a failure in sequence
   */
  private markRemainingItemsAsFailed(items: ExecutionItem[], executionArray: ExecutionArray, failedIndex: number): void {
    for (let j = failedIndex + 1; j < items.length; j++) {
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
  }
  
  /**
   * Handle errors from sequential simulation
   */
  private handleSequentialSimulationError(error: unknown, items: ExecutionItem[], executionArray: ExecutionArray): void {
    const errorMsg = error instanceof Error ? error.message : String(error);
    this.executionLogger.error({ 
      error: errorMsg,
      stack: error instanceof Error ? error.stack : undefined
    }, 'Sequential simulation failed');
    
    this.markItemsAsFailed(items, executionArray, `Sequential simulation failed: ${errorMsg}`);
  }
  
  /**
   * Mark all items as failed with error message
   */
  private markItemsAsFailed(items: ExecutionItem[], executionArray: ExecutionArray, errorMessage: string): void {
    for (const item of items) {
      executionArray.updateSimulationStatus(item.id, {
        phase: 'error',
        message: errorMessage,
        result: {
          success: false,
          error: errorMessage,
          wouldSucceed: false,
        },
      });
      executionArray.updateStatus(item.id, 'failed', errorMessage);
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
    const apiForExtrinsic = this.validateApiForItem(item, extrinsic, executionArray, relayApi, assetHubApi);
    if (!apiForExtrinsic) return;
    
    const connectionReady = await this.waitForApiConnection(item, apiForExtrinsic, executionArray);
    if (!connectionReady) return;
    
    this.logRegistryMismatchIfNeeded(item, extrinsic, apiForExtrinsic);
    await this.runItemSimulation(item, extrinsic, apiForExtrinsic, accountAddress, assetHubApi, assetHubManager, relayChainManager, relayChainSession, assetHubSession, executionArray, onSimulationStatus);
  }
  
  /**
   * Validate and find API for item simulation
   */
  private validateApiForItem(
    item: ExecutionItem,
    extrinsic: any,
    executionArray: ExecutionArray,
    relayApi: ApiPromise,
    assetHubApi: ApiPromise | null
  ): ApiPromise | null {
    const apiForExtrinsic = findMatchingApi(extrinsic, relayApi, assetHubApi);
    
    if (!apiForExtrinsic) {
      const errorMsg = `Cannot determine API for item ${item.id}`;
      executionArray.updateSimulationStatus(item.id, {
        phase: 'error',
        message: errorMsg,
        result: { success: false, error: errorMsg, wouldSucceed: false },
      });
      console.error(errorMsg);
      return null;
    }
    
    return apiForExtrinsic;
  }
  
  /**
   * Wait for API connection to be ready
   */
  private async waitForApiConnection(
    item: ExecutionItem,
    apiForExtrinsic: ApiPromise,
    executionArray: ExecutionArray
  ): Promise<boolean> {
    if (apiForExtrinsic.isConnected) {
      return true;
    }
    
    executionArray.updateSimulationStatus(item.id, {
      phase: 'initializing',
      message: 'Waiting for blockchain connection...',
      progress: 5,
    });
    
    try {
      await Promise.race([
        apiForExtrinsic.isReady,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 30000)
        )
      ]);
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Connection timeout';
      const userMsg = `Cannot connect to blockchain for simulation: ${errorMsg}. Please check your network connection.`;
      this.executionLogger.error({ itemId: item.id, error: errorMsg }, userMsg);
      executionArray.updateSimulationStatus(item.id, {
        phase: 'error',
        message: userMsg,
        result: { success: false, error: userMsg, wouldSucceed: false },
      });
      return false;
    }
  }
  
  /**
   * Run simulation for a single item
   */
  private async runItemSimulation(
    item: ExecutionItem,
    extrinsic: any,
    apiForExtrinsic: ApiPromise,
    accountAddress: string,
    assetHubApi: ApiPromise | null,
    assetHubManager: RpcManager,
    relayChainManager: RpcManager,
    relayChainSession: ExecutionSession,
    assetHubSession: ExecutionSession | null,
    executionArray: ExecutionArray,
    onSimulationStatus?: SimulationStatusCallback
  ): Promise<void> {
    const isAssetHub = apiForExtrinsic === assetHubApi;
    const sessionEndpoint = isAssetHub ? assetHubSession?.endpoint : relayChainSession.endpoint;
    
    const { runSimulation } = await import('./simulation/executionSimulator');
    const simulationContext = createSimulationContext(
      apiForExtrinsic,
      accountAddress,
      assetHubManager,
      relayChainManager,
      sessionEndpoint,
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
      this.executionLogger.warn({ 
        itemId: item.id,
        isAssetHubMethod,
        extrinsicRegistry: extrinsic.registry.constructor.name,
        apiRegistry: apiForExtrinsic.registry.constructor.name
      }, `Registry mismatch for item: extrinsic registry does not match orchestrator API registries. Using ${isAssetHubMethod ? 'Asset Hub' : 'Relay Chain'} API based on method section. This may cause metadata mismatch errors.`);
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
    this.executionLogger.error({ 
      itemId: item.id,
      error: errorMsg
    }, `Simulation failed for item ${item.id}`);
    
    if (errorMsg.includes('Unable to find Call') || errorMsg.includes('findMetaCall')) {
      this.executionLogger.error({
        extrinsicRegistry: extrinsic.registry.constructor.name,
        apiRegistry: apiForExtrinsic.registry.constructor.name,
        callIndex: `[${extrinsic.method.callIndex[0]}, ${extrinsic.method.callIndex[1]}]`
      }, 'Metadata mismatch detected');
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
