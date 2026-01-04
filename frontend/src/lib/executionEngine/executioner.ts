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
import { web3FromAddress } from '@polkadot/extension-dapp';
import { ExecutionArray } from './executionArray';
import {
  ExecutionItem,
  ExecutionOptions,
  ExecutionResult,
  SigningRequest,
  BatchSigningRequest,
} from './types';
import { WalletAccount } from '../../types/wallet';
import { Signer } from './signers/types';
import { BrowserWalletSigner } from './signers/browserSigner';
import { RpcManager, ExecutionSession } from '../rpcManager';

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
      console.warn('Batch execution failed, falling back to individual execution:', error);
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
  
  /**
   * Execute an extrinsic
   * 
   * SIMPLIFIED: Agent creates extrinsic with session API (correct registry from start).
   * Executioner just simulates, signs, and broadcasts.
   */
  private async executeExtrinsic(
    executionArray: ExecutionArray,
    item: ExecutionItem,
    timeout: number,
    autoApprove: boolean
  ): Promise<void> {
    const { agentResult } = item;
    
    if (!this.api || !this.account) {
      throw new Error('Executioner not initialized');
    }
    
    // Validate that agent provided an extrinsic
    if (!agentResult.extrinsic) {
      const errorMessage = 'No extrinsic found in agent result. Agent must create and return an extrinsic.';
      console.error('[Executioner] Missing extrinsic:', {
        hasExtrinsic: !!agentResult.extrinsic,
        executionType: agentResult.executionType,
        resultType: agentResult.resultType,
        description: agentResult.description,
      });
      executionArray.updateStatus(item.id, 'failed', errorMessage);
      executionArray.updateResult(item.id, {
        success: false,
        error: errorMessage,
        errorCode: 'NO_EXTRINSIC',
      });
      throw new Error(errorMessage);
    }
    
    // Use extrinsic from agent (already has correct registry!)
    const extrinsic = agentResult.extrinsic;
    
    console.log('[Executioner] Using extrinsic from agent:', {
      description: item.description,
      method: `${extrinsic.method.section}.${extrinsic.method.method}`,
    });
    
    // Enhanced debug logging
    try {
      console.log('[Executioner] Extrinsic debug info:', {
        method: `${extrinsic.method.section}.${extrinsic.method.method}`,
        callIndex: Array.from(extrinsic.method.toU8a().slice(0, 2)),
        args: extrinsic.method.args.map((arg: any) => arg.toHuman()),
        toHuman: extrinsic.toHuman(),
      });
    } catch (logError) {
      console.warn('[Executioner] Could not log extrinsic debug info:', logError);
    }
    
    // CRITICAL: Use the API that created the extrinsic!
    // The extrinsic knows which API it came from via its registry
    // We need to find the matching API instance in our executioner
    let apiForExtrinsic: ApiPromise;
    
    // Check which API's registry matches the extrinsic
    if (this.api.registry === extrinsic.registry) {
      apiForExtrinsic = this.api;
      console.log('[Executioner] Using relay chain API (registry match)');
    } else if (this.assetHubApi && this.assetHubApi.registry === extrinsic.registry) {
      apiForExtrinsic = this.assetHubApi;
      console.log('[Executioner] Using Asset Hub API (registry match)');
    } else {
      // Fallback: try to determine from metadata
      console.warn('[Executioner] No exact registry match found, using relay chain API as fallback');
      console.warn('[Executioner] This may cause issues! Agent should use executioner APIs.');
      apiForExtrinsic = this.api;
    }
    
    console.log('[Executioner] Registry validation:', {
      extrinsicRegistryAddr: extrinsic.registry.constructor.name,
      selectedApiRegistryAddr: apiForExtrinsic.registry.constructor.name,
      registryMatch: extrinsic.registry === apiForExtrinsic.registry,
    });
    
    console.log('[Executioner] Executing extrinsic:', {
      description: item.description,
      estimatedFee: agentResult.estimatedFee,
    });
    
    // Check if simulation should be enabled
    // Simulation is OFF by default for fast development
    // TODO: Add configuration option to enable simulation globally or per-execution
    const shouldSimulate = false; // Disabled by default
    
    console.log('[Executioner] 🔍 Simulation setting:', {
      shouldSimulate,
      note: 'Simulation is OFF by default for fast development. Enable by setting shouldSimulate=true.',
    });
    
    if (!shouldSimulate) {
      console.log('[Executioner] ⏭️  SIMULATION DISABLED (default) - Skipping validation, proceeding to user approval');
      // Set item to 'ready' immediately for user approval
      executionArray.updateStatus(item.id, 'ready');
      console.log('[Executioner] Item ready for user approval (no pre-execution simulation)');
    } else {
      // Simulation ENABLED - validate before user approval
      console.log('[Executioner] 🧪 SIMULATION ENABLED - Validating extrinsic before user approval...');
    
    try {
      // Try Chopsticks simulation first (real runtime validation)
      let simulateTransaction: any;
      let isChopsticksAvailable: any;
      
      try {
        const simulationModule = await import('../services/simulation');
        simulateTransaction = simulationModule.simulateTransaction;
        isChopsticksAvailable = simulationModule.isChopsticksAvailable;
        console.log('[Executioner] ✓ Simulation module loaded successfully');
      } catch (importError) {
        const importErrorMessage = importError instanceof Error ? importError.message : String(importError);
        console.error('[Executioner] ✗ Failed to import simulation module:', importErrorMessage);
        throw new Error(`Failed to load simulation module: ${importErrorMessage}`);
      }
      
      if (await isChopsticksAvailable()) {
        console.log('[Executioner] Using Chopsticks for runtime simulation...');
        
        // CRITICAL: Use correct RPC endpoints for the chain!
        // Try to get endpoints from RPC manager first, fallback to hardcoded if not available
        const isAssetHub = apiForExtrinsic.registry.chainSS58 === 0;
        const manager = isAssetHub ? this.assetHubManager : this.relayChainManager;
        
        let rpcEndpoints: string[];
        if (manager) {
          // Get healthy endpoints from manager (prioritizes current endpoint)
          const healthStatus = manager.getHealthStatus();
          const currentEndpoint = manager.getCurrentEndpoint();
          const now = Date.now();
          const failoverTimeout = 5 * 60 * 1000; // 5 minutes
          
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
          
          rpcEndpoints = orderedEndpoints.length > 0 
            ? orderedEndpoints 
            : healthStatus.map(h => h.endpoint);
        } else {
          // Fallback to hardcoded endpoints if no manager
          rpcEndpoints = isAssetHub
            ? ['wss://polkadot-asset-hub-rpc.polkadot.io', 'wss://statemint-rpc.dwellir.com']
            : ['wss://rpc.polkadot.io', 'wss://polkadot-rpc.dwellir.com'];
        }
        
        console.log('[Executioner] Using RPC endpoints for simulation:', {
          chain: isAssetHub ? 'Asset Hub' : 'Relay Chain',
          source: manager ? 'RPC Manager' : 'Hardcoded fallback',
          endpoints: rpcEndpoints,
        });
        
        // Encode sender address for simulation
        const { encodeAddress: encodeAddr, decodeAddress: decodeAddr } = await import('@polkadot/util-crypto');
        const senderPublicKey = decodeAddr(this.account.address);
        const senderSS58Format = apiForExtrinsic.registry.chainSS58 || 0;
        const encodedSender = encodeAddr(senderPublicKey, senderSS58Format);
        
        // Simulate the extrinsic
        const simulationResult = await simulateTransaction(
          apiForExtrinsic,
          rpcEndpoints,
          extrinsic,
          encodedSender,
          this.onStatusUpdate
        );
        
        if (!simulationResult.success) {
          // Simulation failed - transaction would fail on-chain
          const errorMessage = simulationResult.error || 'Simulation failed';
          console.error('[Executioner] ✗ Chopsticks simulation failed:', errorMessage);
          
          // Extract the actual error (remove nested prefixes)
          const cleanError = errorMessage
            .replace(/^Chopsticks simulation failed: /, '')
            .replace(/^Simulation failed: /, '')
            .replace(/^Transaction validation failed: /, '');
          
          executionArray.updateStatus(item.id, 'failed', 'Transaction simulation failed');
          executionArray.updateResult(item.id, {
            success: false,
            error: cleanError, // Use clean error without nested prefixes
            errorCode: 'SIMULATION_FAILED',
            rawError: errorMessage, // Keep full error for debugging
          });
          
          throw new Error(cleanError);
        }
        
        console.log('[Executioner] ✓ Chopsticks simulation passed:', {
          estimatedFee: simulationResult.estimatedFee,
          balanceChanges: simulationResult.balanceChanges.length,
        });
        
      } else {
        // Chopsticks not available - fallback to paymentInfo (basic validation only)
        console.warn('[Executioner] Chopsticks unavailable, using paymentInfo for basic validation...');
        
        try {
          // Encode sender address for this chain before paymentInfo
          const { encodeAddress: encodeAddr, decodeAddress: decodeAddr } = await import('@polkadot/util-crypto');
          const senderPublicKey = decodeAddr(this.account.address);
          const senderSS58Format = apiForExtrinsic.registry.chainSS58 || 0;
          const encodedSenderAddress = encodeAddr(senderPublicKey, senderSS58Format);
          
          const paymentInfo = await extrinsic.paymentInfo(encodedSenderAddress);
          console.log('[Executioner] ⚠️ Basic validation passed (runtime not fully tested):', {
            fee: paymentInfo.partialFee.toString(),
            weight: paymentInfo.weight.toString(),
          });
        } catch (paymentInfoError) {
          // paymentInfo can fail with wasm trap if the extrinsic has structural issues
          const errorMessage = paymentInfoError instanceof Error ? paymentInfoError.message : String(paymentInfoError);
          console.warn('[Executioner] paymentInfo failed (proceeding with caution):', errorMessage);
          console.warn('[Executioner] ⚠️ Transaction structure could not be validated - user should review carefully');
          // Continue without fee estimate - let user decide if they want to proceed
          // The outer try-catch will catch actual execution failures
        }
      }
      
      // Simulation passed - NOW set status to 'ready' so UI can show review
      executionArray.updateStatus(item.id, 'ready');
      console.log('[Executioner] Simulation completed, item ready for user approval');
      
    } catch (error) {
      // Validation failed - fail early before user approval
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorLower = errorMessage.toLowerCase();
      
      // Classify error type
      const isRuntimePanic = 
        errorLower.includes('unreachable') ||
        errorLower.includes('panic') ||
        errorLower.includes('taggedtransactionqueue') ||
        errorLower.includes('transactionpaymentapi') ||
        errorLower.includes('wasm trap');
      
      const isSimulationFailure = errorLower.includes('simulation failed') || errorLower.includes('chopsticks');
      
      console.error('[Executioner] ✗ Transaction validation failed:', errorMessage);
      
      executionArray.updateStatus(
        item.id,
        'failed',
        isRuntimePanic ? 'Runtime panic - invalid transaction shape' : 'Transaction validation failed'
      );
      executionArray.updateResult(item.id, {
        success: false,
        error: isRuntimePanic 
          ? 'Runtime validation panic: Transaction shape is invalid for this chain'
          : isSimulationFailure
            ? `Simulation failed: ${errorMessage}`
            : `Validation failed: ${errorMessage}`,
        errorCode: isRuntimePanic ? 'RUNTIME_VALIDATION_PANIC' : isSimulationFailure ? 'SIMULATION_FAILED' : 'VALIDATION_FAILED',
        rawError: errorMessage,
      });
      
      throw new Error(`Transaction validation failed: ${errorMessage}`);
    }
    } // End of else block - simulation only runs if agent didn't already validate
    
    // Request user signature (unless auto-approve is enabled)
    if (!autoApprove) {
      console.log('[Executioner] 🔐 Requesting user approval for extrinsic:', {
        itemId: item.id,
        description: item.description,
        method: `${extrinsic.method.section}.${extrinsic.method.method}`,
      });
      const approved = await this.requestSignature(item, extrinsic);
      if (!approved) {
        console.log('[Executioner] User rejected transaction');
        executionArray.updateStatus(item.id, 'cancelled', 'User rejected transaction');
        return;
      }
      console.log('[Executioner] User approved transaction');
    }
    
    executionArray.updateStatus(item.id, 'signing');
    console.log('[Executioner] Signing transaction...');
    
    try {
      // Encode sender address for this chain before signing
      const { encodeAddress, decodeAddress } = await import('@polkadot/util-crypto');
      const publicKey = decodeAddress(this.account.address);
      const ss58Format = apiForExtrinsic.registry.chainSS58 || 0;
      const encodedSenderAddress = encodeAddress(publicKey, ss58Format);
      
      console.log('[Executioner] Signing with address:', {
        original: this.account.address,
        encoded: encodedSenderAddress,
        ss58Format,
      });
      
      // Sign the transaction using pluggable signer
      const signedExtrinsic = await this.signTransaction(extrinsic, encodedSenderAddress);
      console.log('[Executioner] Transaction signed successfully');
      
      executionArray.updateStatus(item.id, 'broadcasting');
      console.log('[Executioner] Broadcasting transaction...');
      
      // Broadcast and monitor
      const result = await this.broadcastAndMonitor(signedExtrinsic, timeout, apiForExtrinsic, true);
      
      if (result.success) {
        console.log('[Executioner] ✓ Transaction successful:', result.txHash);
        executionArray.updateStatus(item.id, 'finalized');
        executionArray.updateResult(item.id, result);
      } else {
        console.error('[Executioner] ✗ Transaction failed:', result.error);
        executionArray.updateStatus(item.id, 'failed', result.error);
        executionArray.updateResult(item.id, result);
        throw new Error(result.error || 'Transaction failed');
      }
    } catch (error) {
      console.error('[Executioner] Error during transaction execution:', error);
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
  
  /**
   * Execute a batch of extrinsics
   * 
   * SIMPLIFIED: Agents create extrinsics directly. Executioner uses them and batches them together.
   * Uses registry matching to find the correct API for the batch.
   */
  private async executeBatch(
    executionArray: ExecutionArray,
    items: ExecutionItem[],
    timeout: number,
    autoApprove: boolean
  ): Promise<void> {
    if (!this.api || !this.account) {
      throw new Error('Executioner not initialized');
    }
    
    console.log('[Executioner] Batching multiple items:', {
      itemCount: items.length,
      items: items.map(item => ({
        id: item.id,
        description: item.description,
        hasExtrinsic: !!item.agentResult.extrinsic,
      })),
    });
    
    // Validate all items have extrinsics (agents should have created them)
    const extrinsics: SubmittableExtrinsic<'promise'>[] = [];
    for (const item of items) {
      if (!item.agentResult.extrinsic) {
        const errorMessage = `Item ${item.id} has no extrinsic. Agent must create extrinsic before batching.`;
        console.error('[Executioner] Batch item missing extrinsic:', errorMessage);
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
    
    // Find the API that matches the first extrinsic's registry
    const firstExtrinsic = extrinsics[0];
    let apiForBatch: ApiPromise;
    
    if (this.api.registry === firstExtrinsic.registry) {
      apiForBatch = this.api;
      console.log('[Executioner] Using relay chain API for batch (registry match)');
    } else if (this.assetHubApi && this.assetHubApi.registry === firstExtrinsic.registry) {
      apiForBatch = this.assetHubApi;
      console.log('[Executioner] Using Asset Hub API for batch (registry match)');
    } else {
      // Fallback: use relay chain API
      console.warn('[Executioner] No exact registry match for batch, using relay chain API as fallback');
      apiForBatch = this.api;
    }
    
    // Validate all extrinsics have the same registry (required for batching)
    const uniqueRegistries = new Set(extrinsics.map(ext => ext.registry));
    if (uniqueRegistries.size > 1) {
      const errorMessage = `Batch contains extrinsics with different registries. All batch items must use the same chain.`;
      console.error('[Executioner] Batch registry validation failed:', errorMessage);
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
    
    console.log('[Executioner] ✓ Batch registry validated:', {
      registryMatch: apiForBatch.registry === firstExtrinsic.registry,
      extrinsicCount: extrinsics.length,
    });
    
    // Ensure API is ready
    if (!apiForBatch.isReady) {
      await apiForBatch.isReady;
    }
    
    // Create batch extrinsic using the matched API
    const batchExtrinsic = apiForBatch.tx.utility.batchAll(extrinsics);
    
    // CRITICAL: SIMULATE THE BATCH EXTRINSIC BEFORE USER APPROVAL
    // This ensures we test the EXACT batch that will be sent to the network
    // DON'T set status to 'ready' yet - wait until simulation passes
    console.log('[Executioner] Simulating batch extrinsic (testing exact batch that will execute)...');
    
    try {
      // Try Chopsticks simulation first (real runtime validation)
      let simulateTransaction: any;
      let isChopsticksAvailable: any;
      
      try {
        const simulationModule = await import('../services/simulation');
        simulateTransaction = simulationModule.simulateTransaction;
        isChopsticksAvailable = simulationModule.isChopsticksAvailable;
        console.log('[Executioner] ✓ Simulation module loaded successfully for batch');
      } catch (importError) {
        const importErrorMessage = importError instanceof Error ? importError.message : String(importError);
        console.error('[Executioner] ✗ Failed to import simulation module for batch:', importErrorMessage);
        throw new Error(`Failed to load simulation module: ${importErrorMessage}`);
      }
      
      if (await isChopsticksAvailable()) {
        console.log('[Executioner] Using Chopsticks for batch runtime simulation...');
        
        // CRITICAL: Use correct RPC endpoints for the chain!
        // Try to get endpoints from RPC manager first, fallback to hardcoded if not available
        const isAssetHub = apiForBatch.registry.chainSS58 === 0;
        const manager = isAssetHub ? this.assetHubManager : this.relayChainManager;
        
        let rpcEndpoints: string[];
        if (manager) {
          // Get healthy endpoints from manager (prioritizes current endpoint)
          const healthStatus = manager.getHealthStatus();
          const currentEndpoint = manager.getCurrentEndpoint();
          const now = Date.now();
          const failoverTimeout = 5 * 60 * 1000; // 5 minutes
          
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
          
          rpcEndpoints = orderedEndpoints.length > 0 
            ? orderedEndpoints 
            : healthStatus.map(h => h.endpoint);
        } else {
          // Fallback to hardcoded endpoints if no manager
          rpcEndpoints = isAssetHub
            ? ['wss://polkadot-asset-hub-rpc.polkadot.io', 'wss://statemint-rpc.dwellir.com']
            : ['wss://rpc.polkadot.io', 'wss://polkadot-rpc.dwellir.com'];
        }
        
        console.log('[Executioner] Using RPC endpoints for batch simulation:', {
          chain: isAssetHub ? 'Asset Hub' : 'Relay Chain',
          source: manager ? 'RPC Manager' : 'Hardcoded fallback',
          endpoints: rpcEndpoints,
        });
        
        // Encode sender address for batch simulation
        const { encodeAddress: encodeAddr, decodeAddress: decodeAddr } = await import('@polkadot/util-crypto');
        const senderPublicKey = decodeAddr(this.account.address);
        const senderSS58Format = apiForBatch.registry.chainSS58 || 0;
        const encodedSender = encodeAddr(senderPublicKey, senderSS58Format);
        
        // Simulate the batch extrinsic
        const simulationResult = await simulateTransaction(
          apiForBatch,
          rpcEndpoints,
          batchExtrinsic,
          encodedSender,
          this.onStatusUpdate
        );
        
        if (!simulationResult.success) {
          // Simulation failed - batch would fail on-chain
          const errorMessage = simulationResult.error || 'Batch simulation failed';
          console.error('[Executioner] ✗ Batch Chopsticks simulation failed:', errorMessage);
          
          items.forEach(item => {
            executionArray.updateStatus(item.id, 'failed', 'Batch simulation failed');
            executionArray.updateResult(item.id, {
              success: false,
              error: `Batch would fail on-chain: ${errorMessage}`,
              errorCode: 'BATCH_SIMULATION_FAILED',
              rawError: errorMessage,
            });
          });
          
          throw new Error(`Batch simulation failed: ${errorMessage}`);
        }
        
        console.log('[Executioner] ✓ Batch Chopsticks simulation passed:', {
          estimatedFee: simulationResult.estimatedFee,
          extrinsicsCount: extrinsics.length,
        });
        
      } else {
        // Chopsticks not available - fallback to paymentInfo (basic validation only)
        console.warn('[Executioner] Chopsticks unavailable, using paymentInfo for basic batch validation...');
        
        try {
          const paymentInfo = await batchExtrinsic.paymentInfo(this.account.address);
          console.log('[Executioner] ⚠️ Basic batch validation passed (runtime not fully tested):', {
            fee: paymentInfo.partialFee.toString(),
            weight: paymentInfo.weight.toString(),
          });
        } catch (paymentInfoError) {
          // paymentInfo can fail with wasm trap if the batch extrinsic has structural issues
          const errorMessage = paymentInfoError instanceof Error ? paymentInfoError.message : String(paymentInfoError);
          console.warn('[Executioner] Batch paymentInfo failed (proceeding with caution):', errorMessage);
          console.warn('[Executioner] ⚠️ Batch transaction structure could not be validated - user should review carefully');
          // Continue without fee estimate - let user decide if they want to proceed
          // The outer try-catch will catch actual execution failures
        }
      }
      
      // Simulation passed - NOW set status to 'ready' so UI can show review
      items.forEach(item => {
        executionArray.updateStatus(item.id, 'ready');
      });
      console.log('[Executioner] Batch simulation completed, items ready for user approval');
      
    } catch (error) {
      // Validation failed - fail early before user approval
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorLower = errorMessage.toLowerCase();
      
      // Classify error type
      const isRuntimePanic = 
        errorLower.includes('unreachable') ||
        errorLower.includes('panic') ||
        errorLower.includes('taggedtransactionqueue') ||
        errorLower.includes('transactionpaymentapi') ||
        errorLower.includes('wasm trap');
      
      const isSimulationFailure = errorLower.includes('simulation failed') || errorLower.includes('chopsticks');
      
      console.error('[Executioner] ✗ Batch validation failed:', errorMessage);
      
      items.forEach(item => {
        executionArray.updateStatus(
          item.id,
          'failed',
          isRuntimePanic ? 'Runtime panic - invalid batch shape' : 'Batch validation failed'
        );
        executionArray.updateResult(item.id, {
          success: false,
          error: isRuntimePanic 
            ? 'Runtime validation panic: Batch transaction shape is invalid'
            : isSimulationFailure
              ? `Batch simulation failed: ${errorMessage}`
              : `Batch validation failed: ${errorMessage}`,
          errorCode: isRuntimePanic ? 'RUNTIME_VALIDATION_PANIC' : isSimulationFailure ? 'BATCH_SIMULATION_FAILED' : 'BATCH_VALIDATION_FAILED',
          rawError: errorMessage,
        });
      });
      
      throw new Error(`Batch validation failed: ${errorMessage}`);
    }
    
    // Request user signature for batch
    if (!autoApprove) {
      const approved = await this.requestBatchSignature(items, batchExtrinsic);
      if (!approved) {
        items.forEach(item => {
          executionArray.updateStatus(item.id, 'cancelled', 'User rejected batch transaction');
        });
        return;
      }
    }
    
    // Update all items to signing
    items.forEach(item => {
      executionArray.updateStatus(item.id, 'signing');
    });
    
    // Encode sender address for this chain before signing
    const { encodeAddress, decodeAddress } = await import('@polkadot/util-crypto');
    const publicKey = decodeAddress(this.account.address);
    const ss58Format = apiForBatch.registry.chainSS58 || 0;
    const encodedSenderAddress = encodeAddress(publicKey, ss58Format);
    
    console.log('[Executioner] Signing batch with address:', {
      original: this.account.address,
      encoded: encodedSenderAddress,
      ss58Format,
      registryMatch: batchExtrinsic.registry === apiForBatch.registry,
    });
    
    // Sign the batch using pluggable signer
    const signedBatchExtrinsic = await this.signTransaction(batchExtrinsic, encodedSenderAddress);
    
    // Update all items to broadcasting
    items.forEach(item => {
      executionArray.updateStatus(item.id, 'broadcasting');
    });
    
    // Broadcast and monitor using the matched API
    const result = await this.broadcastAndMonitor(signedBatchExtrinsic, timeout, apiForBatch, true);
    
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
  
  /**
   * Request user signature for a transaction
   */
  private async requestSignature(
    item: ExecutionItem,
    extrinsic: SubmittableExtrinsic<'promise'>
  ): Promise<boolean> {
    if (!this.account) {
      throw new Error('No account set');
    }
    
    // Use pluggable signer if available
    if (this.signer && this.signer.requestApproval) {
      const request: SigningRequest = {
        itemId: item.id,
        extrinsic,
        description: item.description,
        estimatedFee: item.estimatedFee,
        warnings: item.warnings,
        metadata: item.metadata,
        accountAddress: this.account.address,
        resolve: () => {}, // Not used with pluggable signer
      };
      return await this.signer.requestApproval(request);
    }
    
    // Legacy: use signing request handler
    if (!this.signingRequestHandler) {
      throw new Error('No signing request handler set');
    }
    
    return new Promise<boolean>((resolve) => {
      const request: SigningRequest = {
        itemId: item.id,
        extrinsic,
        description: item.description,
        estimatedFee: item.estimatedFee,
        warnings: item.warnings,
        metadata: item.metadata,
        accountAddress: this.account!.address,
        resolve: (approved: boolean) => {
          resolve(approved);
        },
      };
      
      this.signingRequestHandler!(request);
    });
  }
  
  /**
   * Request user signature for a batch transaction
   */
  private async requestBatchSignature(
    items: ExecutionItem[],
    batchExtrinsic: SubmittableExtrinsic<'promise'>
  ): Promise<boolean> {
    if (!this.account) {
      throw new Error('No account set');
    }
    
    if (!this.batchSigningRequestHandler) {
      throw new Error('No batch signing request handler set');
    }
    
    return new Promise<boolean>((resolve) => {
      // Calculate total fee
      const totalFee = items.reduce((sum, item) => {
        if (item.estimatedFee) {
          return sum + BigInt(item.estimatedFee);
        }
        return sum;
      }, BigInt(0)).toString();
      
      // Collect all warnings
      const warnings = items
        .flatMap(item => item.warnings || [])
        .filter((w, i, arr) => arr.indexOf(w) === i); // Unique warnings
      
      const request: BatchSigningRequest = {
        itemIds: items.map(item => item.id),
        extrinsic: batchExtrinsic,
        descriptions: items.map(item => item.description),
        estimatedFee: totalFee,
        warnings: warnings.length > 0 ? warnings : undefined,
        accountAddress: this.account!.address,
        resolve: (approved: boolean) => {
          resolve(approved);
        },
      };
      
      this.batchSigningRequestHandler!(request);
    });
  }
  
  /**
   * Broadcast transaction and monitor status
   */
  private async broadcastAndMonitor(
    extrinsic: SubmittableExtrinsic<'promise'>,
    timeout: number,
    apiToUse?: ApiPromise,
    alreadySigned?: boolean
  ): Promise<ExecutionResult> {
    if (!this.api || !this.account) {
      throw new Error('Executioner not initialized');
    }
    
    // Use the provided API or fall back to default
    const api = apiToUse || this.api;
    
    console.log('[Executioner] Broadcasting with API:', apiToUse ? 'custom' : 'default');
    
    return new Promise<ExecutionResult>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        console.error('[Executioner] Transaction timeout');
        reject(new Error('Transaction timeout'));
      }, timeout);
      
      try {
        // If already signed, just send it. Otherwise, sign and send.
        if (alreadySigned) {
          console.log('[Executioner] Sending pre-signed transaction...');
          extrinsic.send((result) => {
            this.handleTransactionResult(result, api, extrinsic, timeoutHandle, resolve);
          }).catch((error: Error) => {
            clearTimeout(timeoutHandle);
            console.error('[Executioner] Broadcast error:', error);
            reject(error);
          });
        } else {
          console.log('[Executioner] Signing and sending transaction...');
          this.signAndSendTransaction(extrinsic, this.account!.address, (result) => {
            this.handleTransactionResult(result, api, extrinsic, timeoutHandle, resolve);
          }).catch((error: Error) => {
            clearTimeout(timeoutHandle);
            console.error('[Executioner] Sign and send error:', error);
            reject(error);
          });
        }
      } catch (error) {
        clearTimeout(timeoutHandle);
        console.error('[Executioner] Unexpected error in broadcastAndMonitor:', error);
        reject(error);
      }
    });
  }
  
  /**
   * Handle transaction result
   */
  private handleTransactionResult(
    result: any,
    api: ApiPromise,
    extrinsic: SubmittableExtrinsic<'promise'>,
    timeoutHandle: NodeJS.Timeout,
    resolve: (value: ExecutionResult) => void
  ): void {
        if (result.status.isInBlock) {
          console.log('[Executioner] Transaction included in block:', result.status.asInBlock.toHex().slice(0, 10) + '...');
        }
        
        if (result.status.isFinalized) {
          clearTimeout(timeoutHandle);
          const blockHash = result.status.asFinalized.toString();
          console.log('[Executioner] Transaction finalized in block:', blockHash.slice(0, 10) + '...');
          
          // Check if transaction succeeded (use the correct API)
          const failedEvent = result.events.find(({ event }: any) => {
            return api.events.system.ExtrinsicFailed.is(event);
          });
          
          if (failedEvent) {
            const errorEvent = failedEvent.event.toHuman();
            console.error('[Executioner] ✗ Extrinsic failed:', errorEvent);
            
            // Try to extract detailed error information
            const { event } = failedEvent;
            let errorDetails = 'Transaction failed';
            
            if (event.data && event.data.length > 0) {
              const dispatchError = event.data[0];
              
              if (dispatchError.isModule) {
                try {
                  const decoded = api.registry.findMetaError(dispatchError.asModule);
                  errorDetails = `${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`;
                  console.error('[Executioner] Error details:', errorDetails);
                } catch (e) {
                  console.error('[Executioner] Could not decode error:', e);
                }
              }
            }
            
            resolve({
              success: false,
              error: errorDetails,
              errorCode: 'EXTRINSIC_FAILED',
              rawError: JSON.stringify(errorEvent),
            });
          } else {
            console.log('[Executioner] ✓ Transaction succeeded');
            console.log('[Executioner] Events:', result.events.length);
            
            resolve({
              success: true,
              txHash: extrinsic.hash.toString(),
              blockHash,
              events: result.events.map((e: any) => e.event.toHuman()),
            });
          }
        }
        
        // Handle invalid/dropped transactions
        if (result.status.isInvalid || result.status.isDropped || result.status.isUsurped) {
          clearTimeout(timeoutHandle);
          const statusType = result.status.isInvalid ? 'Invalid' : 
                           result.status.isDropped ? 'Dropped' : 'Usurped';
          console.error(`[Executioner] ✗ Transaction ${statusType}`);
          resolve({
            success: false,
            error: `Transaction ${statusType}`,
            errorCode: statusType.toUpperCase(),
          });
        }
  }
  
  /**
   * Wait for execution array to resume
   */
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
  
  /**
   * Ensure executioner is initialized
   */
  private ensureInitialized(): void {
    if (!this.api || !this.account) {
      throw new Error('Executioner not initialized. Call initialize() first.');
    }
  }
  
  /**
   * Sign transaction using pluggable signer
   */
  private async signTransaction(
    extrinsic: SubmittableExtrinsic<'promise'>,
    address: string
  ): Promise<SubmittableExtrinsic<'promise'>> {
    // If custom signer is provided, use it
    if (this.signer) {
      return await this.signer.signExtrinsic(extrinsic, address);
    }
    
    // Legacy: fall back to browser wallet
    const injector = await web3FromAddress(address);
    return await extrinsic.signAsync(address, {
      // @ts-expect-error - Polkadot.js type mismatch between @polkadot/extension-inject and @polkadot/api versions
      signer: injector.signer,
    });
  }
  
  /**
   * Sign and send transaction using pluggable signer
   */
  private async signAndSendTransaction(
    extrinsic: SubmittableExtrinsic<'promise'>,
    address: string,
    callback: (result: any) => void
  ): Promise<void> {
    // If custom signer is provided, sign first then send
    if (this.signer) {
      const signedExtrinsic = await this.signer.signExtrinsic(extrinsic, address);
      return new Promise((resolve, reject) => {
        signedExtrinsic.send((result) => {
          callback(result);
          if (result.status.isFinalized || result.status.isInvalid) {
            resolve();
          }
        }).catch(reject);                                                                                                                                                                                                                                 
      });
    }
    
    // Legacy: fall back to browser wallet
    const injector = await web3FromAddress(address);
    return new Promise((resolve, reject) => {
      extrinsic.signAndSend(
        address,
        // @ts-expect-error - Polkadot.js type mismatch between @polkadot/extension-inject and @polkadot/api versions
        { signer: injector.signer },
        (result) => {
          callback(result);
          if (result.status.isFinalized || result.status.isInvalid) {
            resolve();
          }
        }
      ).catch(reject);
    });
  }
  
  /**
   * Request approval using pluggable signer
   */
  private async requestApprovalViaSigner(request: SigningRequest): Promise<boolean> {
    if (this.signer && this.signer.requestApproval) {
      return await this.signer.requestApproval(request);
    }
    
    // Legacy: use handler
    return await this.requestSignature(null as any, request.extrinsic);
  }
}

