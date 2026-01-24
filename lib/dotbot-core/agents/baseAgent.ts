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
import { RpcEndpoints } from '../rpcManager';

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
   * Parse account balance from account info query result
   */
  private parseBalanceFromAccountInfo(accountInfo: any): BalanceInfo {
    const accountData = accountInfo as any;
    const free = accountData.data?.free?.toString() || '0';
    const reserved = accountData.data?.reserved?.toString() || '0';
    const frozen = accountData.data?.frozen?.toString() || '0';
    const available = new BN(free).sub(new BN(frozen)).toString();

    return { free, reserved, frozen, available };
  }

  /**
   * Get account balance information (defaults to relay chain)
   */
  protected async getBalance(address: string): Promise<BalanceInfo> {
    const api = this.getApi();
    const accountInfo = await api.query.system.account(address);
    return this.parseBalanceFromAccountInfo(accountInfo);
  }

  /**
   * Get account balance from Asset Hub
   */
  protected async getAssetHubBalance(address: string): Promise<BalanceInfo | null> {
    if (!this.assetHubApi) {
      if (this.assetHubManager) {
        try {
          this.assetHubApi = await this.assetHubManager.getReadApi();
        } catch {
          return null;
        }
      } else {
        return null;
      }
    }

    try {
      const accountInfo = await this.assetHubApi.query.system.account(address);
      return this.parseBalanceFromAccountInfo(accountInfo);
    } catch {
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
    includeFees = true
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
   * Dry-run an extrinsic to validate it before returning to user.
   * Uses Chopsticks for runtime simulation, falls back to paymentInfo.
   */
  protected async dryRunExtrinsic(
    api: ApiPromise,
    extrinsic: SubmittableExtrinsic<'promise'>,
    address: string,
    rpcEndpoint?: string | string[]
  ): Promise<DryRunResult> {
    await this.ensureApiReady(api);
    this.validateExtrinsic(extrinsic);

    const chopsticksResult = await this.tryChopsticksSimulation(api, extrinsic, address, rpcEndpoint);
    if (chopsticksResult) {
      return chopsticksResult;
    }

    return this.fallbackToPaymentInfo(api, extrinsic, address);
  }

  /**
   * Ensure API is ready
   */
  private async ensureApiReady(api: ApiPromise): Promise<void> {
    if (!api.isReady) {
      await api.isReady;
    }
  }

  /**
   * Validate extrinsic structure
   */
  private validateExtrinsic(extrinsic: SubmittableExtrinsic<'promise'>): void {
    if (!extrinsic || !extrinsic.method || !extrinsic.method.section || !extrinsic.method.method) {
      throw new Error('Invalid extrinsic: missing method information');
    }
  }

  /**
   * Try Chopsticks simulation (server-only)
   */
  private async tryChopsticksSimulation(
    api: ApiPromise,
    extrinsic: SubmittableExtrinsic<'promise'>,
    address: string,
    rpcEndpoint?: string | string[]
  ): Promise<DryRunResult | null> {
    if (typeof window !== 'undefined') {
      return null; // Browser: skip to prevent blocking import
    }

    try {
      const { simulateTransaction, isChopsticksAvailable } = await import('../services/simulation');
      
      if (!(await isChopsticksAvailable())) {
        return null;
      }

      const chain = api === this.assetHubApi ? 'assetHub' : 'relay';
      const endpoints = rpcEndpoint 
        ? (Array.isArray(rpcEndpoint) ? rpcEndpoint : [rpcEndpoint])
        : this.getRpcEndpointsForChain(chain);

      const result = await simulateTransaction(api, endpoints, extrinsic, address, this.onStatusUpdate || undefined);
      const dryRunResult = this.createDryRunResultFromSimulation(result);
      
      this.notifySimulationStatus(dryRunResult);
      return dryRunResult;
    } catch {
      return null;
    }
  }

  /**
   * Create dry run result from simulation result
   */
  private createDryRunResultFromSimulation(result: any): DryRunResult {
    if (result.success) {
      return {
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
      };
    }

    return {
      success: false,
      error: result.error || 'Simulation failed',
      estimatedFee: result.estimatedFee,
      wouldSucceed: false,
      validationMethod: 'chopsticks',
    };
  }

  /**
   * Notify status callback about simulation result
   */
  private notifySimulationStatus(result: DryRunResult): void {
    if (!this.onStatusUpdate || (!result.success && !result.error)) {
      return;
    }

    this.onStatusUpdate({
      phase: result.success ? 'complete' : 'error',
      message: result.success 
        ? '✓ Simulation successful!' 
        : `✗ Simulation failed: ${result.error}`,
      progress: 100,
      result: {
        success: result.success,
        estimatedFee: result.estimatedFee,
        validationMethod: result.validationMethod,
        balanceChanges: result.balanceChanges,
        runtimeInfo: result.runtimeInfo,
        error: result.error,
        wouldSucceed: result.wouldSucceed,
      },
    });
  }

  /**
   * Fallback to paymentInfo validation
   */
  private async fallbackToPaymentInfo(
    api: ApiPromise,
    extrinsic: SubmittableExtrinsic<'promise'>,
    address: string
  ): Promise<DryRunResult> {
    await this.ensureApiReady(api);
    
    if (!address || address.trim().length === 0) {
      throw new Error('Invalid address for paymentInfo');
    }

    try {
      const paymentInfo = await extrinsic.paymentInfo(address);
      const result = this.createPaymentInfoResult(paymentInfo);
      this.notifyPaymentInfoStatus(result);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        estimatedFee: '0',
        wouldSucceed: false,
        validationMethod: 'paymentInfo',
      };
    }
  }

  /**
   * Create result from paymentInfo
   */
  private createPaymentInfoResult(paymentInfo: any): DryRunResult {
    return {
      success: true,
      estimatedFee: paymentInfo.partialFee.toString(),
      wouldSucceed: true,
      validationMethod: 'paymentInfo',
      runtimeInfo: {
        weight: paymentInfo.weight.toString(),
        class: paymentInfo.class.toString(),
        validated: false,
        warning: 'Runtime execution not validated - paymentInfo only checks structure',
      },
    };
  }

  /**
   * Notify status callback about paymentInfo result
   */
  private notifyPaymentInfoStatus(result: DryRunResult): void {
    if (!this.onStatusUpdate) {
      return;
    }

    this.onStatusUpdate({
      phase: 'complete',
      message: '⚠️ Using basic validation (Chopsticks unavailable)',
      progress: 100,
      details: 'Runtime execution not validated - paymentInfo only checks structure',
      result: {
        success: result.success,
        estimatedFee: result.estimatedFee,
        validationMethod: result.validationMethod,
        runtimeInfo: result.runtimeInfo,
        wouldSucceed: result.wouldSucceed,
      },
    });
  }

  /**
   * Get RPC endpoints for a chain using RPC manager if available
   * Returns ordered list of healthy endpoints for round-robin
   */
  protected getRpcEndpointsForChain(chain: 'assetHub' | 'relay'): string[] {
    const manager = chain === 'assetHub' ? this.assetHubManager : this.relayChainManager;
    
    if (!manager) {
      return this.getDefaultRpcEndpoints(chain);
    }

    const orderedEndpoints = this.getOrderedEndpoints(manager);
    return orderedEndpoints.length > 0 
      ? orderedEndpoints 
      : manager.getHealthStatus().map(h => h.endpoint);
  }

  /**
   * Get ordered endpoints from manager (healthy first, sorted by priority)
   */
  private getOrderedEndpoints(manager: RpcManager): string[] {
    const currentEndpoint = manager.getCurrentEndpoint() || '';
    const healthStatus = manager.getHealthStatus();
    const now = Date.now();
    const failoverTimeout = 5 * 60 * 1000; // 5 minutes

    return healthStatus
      .filter(h => h.healthy || !h.lastFailure || (now - h.lastFailure) >= failoverTimeout)
      .sort((a, b) => this.compareEndpoints(a, b, currentEndpoint))
      .map(h => h.endpoint);
  }

  /**
   * Compare endpoints for sorting (current first, then health, then failures, then response time)
   */
  private compareEndpoints(a: any, b: any, currentEndpoint: string | null): number {
    if (a.endpoint === currentEndpoint) return -1;
    if (b.endpoint === currentEndpoint) return 1;
    if (a.healthy !== b.healthy) return a.healthy ? -1 : 1;
    if (a.failureCount !== b.failureCount) return a.failureCount - b.failureCount;
    if (a.avgResponseTime && b.avgResponseTime) return a.avgResponseTime - b.avgResponseTime;
    return 0;
  }

  /**
   * Get default RPC endpoints (fallback when RPC manager not available)
   */
  private getDefaultRpcEndpoints(chain: 'assetHub' | 'relay'): string[] {
    // Fallback to Polkadot mainnet endpoints if no manager available
    if (chain === 'assetHub') {
      return RpcEndpoints.POLKADOT_ASSET_HUB.slice(0, 3);
    }
    
    return RpcEndpoints.POLKADOT_RELAY_CHAIN.slice(0, 3);
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
   * Get API instance for a specific chain.
   * Validates the API is connected to the expected chain type.
   */
  protected async getApiForChain(chain: 'assetHub' | 'relay'): Promise<ApiPromise> {
    const api = chain === 'assetHub' 
      ? await this.getAssetHubApi()
      : this.getApi();

    await this.ensureApiReady(api);
    this.validateChainMatch(api, chain);
    
    return api;
  }

  /**
   * Get Asset Hub API, reconnecting if needed
   */
  private async getAssetHubApi(): Promise<ApiPromise> {
    if (this.assetHubApi && await this.isValidAssetHubApi(this.assetHubApi)) {
      return this.assetHubApi;
    }

    this.assetHubApi = null;
    
    if (!this.assetHubManager) {
      throw new AgentError(
        'Asset Hub API not available. Please ensure Asset Hub connection is initialized.',
        'ASSET_HUB_NOT_AVAILABLE'
      );
    }

    try {
      this.assetHubApi = await this.assetHubManager.getReadApi();
      await this.assetHubApi.isReady;
      
      if (!(await this.isValidAssetHubApi(this.assetHubApi))) {
        this.assetHubApi = null;
        throw new AgentError(
          `Asset Hub manager returned wrong chain. Expected Asset Hub but got relay chain.`,
          'ASSET_HUB_WRONG_CHAIN'
        );
      }

      return this.assetHubApi;
    } catch (error) {
      this.assetHubApi = null;
      if (error instanceof AgentError) {
        throw error;
      }
      throw new AgentError(
        `Asset Hub API not available. Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'ASSET_HUB_NOT_AVAILABLE'
      );
    }
  }

  /**
   * Check if API is valid Asset Hub
   */
  private async isValidAssetHubApi(api: ApiPromise): Promise<boolean> {
    try {
      await api.isReady;
      return this.isAssetHubChain(api);
    } catch {
      return false;
    }
  }

  /**
   * Check if API is connected to Asset Hub chain
   */
  private isAssetHubChain(api: ApiPromise): boolean {
    const runtimeChain = api.runtimeChain?.toString() || 'Unknown';
    const specName = api.runtimeVersion?.specName?.toString() || 'unknown';
    
    return runtimeChain.toLowerCase().includes('asset') ||
           runtimeChain.toLowerCase().includes('statemint') ||
           specName.toLowerCase().includes('asset') ||
           specName.toLowerCase().includes('statemint');
  }

  /**
   * Validate API matches requested chain
   */
  private validateChainMatch(api: ApiPromise, requestedChain: 'assetHub' | 'relay'): void {
    if (requestedChain === 'assetHub' && !this.isAssetHubChain(api)) {
      const runtimeChain = api.runtimeChain?.toString() || 'Unknown';
      const specName = api.runtimeVersion?.specName?.toString() || 'unknown';
      
      throw new AgentError(
        `API chain mismatch: Requested Asset Hub but API is connected to "${runtimeChain}" (${specName}). ` +
        `This would cause extrinsic construction on the wrong runtime.`,
        'API_CHAIN_MISMATCH',
        { requested: 'assetHub', actual: runtimeChain, specName }
      );
    }
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
   * Format amount for display (convert from Planck to human-readable)
   * 
   * CRITICAL: Uses chain decimals from API registry, not hardcoded 10!
   * - Polkadot: 10 decimals (DOT)
   * - Kusama: 12 decimals (KSM)
   * - Westend: 12 decimals (WND)
   * 
   * @param amount Amount in Planck (smallest unit)
   * @param decimals Optional decimals (defaults to API registry decimals or 10)
   */
  protected formatAmount(amount: string | BN, decimals?: number): string {
    const amountBN = typeof amount === 'string' ? new BN(amount) : amount;
    
    // Get decimals from API registry if not provided
    // CRITICAL: This ensures correct formatting for all networks
    let actualDecimals = decimals;
    if (actualDecimals === undefined) {
      const api = this.getApi();
      actualDecimals = api.registry.chainDecimals?.[0] || 10;
    }
    
    const divisor = new BN(10).pow(new BN(actualDecimals));
    const whole = amountBN.div(divisor).toString();
    const fraction = amountBN.mod(divisor).toString().padStart(actualDecimals, '0');
    
    // Remove trailing zeros for cleaner display
    const trimmedFraction = fraction.replace(/0+$/, '');
    if (trimmedFraction === '') {
      return whole;
    }
    return `${whole}.${trimmedFraction}`;
  }

  /**
   * Parse amount from human-readable format to Planck
   */
  protected parseAmount(amount: string | number, decimals = 10): BN {
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

