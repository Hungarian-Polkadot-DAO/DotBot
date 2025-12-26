/**
 * Base Agent Class
 * 
 * Base class for all agents providing common functionality.
 * All agents should extend this class for standardized behavior.
 */

import { ApiPromise } from '@polkadot/api';
import { decodeAddress } from '@polkadot/keyring';
import { isAddress } from '@polkadot/util-crypto';
import { BN } from '@polkadot/util';
import { AgentResult, AgentError, ValidationResult, BalanceInfo } from './types';

export abstract class BaseAgent {
  protected api: ApiPromise | null = null;

  /**
   * Initialize the agent with a Polkadot API instance
   */
  initialize(api: ApiPromise): void {
    this.api = api;
  }

  /**
   * Check if the agent is initialized
   */
  protected ensureInitialized(): void {
    if (!this.api) {
      throw new AgentError(
        'Agent not initialized. Call initialize() with an ApiPromise instance first.',
        'NOT_INITIALIZED'
      );
    }
  }

  /**
   * Get the API instance
   */
  protected getApi(): ApiPromise {
    this.ensureInitialized();
    return this.api!;
  }

  /**
   * Validate that an address is valid
   */
  protected validateAddress(address: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!address || address.trim().length === 0) {
      errors.push('Address is required');
      return { valid: false, errors, warnings };
    }

    try {
      // Check if address is valid Polkadot/Substrate address format
      if (!isAddress(address)) {
        errors.push(`Invalid address format: ${address}`);
        return { valid: false, errors, warnings };
      }

      // Decode to verify it's a valid address
      decodeAddress(address);
    } catch (error) {
      errors.push(`Address validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { valid: false, errors, warnings };
    }

    return { valid: true, errors: [], warnings };
  }

  /**
   * Get account balance information
   */
  protected async getBalance(address: string): Promise<BalanceInfo> {
    const api = this.getApi();
    console.log('💰 Getting balance for address:', address);
    const accountInfo = await api.query.system.account(address);
    console.log('💰 Account info retrieved:', {
      hasData: !!accountInfo,
      free: (accountInfo as any).data?.free?.toString(),
      reserved: (accountInfo as any).data?.reserved?.toString()
    });
    
    // Type assertion for account data
    const accountData = accountInfo as any;
    const free = accountData.data?.free?.toString() || '0';
    const reserved = accountData.data?.reserved?.toString() || '0';
    const frozen = accountData.data?.frozen?.toString() || '0';
    const available = new BN(free).sub(new BN(frozen)).toString();

    return {
      free,
      reserved,
      frozen,
      available,
    };
  }

  /**
   * Check if account has sufficient balance
   */
  protected async hasSufficientBalance(
    address: string,
    requiredAmount: string | BN,
    includeFees: boolean = true
  ): Promise<{ sufficient: boolean; available: string; required: string; shortfall?: string }> {
    const balance = await this.getBalance(address);
    const requiredBN = typeof requiredAmount === 'string' ? new BN(requiredAmount) : requiredAmount;
    const availableBN = new BN(balance.available);

    // If we need to include fees, we'll estimate them
    // For now, we'll add a small buffer (0.01 DOT) for fees
    const feeBuffer = includeFees ? new BN(10_000_000_000) : new BN(0); // 0.01 DOT
    const totalRequired = requiredBN.add(feeBuffer);

    const sufficient = availableBN.gte(totalRequired);
    const shortfall = sufficient ? undefined : totalRequired.sub(availableBN).toString();

    return {
      sufficient,
      available: balance.available,
      required: totalRequired.toString(),
      shortfall,
    };
  }

  /**
   * Estimate transaction fee
   */
  protected async estimateFee(
    extrinsic: any,
    address: string
  ): Promise<string> {
    try {
      const api = this.getApi();
      const { partialFee } = await extrinsic.paymentInfo(address);
      return partialFee.toString();
    } catch (error) {
      // If fee estimation fails, return a conservative estimate
      return '1000000000'; // 0.001 DOT
    }
  }

  /**
   * Format amount for display (convert from Planck to DOT)
   */
  protected formatAmount(amount: string | BN, decimals: number = 10): string {
    const amountBN = typeof amount === 'string' ? new BN(amount) : amount;
    const divisor = new BN(10).pow(new BN(decimals));
    const whole = amountBN.div(divisor).toString();
    const fraction = amountBN.mod(divisor).toString().padStart(decimals, '0');
    return `${whole}.${fraction}`;
  }

  /**
   * Parse amount from human-readable format to Planck
   */
  protected parseAmount(amount: string | number, decimals: number = 10): BN {
    const amountStr = typeof amount === 'number' ? amount.toString() : amount;
    const [whole, fraction = ''] = amountStr.split('.');
    const fractionPadded = fraction.padEnd(decimals, '0').slice(0, decimals);
    const wholeBN = new BN(whole || '0');
    const fractionBN = new BN(fractionPadded || '0');
    const divisor = new BN(10).pow(new BN(decimals));
    return wholeBN.mul(divisor).add(fractionBN);
  }

  /**
   * Create a standardized agent result
   */
  protected createResult(
    description: string,
    extrinsic?: any,
    options: {
      estimatedFee?: string;
      warnings?: string[];
      metadata?: Record<string, any>;
      data?: any;
      resultType?: 'extrinsic' | 'data' | 'mixed' | 'confirmation';
      requiresConfirmation?: boolean;
      executionType?: 'extrinsic' | 'data_fetch' | 'validation' | 'user_input';
    } = {}
  ): AgentResult {
    const {
      estimatedFee,
      warnings,
      metadata,
      data,
      resultType = extrinsic ? 'extrinsic' : 'data',
      requiresConfirmation = true,
      executionType = extrinsic ? 'extrinsic' : 'data_fetch',
    } = options;

    return {
      description,
      extrinsic,
      estimatedFee,
      warnings,
      metadata,
      data,
      resultType,
      requiresConfirmation,
      executionType,
    };
  }

  /**
   * Get agent name (for logging/debugging)
   */
  abstract getAgentName(): string;
}

