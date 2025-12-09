/**
 * Executioner
 * 
 * Executes operations from the ExecutionArray.
 * Handles signing, broadcasting, and monitoring of transactions.
 */

import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { web3FromAddress } from '@polkadot/extension-dapp';
import { ExecutionArray } from './execution-array';
import {
  ExecutionItem,
  ExecutionOptions,
  ExecutionResult,
  SigningRequest,
  BatchSigningRequest,
} from './types';
import { WalletAccount } from '../../types/wallet';

/**
 * Executioner class
 * 
 * Handles execution of operations from ExecutionArray.
 */
export class Executioner {
  private api: ApiPromise | null = null;
  private account: WalletAccount | null = null;
  private signingRequestHandler?: (request: SigningRequest) => void;
  private batchSigningRequestHandler?: (request: BatchSigningRequest) => void;
  
  /**
   * Initialize with Polkadot API and account
   */
  initialize(api: ApiPromise, account: WalletAccount): void {
    this.api = api;
    this.account = account;
  }
  
  /**
   * Set handler for signing requests
   */
  setSigningRequestHandler(handler: (request: SigningRequest) => void): void {
    this.signingRequestHandler = handler;
  }
  
  /**
   * Set handler for batch signing requests
   */
  setBatchSigningRequestHandler(handler: (request: BatchSigningRequest) => void): void {
    this.batchSigningRequestHandler = handler;
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
    
    // Request user signature (unless auto-approve is enabled)
    if (!autoApprove) {
      const approved = await this.requestSignature(item, extrinsic);
      if (!approved) {
        executionArray.updateStatus(item.id, 'cancelled', 'User rejected transaction');
        return;
      }
    }
    
    executionArray.updateStatus(item.id, 'signing');
    
    // Sign the transaction
    const injector = await web3FromAddress(this.account.address);
    await extrinsic.signAsync(this.account.address, {
      signer: injector.signer,
    });
    
    executionArray.updateStatus(item.id, 'broadcasting');
    
    // Broadcast and monitor
    const result = await this.broadcastAndMonitor(extrinsic, timeout);
    
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
    
    // Sign the batch
    const injector = await web3FromAddress(this.account.address);
    await batchExtrinsic.signAsync(this.account.address, {
      signer: injector.signer,
    });
    
    // Update all items to broadcasting
    items.forEach(item => {
      executionArray.updateStatus(item.id, 'broadcasting');
    });
    
    // Broadcast and monitor
    const result = await this.broadcastAndMonitor(batchExtrinsic, timeout);
    
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
    timeout: number
  ): Promise<ExecutionResult> {
    if (!this.api || !this.account) {
      throw new Error('Executioner not initialized');
    }
    
    return new Promise<ExecutionResult>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(new Error('Transaction timeout'));
      }, timeout);
      
      web3FromAddress(this.account!.address)
        .then(injector => {
          extrinsic.signAndSend(
            this.account!.address,
            { signer: injector.signer },
            (result) => {
              if (result.status.isInBlock) {
                // Transaction is in a block
              }
              
              if (result.status.isFinalized) {
                clearTimeout(timeoutHandle);
                
                // Check if transaction succeeded
                const failedEvent = result.events.find(({ event }) => {
                  return this.api!.events.system.ExtrinsicFailed.is(event);
                });
                
                if (failedEvent) {
                  const errorEvent = failedEvent.event.toHuman();
                  resolve({
                    success: false,
                    error: JSON.stringify(errorEvent),
                    errorCode: 'EXTRINSIC_FAILED',
                  });
                } else {
                  // Extract block info
                  const blockHash = result.status.asFinalized.toString();
                  
                  resolve({
                    success: true,
                    txHash: extrinsic.hash.toString(),
                    blockHash,
                    events: result.events.map(e => e.event.toHuman()),
                  });
                }
              }
            }
          ).catch((error: Error) => {
            clearTimeout(timeoutHandle);
            reject(error);
          });
        })
        .catch((error: Error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        });
    });
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
}

