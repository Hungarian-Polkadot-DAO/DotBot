/**
 * Executioner
 * 
 * Executes operations from the ExecutionArray.
 * Handles signing, broadcasting, and monitoring of transactions.
 * 
 * **Pluggable Signing**: Works in any environment (browser, terminal, backend, tests)
 */

import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { ExecutionArray } from './executionArray';
import {
  ExecutionItem,
  ExecutionOptions,
  ExecutionResult as _ExecutionResult,
  ExecutionStatus,
  SigningRequest,
  BatchSigningRequest,
} from './types';
import { WalletAccount } from '../types/wallet';
import { Signer } from './signers/types';
import { BrowserWalletSigner } from './signers/browserSigner';
import { RpcManager } from '../rpcManager';
import { runSimulation } from './simulation/executionSimulator';
import { isSimulationEnabled } from './simulation/simulationConfig';
import { createSimulationContext } from './simulation/simulationHelpers';
import {
  createSigningRequest,
  createBatchSigningRequest,
  signExtrinsic,
  encodeAddressForChain,
  SigningContext,
} from './signing/executionSigner';
import { broadcastTransaction } from './broadcasting/executionBroadcaster';
import { markItemAsFailed, markItemAsFailedAndThrow, extractErrorMessage } from './errorHandlers';

/**
 * Executioner class
 * 
 * Handles execution of operations from ExecutionArray.
 * Now supports pluggable signing for any environment!
 */
export class Executioner {
  private api: ApiPromise | null = null;
  private assetHubApi: ApiPromise | null = null;
  private account: WalletAccount | null = null;
  private signer: Signer | null = null;
  private relayChainManager: RpcManager | null = null;
  private assetHubManager: RpcManager | null = null;
  private onStatusUpdate?: (status: any) => void;
  
  // Backwards compatibility: old browser-specific handlers
  private signingRequestHandler?: (request: SigningRequest) => void;
  private batchSigningRequestHandler?: (request: BatchSigningRequest) => void;
  
  /**
   * Initialize with Polkadot API and account
   * 
   * @param api Polkadot Relay Chain API instance
   * @param account Account info (address, name, etc.)
   * @param signer Optional: Pluggable signer (BrowserWalletSigner, KeyringSigner, custom)
   *               If not provided, uses legacy browser wallet signing
   * @param assetHubApi Optional: Asset Hub API instance (for DOT transfers)
   * @param relayChainManager Optional: RPC manager for Relay Chain (for execution sessions)
   * @param assetHubManager Optional: RPC manager for Asset Hub (for execution sessions)
   * @param onStatusUpdate Optional: Callback for simulation status updates
   */
  initialize(
    api: ApiPromise, 
    account: WalletAccount, 
    signer?: Signer, 
    assetHubApi?: ApiPromise | null,
    relayChainManager?: RpcManager | null,
    assetHubManager?: RpcManager | null,
    onStatusUpdate?: (status: any) => void
  ): void {
    this.api = api;
    this.assetHubApi = assetHubApi || null;
    this.account = account;
    this.signer = signer || null;
    this.relayChainManager = relayChainManager || null;
    this.assetHubManager = assetHubManager || null;
    this.onStatusUpdate = onStatusUpdate;
    
    // If signer is BrowserWalletSigner, set up handlers
    if (signer && signer instanceof BrowserWalletSigner) {
      const browserSigner = signer as BrowserWalletSigner;
      if (this.signingRequestHandler) {
        browserSigner.setSigningRequestHandler(this.signingRequestHandler);
      }
      if (this.batchSigningRequestHandler) {
        browserSigner.setBatchSigningRequestHandler(this.batchSigningRequestHandler);
      }
    }
  }
  
  /**
   * Set handler for signing requests (legacy - for backwards compatibility)
   * 
   * @deprecated Use initialize() with a Signer instead
   */
  setSigningRequestHandler(handler: (request: SigningRequest) => void): void {
    this.signingRequestHandler = handler;
    
    // If signer is already set and is BrowserWalletSigner, update it
    if (this.signer && this.signer instanceof BrowserWalletSigner) {
      (this.signer as BrowserWalletSigner).setSigningRequestHandler(handler);
    }
  }
  
  /**
   * Set handler for batch signing requests (legacy - for backwards compatibility)
   * 
   * @deprecated Use initialize() with a Signer instead
   */
  setBatchSigningRequestHandler(handler: (request: BatchSigningRequest) => void): void {
    this.batchSigningRequestHandler = handler;
    
    // If signer is already set and is BrowserWalletSigner, update it
    if (this.signer && this.signer instanceof BrowserWalletSigner) {
      (this.signer as BrowserWalletSigner).setBatchSigningRequestHandler(handler);
    }
  }
  
  /**
   * Execute all items in the execution array
   */
  async execute(
    executionArray: ExecutionArray,
    options: ExecutionOptions = {}
  ): Promise<void> {
    this.ensureInitialized();
    
    const normalizedOptions = this.normalizeExecutionOptions(options);
    executionArray.setExecuting(true);
    
    try {
      const readyItems = executionArray.getReadyItems();
      if (readyItems.length === 0) {
        executionArray.setExecuting(false);
        return;
      }
      
      await this.executeItems(executionArray, readyItems, normalizedOptions);
      await this.executeBatchesIfEnabled(executionArray, normalizedOptions);
    } finally {
      executionArray.setExecuting(false);
      executionArray.notifyCompletion();
    }
  }
  
  /**
   * Normalize execution options with defaults
   */
  private normalizeExecutionOptions(options: ExecutionOptions): Required<Pick<ExecutionOptions, 'continueOnError' | 'allowBatching' | 'timeout' | 'sequential' | 'autoApprove'>> {
    return {
      continueOnError: options.continueOnError ?? false,
      allowBatching: options.allowBatching ?? true,
      timeout: options.timeout ?? 300000, // 5 minutes default
      sequential: options.sequential ?? true,
      autoApprove: options.autoApprove ?? false,
    };
  }
  
  /**
   * Execute items (sequentially or in parallel)
   */
  private async executeItems(
    executionArray: ExecutionArray,
    readyItems: ExecutionItem[],
    options: Required<Pick<ExecutionOptions, 'continueOnError' | 'timeout' | 'sequential' | 'autoApprove'>>
  ): Promise<void> {
    if (options.sequential) {
      await this.executeSequentially(
        executionArray,
        readyItems,
        options.continueOnError,
        options.timeout,
        options.autoApprove
      );
    } else {
      await this.executeParallel(
        executionArray,
        readyItems,
        options.continueOnError,
        options.timeout,
        options.autoApprove
      );
    }
  }
  
  /**
   * Execute batches if enabled
   */
  private async executeBatchesIfEnabled(
    executionArray: ExecutionArray,
    options: Required<Pick<ExecutionOptions, 'allowBatching' | 'timeout' | 'autoApprove'>>
  ): Promise<void> {
    if (options.allowBatching) {
      await this.executeBatches(executionArray, options.timeout, options.autoApprove);
    }
  }
  
  /**
   * Execute items sequentially
   */
  private async executeSequentially(
    executionArray: ExecutionArray,
    items: ExecutionItem[],
    continueOnError: boolean,
    timeout: number,
    autoApprove: boolean
  ): Promise<void> {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      // Check if paused
      const state = executionArray.getState();
      if (state.isPaused) {
        // Wait for resume
        await this.waitForResume(executionArray);
      }
      
      executionArray.setCurrentIndex(item.index);
      executionArray.updateStatus(item.id, 'ready');
      
      try {
        await this.executeItem(executionArray, item, timeout, autoApprove);
      } catch (error) {
        markItemAsFailed(executionArray, item.id, extractErrorMessage(error), 'EXECUTION_FAILED');
        if (!continueOnError) {
          throw error;
        }
      }
    }
  }
  
  /**
   * Execute items in parallel (only for non-extrinsic operations)
   */
  private async executeParallel(
    executionArray: ExecutionArray,
    items: ExecutionItem[],
    continueOnError: boolean,
    timeout: number,
    autoApprove: boolean
  ): Promise<void> {
    // Filter out extrinsics (they must be sequential)
    const extrinsicItems = items.filter(item => item.executionType === 'extrinsic');
    const nonExtrinsicItems = items.filter(item => item.executionType !== 'extrinsic');
    
    // Execute non-extrinsic items in parallel
    const promises = nonExtrinsicItems.map(item =>
      this.executeItem(executionArray, item, timeout, autoApprove).catch(error => {
        markItemAsFailed(executionArray, item.id, extractErrorMessage(error), 'EXECUTION_FAILED');
        if (!continueOnError) {
          throw error;
        }
      })
    );
    
    await Promise.all(promises);
    
    // Execute extrinsic items sequentially
    if (extrinsicItems.length > 0) {
      await this.executeSequentially(
        executionArray,
        extrinsicItems,
        continueOnError,
        timeout,
        autoApprove
      );
    }
  }
  
  /**
   * Execute batches of compatible extrinsics
   */
  private async executeBatches(
    executionArray: ExecutionArray,
    timeout: number,
    autoApprove: boolean
  ): Promise<void> {
    // Filter for extrinsic items - extrinsic may be undefined (executioner will rebuild from metadata)
    const pendingExtrinsics = executionArray
      .getItemsByStatus('pending')
      .filter(item => item.executionType === 'extrinsic');
    
    if (pendingExtrinsics.length < 2) {
      return; // Need at least 2 extrinsics to batch
    }
    
    // Group by chain (all must be on same chain for batching)
    // For now, we'll assume all are on the same chain
    // In the future, we can add chain detection
    
    const batchSize = Math.min(pendingExtrinsics.length, 100); // Polkadot batch limit
    const batch = pendingExtrinsics.slice(0, batchSize);
    
    try {
      await this.executeBatch(executionArray, batch, timeout, autoApprove);
    } catch (error) {
      // If batch fails, fall back to individual execution
    }
  }
  
  /**
   * Execute a single item
   */
  private async executeItem(
    executionArray: ExecutionArray,
    item: ExecutionItem,
    timeout: number,
    autoApprove: boolean
  ): Promise<void> {
    const { agentResult } = item;
    
    switch (agentResult.executionType) {
      case 'extrinsic':
        await this.executeExtrinsic(executionArray, item, timeout, autoApprove);
        break;
      
      case 'data_fetch':
        await this.executeDataFetch(executionArray, item);
        break;
      
      case 'validation':
        await this.executeValidation(executionArray, item);
        break;
      
      case 'user_input':
        await this.executeUserInput(executionArray, item);
        break;
      
      default:
        throw new Error(`Unknown execution type: ${agentResult.executionType}`);
    }
  }
  
  private async executeExtrinsic(
    executionArray: ExecutionArray,
    item: ExecutionItem,
    timeout: number,
    autoApprove: boolean
  ): Promise<void> {
    this.ensureInitialized();
    
    const { extrinsic, apiForExtrinsic } = this.validateExtrinsic(executionArray, item);
    this.prepareItemForSigning(executionArray, item);
    
    if (!(await this.requestApprovalIfNeeded(executionArray, item, extrinsic, autoApprove))) {
      return;
    }

    executionArray.updateStatus(item.id, 'signing');
    
    try {
      const signedExtrinsic = await this.signExtrinsicForItem(extrinsic, apiForExtrinsic);
      await this.broadcastAndFinalize(executionArray, item, signedExtrinsic, apiForExtrinsic, timeout);
    } catch (error) {
      markItemAsFailed(executionArray, item.id, extractErrorMessage(error), 'EXECUTION_FAILED');
      throw error;
    }
  }
  
  /**
   * Validate extrinsic and get API instance
   */
  private validateExtrinsic(
    executionArray: ExecutionArray,
    item: ExecutionItem
  ): { extrinsic: SubmittableExtrinsic<'promise'>; apiForExtrinsic: ApiPromise } {
    const { agentResult } = item;
    if (!agentResult.extrinsic) {
      markItemAsFailedAndThrow(
        executionArray,
        item.id,
        'No extrinsic found in agent result. Agent must create and return an extrinsic.',
        'NO_EXTRINSIC'
      );
    }

    const extrinsic = agentResult.extrinsic;
    const apiForExtrinsic = this.getApiForExtrinsic(extrinsic);

    // Note: getApiForExtrinsic() already matches the extrinsic's registry to the correct API.
    // With execution sessions, we use new API instances, but getApiForExtrinsic() ensures
    // we use the API whose registry matches the extrinsic's registry.

    return { extrinsic, apiForExtrinsic };
  }
  
  /**
   * Prepare item for signing (mark as ready if pending)
   */
  private prepareItemForSigning(executionArray: ExecutionArray, item: ExecutionItem): void {
    // Simulation should have already run during prepareExecution() if enabled.
    // If item is still 'pending' at this point, it means simulation was disabled
    // or skipped - mark as ready to proceed with signing.
    if (item.status === 'pending') {
      executionArray.updateStatus(item.id, 'ready');
    }
  }
  
  /**
   * Request user approval if needed
   */
  private async requestApprovalIfNeeded(
    executionArray: ExecutionArray,
    item: ExecutionItem,
    extrinsic: SubmittableExtrinsic<'promise'>,
    autoApprove: boolean
  ): Promise<boolean> {
    if (autoApprove) {
      return true;
    }

    const signingContext: SigningContext = {
      accountAddress: this.account!.address,
      signer: this.signer,
      signingRequestHandler: this.signingRequestHandler,
    };
    const approved = await createSigningRequest(item, extrinsic, signingContext);
    if (!approved) {
      executionArray.updateStatus(item.id, 'cancelled', 'User rejected transaction');
      return false;
    }
    return true;
  }
  
  /**
   * Sign extrinsic for item
   */
  private async signExtrinsicForItem(
    extrinsic: SubmittableExtrinsic<'promise'>,
    apiForExtrinsic: ApiPromise
  ): Promise<SubmittableExtrinsic<'promise'>> {
    const ss58Format = apiForExtrinsic.registry.chainSS58 || 0;
    const encodedSenderAddress = await encodeAddressForChain(this.account!.address, ss58Format);
    return await signExtrinsic(extrinsic, encodedSenderAddress, this.signer);
  }
  
  /**
   * Broadcast and finalize transaction
   */
  private async broadcastAndFinalize(
    executionArray: ExecutionArray,
    item: ExecutionItem,
    signedExtrinsic: SubmittableExtrinsic<'promise'>,
    apiForExtrinsic: ApiPromise,
    timeout: number
  ): Promise<void> {
    executionArray.updateStatus(item.id, 'broadcasting');
    const result = await broadcastTransaction(signedExtrinsic, apiForExtrinsic, timeout);

    if (result.success) {
      executionArray.updateStatus(item.id, 'finalized');
      executionArray.updateResult(item.id, result);
    } else {
      executionArray.updateStatus(item.id, 'failed', result.error);
      executionArray.updateResult(item.id, result);
      throw new Error(result.error || 'Transaction failed');
    }
  }

  /**
   * Get API instance for extrinsic (public method)
   * 
   * Matches extrinsic's registry to the correct API instance.
   * Used by simulation code to ensure metadata compatibility.
   * 
   * @param extrinsic Extrinsic to match
   * @returns Matching API instance (or relay chain API as fallback)
   */
  public getApiForExtrinsic(extrinsic: SubmittableExtrinsic<'promise'>): ApiPromise {
    if (this.api && this.api.registry === extrinsic.registry) {
      return this.api;
    }
    if (this.assetHubApi && this.assetHubApi.registry === extrinsic.registry) {
      return this.assetHubApi;
    }
    return this.api!;
  }
  
  private async executeBatch(
    executionArray: ExecutionArray,
    items: ExecutionItem[],
    timeout: number,
    autoApprove: boolean
  ): Promise<void> {
    if (!this.api || !this.account) {
      throw new Error('Executioner not initialized');
    }

    const extrinsics = this.validateBatchItems(items, executionArray);
    const apiForBatch = this.getApiForExtrinsic(extrinsics[0]);
    this.validateBatchRegistries(extrinsics, items, executionArray);
    
    if (!apiForBatch.isReady) {
      await apiForBatch.isReady;
    }

    const batchExtrinsic = apiForBatch.tx.utility.batchAll(extrinsics);
    await this.simulateBatchIfEnabled(batchExtrinsic, items, apiForBatch, executionArray);
    
    if (!autoApprove && !(await this.requestBatchApproval(items, batchExtrinsic, executionArray))) {
      return;
    }

    this.updateBatchStatus(items, 'signing', executionArray);

    const ss58Format = apiForBatch.registry.chainSS58 || 0;
    const encodedSenderAddress = await encodeAddressForChain(this.account!.address, ss58Format);
    const signedBatchExtrinsic = await signExtrinsic(batchExtrinsic, encodedSenderAddress, this.signer);

    this.updateBatchStatus(items, 'broadcasting', executionArray);
    const result = await broadcastTransaction(signedBatchExtrinsic, apiForBatch, timeout);
    
    if (result.success) {
      items.forEach(item => {
        executionArray.updateStatus(item.id, 'finalized');
        executionArray.updateResult(item.id, result);
      });
    } else {
      items.forEach(item => {
        executionArray.updateStatus(item.id, 'failed', result.error);
        executionArray.updateResult(item.id, result);
      });
      throw new Error(result.error || 'Batch transaction failed');
    }
  }
  
  /**
   * Validate batch items and extract extrinsics
   */
  private validateBatchItems(
    items: ExecutionItem[],
    executionArray: ExecutionArray
  ): SubmittableExtrinsic<'promise'>[] {
    const extrinsics: SubmittableExtrinsic<'promise'>[] = [];
    for (const item of items) {
      if (!item.agentResult.extrinsic) {
        markItemAsFailedAndThrow(
          executionArray,
          item.id,
          `Item ${item.id} has no extrinsic. Agent must create extrinsic before batching.`,
          'NO_EXTRINSIC_IN_BATCH_ITEM'
        );
      }
      extrinsics.push(item.agentResult.extrinsic);
    }
    return extrinsics;
  }
  
  /**
   * Validate all batch items use the same registry
   */
  private validateBatchRegistries(
    extrinsics: SubmittableExtrinsic<'promise'>[],
    items: ExecutionItem[],
    executionArray: ExecutionArray
  ): void {
    const uniqueRegistries = new Set(extrinsics.map(ext => ext.registry));
    if (uniqueRegistries.size > 1) {
      const errorMessage = `Batch contains extrinsics with different registries. All batch items must use the same chain.`;
      items.forEach(item => {
        markItemAsFailed(executionArray, item.id, errorMessage, 'MIXED_REGISTRIES_IN_BATCH');
      });
      throw new Error(errorMessage);
    }
  }
  
  /**
   * Simulate batch if simulation is enabled
   */
  private async simulateBatchIfEnabled(
    batchExtrinsic: SubmittableExtrinsic<'promise'>,
    items: ExecutionItem[],
    apiForBatch: ApiPromise,
    executionArray: ExecutionArray
  ): Promise<void> {
    if (isSimulationEnabled()) {
      // Note: Executioner doesn't have access to ExecutionSession, so we pass undefined for sessionEndpoint
      // This will fall back to using manager endpoints (legacy behavior)
      const simulationContext = createSimulationContext(
        apiForBatch,
        this.account!.address,
        this.assetHubManager,
        this.relayChainManager,
        undefined, // sessionEndpoint - not available in Executioner context
        this.onStatusUpdate
      );
      for (const item of items) {
        await runSimulation(batchExtrinsic, simulationContext, executionArray, item);
      }
    } else {
      items.forEach(item => {
        executionArray.updateStatus(item.id, 'ready');
      });
    }
  }
  
  /**
   * Request batch approval from user
   */
  private async requestBatchApproval(
    items: ExecutionItem[],
    batchExtrinsic: SubmittableExtrinsic<'promise'>,
    executionArray: ExecutionArray
  ): Promise<boolean> {
    const signingContext: SigningContext = {
      accountAddress: this.account!.address,
      signer: this.signer,
      batchSigningRequestHandler: this.batchSigningRequestHandler,
    };
    const approved = await createBatchSigningRequest(items, batchExtrinsic, signingContext);
    if (!approved) {
      items.forEach(item => {
        executionArray.updateStatus(item.id, 'cancelled', 'User rejected batch transaction');
      });
      return false;
    }
    return true;
  }
  
  /**
   * Update status for all batch items
   */
  private updateBatchStatus(
    items: ExecutionItem[],
    status: ExecutionStatus,
    executionArray: ExecutionArray
  ): void {
    items.forEach(item => {
      executionArray.updateStatus(item.id, status);
    });
  }
  
  /**
   * Execute a data fetch operation
   */
  private async executeDataFetch(
    executionArray: ExecutionArray,
    item: ExecutionItem
  ): Promise<void> {
    // Data fetch operations are already completed when agent returns them
    // Just mark as completed
    executionArray.updateStatus(item.id, 'completed');
    if (item.agentResult.data) {
      executionArray.updateResult(item.id, {
        success: true,
        data: item.agentResult.data,
      });
    }
  }
  
  /**
   * Execute a validation operation
   */
  private async executeValidation(
    executionArray: ExecutionArray,
    item: ExecutionItem
  ): Promise<void> {
    // Validation operations are already completed when agent returns them
    executionArray.updateStatus(item.id, 'completed');
    if (item.agentResult.data) {
      executionArray.updateResult(item.id, {
        success: true,
        data: item.agentResult.data,
      });
    }
  }
  
  /**
   * Execute a user input operation
   */
  private async executeUserInput(
    executionArray: ExecutionArray,
    item: ExecutionItem
  ): Promise<void> {
    // User input operations require external handling
    // For now, we'll mark them as ready and let the UI handle it
    executionArray.updateStatus(item.id, 'ready');
  }
  
  private async waitForResume(executionArray: ExecutionArray): Promise<void> {
    return new Promise<void>((resolve) => {
      const checkResume = () => {
        const state = executionArray.getState();
        if (!state.isPaused) {
          resolve();
        } else {
          setTimeout(checkResume, 100);
        }
      };
      checkResume();
    });
  }

  private ensureInitialized(): void {
    if (!this.api || !this.account) {
      throw new Error('Executioner not initialized. Call initialize() first.');
    }
  }
}

