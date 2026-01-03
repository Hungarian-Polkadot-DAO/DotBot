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
   */
  initialize(
    api: ApiPromise, 
    account: WalletAccount, 
    signer?: Signer, 
    assetHubApi?: ApiPromise | null,
    relayChainManager?: RpcManager | null,
    assetHubManager?: RpcManager | null
  ): void {
    this.api = api;
    this.assetHubApi = assetHubApi || null;
    this.account = account;
    this.signer = signer || null;
    this.relayChainManager = relayChainManager || null;
    this.assetHubManager = assetHubManager || null;
    
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
    const pendingExtrinsics = executionArray
      .getItemsByStatus('pending')
      .filter(item => item.executionType === 'extrinsic' && item.agentResult.extrinsic);
    
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
   * CRITICAL: Uses execution session to lock API instance and prevent metadata mismatches.
   * Rebuilds extrinsic using the exact API that will submit it.
   */
  private async executeExtrinsic(
    executionArray: ExecutionArray,
    item: ExecutionItem,
    timeout: number,
    autoApprove: boolean
  ): Promise<void> {
    const { agentResult } = item;
    
    if (!agentResult.extrinsic) {
      throw new Error('No extrinsic found in agent result');
    }
    
    if (!this.api || !this.account) {
      throw new Error('Executioner not initialized');
    }
    
    // Determine chain from metadata
    const chainType = agentResult.metadata?.chainType as 'assetHub' | 'relay' | undefined;
    
    // If chainType is undefined, try to infer from chain name, otherwise default to relay
    let resolvedChainType: 'assetHub' | 'relay' = chainType || 'relay';
    if (!chainType && agentResult.metadata?.chain) {
      const chainName = String(agentResult.metadata.chain).toLowerCase();
      if (chainName.includes('asset') || chainName.includes('statemint')) {
        resolvedChainType = 'assetHub';
      }
    }
    
    const manager = resolvedChainType === 'assetHub' ? this.assetHubManager : this.relayChainManager;
    
    // Create execution session - locks API instance for transaction lifecycle
    let session: ExecutionSession | null = null;
    let apiForExtrinsic: ApiPromise;
    
    if (manager) {
      // Use execution session from RPC manager (immutable API)
      try {
        session = await manager.createExecutionSession();
        apiForExtrinsic = session.api;
        console.log('[Executioner] Created execution session:', session.endpoint, `(chain: ${resolvedChainType})`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        executionArray.updateStatus(item.id, 'failed', `Failed to create execution session: ${errorMessage}`);
        executionArray.updateResult(item.id, {
          success: false,
          error: `Failed to create execution session: ${errorMessage}`,
          errorCode: 'EXECUTION_SESSION_FAILED',
        });
        throw new Error(`Failed to create execution session: ${errorMessage}`);
      }
    } else {
      // Fallback: use existing API (not ideal, but better than nothing)
      // Warn that we're not using execution session
      apiForExtrinsic = resolvedChainType === 'assetHub' && this.assetHubApi 
        ? this.assetHubApi 
        : this.api;
      console.warn('[Executioner] No RPC manager available, using existing API (no execution session - metadata mismatch risk)');
    }
    
    // Ensure API is ready
    if (!apiForExtrinsic.isReady) {
      await apiForExtrinsic.isReady;
    }
    
    // Check session health before proceeding
    if (session && !(await session.isConnected())) {
      const errorMessage = 'Execution session disconnected before transaction execution';
      executionArray.updateStatus(item.id, 'failed', errorMessage);
      executionArray.updateResult(item.id, {
        success: false,
        error: errorMessage,
        errorCode: 'SESSION_DISCONNECTED',
      });
      throw new Error(errorMessage);
    }
    
    // Rebuild extrinsic using the correct API instance
    // This ensures metadata matches exactly
    const metadata = agentResult.metadata || {};
    let extrinsic: SubmittableExtrinsic<'promise'>;
    
    try {
      // Rebuild based on extrinsic type
      if (metadata.recipient && metadata.amount) {
        // Transfer extrinsic
        // IMPORTANT: amount is stored as string in metadata, must convert to BN
        const { BN } = await import('@polkadot/util');
        const amount = new BN(metadata.amount);
        const keepAlive = metadata.keepAlive === true;
        
        console.log('[Executioner] Rebuilding transfer extrinsic:', {
          recipient: metadata.recipient,
          amount: amount.toString(),
          keepAlive,
          chain: resolvedChainType,
        });
        
        if (keepAlive) {
          extrinsic = apiForExtrinsic.tx.balances.transferKeepAlive(metadata.recipient, amount);
        } else {
          extrinsic = apiForExtrinsic.tx.balances.transferAllowDeath(metadata.recipient, amount);
        }
      } else {
        // Cannot rebuild from metadata - this is a critical error
        // We cannot safely use the original extrinsic as it might have wrong registry
        const errorMessage = 'Cannot rebuild extrinsic from metadata. Missing recipient or amount.';
        console.error('[Executioner] Failed to rebuild extrinsic:', errorMessage);
        executionArray.updateStatus(item.id, 'failed', errorMessage);
        executionArray.updateResult(item.id, {
          success: false,
          error: errorMessage,
          errorCode: 'EXTRINSIC_REBUILD_FAILED',
        });
        throw new Error(errorMessage);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Executioner] Failed to rebuild extrinsic:', errorMessage);
      executionArray.updateStatus(item.id, 'failed', `Failed to rebuild extrinsic: ${errorMessage}`);
      executionArray.updateResult(item.id, {
        success: false,
        error: `Failed to rebuild extrinsic: ${errorMessage}`,
        errorCode: 'EXTRINSIC_REBUILD_FAILED',
      });
      throw new Error(`Failed to rebuild extrinsic: ${errorMessage}`);
    }
    
    // Validate registry match (if session exists)
    if (session) {
      try {
        session.assertSameRegistry(extrinsic);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[Executioner] Registry mismatch detected:', errorMessage);
        executionArray.updateStatus(item.id, 'failed', 'Cross-registry extrinsic detected');
        executionArray.updateResult(item.id, {
          success: false,
          error: errorMessage,
          errorCode: 'CROSS_REGISTRY_EXTRINSIC',
        });
        throw new Error(errorMessage);
      }
    }
    
    console.log('[Executioner] Executing extrinsic:', {
      description: item.description,
      estimatedFee: agentResult.estimatedFee,
      chain: metadata.chain,
      chainType: chainType,
      endpoint: session?.endpoint || 'fallback',
    });
    
    // CRITICAL: SIMULATE THE REBUILT EXTRINSIC BEFORE USER APPROVAL
    // This ensures we test the EXACT extrinsic that will be sent to the network
    executionArray.updateStatus(item.id, 'ready');
    console.log('[Executioner] Simulating rebuilt extrinsic (testing exact transaction that will execute)...');
    
    try {
      // Try Chopsticks simulation first (real runtime validation)
      const { simulateTransaction, isChopsticksAvailable } = await import('../../services/simulation');
      
      if (await isChopsticksAvailable()) {
        console.log('[Executioner] Using Chopsticks for runtime simulation of rebuilt extrinsic...');
        
        // Get RPC endpoints for this chain
        const rpcEndpoints = session?.endpoint || (resolvedChainType === 'assetHub' 
          ? ['wss://polkadot-asset-hub-rpc.polkadot.io', 'wss://statemint-rpc.dwellir.com']
          : ['wss://rpc.polkadot.io', 'wss://polkadot-rpc.dwellir.com']);
        
        // Simulate the REBUILT extrinsic (not the original!)
        const simulationResult = await simulateTransaction(
          apiForExtrinsic,
          rpcEndpoints,
          extrinsic,
          this.account.address,
          // TODO: Pass status callback if needed
        );
        
        if (!simulationResult.success) {
          // Simulation failed - transaction would fail on-chain
          const errorMessage = simulationResult.error || 'Simulation failed';
          console.error('[Executioner] ✗ Chopsticks simulation failed:', errorMessage);
          
          executionArray.updateStatus(item.id, 'failed', 'Transaction simulation failed');
          executionArray.updateResult(item.id, {
            success: false,
            error: `Transaction would fail on-chain: ${errorMessage}`,
            errorCode: 'SIMULATION_FAILED',
            rawError: errorMessage,
          });
          
          throw new Error(`Simulation failed: ${errorMessage}`);
        }
        
        console.log('[Executioner] ✓ Chopsticks simulation passed:', {
          estimatedFee: simulationResult.estimatedFee,
          balanceChanges: simulationResult.balanceChanges.length,
        });
        
      } else {
        // Chopsticks not available - fallback to paymentInfo (basic validation only)
        console.warn('[Executioner] Chopsticks unavailable, using paymentInfo for basic validation...');
        
        const paymentInfo = await extrinsic.paymentInfo(this.account.address);
        console.log('[Executioner] ⚠️ Basic validation passed (runtime not fully tested):', {
          fee: paymentInfo.partialFee.toString(),
          weight: paymentInfo.weight.toString(),
        });
      }
      
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
    
    // Request user signature (unless auto-approve is enabled)
    if (!autoApprove) {
      console.log('[Executioner] Requesting user approval...');
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
      // Final registry check before signing
      if (session) {
        session.assertSameRegistry(extrinsic);
      }
      
      // Sign the transaction using pluggable signer
      const signedExtrinsic = await this.signTransaction(extrinsic, this.account.address);
      console.log('[Executioner] Transaction signed successfully');
      
      // Validate signed extrinsic registry
      if (session) {
        session.assertSameRegistry(signedExtrinsic);
      }
      
      executionArray.updateStatus(item.id, 'broadcasting');
      console.log('[Executioner] Broadcasting transaction...');
      
      // Broadcast and monitor using the session API (immutable)
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
      
      // Check if session died
      if (session && !(await session.isConnected())) {
        executionArray.updateStatus(item.id, 'failed', 'Execution session disconnected. Please retry.');
        executionArray.updateResult(item.id, {
          success: false,
          error: 'Execution session disconnected. The RPC endpoint died during transaction execution.',
          errorCode: 'SESSION_DISCONNECTED',
        });
      } else {
        executionArray.updateStatus(item.id, 'failed', errorMessage);
        executionArray.updateResult(item.id, {
          success: false,
          error: errorMessage,
          errorCode: 'EXECUTION_FAILED',
        });
      }
      throw error;
    }
  }
  
  /**
   * Execute a batch of extrinsics
   * 
   * CRITICAL: Uses execution session to lock API instance and prevent metadata mismatches.
   * Rebuilds all extrinsics using the exact API that will submit them.
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
    
    // Determine chain from first item (all should be on same chain)
    const firstItemChain = items[0]?.agentResult?.metadata?.chainType as 'assetHub' | 'relay' | undefined;
    
    // Resolve chain type (same logic as single extrinsic)
    let resolvedChainType: 'assetHub' | 'relay' = firstItemChain || 'relay';
    if (!firstItemChain && items[0]?.agentResult?.metadata?.chain) {
      const chainName = String(items[0].agentResult.metadata.chain).toLowerCase();
      if (chainName.includes('asset') || chainName.includes('statemint')) {
        resolvedChainType = 'assetHub';
      }
    }
    
    const manager = resolvedChainType === 'assetHub' ? this.assetHubManager : this.relayChainManager;
    
    // Create execution session - locks API instance for batch lifecycle
    let session: ExecutionSession | null = null;
    let apiForBatch: ApiPromise;
    
    if (manager) {
      try {
        session = await manager.createExecutionSession();
        apiForBatch = session.api;
        console.log('[Executioner] Created execution session for batch:', session.endpoint, `(chain: ${resolvedChainType})`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        items.forEach(item => {
          executionArray.updateStatus(item.id, 'failed', `Failed to create execution session: ${errorMessage}`);
          executionArray.updateResult(item.id, {
            success: false,
            error: `Failed to create execution session: ${errorMessage}`,
            errorCode: 'EXECUTION_SESSION_FAILED',
          });
        });
        throw new Error(`Failed to create execution session: ${errorMessage}`);
      }
    } else {
      // Fallback: use existing API
      apiForBatch = resolvedChainType === 'assetHub' && this.assetHubApi 
        ? this.assetHubApi 
        : this.api;
      console.warn('[Executioner] No RPC manager available for batch, using existing API (no execution session - metadata mismatch risk)');
    }
    
    // Ensure API is ready
    if (!apiForBatch.isReady) {
      await apiForBatch.isReady;
    }
    
    // Check session health before proceeding
    if (session && !(await session.isConnected())) {
      const errorMessage = 'Execution session disconnected before batch execution';
      items.forEach(item => {
        executionArray.updateStatus(item.id, 'failed', errorMessage);
        executionArray.updateResult(item.id, {
          success: false,
          error: errorMessage,
          errorCode: 'SESSION_DISCONNECTED',
        });
      });
      throw new Error(errorMessage);
    }
    
    // Rebuild all extrinsics using the correct API
    const rebuiltExtrinsics: SubmittableExtrinsic<'promise'>[] = [];
    const { BN } = await import('@polkadot/util');
    
    for (const item of items) {
      const metadata = item.agentResult.metadata || {};
      
      // Check if this is a batch transfer (has transfers array)
      if (metadata.transfers && Array.isArray(metadata.transfers) && metadata.transfers.length > 0) {
        // Batch transfer - rebuild individual transfers
        for (const transfer of metadata.transfers) {
          if (transfer.recipient && transfer.amount) {
            // IMPORTANT: amount is stored as string, must convert to BN
            const amount = new BN(transfer.amount);
            const extrinsic = apiForBatch.tx.balances.transferAllowDeath(transfer.recipient, amount);
            rebuiltExtrinsics.push(extrinsic);
            
            // Validate registry match
            if (session) {
              session.assertSameRegistry(extrinsic);
            }
          }
        }
      } else if (metadata.recipient && metadata.amount) {
        // Single transfer extrinsic
        // IMPORTANT: amount is stored as string, must convert to BN
        const amount = new BN(metadata.amount);
        const keepAlive = metadata.keepAlive === true;
        const extrinsic = keepAlive
          ? apiForBatch.tx.balances.transferKeepAlive(metadata.recipient, amount)
          : apiForBatch.tx.balances.transferAllowDeath(metadata.recipient, amount);
        rebuiltExtrinsics.push(extrinsic);
        
        // Validate registry match
        if (session) {
          session.assertSameRegistry(extrinsic);
        }
      } else {
        // Cannot rebuild from metadata - fail this item
        const errorMessage = `Cannot rebuild extrinsic from metadata for item ${item.id}. Missing recipient/amount or transfers array.`;
        console.error('[Executioner] Batch item rebuild failed:', errorMessage);
        executionArray.updateStatus(item.id, 'failed', errorMessage);
        executionArray.updateResult(item.id, {
          success: false,
          error: errorMessage,
          errorCode: 'EXTRINSIC_REBUILD_FAILED',
        });
        // Don't add to batch - this item will fail
        continue;
      }
    }
    
    if (rebuiltExtrinsics.length === 0) {
      items.forEach(item => {
        executionArray.updateStatus(item.id, 'failed', 'No valid extrinsics in batch');
      });
      return;
    }
    
    // Create batch extrinsic using correct API
    const batchExtrinsic = apiForBatch.tx.utility.batchAll(rebuiltExtrinsics);
    
    // CRITICAL: SIMULATE THE REBUILT BATCH EXTRINSIC BEFORE USER APPROVAL
    // This ensures we test the EXACT batch that will be sent to the network
    items.forEach(item => {
      executionArray.updateStatus(item.id, 'ready');
    });
    console.log('[Executioner] Simulating rebuilt batch extrinsic (testing exact batch that will execute)...');
    
    try {
      // Try Chopsticks simulation first (real runtime validation)
      const { simulateTransaction, isChopsticksAvailable } = await import('../../services/simulation');
      
      if (await isChopsticksAvailable()) {
        console.log('[Executioner] Using Chopsticks for runtime simulation of rebuilt batch...');
        
        // Get RPC endpoints for this chain
        const rpcEndpoints = session?.endpoint || (resolvedChainType === 'assetHub' 
          ? ['wss://polkadot-asset-hub-rpc.polkadot.io', 'wss://statemint-rpc.dwellir.com']
          : ['wss://rpc.polkadot.io', 'wss://polkadot-rpc.dwellir.com']);
        
        // Simulate the REBUILT batch extrinsic (not the originals!)
        const simulationResult = await simulateTransaction(
          apiForBatch,
          rpcEndpoints,
          batchExtrinsic,
          this.account.address,
          // TODO: Pass status callback if needed
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
          extrinsicsCount: rebuiltExtrinsics.length,
        });
        
      } else {
        // Chopsticks not available - fallback to paymentInfo (basic validation only)
        console.warn('[Executioner] Chopsticks unavailable, using paymentInfo for basic batch validation...');
        
        const paymentInfo = await batchExtrinsic.paymentInfo(this.account.address);
        console.log('[Executioner] ⚠️ Basic batch validation passed (runtime not fully tested):', {
          fee: paymentInfo.partialFee.toString(),
          weight: paymentInfo.weight.toString(),
        });
      }
      
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
    
    // Final registry check
    if (session) {
      session.assertSameRegistry(batchExtrinsic);
    }
    
    // Sign the batch using pluggable signer
    const signedBatchExtrinsic = await this.signTransaction(batchExtrinsic, this.account.address);
    
    // Validate signed batch registry
    if (session) {
      session.assertSameRegistry(signedBatchExtrinsic);
    }
    
    // Update all items to broadcasting
    items.forEach(item => {
      executionArray.updateStatus(item.id, 'broadcasting');
    });
    
    // Broadcast and monitor using the session API (immutable)
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

