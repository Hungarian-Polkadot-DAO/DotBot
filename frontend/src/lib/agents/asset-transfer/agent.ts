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
import { BN } from '@polkadot/util';
import { 
  analyzeError, 
  getRetryStrategy, 
  formatErrorForUser,
  ErrorAnalysis 
} from '../errorAnalyzer';
import {
  detectTransferCapabilities,
  validateMinimumCapabilities,
  validateExistentialDeposit,
  TransferCapabilities,
} from './utils/transferCapabilities';
import {
  buildSafeTransferExtrinsic,
  buildSafeBatchExtrinsic,
} from './utils/safeExtrinsicBuilder';

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
   * PRODUCTION-SAFE FLOW:
   * 1. Validate addresses and amount (fail fast on user errors)
   * 2. Detect chain capabilities (available methods, ED, decimals)
   * 3. Check balance
   * 4. Create extrinsic using production-safe builder (automatic fallbacks)
   * 5. Return extrinsic ready for signing
   * 
   * @param params Transfer parameters
   * @returns AgentResult with transfer extrinsic
   */
  async transfer(params: TransferParams): Promise<AgentResult> {
    this.ensureInitialized();
    
    if (!this.api) {
      throw new AgentError('API not initialized', 'API_NOT_INITIALIZED');
    }

    console.log('[AssetTransferAgent] Transfer request received');

    try {
      // Step 1: Validate addresses (fail fast on user errors)
      this.validateTransferAddresses(params.address, params.recipient);
      const amountBN = this.parseAndValidateAmount(params.amount);
      const keepAlive = params.keepAlive === true;
      
      // Step 2: Determine target chain and get appropriate API
      const targetChain = params.chain || 'assetHub';
      const chainName = targetChain === 'assetHub' ? 'Asset Hub' : 'Relay Chain';
      
      console.log(`[AssetTransferAgent] Preparing transfer on ${chainName}`);
      
      // Get API for target chain (NOT this.api which might be relay!)
      // IMPORTANT: Agent is initialized with relay API, but transfers happen on Asset Hub
      const targetApi = await this.getApiForChain(targetChain);
      
      // Step 3: Detect chain capabilities (CRITICAL for multi-network support)
      const capabilities = await detectTransferCapabilities(targetApi);
      
      console.log(`[AssetTransferAgent] Detected chain capabilities:`, {
        chain: capabilities.chainName,
        methods: {
          transferAllowDeath: capabilities.hasTransferAllowDeath,
          transfer: capabilities.hasTransfer,
          transferKeepAlive: capabilities.hasTransferKeepAlive,
        },
        decimals: capabilities.nativeDecimals,
        symbol: capabilities.nativeTokenSymbol,
      });
      
      // Validate minimum capabilities
      validateMinimumCapabilities(capabilities);
      
      // Step 4: Validate existential deposit
      const warnings: string[] = [];
      const edCheck = validateExistentialDeposit(amountBN, capabilities);
      if (!edCheck.valid && edCheck.warning) {
        warnings.push(edCheck.warning);
      }
      
      // Step 5: Check balance on TARGET chain
      const senderAddress = this.ensurePolkadotAddress(params.address);
      const balance = await targetApi.query.system.account(senderAddress);
      const balanceData = balance as any;
      const availableBN = new BN(balanceData.data?.free?.toString() || '0');
      
      // Estimate fees (conservative)
      const estimatedFeeBN = new BN('200000000'); // 0.02 DOT
      const totalRequired = amountBN.add(estimatedFeeBN);
      
      if (params.validateBalance !== false && availableBN.lt(totalRequired)) {
        throw new AgentError(
          `Insufficient balance. Available: ${this.formatAmount(availableBN)} ${capabilities.nativeTokenSymbol}, Required: ${this.formatAmount(totalRequired)} ${capabilities.nativeTokenSymbol} (including fees)`,
          'INSUFFICIENT_BALANCE',
          {
            chain: capabilities.chainName,
            available: availableBN.toString(),
            required: totalRequired.toString(),
          }
        );
      }
      
      // Step 6: Create extrinsic using production-safe builder with TARGET API
      console.log('[AssetTransferAgent] Creating transfer extrinsic...');
      
      const result = buildSafeTransferExtrinsic(
        targetApi, // Use target chain API, not this.api!
        {
          recipient: params.recipient,
          amount: amountBN,
          keepAlive,
        },
        capabilities
      );
      
      // Add builder warnings
      warnings.push(...result.warnings);
      
      console.log('[AssetTransferAgent] ✓ Extrinsic created successfully:', {
        method: result.method,
        recipient: result.recipientEncoded,
        amount: result.amountBN.toString(),
      });
      
      // Step 7: Return extrinsic (ready for signing!)
      const description = `Transfer ${this.formatAmount(result.amountBN)} ${capabilities.nativeTokenSymbol} from ${senderAddress.slice(0, 8)}...${senderAddress.slice(-8)} to ${result.recipientEncoded.slice(0, 8)}...${result.recipientEncoded.slice(-8)} on ${chainName}`;

      return this.createResult(
        description,
        result.extrinsic, // ✅ EXTRINSIC READY!
        {
          estimatedFee: estimatedFeeBN.toString(),
          warnings: warnings.length > 0 ? warnings : undefined,
          metadata: {
            method: result.method,
            chain: capabilities.chainName,
            decimals: capabilities.nativeDecimals,
            symbol: capabilities.nativeTokenSymbol,
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
   * PRODUCTION-SAFE FLOW:
   * 1. Validate all recipients and amounts
   * 2. Detect chain capabilities
   * 3. Check total balance
   * 4. Create batch extrinsic using production-safe builder
   * 5. Return extrinsic ready for signing
   */
  async batchTransfer(params: BatchTransferParams): Promise<AgentResult> {
    this.ensureInitialized();
    
    if (!this.api) {
      throw new AgentError('API not initialized', 'API_NOT_INITIALIZED');
    }

    console.log('[AssetTransferAgent] Batch transfer request received');

    try {
      // Step 1: Validate sender and transfers array
      this.validateSenderAddress(params.address);
      this.validateTransfersArray(params.transfers);

      const { validatedTransfers, totalAmount } = this.validateAndParseTransfers(
        params.address,
        params.transfers
      );

      // Step 2: Determine target chain and get appropriate API
      const targetChain = params.chain || 'assetHub';
      const chainName = targetChain === 'assetHub' ? 'Asset Hub' : 'Relay Chain';
      
      console.log(`[AssetTransferAgent] Preparing batch transfer on ${chainName}`);
      
      // Get API for target chain
      const targetApi = await this.getApiForChain(targetChain);

      // Step 3: Detect chain capabilities
      const capabilities = await detectTransferCapabilities(targetApi);
      
      console.log(`[AssetTransferAgent] Detected chain capabilities for batch:`, {
        chain: capabilities.chainName,
        hasBatch: capabilities.hasBatch,
        hasBatchAll: capabilities.hasBatchAll,
      });
      
      validateMinimumCapabilities(capabilities);
      
      // Check batch support
      if (!capabilities.hasUtility) {
        throw new AgentError(
          `Chain ${capabilities.chainName} does not support batch operations (no utility pallet)`,
          'BATCH_NOT_SUPPORTED'
        );
      }

      // Step 4: Validate total against ED and balance on TARGET chain
      const warnings: string[] = [];
      const senderAddress = this.ensurePolkadotAddress(params.address);
      
      const balance = await targetApi.query.system.account(senderAddress);
      const balanceData = balance as any;
      const availableBN = new BN(balanceData.data?.free?.toString() || '0');
      
      const estimatedFeeBN = new BN('500000000'); // 0.05 DOT for batch
      const totalRequired = totalAmount.add(estimatedFeeBN);
      
      if (params.validateBalance !== false && availableBN.lt(totalRequired)) {
        throw new AgentError(
          `Insufficient balance for batch. Available: ${this.formatAmount(availableBN)} ${capabilities.nativeTokenSymbol}, Required: ${this.formatAmount(totalRequired)} ${capabilities.nativeTokenSymbol}`,
          'INSUFFICIENT_BALANCE',
          {
            available: availableBN.toString(),
            required: totalRequired.toString(),
          }
        );
      }

      // Step 5: Create batch extrinsic using production-safe builder with TARGET API
      console.log('[AssetTransferAgent] Creating batch extrinsic...');
      
      const transfersWithBN = validatedTransfers.map(t => ({
        recipient: t.recipient,
        amount: new BN(t.amount),
      }));
      
      const result = buildSafeBatchExtrinsic(
        targetApi, // Use target chain API!
        transfersWithBN,
        capabilities,
        true // useAtomicBatch (batchAll)
      );
      
      warnings.push(...result.warnings);
      
      console.log('[AssetTransferAgent] ✓ Batch extrinsic created:', {
        method: result.method,
        transfers: params.transfers.length,
        totalAmount: result.amountBN.toString(),
      });
      
      // Step 6: Return extrinsic
      const description = `Batch transfer: ${params.transfers.length} transfers totaling ${this.formatAmount(result.amountBN)} ${capabilities.nativeTokenSymbol} from ${senderAddress.slice(0, 8)}...${senderAddress.slice(-8)} on ${chainName}`;

      return this.createResult(
        description,
        result.extrinsic, // ✅ BATCH EXTRINSIC READY!
        {
          estimatedFee: estimatedFeeBN.toString(),
          warnings: warnings.length > 0 ? warnings : undefined,
          metadata: {
            method: result.method,
            transferCount: params.transfers.length,
            chain: capabilities.chainName,
            decimals: capabilities.nativeDecimals,
            symbol: capabilities.nativeTokenSymbol,
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

  // ===== HELPER METHODS =====

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
