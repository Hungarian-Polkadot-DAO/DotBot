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
      
      // Step 2: Determine chain and validate (NO SIMULATION - executioner will simulate!)
      // Ensure addresses are in SS58 format
      const senderAddress = this.ensurePolkadotAddress(params.address);
      const recipientAddress = this.ensurePolkadotAddress(params.recipient);
      
      // Determine target chain (default to Asset Hub, user can override)
      const targetChain = params.chain || 'assetHub';
      const chainName = targetChain === 'assetHub' ? 'Asset Hub' : 'Relay Chain';
      const finalKeepAlive = keepAlive;
      
      console.log(`[AssetTransferAgent] Preparing transfer on ${chainName}:`, {
        from: senderAddress.slice(0, 8) + '...',
        to: recipientAddress.slice(0, 8) + '...',
        amount: this.formatAmount(amountBN),
        keepAlive: finalKeepAlive,
      });
      
      // Step 3: Check balance on target chain
      const balance = await this.getBalanceOnChain(targetChain, senderAddress);
      
      // Step 4: Validate balance (amount + estimated fees)
      // Note: This is a rough estimate - actual fees will be calculated during simulation
      const estimatedFeeBN = new BN('200000000'); // Conservative estimate: 0.02 DOT
      const totalRequired = amountBN.add(estimatedFeeBN);
      const availableBN = new BN(balance.available);
      
      if (params.validateBalance !== false && availableBN.lt(totalRequired)) {
        throw new AgentError(
          `Insufficient balance on ${chainName}. Available: ${this.formatAmount(availableBN)} DOT, Required (estimated): ${this.formatAmount(totalRequired)} DOT (including ~${this.formatAmount(estimatedFeeBN)} DOT fees)`,
          'INSUFFICIENT_BALANCE',
          {
            chain: chainName,
            available: availableBN.toString(),
            required: totalRequired.toString(),
            amount: amountBN.toString(),
            fees: estimatedFeeBN.toString(),
            shortfall: totalRequired.sub(availableBN).toString(),
          }
        );
      }
      
      // Step 5: Collect warnings
      const warnings: string[] = [];
      
      // Add chain info
      if (chainName === 'Asset Hub') {
        warnings.push('✅ Using Asset Hub (recommended for DOT transfers)');
      } else {
        warnings.push('ℹ️ Using Relay Chain');
      }
      
      if (finalKeepAlive) {
        warnings.push('Using transferKeepAlive - sender account will remain alive after transfer');
      }
      
      // Step 6: Return metadata (NO EXTRINSIC - executioner will build and simulate!)
      const description = `Transfer ${this.formatAmount(amountBN)} DOT from ${senderAddress.slice(0, 8)}...${senderAddress.slice(-8)} to ${recipientAddress.slice(0, 8)}...${recipientAddress.slice(-8)} on ${chainName}`;

      return this.createResult(
        description,
        undefined, // NO EXTRINSIC - executioner will rebuild
        {
          estimatedFee: estimatedFeeBN.toString(), // Rough estimate - actual fee from simulation
          warnings: warnings.length > 0 ? warnings : undefined,
          metadata: {
            amount: amountBN.toString(),
            formattedAmount: this.formatAmount(amountBN),
            recipient: recipientAddress,
            sender: senderAddress,
            keepAlive: finalKeepAlive,
            chain: chainName,
            chainType: targetChain, // 'assetHub' | 'relay' - for executioner to rebuild
            // NO API INSTANCE - executioner uses its own session API
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

      // Step 2: Determine chain and validate (NO SIMULATION - executioner will simulate!)
      // Ensure addresses are in SS58 format
      const senderAddress = this.ensurePolkadotAddress(params.address);
      const validatedRecipients = validatedTransfers.map(t => ({
        recipient: this.ensurePolkadotAddress(t.recipient),
        amount: t.amount,
      }));
      
      // Determine target chain (default to Asset Hub, user can override)
      const targetChain = params.chain || 'assetHub';
      const chainName = targetChain === 'assetHub' ? 'Asset Hub' : 'Relay Chain';
      
      console.log(`[AssetTransferAgent] Preparing batch transfer on ${chainName}:`, {
        from: senderAddress.slice(0, 8) + '...',
        transfers: validatedRecipients.length,
        totalAmount: this.formatAmount(totalAmount),
      });

      // Step 3: Check balance on target chain
      const balance = await this.getBalanceOnChain(targetChain, senderAddress);

      // Step 4: Validate total balance (amount + estimated fees)
      // Note: This is a rough estimate - actual fees will be calculated during simulation
      const estimatedFeeBN = new BN('500000000'); // Conservative estimate for batch: 0.05 DOT
      const totalRequired = totalAmount.add(estimatedFeeBN);
      const availableBN = new BN(balance.available);
      
      if (params.validateBalance !== false && availableBN.lt(totalRequired)) {
        throw new AgentError(
          `Insufficient balance on ${chainName}. Available: ${this.formatAmount(availableBN)} DOT, Required (estimated): ${this.formatAmount(totalRequired)} DOT (including ~${this.formatAmount(estimatedFeeBN)} DOT fees)`,
          'INSUFFICIENT_BALANCE',
          {
            chain: chainName,
            available: availableBN.toString(),
            required: totalRequired.toString(),
            totalAmount: totalAmount.toString(),
            fees: estimatedFeeBN.toString(),
            shortfall: totalRequired.sub(availableBN).toString(),
          }
        );
      }

      const warnings = this.collectBatchWarnings(params.transfers.length, chainName);
      
      const description = `Batch transfer: ${params.transfers.length} transfers totaling ${this.formatAmount(totalAmount)} DOT from ${senderAddress.slice(0, 8)}...${senderAddress.slice(-8)} on ${chainName}`;

      return this.createResult(
        description,
        undefined, // NO EXTRINSIC - executioner will rebuild and simulate
        {
          estimatedFee: estimatedFeeBN.toString(), // Rough estimate - actual fee from simulation
          warnings: warnings.length > 0 ? warnings : undefined,
          metadata: {
            transferCount: params.transfers.length,
            totalAmount: totalAmount.toString(),
            formattedTotalAmount: this.formatAmount(totalAmount),
            sender: senderAddress,
            chain: chainName,
            chainType: targetChain, // 'assetHub' | 'relay' - for executioner to rebuild
            transfers: validatedTransfers.map(t => ({
              recipient: t.recipient,
              amount: t.amount,
              formattedAmount: this.formatAmount(new BN(t.amount)),
            })),
            // NO API INSTANCE - executioner uses its own session API
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
  // NOTE: Agent no longer simulates - that's done by executioner after rebuild!
  // This simplifies the agent and ensures we simulate what we execute.

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
