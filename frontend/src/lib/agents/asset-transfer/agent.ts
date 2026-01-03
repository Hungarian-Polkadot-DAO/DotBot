/**
 * Asset Transfer Agent
 * 
 * Creates extrinsics for transferring assets (DOT, tokens) across chains.
 * Handles standard transfers, keep-alive transfers, and batch transfers.
 */

import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { BaseAgent } from '../baseAgent';
import { AgentResult, AgentError, DryRunResult, SimulationStatusCallback } from '../types';
import { TransferParams, BatchTransferParams } from './types';
import { createTransferExtrinsic } from './extrinsics/transfer';
import { createTransferKeepAliveExtrinsic } from './extrinsics/transferKeepAlive';
import { createBatchTransferExtrinsic } from './extrinsics/batchTransfer';
import { BN } from '@polkadot/util';
import { 
  analyzeError, 
  getRetryStrategy, 
  formatErrorForUser,
  ErrorAnalysis 
} from '../errorAnalyzer';

/**
 * Agent for handling asset transfers
 * 
 * @example
 * const agent = new AssetTransferAgent();
 * agent.initialize(api);
 * const result = await agent.transfer({
 *   address: '1A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P7Q8R9S0T1U2V3W4X5Y6Z7A8B9C0D1',
 *   recipient: '1Z9B8C7D6E5F4G3H2I1J0K9L8M7N6O5P4Q3R2S1T0U9V8W7X6Y5Z4A3B2C1',
 *   amount: '1.5', // 1.5 DOT (will be converted to Planck)
 * });
 */
export class AssetTransferAgent extends BaseAgent {
  getAgentName(): string {
    return 'AssetTransferAgent';
  }

  /**
   * Transfer DOT or tokens
   * 
   * ROBUST FLOW with comprehensive retry:
   * 1. Validate addresses and amount (fail fast on user errors)
   * 2. Try simulation with intelligent retry:
   *    - Reviews ALL adjustable parameters (chain, keepAlive, etc.)
   *    - Analyzes errors (user error vs configuration error)
   *    - Systematically tries different combinations
   *    - Does NOT change user intent (amount, recipient, sender)
   * 3. Check balance on successful configuration
   * 4. Final validation (amount + fees)
   * 5. Return validated extrinsic with correct API and parameters
   * 
   * @param params Transfer parameters
   * @returns AgentResult with transfer extrinsic
   */
  async transfer(params: TransferParams): Promise<AgentResult> {
    this.ensureInitialized();

    // Transfer request received

    try {
      // Step 1: Validate addresses (fail fast on user errors)
      this.validateTransferAddresses(params.address, params.recipient);
      const amountBN = this.parseAndValidateAmount(params.amount);
      const keepAlive = params.keepAlive === true;
      
      // Step 2: Robust dry-run with retry logic
      // Ensure addresses are in SS58 format
      const senderAddress = this.ensurePolkadotAddress(params.address);
      const recipientAddress = this.ensurePolkadotAddress(params.recipient);
      
      const { dryRun, api, extrinsic, chainName, keepAlive: finalKeepAlive, attemptLog } = await this.dryRunWithRetry(
        { 
          address: senderAddress, 
          chain: params.chain,
          keepAlive: keepAlive,
          recipient: recipientAddress,
          amount: amountBN,
          onStatusUpdate: params.onSimulationStatus
        },
        (apiInstance, keepAliveFlag) => this.createTransferExtrinsic(apiInstance, recipientAddress, amountBN, keepAliveFlag)
      );
      
      // Step 3: Check balance on the successful chain
      const targetChain = chainName === 'Asset Hub' ? 'assetHub' : 'relay';
      const balance = await this.getBalanceOnChain(targetChain, senderAddress);
      
      // Step 4: Validate balance (amount + fees on successful chain)
      const estimatedFeeBN = new BN(dryRun.estimatedFee);
      const totalRequired = amountBN.add(estimatedFeeBN);
      const availableBN = new BN(balance.available);
      
      if (params.validateBalance !== false && availableBN.lt(totalRequired)) {
        throw new AgentError(
          `Insufficient balance on ${chainName}. Available: ${this.formatAmount(availableBN)} DOT, Required: ${this.formatAmount(totalRequired)} DOT (including ${this.formatAmount(estimatedFeeBN)} DOT fees)`,
          'INSUFFICIENT_BALANCE',
          {
            chain: chainName,
            available: availableBN.toString(),
            required: totalRequired.toString(),
            amount: amountBN.toString(),
            fees: estimatedFeeBN.toString(),
            shortfall: totalRequired.sub(availableBN).toString(),
            attemptLog: attemptLog.join('\n'),
          }
        );
      }
      
      // Step 5: Collect warnings
      const warnings = await this.collectTransferWarnings(api, params.recipient, finalKeepAlive, chainName);
      
      // Add validation method warning
      if (dryRun.validationMethod === 'paymentInfo') {
        warnings.push('⚠️ Transaction validated using basic check only (Chopsticks unavailable). Runtime execution not fully validated.');
      }
      
      // Add retry info to warnings if multiple attempts were needed
      if (attemptLog.length > 2) {
        const attemptsUsed = attemptLog.filter(log => log.includes('Validating')).length;
        if (attemptsUsed > 1) {
          warnings.push(`Transaction validated after trying ${attemptsUsed} different configurations`);
        }
      }
      
      // Step 6: Return validated extrinsic
      const description = `Transfer ${this.formatAmount(amountBN)} DOT from ${senderAddress.slice(0, 8)}...${senderAddress.slice(-8)} to ${recipientAddress.slice(0, 8)}...${recipientAddress.slice(-8)} on ${chainName}`;

      return this.createResult(
        description,
        extrinsic,
        {
          estimatedFee: dryRun.estimatedFee,
          warnings: warnings.length > 0 ? warnings : undefined,
          metadata: {
            amount: amountBN.toString(),
            formattedAmount: this.formatAmount(amountBN),
            recipient: recipientAddress,
            sender: senderAddress,
            keepAlive: finalKeepAlive,
            chain: chainName,
            attemptLog: attemptLog.join('\n'),
            // Store the API instance that created this extrinsic (CRITICAL!)
            apiInstance: api,
          },
          resultType: 'extrinsic',
          requiresConfirmation: true,
          executionType: 'extrinsic',
        }
      );
    } catch (error) {
      return this.handleTransferError(error, 'Transfer');
    }
  }

  /**
   * Batch transfer - transfer to multiple recipients in a single transaction
   * 
   * ROBUST FLOW with intelligent retry:
   * 1. Validate all recipients and amounts (fail fast on user errors)
   * 2. Try simulation with retry logic (same as transfer)
   * 3. Check balance on successful chain
   * 4. Final validation (total + fees)
   * 5. Return validated batch extrinsic
   */
  async batchTransfer(params: BatchTransferParams): Promise<AgentResult> {
    this.ensureInitialized();

    // Batch transfer request received

    try {
      // Step 1: Validate sender and transfers array (fail fast on user errors)
      this.validateSenderAddress(params.address);
      this.validateTransfersArray(params.transfers);

      const { validatedTransfers, totalAmount } = this.validateAndParseTransfers(
        params.address,
        params.transfers
      );

      // Step 2: Robust dry-run with retry logic
      // Ensure addresses are in SS58 format
      const senderAddress = this.ensurePolkadotAddress(params.address);
      const validatedRecipients = validatedTransfers.map(t => ({
        recipient: this.ensurePolkadotAddress(t.recipient),
        amount: t.amount,
      }));
      
      const { dryRun, api, extrinsic, chainName, keepAlive: finalKeepAlive, attemptLog } = await this.dryRunWithRetry(
        { 
          address: senderAddress, 
          chain: params.chain,
          keepAlive: false,
          recipient: validatedRecipients[0]?.recipient || '',
          amount: totalAmount,
          onStatusUpdate: params.onSimulationStatus
        },
        (apiInstance, keepAliveFlag) => createBatchTransferExtrinsic(apiInstance, {
          transfers: validatedRecipients.map(t => ({
            recipient: t.recipient,
            amount: t.amount,
          })),
        })
      );

      // Step 3: Check balance on the successful chain
      const targetChain = chainName === 'Asset Hub' ? 'assetHub' : 'relay';
      const balance = await this.getBalanceOnChain(targetChain, senderAddress);

      // Step 4: Validate total balance (amount + fees)
      const estimatedFeeBN = new BN(dryRun.estimatedFee);
      const totalRequired = totalAmount.add(estimatedFeeBN);
      const availableBN = new BN(balance.available);
      
      if (params.validateBalance !== false && availableBN.lt(totalRequired)) {
        throw new AgentError(
          `Insufficient balance on ${chainName}. Available: ${this.formatAmount(availableBN)} DOT, Required: ${this.formatAmount(totalRequired)} DOT (including ${this.formatAmount(estimatedFeeBN)} DOT fees)`,
          'INSUFFICIENT_BALANCE',
          {
            chain: chainName,
            available: availableBN.toString(),
            required: totalRequired.toString(),
            totalAmount: totalAmount.toString(),
            fees: estimatedFeeBN.toString(),
            shortfall: totalRequired.sub(availableBN).toString(),
            attemptLog: attemptLog.join('\n'),
          }
        );
      }

      const warnings = this.collectBatchWarnings(params.transfers.length, chainName);
      
      // Add retry info to warnings if multiple attempts were needed
      if (attemptLog.length > 2) {
        const attemptsUsed = attemptLog.filter(log => log.includes('Validating')).length;
        if (attemptsUsed > 1) {
          warnings.push(`Transaction validated after trying ${attemptsUsed} different configurations`);
        }
      }
      
      const description = `Batch transfer: ${params.transfers.length} transfers totaling ${this.formatAmount(totalAmount)} DOT from ${senderAddress.slice(0, 8)}...${senderAddress.slice(-8)} on ${chainName}`;

      return this.createResult(
        description,
        extrinsic,
        {
          estimatedFee: dryRun.estimatedFee,
          warnings: warnings.length > 0 ? warnings : undefined,
          metadata: {
            transferCount: params.transfers.length,
            totalAmount: totalAmount.toString(),
            formattedTotalAmount: this.formatAmount(totalAmount),
            sender: senderAddress,
            chain: chainName,
            attemptLog: attemptLog.join('\n'),
            apiInstance: api, // Store API instance
            transfers: validatedTransfers.map(t => ({
              recipient: t.recipient,
              amount: t.amount,
              formattedAmount: this.formatAmount(new BN(t.amount)),
            })),
          },
          resultType: 'extrinsic',
          requiresConfirmation: true,
          executionType: 'extrinsic',
        }
      );
    } catch (error) {
      return this.handleTransferError(error, 'Batch transfer');
    }
  }

  // ===== ROBUST SIMULATION WITH RETRY LOGIC =====

  /**
   * Robust dry-run with intelligent retry mechanism
   * 
   * Reviews and adjusts ALL adjustable parameters:
   * - Chain selection (assetHub/relay)
   * - Keep-alive flag (transferKeepAlive vs transferAllowDeath)
   * - Any other configurable parameters
   * 
   * Does NOT change user intent (amount, recipient, sender)
   * 
   * @param params Transfer parameters including all adjustable options
   * @param extrinsicCreator Function to create extrinsic with current parameters
   * @returns Successful dry-run result with correct API and extrinsic
   */
  private async dryRunWithRetry(
    params: { 
      address: string; 
      chain?: 'assetHub' | 'relay';
      keepAlive?: boolean;
      recipient: string;
      amount: BN;
      onStatusUpdate?: SimulationStatusCallback;
    },
    extrinsicCreator: (api: ApiPromise, keepAlive: boolean) => SubmittableExtrinsic<'promise'>
  ): Promise<{
    dryRun: DryRunResult;
    api: ApiPromise;
    extrinsic: SubmittableExtrinsic<'promise'>;
    chainName: string;
    keepAlive: boolean;
    attemptLog: string[];
  }> {
    const maxAttempts = 5;
    const attemptLog: string[] = [];
    let currentChain = params.chain || 'assetHub';
    let currentKeepAlive = params.keepAlive !== undefined ? params.keepAlive : false;
    let lastError: ErrorAnalysis | null = null;
    const triedCombinations = new Set<string>();
    const statusCallback = params.onStatusUpdate || this.onStatusUpdate;

    // Ensure addresses are in SS58 format (Polkadot prefix 0)
    const senderAddress = this.ensurePolkadotAddress(params.address);
    const recipientAddress = this.ensurePolkadotAddress(params.recipient);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const chainName = currentChain === 'assetHub' ? 'Asset Hub' : 'Relay Chain';
      const combinationKey = `${currentChain}-${currentKeepAlive}`;
      
      if (triedCombinations.has(combinationKey)) {
        break;
      }
      triedCombinations.add(combinationKey);
      
      const userFriendlyLog = `Validating on ${chainName}${currentKeepAlive ? ' (keep-alive mode)' : ''}`;
      attemptLog.push(userFriendlyLog);
      
      if (statusCallback) {
        statusCallback({
          phase: attempt === 1 ? 'validating' : 'retrying',
          message: userFriendlyLog,
          attempt,
          maxAttempts,
          chain: chainName,
        });
      }

      try {
        const api = await this.getApiForChain(currentChain);
        const extrinsic = extrinsicCreator(api, currentKeepAlive);
        const rpcEndpoint = this.getRpcEndpointForChain(currentChain);
        
        if (statusCallback) {
          statusCallback({
            phase: 'simulating',
            message: `Simulating transaction on ${chainName}...`,
            attempt,
            maxAttempts,
            chain: chainName,
          });
        }
        
        const dryRun = await this.dryRunExtrinsic(api, extrinsic, senderAddress, rpcEndpoint);
        
        if (dryRun.success) {
          // If using paymentInfo (unvalidated), log warning
          if (dryRun.validationMethod === 'paymentInfo') {
            attemptLog.push(`⚠️ Validation using basic check only (Chopsticks unavailable)`);
            console.warn('[Transfer] Warning: Transaction validated using paymentInfo only - runtime execution not fully validated');
          } else {
            attemptLog.push(`✓ Validation successful (Chopsticks)`);
          }
          
          if (statusCallback) {
            statusCallback({
              phase: 'complete',
              message: `Transaction validated successfully on ${chainName}${dryRun.validationMethod === 'paymentInfo' ? ' (basic check)' : ''}`,
              attempt,
              maxAttempts,
              chain: chainName,
            });
          }
          return {
            dryRun,
            api,
            extrinsic,
            chainName,
            keepAlive: currentKeepAlive,
            attemptLog,
          };
        }
        
        const errorAnalysis = analyzeError(dryRun.error || 'Unknown error');
        lastError = errorAnalysis;
        
        if (statusCallback) {
          statusCallback({
            phase: 'analyzing',
            message: `Analyzing error: ${errorAnalysis.userMessage}`,
            attempt,
            maxAttempts,
            chain: chainName,
          });
        }
        
        if (errorAnalysis.category === 'USER_ERROR') {
          attemptLog.push(`Cannot proceed: ${errorAnalysis.userMessage}`);
          throw new AgentError(
            errorAnalysis.userMessage,
            'USER_ERROR',
            {
              category: errorAnalysis.category,
              technicalDetails: errorAnalysis.technicalDetails,
              attemptLog: attemptLog.join('\n'),
            }
          );
        }
        
        const retryStrategy = getRetryStrategy(
          errorAnalysis, 
          attempt, 
          currentChain,
          currentKeepAlive
        );
        
        if (!retryStrategy) {
          attemptLog.push(`No further adjustments available`);
          break;
        }
        
        const adjustments: string[] = [];
        
        if (retryStrategy.tryAlternateChain) {
          const newChain = currentChain === 'assetHub' ? 'relay' : 'assetHub';
          const newChainName = newChain === 'assetHub' ? 'Asset Hub' : 'Relay Chain';
          adjustments.push(`switching to ${newChainName}`);
          attemptLog.push(`Adjusting: switching to ${newChainName}`);
          currentChain = newChain;
        }
        
        if (retryStrategy.tryKeepAlive !== undefined) {
          const newKeepAlive = retryStrategy.tryKeepAlive;
          adjustments.push(newKeepAlive ? 'enabling keep-alive mode' : 'disabling keep-alive mode');
          attemptLog.push(`Adjusting: ${newKeepAlive ? 'enabling' : 'disabling'} keep-alive mode`);
          currentKeepAlive = newKeepAlive;
        }
        
        if (statusCallback && adjustments.length > 0) {
          statusCallback({
            phase: 'retrying',
            message: `Retrying with adjustments: ${adjustments.join(', ')}`,
            attempt: attempt + 1,
            maxAttempts,
            chain: currentChain === 'assetHub' ? 'Asset Hub' : 'Relay Chain',
            adjustments,
          });
        }
        
      } catch (error) {
        if (error instanceof AgentError) {
          throw error;
        }
        
        const errorAnalysis = analyzeError(error instanceof Error ? error : String(error));
        lastError = errorAnalysis;
        
        if (errorAnalysis.category === 'USER_ERROR') {
          throw new AgentError(
            errorAnalysis.userMessage,
            'USER_ERROR',
            {
              technicalDetails: errorAnalysis.technicalDetails,
              attemptLog: attemptLog.join('\n'),
            }
          );
        }
        
        if (attempt === maxAttempts) {
          break;
        }
      }
    }
    
    // All attempts failed
    attemptLog.push(`All ${maxAttempts} attempts failed`);
    
    const errorMessage = lastError 
      ? formatErrorForUser(lastError, maxAttempts, maxAttempts)
      : 'Transaction validation failed after multiple attempts';
    
    throw new AgentError(
      errorMessage,
      'VALIDATION_FAILED_ALL_ATTEMPTS',
      {
        attempts: maxAttempts,
        lastError: lastError?.technicalDetails,
        attemptLog: attemptLog.join('\n'),
      }
    );
  }

  // ===== HELPER METHODS =====

  /**
   * Get RPC endpoints for a specific chain (uses RPC manager if available)
   */
  private getRpcEndpointForChain(chain: 'assetHub' | 'relay'): string[] {
    return this.getRpcEndpointsForChain(chain);
  }

  private validateTransferAddresses(sender: string, recipient: string): void {
    const senderValidation = this.validateAddress(sender);
    if (!senderValidation.valid) {
      throw new AgentError(
        `Invalid sender address: ${senderValidation.errors.join(', ')}`,
        'INVALID_SENDER_ADDRESS',
        { errors: senderValidation.errors }
      );
    }

    const recipientValidation = this.validateAddress(recipient);
    if (!recipientValidation.valid) {
      throw new AgentError(
        `Invalid recipient address: ${recipientValidation.errors.join(', ')}`,
        'INVALID_RECIPIENT_ADDRESS',
        { errors: recipientValidation.errors }
      );
    }

    if (sender === recipient) {
      throw new AgentError(
        'Sender and recipient addresses cannot be the same',
        'SAME_SENDER_RECIPIENT'
      );
    }
  }

  private validateSenderAddress(address: string): void {
    const validation = this.validateAddress(address);
    if (!validation.valid) {
      throw new AgentError(
        `Invalid sender address: ${validation.errors.join(', ')}`,
        'INVALID_SENDER_ADDRESS',
        { errors: validation.errors }
      );
    }
  }

  private validateTransfersArray(transfers?: Array<{ recipient: string; amount: string | number }>): void {
    if (!transfers || transfers.length === 0) {
      throw new AgentError('At least one transfer is required', 'NO_TRANSFERS');
    }
    if (transfers.length > 100) {
      throw new AgentError('Batch transfer cannot exceed 100 transfers', 'TOO_MANY_TRANSFERS');
    }
  }

  private validateAndParseTransfers(
    senderAddress: string,
    transfers: Array<{ recipient: string; amount: string | number }>
  ): { validatedTransfers: Array<{ recipient: string; amount: string }>; totalAmount: BN } {
    const totalAmount = new BN(0);
    const validatedTransfers = transfers.map((transfer, index) => {
      const recipientValidation = this.validateAddress(transfer.recipient);
      if (!recipientValidation.valid) {
        throw new AgentError(
          `Invalid recipient address at index ${index}: ${recipientValidation.errors.join(', ')}`,
          'INVALID_RECIPIENT_ADDRESS',
          { index, errors: recipientValidation.errors }
        );
      }

      if (senderAddress === transfer.recipient) {
        throw new AgentError(
          `Transfer ${index + 1}: Sender and recipient addresses cannot be the same`,
          'SAME_SENDER_RECIPIENT',
          { index }
        );
      }

      const amountBN = this.parseAndValidateAmount(transfer.amount, index);
      totalAmount.iadd(amountBN);

      return {
        recipient: transfer.recipient,
        amount: amountBN.toString(),
      };
    });

    return { validatedTransfers, totalAmount };
  }

  private parseAndValidateAmount(amount: string | number, index?: number): BN {
    const amountBN = typeof amount === 'string' && amount.includes('.')
      ? this.parseAmount(amount)
      : new BN(amount);

    if (amountBN.lte(new BN(0))) {
      const prefix = index !== undefined ? `Transfer ${index + 1}: ` : '';
      throw new AgentError(
        `${prefix}Transfer amount must be greater than zero`,
        'INVALID_AMOUNT',
        index !== undefined ? { index } : undefined
      );
    }

    return amountBN;
  }

  private async validateTransferBalance(
    address: string,
    amount: BN,
    validateBalance?: boolean
  ): Promise<void> {
    if (validateBalance === false) return;

    const balanceCheck = await this.hasSufficientBalance(address, amount, true);
    if (!balanceCheck.sufficient) {
      throw new AgentError(
        `Insufficient balance. Available: ${this.formatAmount(balanceCheck.available)} DOT, Required: ${this.formatAmount(balanceCheck.required)} DOT`,
        'INSUFFICIENT_BALANCE',
        {
          available: balanceCheck.available,
          required: balanceCheck.required,
          shortfall: balanceCheck.shortfall,
        }
      );
    }
  }

  private async validateDotBalance(
    balance: { free: string; reserved: string; frozen: string; available: string },
    amount: BN,
    validateBalance?: boolean
  ): Promise<void> {
    if (validateBalance === false) return;

    const availableBN = new BN(balance.available);
    const feeBuffer = new BN(10_000_000_000); // 0.01 DOT
    const totalRequired = amount.add(feeBuffer);

    if (availableBN.lt(totalRequired)) {
      throw new AgentError(
        `Insufficient balance. Available: ${this.formatAmount(availableBN)} DOT, Required: ${this.formatAmount(totalRequired)} DOT`,
        'INSUFFICIENT_BALANCE',
        {
          available: availableBN.toString(),
          required: totalRequired.toString(),
          shortfall: totalRequired.sub(availableBN).toString(),
        }
      );
    }
  }

  private createTransferExtrinsic(
    api: any,
    recipient: string,
    amount: BN,
    keepAlive: boolean
  ): any {
    const extrinsicParams = {
      recipient,
      amount: amount.toString(),
    };
    return keepAlive
      ? createTransferKeepAliveExtrinsic(api, extrinsicParams)
      : createTransferExtrinsic(api, extrinsicParams);
  }

  private async collectTransferWarnings(
    api: any,
    recipient: string,
    keepAlive: boolean,
    chainName: string
  ): Promise<string[]> {
    const warnings: string[] = [];

    // Add chain info
    if (chainName === 'Asset Hub') {
      warnings.push('✅ Using Asset Hub (recommended for DOT transfers)');
    } else {
      warnings.push('ℹ️ Using Relay Chain');
    }

    if (keepAlive) {
      warnings.push('Using transferKeepAlive - this ensures the sender account remains alive after transfer');
    }

    try {
      const recipientInfo = await api.query.system.account(recipient);
      const recipientData = recipientInfo as any;
      const recipientBalance = recipientData.data?.free?.toString() || '0';
      if (recipientBalance === '0') {
        warnings.push('Recipient account appears to be new or empty');
      }
    } catch {
      // Ignore errors when checking recipient
    }

    return warnings;
  }

  private collectBatchWarnings(transferCount: number, chainName: string): string[] {
    const warnings: string[] = [];
    
    // Add chain info
    if (chainName === 'Asset Hub') {
      warnings.push('✅ Using Asset Hub (recommended for DOT transfers)');
    } else {
      warnings.push('ℹ️ Using Relay Chain');
    }
    
    warnings.push(`Batch transfer with ${transferCount} recipients`);
    
    if (transferCount > 10) {
      warnings.push('Large batch transfer - ensure all recipients are correct');
    }
    
    return warnings;
  }

  private handleTransferError(error: unknown, operation: string): never {
    if (error instanceof AgentError) {
      throw error;
    }
    throw new AgentError(
      `${operation} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      `${operation.toUpperCase().replace(' ', '_')}_ERROR`,
      { originalError: error instanceof Error ? error.message : String(error) }
    );
  }
}
