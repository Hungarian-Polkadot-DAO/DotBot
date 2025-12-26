/**
 * Asset Transfer Agent
 * 
 * Creates extrinsics for transferring assets (DOT, tokens) across chains.
 * Handles standard transfers, keep-alive transfers, and batch transfers.
 */

import { BaseAgent } from '../base-agent';
import { AgentResult, AgentError } from '../types';
import { TransferParams, BatchTransferParams } from './types';
import { createTransferExtrinsic } from './extrinsics/transfer';
import { createTransferKeepAliveExtrinsic } from './extrinsics/transfer-keep-alive';
import { createBatchTransferExtrinsic } from './extrinsics/batch-transfer';
import { BN } from '@polkadot/util';

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
   * @param params Transfer parameters
   * @returns AgentResult with transfer extrinsic
   */
  async transfer(params: TransferParams): Promise<AgentResult> {
    this.ensureInitialized();
    const api = this.getApi();
    const warnings: string[] = [];

    console.log('💸 AssetTransferAgent.transfer() called with params:', {
      sender: params.address,
      recipient: params.recipient,
      amount: params.amount
    });

    try {
      // Validate sender address
      const senderValidation = this.validateAddress(params.address);
      if (!senderValidation.valid) {
        throw new AgentError(
          `Invalid sender address: ${senderValidation.errors.join(', ')}`,
          'INVALID_SENDER_ADDRESS',
          { errors: senderValidation.errors }
        );
      }

      // Validate recipient address
      const recipientValidation = this.validateAddress(params.recipient);
      if (!recipientValidation.valid) {
        throw new AgentError(
          `Invalid recipient address: ${recipientValidation.errors.join(', ')}`,
          'INVALID_RECIPIENT_ADDRESS',
          { errors: recipientValidation.errors }
        );
      }

      // Check if sender and recipient are the same
      if (params.address === params.recipient) {
        throw new AgentError(
          'Sender and recipient addresses cannot be the same',
          'SAME_SENDER_RECIPIENT'
        );
      }

      // Parse and validate amount
      const amountBN = typeof params.amount === 'string' && params.amount.includes('.')
        ? this.parseAmount(params.amount)
        : new BN(params.amount);

      if (amountBN.lte(new BN(0))) {
        throw new AgentError(
          'Transfer amount must be greater than zero',
          'INVALID_AMOUNT'
        );
      }

      // Validate balance if requested (default: true)
      const validateBalance = params.validateBalance !== false;
      if (validateBalance) {
        const balanceCheck = await this.hasSufficientBalance(
          params.address,
          amountBN,
          true // include fees
        );

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

      // Create the appropriate extrinsic
      const keepAlive = params.keepAlive === true;
      const extrinsicParams = {
        recipient: params.recipient,
        amount: amountBN.toString(),
      };
      const extrinsic = keepAlive
        ? createTransferKeepAliveExtrinsic(api, extrinsicParams)
        : createTransferExtrinsic(api, extrinsicParams);

      // Estimate fee
      const estimatedFee = await this.estimateFee(extrinsic, params.address);

      // Add warnings
      if (keepAlive) {
        warnings.push('Using transferKeepAlive - this ensures the sender account remains alive after transfer');
      }

      // Check if recipient account exists (optional warning)
      try {
        const recipientInfo = await api.query.system.account(params.recipient);
        const recipientData = recipientInfo as any;
        const recipientBalance = recipientData.data?.free?.toString() || '0';
        if (recipientBalance === '0') {
          warnings.push('Recipient account appears to be new or empty');
        }
      } catch {
        // Ignore errors when checking recipient
      }

      const description = `Transfer ${this.formatAmount(amountBN)} DOT from ${params.address.slice(0, 8)}...${params.address.slice(-8)} to ${params.recipient.slice(0, 8)}...${params.recipient.slice(-8)}`;

      return this.createResult(
        description,
        extrinsic,
        {
          estimatedFee,
          warnings: warnings.length > 0 ? warnings : undefined,
          metadata: {
            amount: amountBN.toString(),
            formattedAmount: this.formatAmount(amountBN),
            recipient: params.recipient,
            sender: params.address,
            keepAlive,
          },
          resultType: 'extrinsic',
          requiresConfirmation: true,
          executionType: 'extrinsic',
        }
      );
    } catch (error) {
      if (error instanceof AgentError) {
        throw error;
      }
      throw new AgentError(
        `Transfer failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'TRANSFER_ERROR',
        { originalError: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Batch transfer - transfer to multiple recipients in a single transaction
   * 
   * @param params Batch transfer parameters
   * @returns AgentResult with batch transfer extrinsic
   */
  async batchTransfer(params: BatchTransferParams): Promise<AgentResult> {
    this.ensureInitialized();
    const api = this.getApi();
    const warnings: string[] = [];

    try {
      // Validate sender address
      const senderValidation = this.validateAddress(params.address);
      if (!senderValidation.valid) {
        throw new AgentError(
          `Invalid sender address: ${senderValidation.errors.join(', ')}`,
          'INVALID_SENDER_ADDRESS',
          { errors: senderValidation.errors }
        );
      }

      // Validate transfers array
      if (!params.transfers || params.transfers.length === 0) {
        throw new AgentError(
          'At least one transfer is required',
          'NO_TRANSFERS'
        );
      }

      if (params.transfers.length > 100) {
        throw new AgentError(
          'Batch transfer cannot exceed 100 transfers',
          'TOO_MANY_TRANSFERS'
        );
      }

      // Validate each transfer
      const totalAmount = new BN(0);
      const validatedTransfers = params.transfers.map((transfer, index) => {
        // Validate recipient
        const recipientValidation = this.validateAddress(transfer.recipient);
        if (!recipientValidation.valid) {
          throw new AgentError(
            `Invalid recipient address at index ${index}: ${recipientValidation.errors.join(', ')}`,
            'INVALID_RECIPIENT_ADDRESS',
            { index, errors: recipientValidation.errors }
          );
        }

        // Check if sender and recipient are the same
        if (params.address === transfer.recipient) {
          throw new AgentError(
            `Transfer ${index + 1}: Sender and recipient addresses cannot be the same`,
            'SAME_SENDER_RECIPIENT',
            { index }
          );
        }

        // Parse and validate amount
        const amountBN = typeof transfer.amount === 'string' && transfer.amount.includes('.')
          ? this.parseAmount(transfer.amount)
          : new BN(transfer.amount);

        if (amountBN.lte(new BN(0))) {
          throw new AgentError(
            `Transfer ${index + 1}: Amount must be greater than zero`,
            'INVALID_AMOUNT',
            { index }
          );
        }

        totalAmount.iadd(amountBN);

        return {
          recipient: transfer.recipient,
          amount: amountBN.toString(),
        };
      });

      // Validate balance if requested (default: true)
      const validateBalance = params.validateBalance !== false;
      if (validateBalance) {
        const balanceCheck = await this.hasSufficientBalance(
          params.address,
          totalAmount,
          true // include fees
        );

        if (!balanceCheck.sufficient) {
          throw new AgentError(
            `Insufficient balance for batch transfer. Available: ${this.formatAmount(balanceCheck.available)} DOT, Required: ${this.formatAmount(balanceCheck.required)} DOT`,
            'INSUFFICIENT_BALANCE',
            {
              available: balanceCheck.available,
              required: balanceCheck.required,
              shortfall: balanceCheck.shortfall,
            }
          );
        }
      }

      // Create batch extrinsic
      const extrinsic = createBatchTransferExtrinsic(api, {
        transfers: validatedTransfers.map(t => ({
          recipient: t.recipient,
          amount: t.amount,
        })),
      });

      // Estimate fee
      const estimatedFee = await this.estimateFee(extrinsic, params.address);

      // Add warnings
      warnings.push(`Batch transfer with ${params.transfers.length} recipients`);
      if (params.transfers.length > 10) {
        warnings.push('Large batch transfer - ensure all recipients are correct');
      }

      const description = `Batch transfer: ${params.transfers.length} transfers totaling ${this.formatAmount(totalAmount)} DOT from ${params.address.slice(0, 8)}...${params.address.slice(-8)}`;

      return this.createResult(
        description,
        extrinsic,
        {
          estimatedFee,
          warnings: warnings.length > 0 ? warnings : undefined,
          metadata: {
            transferCount: params.transfers.length,
            totalAmount: totalAmount.toString(),
            formattedTotalAmount: this.formatAmount(totalAmount),
            sender: params.address,
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
      if (error instanceof AgentError) {
        throw error;
      }
      throw new AgentError(
        `Batch transfer failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'BATCH_TRANSFER_ERROR',
        { originalError: error instanceof Error ? error.message : String(error) }
      );
    }
  }
}

