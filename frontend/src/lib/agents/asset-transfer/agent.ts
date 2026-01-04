/**
 * Asset Transfer Agent
 * 
 * Creates extrinsics for transferring assets (DOT, tokens) across chains.
 * Handles standard transfers, keep-alive transfers, and batch transfers.
 */

import { ApiPromise } from '@polkadot/api';
import { BaseAgent } from '../baseAgent';
import { AgentResult, AgentError } from '../types';
import { TransferParams, BatchTransferParams } from './types';
import { BN } from '@polkadot/util';
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
import {
  validateTransferAddresses,
  validateSenderAddress,
  validateSenderAddressForSigning,
} from './utils/addressValidation';
import {
  parseAndValidateAmountWithCapabilities,
  formatAmount,
} from './utils/amountParser';
import {
  validateBalance,
  checkAccountReapingRisk,
} from './utils/balanceValidator';

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
    
    if (!this.api) {
      throw new AgentError('API not initialized', 'API_NOT_INITIALIZED');
    }

    try {
      validateTransferAddresses(params.address, params.recipient);
      
      const context = await this.prepareTransferContext(params);
      const preconditions = await this.validateTransferPreconditions(params, context);
      const extrinsicResult = this.buildTransferExtrinsic(params, context);
      
      return this.createTransferResult(params, extrinsicResult, {
        ...context,
        ...preconditions,
      });
    } catch (error) {
      console.error('[AssetTransferAgent] Transfer failed:', {
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof AgentError ? (error as AgentError).code : 'UNKNOWN',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return this.handleTransferError(error, 'Transfer');
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
    
    if (!this.api) {
      throw new AgentError('API not initialized', 'API_NOT_INITIALIZED');
    }

    try {
      validateSenderAddress(params.address);
      this.validateTransfersArray(params.transfers);

      const context = await this.prepareBatchContext(params);
      const { validatedTransfers, totalAmount } = this.validateAndParseTransfersWithCapabilities(
        params.address,
        params.transfers,
        context.capabilities
      );

      await validateSenderAddressForSigning(params.address);
      const senderAddress = params.address;
      
      const estimatedFeeBN = new BN('500000000');
      const balanceResult = await validateBalance(
        context.targetApi,
        senderAddress,
        totalAmount,
        estimatedFeeBN,
        context.capabilities,
        params.validateBalance !== false
      );
      
      const transfersWithBN = validatedTransfers.map(t => ({
        recipient: t.recipient,
        amount: new BN(t.amount),
      }));
      
      const result = buildSafeBatchExtrinsic(
        context.targetApi,
        transfersWithBN,
        context.capabilities,
        true
      );

      const description = `Batch transfer: ${params.transfers.length} transfers totaling ${formatAmount(result.amountBN, context.capabilities.nativeDecimals)} ${context.capabilities.nativeTokenSymbol} from ${senderAddress.slice(0, 8)}...${senderAddress.slice(-8)} on ${context.chainName}`;

      return this.createResult(
        description,
        result.extrinsic,
        {
          estimatedFee: estimatedFeeBN.toString(),
          warnings: result.warnings.length > 0 ? result.warnings : undefined,
          metadata: {
            method: result.method,
            transferCount: params.transfers.length,
            chain: context.capabilities.chainName,
            decimals: context.capabilities.nativeDecimals,
            symbol: context.capabilities.nativeTokenSymbol,
            enableSimulation: true,
          },
          resultType: 'extrinsic',
          requiresConfirmation: true,
          executionType: 'extrinsic',
        }
      );
    } catch (error) {
      console.error('[AssetTransferAgent] Batch transfer failed:', {
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof AgentError ? (error as AgentError).code : 'UNKNOWN',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return this.handleTransferError(error, 'Batch transfer');
    }
  }

  // ===== HELPER METHODS =====

  private async prepareTransferContext(
    params: TransferParams
  ): Promise<{
    targetApi: ApiPromise;
    capabilities: TransferCapabilities;
    amountBN: BN;
    keepAlive: boolean;
    targetChain: 'assetHub' | 'relay';
    chainName: string;
  }> {
    const targetChain = params.chain || 'assetHub';
    const chainName = targetChain === 'assetHub' ? 'Asset Hub' : 'Relay Chain';
    const keepAlive = params.keepAlive === true;

    const targetApi = await this.getApiForChain(targetChain);
    if (!targetApi) {
      throw new AgentError(
        `Failed to get API for ${chainName}`,
        'API_NOT_AVAILABLE',
        { chain: targetChain }
      );
    }

    await targetApi.isReady;

    if (!targetApi.tx || !targetApi.tx.balances) {
      throw new AgentError(
        `Target chain (${chainName}) API does not have balances pallet. ` +
        `This is required for native token transfers.`,
        'INVALID_API_STATE',
        { chain: targetChain, chainName }
      );
    }

    const capabilities = await detectTransferCapabilities(targetApi);
    const amountBN = parseAndValidateAmountWithCapabilities(params.amount, capabilities);

    const isAssetHub =
      capabilities.chainName.toLowerCase().includes('asset') ||
      capabilities.chainName.toLowerCase().includes('statemint') ||
      capabilities.specName.toLowerCase().includes('asset') ||
      capabilities.specName.toLowerCase().includes('statemint');

    if (targetChain === 'assetHub' && !isAssetHub) {
      throw new AgentError(
        `Chain type mismatch: Expected Asset Hub, but detected "${capabilities.chainName}" (${capabilities.specName}). ` +
        `This may indicate a connection to the wrong chain.`,
        'CHAIN_TYPE_MISMATCH',
        {
          expected: 'assetHub',
          detected: capabilities.chainName,
          specName: capabilities.specName,
        }
      );
    }

    validateMinimumCapabilities(capabilities);

    return {
      targetApi,
      capabilities,
      amountBN,
      keepAlive,
      targetChain,
      chainName,
    };
  }

  private async validateTransferPreconditions(
    params: TransferParams,
    context: {
      targetApi: ApiPromise;
      capabilities: TransferCapabilities;
      amountBN: BN;
      keepAlive: boolean;
      chainName: string;
    }
  ): Promise<{
    senderAddress: string;
    warnings: string[];
    estimatedFeeBN: BN;
  }> {
    await validateSenderAddressForSigning(params.address);
    const senderAddress = params.address;

    const warnings: string[] = [];
    const edCheck = validateExistentialDeposit(context.amountBN, context.capabilities);
    if (!edCheck.valid && edCheck.warning) {
      warnings.push(edCheck.warning);
    }

    const estimatedFeeBN = new BN('200000000');
    const balanceResult = await validateBalance(
      context.targetApi,
      senderAddress,
      context.amountBN,
      estimatedFeeBN,
      context.capabilities,
      params.validateBalance !== false
    );

    const edBN = new BN(context.capabilities.existentialDeposit);
    const reapingWarning = checkAccountReapingRisk(
      balanceResult.available,
      context.amountBN,
      estimatedFeeBN,
      edBN,
      context.keepAlive,
      context.capabilities
    );

    if (reapingWarning) {
      warnings.push(reapingWarning);
    }

    return {
      senderAddress,
      warnings,
      estimatedFeeBN,
    };
  }

  private buildTransferExtrinsic(
    params: TransferParams,
    context: {
      targetApi: ApiPromise;
      capabilities: TransferCapabilities;
      amountBN: BN;
      keepAlive: boolean;
    }
  ): {
    extrinsic: any;
    method: string;
    recipientEncoded: string;
    amountBN: BN;
    warnings: string[];
  } {
    return buildSafeTransferExtrinsic(
      context.targetApi,
      {
        recipient: params.recipient,
        amount: context.amountBN,
        keepAlive: context.keepAlive,
      },
      context.capabilities
    );
  }

  private createTransferResult(
    params: TransferParams,
    extrinsicResult: {
      extrinsic: any;
      method: string;
      recipientEncoded: string;
      amountBN: BN;
      warnings: string[];
    },
    context: {
      capabilities: TransferCapabilities;
      chainName: string;
      senderAddress: string;
      warnings: string[];
      estimatedFeeBN: BN;
    }
  ): AgentResult {
    const allWarnings = [...context.warnings, ...extrinsicResult.warnings];
    const description = `Transfer ${formatAmount(extrinsicResult.amountBN, context.capabilities.nativeDecimals)} ${context.capabilities.nativeTokenSymbol} from ${context.senderAddress.slice(0, 8)}...${context.senderAddress.slice(-8)} to ${extrinsicResult.recipientEncoded.slice(0, 8)}...${extrinsicResult.recipientEncoded.slice(-8)} on ${context.chainName}`;

    return this.createResult(
      description,
      extrinsicResult.extrinsic,
      {
        estimatedFee: context.estimatedFeeBN.toString(),
        warnings: allWarnings.length > 0 ? allWarnings : undefined,
        metadata: {
          method: extrinsicResult.method,
          chain: context.capabilities.chainName,
          decimals: context.capabilities.nativeDecimals,
          symbol: context.capabilities.nativeTokenSymbol,
          enableSimulation: true,
        },
        resultType: 'extrinsic',
        requiresConfirmation: true,
        executionType: 'extrinsic',
      }
    );
  }

  private validateTransfersArray(transfers?: Array<{ recipient: string; amount: string | number }>): void {
    if (!transfers || transfers.length === 0) {
      throw new AgentError('At least one transfer is required', 'NO_TRANSFERS');
    }
    if (transfers.length > 100) {
      throw new AgentError('Batch transfer cannot exceed 100 transfers', 'TOO_MANY_TRANSFERS');
    }
  }

  private validateAndParseTransfersWithCapabilities(
    senderAddress: string,
    transfers: Array<{ recipient: string; amount: string | number }>,
    capabilities: TransferCapabilities
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

      const amountBN = parseAndValidateAmountWithCapabilities(transfer.amount, capabilities, index);
      totalAmount.iadd(amountBN);

      return {
        recipient: transfer.recipient,
        amount: amountBN.toString(),
      };
    });

    return { validatedTransfers, totalAmount };
  }

  private async prepareBatchContext(
    params: BatchTransferParams
  ): Promise<{
    targetApi: ApiPromise;
    capabilities: TransferCapabilities;
    targetChain: 'assetHub' | 'relay';
    chainName: string;
  }> {
    const targetChain = params.chain || 'assetHub';
    const chainName = targetChain === 'assetHub' ? 'Asset Hub' : 'Relay Chain';

    const targetApi = await this.getApiForChain(targetChain);
    if (!targetApi) {
      throw new AgentError(
        `Failed to get API for ${chainName}`,
        'API_NOT_AVAILABLE',
        { chain: targetChain }
      );
    }

    await targetApi.isReady;
    const capabilities = await detectTransferCapabilities(targetApi);
    validateMinimumCapabilities(capabilities);

    if (!capabilities.hasUtility) {
      throw new AgentError(
        `Chain ${capabilities.chainName} does not support batch operations (no utility pallet)`,
        'BATCH_NOT_SUPPORTED'
      );
    }

    return {
      targetApi,
      capabilities,
      targetChain,
      chainName,
    };
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
