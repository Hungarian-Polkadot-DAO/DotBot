/**
 * Base Agent Class
 * 
 * Base class for all agents providing common functionality.
 * All agents should extend this class for standardized behavior.
 */

import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { decodeAddress, encodeAddress } from '@polkadot/keyring';
import { isAddress } from '@polkadot/util-crypto';
import { BN } from '@polkadot/util';
import { AgentResult, AgentError, ValidationResult, BalanceInfo, DryRunResult, SimulationStatusCallback } from './types';
import type { RpcManager } from '../rpcManager';

export abstract class BaseAgent {
  protected api: ApiPromise | null = null;
  protected assetHubApi: ApiPromise | null = null;
  protected onStatusUpdate: SimulationStatusCallback | null = null;
  protected relayChainManager: RpcManager | null = null;
  protected assetHubManager: RpcManager | null = null;

  /**
   * Initialize the agent with a Polkadot API instance
   * 
   * @param api Polkadot Relay Chain API instance
   * @param assetHubApi Optional Asset Hub API instance (recommended for DOT operations)
   * @param onStatusUpdate Optional callback for simulation status updates
   * @param relayChainManager Optional RPC manager for Relay Chain endpoints
   * @param assetHubManager Optional RPC manager for Asset Hub endpoints
   */
  initialize(
    api: ApiPromise, 
    assetHubApi?: ApiPromise | null, 
    onStatusUpdate?: SimulationStatusCallback | null,
    relayChainManager?: RpcManager | null,
    assetHubManager?: RpcManager | null
  ): void {
    this.api = api;
    this.assetHubApi = assetHubApi || null;
    this.onStatusUpdate = onStatusUpdate || null;
    this.relayChainManager = relayChainManager || null;
    this.assetHubManager = assetHubManager || null;
  }

  /**
   * Ensure address is in SS58 format for Polkadot (prefix 0)
   */
  protected ensurePolkadotAddress(address: string): string {
    try {
      // Decode to get raw bytes
      const decoded = decodeAddress(address);
      // Re-encode with Polkadot prefix (0)
      return encodeAddress(decoded, 0);
    } catch {
      // If decode fails, address is invalid - return as is (will fail validation later)
      return address;
    }
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
   * Get account balance information (defaults to relay chain)
   */
  protected async getBalance(address: string): Promise<BalanceInfo> {
    const api = this.getApi();
    const accountInfo = await api.query.system.account(address);
    
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
   * Get account balance from Asset Hub
   */
  protected async getAssetHubBalance(address: string): Promise<BalanceInfo | null> {
    if (!this.assetHubApi) {
      // Try to reconnect if we have the manager
      if (this.assetHubManager) {
        try {
          this.assetHubApi = await this.assetHubManager.connect();
        } catch (error) {
          console.error('Failed to reconnect to Asset Hub for balance check:', error);
          return null;
        }
      } else {
        return null;
      }
    }

    try {
      const accountInfo = await this.assetHubApi.query.system.account(address);
      
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
    } catch (error) {
      // Failed to fetch Asset Hub balance
      return null;
    }
  }

  /**
   * DEPRECATED: Do not use this method!
   * 
   * This method incorrectly infers chain selection from balance.
   * Chain selection MUST be explicit based on user intent.
   * 
   * Use getBalanceOnChain() with explicit chain parameter instead.
   * 
   * @deprecated Use getBalanceOnChain(chain, address) instead
   */
  protected async getDotBalance(address: string): Promise<{
    balance: BalanceInfo;
    chain: 'relay' | 'assetHub';
  }> {
    // DEPRECATED: Use getBalanceOnChain() with explicit chain parameter
    
    // For backward compatibility, default to Asset Hub
    const assetHubBalance = await this.getAssetHubBalance(address);
    if (assetHubBalance) {
      return { balance: assetHubBalance, chain: 'assetHub' };
    }

    // Fall back to relay chain
    const relayBalance = await this.getBalance(address);
    return { balance: relayBalance, chain: 'relay' };
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
      const { partialFee } = await extrinsic.paymentInfo(address);
      return partialFee.toString();
    } catch (error) {
      // If fee estimation fails, return a conservative estimate
      return '1000000000'; // 0.001 DOT
    }
  }

  /**
   * Dry-run an extrinsic to validate it before returning to user
   * This catches runtime errors BEFORE the user sees the transaction
   * 
   * Uses Chopsticks for real runtime simulation (fork-based execution)
   * Falls back to paymentInfo if Chopsticks is unavailable (with warning)
   * 
   * @param api The API instance that created the extrinsic (MUST match!)
   * @param extrinsic The extrinsic to validate
   * @param address The sender address
   * @param rpcEndpoint Optional RPC endpoint for Chopsticks (defaults to api endpoint)
   * @returns DryRunResult with success status and fee estimation
   */
  protected async dryRunExtrinsic(
    api: ApiPromise,
    extrinsic: SubmittableExtrinsic<'promise'>,
    address: string,
    rpcEndpoint?: string | string[]
  ): Promise<DryRunResult> {
    // CRITICAL: Ensure API is ready before any operations
    if (!api.isReady) {
      await api.isReady;
    }
    
    // Validate extrinsic is properly formed
    if (!extrinsic || !extrinsic.method || !extrinsic.method.section || !extrinsic.method.method) {
      throw new Error('Invalid extrinsic: missing method information');
    }
    
    let chopsticksError: any = null;
    
    // Try Chopsticks simulation first (real runtime execution)
    try {
      const { simulateTransaction, isChopsticksAvailable } = await import(
        '../../services/simulation'
      );
      
      if (await isChopsticksAvailable()) {
        // Use RPC manager endpoints if available, otherwise fallback
        const chain = api === this.assetHubApi ? 'assetHub' : 'relay';
        const endpoints = rpcEndpoint 
          ? (Array.isArray(rpcEndpoint) ? rpcEndpoint : [rpcEndpoint])
          : this.getRpcEndpointsForChain(chain);
        console.log('[Simulation] Using Chopsticks for runtime validation with endpoints:', endpoints);
        
        // Pass status callback to simulation for user feedback
        const result = await simulateTransaction(api, endpoints, extrinsic, address, this.onStatusUpdate || undefined);
        
        const dryRunResult: DryRunResult = result.success ? {
          success: true,
          estimatedFee: result.estimatedFee,
          wouldSucceed: true,
          validationMethod: 'chopsticks',
          balanceChanges: result.balanceChanges.map((bc: any) => ({
            value: bc.value.toString(),
            change: bc.change,
          })),
          runtimeInfo: {
            validated: true,
            events: result.events.length,
          },
        } : {
          success: false,
          error: result.error || 'Simulation failed',
          estimatedFee: result.estimatedFee,
          wouldSucceed: false,
          validationMethod: 'chopsticks',
        };

        // Send result to status callback
        if (this.onStatusUpdate && (dryRunResult.success || dryRunResult.error)) {
          this.onStatusUpdate({
            phase: dryRunResult.success ? 'complete' : 'error',
            message: dryRunResult.success 
              ? `✓ Simulation successful!` 
              : `✗ Simulation failed: ${dryRunResult.error}`,
            progress: 100,
            result: {
              success: dryRunResult.success,
              estimatedFee: dryRunResult.estimatedFee,
              validationMethod: dryRunResult.validationMethod,
              balanceChanges: dryRunResult.balanceChanges,
              runtimeInfo: dryRunResult.runtimeInfo,
              error: dryRunResult.error,
              wouldSucceed: dryRunResult.wouldSucceed,
            },
          });
        }

        if (result.success) {
          console.log('[Simulation] ✓ Chopsticks validation passed');
          return dryRunResult;
        } else {
          console.log('[Simulation] ✗ Chopsticks validation failed:', result.error);
          return dryRunResult;
        }
      } else {
        console.log('[Simulation] Chopsticks not available, falling back to paymentInfo');
      }
    } catch (error) {
      chopsticksError = error;
      console.warn('[Simulation] Chopsticks error (falling back to paymentInfo):', 
        error instanceof Error ? error.message : String(error));
    }
    
    // Fallback: Use paymentInfo (structure validation only)
    // WARNING: This does NOT validate runtime execution!
    // CRITICAL: Ensure API is ready and extrinsic is valid before calling paymentInfo
    try {
      // Ensure API is ready
      if (!api.isReady) {
        await api.isReady;
      }
      
      // Validate extrinsic before calling paymentInfo
      // This helps catch invalid extrinsic shapes before they cause runtime panics
      if (!extrinsic.method || !extrinsic.method.section || !extrinsic.method.method) {
        throw new Error('Invalid extrinsic structure: missing method information');
      }
      
      // Ensure address is valid SS58 format
      if (!address || address.trim().length === 0) {
        throw new Error('Invalid address for paymentInfo');
      }
      
      // Call paymentInfo with error handling for runtime panics
      const paymentInfo = await extrinsic.paymentInfo(address);
      const estimatedFee = paymentInfo.partialFee.toString();
      
      console.warn('[Simulation] ⚠ Using paymentInfo only - runtime execution NOT validated!');
      
      const paymentInfoResult: DryRunResult = {
        success: true,
        estimatedFee,
        wouldSucceed: true,
        validationMethod: 'paymentInfo',
        runtimeInfo: {
          weight: paymentInfo.weight.toString(),
          class: paymentInfo.class.toString(),
          validated: false,
          warning: 'Runtime execution not validated - paymentInfo only checks structure',
          chopsticksError: chopsticksError ? (chopsticksError instanceof Error ? chopsticksError.message : String(chopsticksError)) : undefined,
        },
      };

      // Send result to status callback
      if (this.onStatusUpdate) {
        this.onStatusUpdate({
          phase: 'complete',
          message: '⚠️ Using basic validation (Chopsticks unavailable)',
          progress: 100,
          details: 'Runtime execution not validated - paymentInfo only checks structure',
          result: {
            success: paymentInfoResult.success,
            estimatedFee: paymentInfoResult.estimatedFee,
            validationMethod: paymentInfoResult.validationMethod,
            runtimeInfo: paymentInfoResult.runtimeInfo,
            wouldSucceed: paymentInfoResult.wouldSucceed,
          },
        });
      }

      return paymentInfoResult;
    } catch (error) {
      console.error('[Simulation] ✗ paymentInfo also failed:', error);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      return {
        success: false,
        error: errorMessage,
        estimatedFee: '0',
        wouldSucceed: false,
        validationMethod: 'paymentInfo',
      };
    }
  }

  /**
   * Get RPC endpoints for a chain using RPC manager if available
   * Returns ordered list of healthy endpoints for round-robin
   */
  protected getRpcEndpointsForChain(chain: 'assetHub' | 'relay'): string[] {
    const manager = chain === 'assetHub' ? this.assetHubManager : this.relayChainManager;
    
    if (manager) {
      // Get current endpoint first (the one API is connected to)
      const currentEndpoint = manager.getCurrentEndpoint();
      
      // Get all endpoints from manager (it handles health and ordering)
      const healthStatus = manager.getHealthStatus();
      const now = Date.now();
      const failoverTimeout = 5 * 60 * 1000; // 5 minutes
      
      // Filter and sort endpoints
      const orderedEndpoints = healthStatus
        .filter(h => {
          // Include if healthy, or if failure was long ago
          if (h.healthy) return true;
          if (!h.lastFailure) return true;
          return (now - h.lastFailure) >= failoverTimeout;
        })
        .sort((a, b) => {
          // Prioritize current endpoint
          if (a.endpoint === currentEndpoint) return -1;
          if (b.endpoint === currentEndpoint) return 1;
          // Then by health
          if (a.healthy !== b.healthy) return a.healthy ? -1 : 1;
          // Then by failure count
          if (a.failureCount !== b.failureCount) return a.failureCount - b.failureCount;
          // Finally by response time
          if (a.avgResponseTime && b.avgResponseTime) return a.avgResponseTime - b.avgResponseTime;
          return 0;
        })
        .map(h => h.endpoint);
      
      if (orderedEndpoints.length > 0) {
        return orderedEndpoints;
      }
      
      // Fallback to all endpoints if none are healthy
      return healthStatus.map(h => h.endpoint);
    }
    
    // Fallback to hardcoded endpoints if no manager
    return this.getDefaultRpcEndpoints(chain);
  }

  /**
   * Get default RPC endpoints (fallback when RPC manager not available)
   */
  private getDefaultRpcEndpoints(chain: 'assetHub' | 'relay'): string[] {
    if (chain === 'assetHub') {
      return [
        'wss://sys.ibp.network/statemint',
        'wss://sys.dotters.network/statemint',
        'wss://polkadot-asset-hub-rpc.polkadot.io',
      ];
    }
    
    return [
      'wss://rpc.polkadot.io',
      'wss://polkadot-rpc.dwellir.com',
      'wss://polkadot.api.onfinality.io/public-ws',
    ];
  }

  /**
   * Extract RPC endpoint from API instance (legacy method, kept for compatibility)
   */
  private extractRpcEndpoint(api: ApiPromise): string {
    try {
      // Try to get endpoint from API
      const provider = (api as any)._options?.provider;
      if (provider && provider.endpoint) {
        return provider.endpoint;
      }
      
      // Fallback to common endpoints based on genesis hash
      const genesisHash = api.genesisHash.toHex();
      
      // Polkadot
      if (genesisHash === '0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3') {
        return 'wss://rpc.polkadot.io';
      }
      
      // Asset Hub
      if (genesisHash === '0x68d56f15f85d3136970ec16946040bc1752654e906147f7e43e9d539d7c3de2f') {
        return 'wss://polkadot-asset-hub-rpc.polkadot.io';
      }
      
      // Default
      return 'wss://rpc.polkadot.io';
    } catch {
      return 'wss://rpc.polkadot.io';
    }
  }

  /**
   * Get API instance for a specific chain
   * 
   * @param chain The target chain ('assetHub' or 'relay')
   * @returns The corresponding API instance
   * @throws AgentError if the requested API is not available
   */
  protected async getApiForChain(chain: 'assetHub' | 'relay'): Promise<ApiPromise> {
    if (chain === 'assetHub') {
      if (!this.assetHubApi) {
        // Try to reconnect if we have the manager
        if (this.assetHubManager) {
          console.log('🔄 Asset Hub API not available, attempting to reconnect...');
          try {
            this.assetHubApi = await this.assetHubManager.connect();
            console.log(`✅ Asset Hub reconnected via: ${this.assetHubManager.getCurrentEndpoint()}`);
            return this.assetHubApi;
          } catch (error) {
            console.error('❌ Asset Hub reconnection failed:', error);
            throw new AgentError(
              `Asset Hub API not available. Failed to connect to any Asset Hub endpoint: ${error instanceof Error ? error.message : 'Unknown error'}`,
              'ASSET_HUB_NOT_AVAILABLE'
            );
          }
        } else {
          throw new AgentError(
            'Asset Hub API not available. Please ensure Asset Hub connection is initialized.',
            'ASSET_HUB_NOT_AVAILABLE'
          );
        }
      }
      return this.assetHubApi;
    }
    
    // Default to relay chain
    return this.getApi();
  }

  /**
   * Get balance on a specific chain
   * 
   * @param chain The target chain
   * @param address The account address
   * @returns Balance information for that chain
   */
  protected async getBalanceOnChain(
    chain: 'assetHub' | 'relay',
    address: string
  ): Promise<BalanceInfo> {
    if (chain === 'assetHub') {
      const balance = await this.getAssetHubBalance(address);
      if (!balance) {
        throw new AgentError(
          'Unable to fetch Asset Hub balance',
          'ASSET_HUB_BALANCE_FETCH_FAILED'
        );
      }
      return balance;
    }
    
    // Relay chain
    return this.getBalance(address);
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

