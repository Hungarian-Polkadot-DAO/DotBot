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
  ExecutionResult,
  SigningRequest,
  BatchSigningRequest,
} from './types';
import { WalletAccount } from '../types/wallet';
import { Signer } from './signers/types';
import { BrowserWalletSigner } from './signers/browserSigner';
import { RpcManager } from '../rpcManager';
import { shouldSimulate, runSimulation, SimulationContext } from './simulation/executionSimulator';
import {
  createSigningRequest,
  createBatchSigningRequest,
  signExtrinsic,
  encodeAddressForChain,
  SigningContext,
} from './signing/executionSigner';
import { broadcastTransaction } from './broadcasting/executionBroadcaster';

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
    
    const {
      continueOnError = false,
      allowBatching = true,
      timeout = 300000, // 5 minutes default
      sequential = true,
      autoApprove = false,
    } = options;
    
    executionArray.setExecuting(true);
    
    try {
      const readyItems = executionArray.getReadyItems();
      
      if (readyItems.length === 0) {
        executionArray.setExecuting(false);
        return;
      }
      
      if (sequential) {
        // Execute sequentially
        await this.executeSequentially(
          executionArray,
          readyItems,
          continueOnError,
          timeout,
          autoApprove
        );
      } else {
        // Execute in parallel (only for non-extrinsic operations)
        await this.executeParallel(
          executionArray,
          readyItems,
          continueOnError,
          timeout,
          autoApprove
        );
      }
      
      // Check if we can batch any remaining extrinsics
      if (allowBatching) {
        await this.executeBatches(executionArray, timeout, autoApprove);
      }
      
    } finally {
      executionArray.setExecuting(false);
      executionArray.notifyCompletion();
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
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        executionArray.updateStatus(item.id, 'failed', errorMessage);
        
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
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        executionArray.updateStatus(item.id, 'failed', errorMessage);
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
    if (!this.api || !this.account) {
      throw new Error('Executioner not initialized');
    }

    const { agentResult } = item;
    if (!agentResult.extrinsic) {
      const errorMessage = 'No extrinsic found in agent result. Agent must create and return an extrinsic.';
      executionArray.updateStatus(item.id, 'failed', errorMessage);
      executionArray.updateResult(item.id, {
        success: false,
        error: errorMessage,
        errorCode: 'NO_EXTRINSIC',
      });
      throw new Error(errorMessage);
    }

    const extrinsic = agentResult.extrinsic;
    const apiForExtrinsic = this.getApiForExtrinsic(extrinsic);

    if (shouldSimulate()) {
      const simulationContext: SimulationContext = {
        api: apiForExtrinsic,
        accountAddress: this.account.address,
        assetHubManager: this.assetHubManager,
        relayChainManager: this.relayChainManager,
        onStatusUpdate: this.onStatusUpdate,
      };
      await runSimulation(extrinsic, simulationContext, executionArray, item);
    } else {
      executionArray.updateStatus(item.id, 'ready');
    }

    if (!autoApprove) {
      const signingContext: SigningContext = {
        accountAddress: this.account.address,
        signer: this.signer,
        signingRequestHandler: this.signingRequestHandler,
      };
      const approved = await createSigningRequest(item, extrinsic, signingContext);
      if (!approved) {
        executionArray.updateStatus(item.id, 'cancelled', 'User rejected transaction');
        return;
      }
    }

    executionArray.updateStatus(item.id, 'signing');

    try {
      const ss58Format = apiForExtrinsic.registry.chainSS58 || 0;
      const encodedSenderAddress = await encodeAddressForChain(this.account.address, ss58Format);
      const signedExtrinsic = await signExtrinsic(extrinsic, encodedSenderAddress, this.signer);

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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      executionArray.updateStatus(item.id, 'failed', errorMessage);
      executionArray.updateResult(item.id, {
        success: false,
        error: errorMessage,
        errorCode: 'EXECUTION_FAILED',
      });
      throw error;
    }
  }

  private getApiForExtrinsic(extrinsic: SubmittableExtrinsic<'promise'>): ApiPromise {
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

    const extrinsics: SubmittableExtrinsic<'promise'>[] = [];
    for (const item of items) {
      if (!item.agentResult.extrinsic) {
        const errorMessage = `Item ${item.id} has no extrinsic. Agent must create extrinsic before batching.`;
        executionArray.updateStatus(item.id, 'failed', errorMessage);
        executionArray.updateResult(item.id, {
          success: false,
          error: errorMessage,
          errorCode: 'NO_EXTRINSIC_IN_BATCH_ITEM',
        });
        throw new Error(errorMessage);
      }
      extrinsics.push(item.agentResult.extrinsic);
    }

    const firstExtrinsic = extrinsics[0];
    const apiForBatch = this.getApiForExtrinsic(firstExtrinsic);

    const uniqueRegistries = new Set(extrinsics.map(ext => ext.registry));
    if (uniqueRegistries.size > 1) {
      const errorMessage = `Batch contains extrinsics with different registries. All batch items must use the same chain.`;
      items.forEach(item => {
        executionArray.updateStatus(item.id, 'failed', 'Mixed registries in batch');
        executionArray.updateResult(item.id, {
          success: false,
          error: errorMessage,
          errorCode: 'MIXED_REGISTRIES_IN_BATCH',
        });
      });
      throw new Error(errorMessage);
    }

    if (!apiForBatch.isReady) {
      await apiForBatch.isReady;
    }

    const batchExtrinsic = apiForBatch.tx.utility.batchAll(extrinsics);

    if (shouldSimulate()) {
      const simulationContext: SimulationContext = {
        api: apiForBatch,
        accountAddress: this.account.address,
        assetHubManager: this.assetHubManager,
        relayChainManager: this.relayChainManager,
        onStatusUpdate: this.onStatusUpdate,
      };
      for (const item of items) {
        await runSimulation(batchExtrinsic, simulationContext, executionArray, item);
      }
    } else {
      items.forEach(item => {
        executionArray.updateStatus(item.id, 'ready');
      });
    }
    
    if (!autoApprove) {
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
        return;
      }
    }

    items.forEach(item => {
      executionArray.updateStatus(item.id, 'signing');
    });

    const ss58Format = apiForBatch.registry.chainSS58 || 0;
    const encodedSenderAddress = await encodeAddressForChain(this.account!.address, ss58Format);
    const signedBatchExtrinsic = await signExtrinsic(batchExtrinsic, encodedSenderAddress, this.signer);

    items.forEach(item => {
      executionArray.updateStatus(item.id, 'broadcasting');
    });

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

