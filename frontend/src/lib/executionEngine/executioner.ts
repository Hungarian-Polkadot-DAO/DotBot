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

/**
 * Executioner class
 * 
 * Handles execution of operations from ExecutionArray.
 * Now supports pluggable signing for any environment!
 */
export class Executioner {
  private api: ApiPromise | null = null;
  private account: WalletAccount | null = null;
  private signer: Signer | null = null;
  
  // Backwards compatibility: old browser-specific handlers
  private signingRequestHandler?: (request: SigningRequest) => void;
  private batchSigningRequestHandler?: (request: BatchSigningRequest) => void;
  
  /**
   * Initialize with Polkadot API and account
   * 
   * @param api Polkadot API instance
   * @param account Account info (address, name, etc.)
   * @param signer Optional: Pluggable signer (BrowserWalletSigner, KeyringSigner, custom)
   *               If not provided, uses legacy browser wallet signing
   */
  initialize(api: ApiPromise, account: WalletAccount, signer?: Signer): void {
    this.api = api;
    this.account = account;
    this.signer = signer || null;
    
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
   */
  private async executeExtrinsic(
    executionArray: ExecutionArray,
    item: ExecutionItem,
    timeout: number,
    autoApprove: boolean
  ): Promise<void> {
    const { agentResult } = item;
    const extrinsic = agentResult.extrinsic;
    
    if (!extrinsic) {
      throw new Error('No extrinsic found in agent result');
    }
    
    if (!this.api || !this.account) {
      throw new Error('Executioner not initialized');
    }
    
    // Get the API instance that was used to create this extrinsic
    // If not specified, fall back to the default API
    const apiForExtrinsic = (agentResult.metadata?.apiInstance as ApiPromise) || this.api;
    
    console.log('[Executioner] Executing extrinsic:', {
      description: item.description,
      estimatedFee: agentResult.estimatedFee,
      chain: agentResult.metadata?.chain,
      usingCustomAPI: !!agentResult.metadata?.apiInstance,
    });
    
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
      // Sign the transaction using pluggable signer
      const signedExtrinsic = await this.signTransaction(extrinsic, this.account.address);
      console.log('[Executioner] Transaction signed successfully');
      
      executionArray.updateStatus(item.id, 'broadcasting');
      console.log('[Executioner] Broadcasting transaction...');
      
      // Broadcast and monitor using the correct API
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
      throw error;
    }
  }
  
  /**
   * Execute a batch of extrinsics
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
    
    const extrinsics = items
      .map(item => item.agentResult.extrinsic)
      .filter((ext): ext is SubmittableExtrinsic<'promise'> => ext !== undefined);
    
    if (extrinsics.length === 0) {
      return;
    }
    
    // Create batch extrinsic
    const batchExtrinsic = this.api.tx.utility.batchAll(extrinsics);
    
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
    
    // Sign the batch using pluggable signer
    const signedBatchExtrinsic = await this.signTransaction(batchExtrinsic, this.account.address);
    
    // Update all items to broadcasting
    items.forEach(item => {
      executionArray.updateStatus(item.id, 'broadcasting');
    });
    
    // Broadcast and monitor
    // For batch, use the first item's API (they should all be on the same chain)
    const apiForBatch = (items[0]?.agentResult?.metadata?.apiInstance as ApiPromise) || this.api;
    
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

