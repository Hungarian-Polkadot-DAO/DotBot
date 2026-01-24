/**
 * StateAllocator
 * 
 * Sets up initial state for scenario execution.
 * 
 * **ARCHITECTURE PRINCIPLE**: StateAllocator prepares the REAL environment for testing.
 * It does NOT create duplicate/shadow state. It modifies what DotBot will see.
 * 
 * ## Current Implementation Status
 * 
 * ### LIVE Mode: ✅ READY
 * 
 * **Wallet/Account Balances**:
 * - Batch transfers from user's wallet to test accounts (single signature)
 * - Creates REAL balances on REAL Westend testnet
 * - DotBot queries the REAL chain and sees these balances
 * - ✅ No duplicate state - DotBot and tests see the same thing
 * 
 * **On-chain Entities (Multisigs, Proxies)**:
 * - Submit actual multisig creation transactions to Westend
 * - Creates REAL multisigs on REAL chain
 * - DotBot queries the REAL chain and sees these multisigs
 * 
 * **Local Storage & Chat History**:
 * - Populate browser localStorage with test data
 * - DotBot reads this localStorage normally
 * 
 * ### SYNTHETIC Mode: ⚠️ TODO (Disabled)
 * 
 * Future implementation would:
 * - NOT create duplicate state
 * - Instead: Mock DotBot's LLM responses entirely (the LLM responses itself shouldn't be mocked)
 * - Don't run real DotBot at all - just verify response structure
 * - Fast unit testing without any chain interaction
 * 
 * ### EMULATED Mode: ⚠️ TODO (Disabled)
 * 
 * Future implementation would:
 * - Create Chopsticks fork
 * - Use `setStorage` to set balances on fork
 * - **Reconfigure DotBot's API** to use Chopsticks fork (not real chain)
 * - DotBot must query Chopsticks, not real chain
 * - ✅ No duplicate state - DotBot uses fork, StateAllocator sets up fork
 * 
 * ## Example: Live Mode Usage
 * 
 * ```typescript
 * // User's wallet will be used to fund entities
 * await stateAllocator.allocateWalletState({
 *   accounts: [
 *     { entityName: "Alice", balance: "100 WND" },  // Real transfer on Westend
 *     { entityName: "Bob", balance: "50 WND" },
 *     { entityName: "Charlie", balance: "50 WND" }
 *   ]
 * });
 * // All transfers are batched into a single transaction
 * // User signs once via wallet extension (Talisman, Subwallet, etc.)
 * 
 * // Now DotBot can query the chain and see these balances!
 * // No duplicate state - it's all on the real chain.
 * ```
 */

import type {
  TestEntity,
  ScenarioMode,
  ScenarioChain,
  WalletStateConfig,
  OnchainStateConfig,
  LocalStateConfig,
  BalanceOverrides,
  StakingSetup,
  GovernanceSetup,
  AssetState,
  ChatSnapshot,
} from '../types';
import type { ApiPromise } from '@polkadot/api';
import { ApiPromise as ApiPromiseClass, WsProvider } from '@polkadot/api';
import { BN } from '@polkadot/util';
import { decodeAddress } from '@polkadot/util-crypto';
import { ChatInstanceManager } from '../../chatInstanceManager';
// NOTE: Chopsticks imports removed - emulated mode not currently supported
// Emulated mode would require server-side Chopsticks setup
import type { Network, RpcManager } from '../../rpcManager';
import { getEndpointsForNetwork } from '../../rpcManager';
import type { ConversationItem, TextMessage, SystemMessage } from '../../types/chatInstance';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Custom error for funding requirements
 * This error type signals that execution should stop immediately
 * Used when user's wallet doesn't have sufficient balance for transfers
 */
export class FundingRequiredError extends Error {
  constructor(
    message: string,
    public readonly walletAddress: string,
    public readonly faucetLink: string,
    public readonly currentBalance?: string,
    public readonly requiredBalance?: string
  ) {
    super(message);
    this.name = 'FundingRequiredError';
    // Ensure this error is not caught and ignored
    Object.setPrototypeOf(this, FundingRequiredError.prototype);
  }
}

export interface StateAllocatorConfig {
  /** Execution mode */
  mode: ScenarioMode;
  
  /** Target chain */
  chain: ScenarioChain;
  
  /** Entity resolver function */
  entityResolver: (name: string) => TestEntity | undefined;
  
  /** Optional RPC manager provider (for integration with core RPC manager system) */
  rpcManagerProvider?: () => {
    relayChainManager?: RpcManager;
    assetHubManager?: RpcManager;
  } | null;
  
  /** Chopsticks endpoint (for emulated mode, optional if rpcManagerProvider provided) */
  chopsticksEndpoint?: string;
  
  /** RPC endpoint (for live mode, optional if rpcManagerProvider provided) */
  rpcEndpoint?: string;
  
  /** SS58 format for address encoding (0 = Polkadot, 42 = Westend) */
  ss58Format?: number;
  
  /** Seed prefix for deterministic generation */
  seedPrefix?: string;
  
  /** User's wallet account (for live mode transfers) */
  walletAccount?: {
    address: string;
    name?: string;
    source: string;
  };
  
  /** Signer for live mode transactions (browser wallet) */
  signer?: any; // Signer from executionEngine/signers/types
}

export interface AllocationResult {
  /** Whether allocation succeeded */
  success: boolean;
  
  /** Allocated balances */
  balances: Map<string, { free: string; reserved?: string }>;
  
  /** Allocated assets */
  assets: Map<string, AssetState[]>;
  
  /** Any warnings */
  warnings: string[];
  
  /** Errors if failed */
  errors: string[];
  
  /** Transaction hashes (for live mode) */
  txHashes?: string[];
  
  /** Pending transfers to batch (for live mode) */
  pendingTransfers?: Array<{ address: string; planck: string }>;
}

// =============================================================================
// STATE ALLOCATOR CLASS
// =============================================================================

export class StateAllocator {
  private config: StateAllocatorConfig;
  private initialized = false;
  // NOTE: Chopsticks properties removed - emulated mode is disabled
  // private chopsticksChain: any = null;
  // private chopsticksApi: ApiPromise | null = null;
  private api: ApiPromise | null = null; // Polkadot.js API for live mode
  private executionSession: any = null; // Execution session for live mode (keeps API alive)
  private chatManager: ChatInstanceManager;

  constructor(config: StateAllocatorConfig) {
    // Set defaults for ss58Format and seedPrefix
    const ss58Format = config.ss58Format ?? (config.chain === 'polkadot' || config.chain === 'asset-hub-polkadot' ? 0 : 42);
    const seedPrefix = config.seedPrefix ?? 'dotbot-scenario';
    
    this.config = {
      ...config,
      ss58Format,
      seedPrefix,
    };
    this.chatManager = new ChatInstanceManager();
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Initialize the allocator
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    if (this.config.mode === 'emulated') {
      await this.connectToChopsticks();
    } else if (this.config.mode === 'live') {
      await this.connectToRpc();
    }
    
    this.initialized = true;
  }

  /**
   * Connect to Chopsticks for emulated mode
   * 
   * NOTE: Emulated mode is currently disabled. Chopsticks setup now happens on the server.
   * This functionality would need to be moved to @dotbot/express if emulated mode is needed.
   */
  private async connectToChopsticks(): Promise<void> {
    throw new Error(
      'Emulated mode is not currently supported. Chopsticks setup has been moved to the server (@dotbot/express). ' +
      'Please use "live" or "synthetic" mode instead, or implement emulated mode on the server side.'
    );
  }

  /**
   * Connect to RPC for live mode
   */
  private async connectToRpc(): Promise<void> {
    // Try to use RPC manager if available (for execution session)
    if (this.config.rpcManagerProvider) {
      const managers = this.config.rpcManagerProvider();
      if (managers) {
        const manager = this.isAssetHubChain() 
          ? managers.assetHubManager 
          : managers.relayChainManager;
        
        if (manager) {
          // Use execution session for live mode (locks API instance)
          const session = await manager.createExecutionSession();
          this.executionSession = session; // Keep session alive
          this.api = session.api;
          
          // Verify API is connected to the correct chain
          await this.api.isReady;
          const runtimeChain = this.api.runtimeChain?.toString() || 'Unknown';
          const specName = this.api.runtimeVersion?.specName?.toString() || 'unknown';
          const chainType = this.isAssetHubChain() ? 'Asset Hub' : 'Relay Chain';
          console.log(`[StateAllocator] Connected to ${chainType} for ${this.config.chain} via RPC manager`);
          console.log(`[StateAllocator] API runtime: ${runtimeChain} (${specName})`);
          
          return;
        }
      }
    }

    // Fallback to direct connection if no manager provided
    const rpcEndpoints = this.getRpcEndpoints();
    if (!rpcEndpoints || rpcEndpoints.length === 0) {
      throw new Error(`No RPC endpoints available for chain: ${this.config.chain}`);
    }

    // Use first endpoint (best one from manager or fallback)
    const rpcEndpoint = rpcEndpoints[0];

    try {
      const provider = new WsProvider(rpcEndpoint);
      this.api = await ApiPromiseClass.create({ provider });
      console.log(`[StateAllocator] Connected to RPC for ${this.config.chain} at ${rpcEndpoint}`);
    } catch (error) {
      throw new Error(`Failed to connect to RPC: ${error}`);
    }
  }

  /**
   * Get RPC endpoints for the chain (using RPC manager if available)
   */
  private getRpcEndpoints(): string[] {
    // Try to use RPC manager if available
    if (this.config.rpcManagerProvider) {
      const managers = this.config.rpcManagerProvider();
      if (managers) {
        const manager = this.isAssetHubChain() 
          ? managers.assetHubManager 
          : managers.relayChainManager;
        
        if (manager) {
          // Get ordered endpoints from manager (handles round-robin and health)
          const healthStatus = manager.getHealthStatus();
          const currentEndpoint = manager.getCurrentEndpoint();
          const now = Date.now();
          const failoverTimeout = 5 * 60 * 1000; // 5 minutes
          
          // Filter and sort endpoints (same logic as BaseAgent.getRpcEndpointsForChain)
          const orderedEndpoints = healthStatus
            .filter(h => {
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
      }
    }

    // Fallback: use getEndpointsForNetwork if no manager
    const network = this.getNetworkFromChain(this.config.chain);
    const endpoints = getEndpointsForNetwork(network);
    const chainEndpoints = this.isAssetHubChain() 
      ? endpoints.assetHub 
      : endpoints.relayChain;
    
    // If explicit endpoint provided, use it first
    if (this.config.rpcEndpoint) {
      return [this.config.rpcEndpoint, ...chainEndpoints];
    }
    
    return chainEndpoints;
  }

  /**
   * Check if chain is an Asset Hub chain
   */
  private isAssetHubChain(): boolean {
    return this.config.chain.includes('asset-hub');
  }

  /**
   * Allocate wallet state (balances and assets)
   */
  async allocateWalletState(
    config: WalletStateConfig
  ): Promise<AllocationResult> {
    this.ensureInitialized();
    
    const result: AllocationResult = {
      success: true,
      balances: new Map(),
      assets: new Map(),
      warnings: [],
      errors: [],
    };

    // For live mode, check user's wallet balance
    // First, calculate how much we actually need by checking each account's current balance
    if (this.config.mode === 'live') {
      if (!this.config.walletAccount || !this.config.signer) {
        throw new Error('Wallet account and signer are required for live mode transfers');
      }
      
      try {
        const chainName = this.isAssetHubChain() ? 'Asset Hub' : 'Relay Chain';
        console.log(`[StateAllocator] Checking wallet balance and account balances on ${chainName} (chain: ${this.config.chain})`);
        
        await this.api!.isReady;
        
        // Calculate total needed by checking each account's current balance
        let totalNeeded = new BN(0);
        for (const accountConfig of config.accounts) {
          const entity = this.config.entityResolver(accountConfig.entityName);
          if (!entity) continue;
          
          const requiredBalance = this.parseBalance(accountConfig.balance);
          const currentBalance = await this.getCurrentBalance(entity.address);
          const requiredBN = new BN(requiredBalance.planck);
          
          if (currentBalance.lt(requiredBN)) {
            const needed = requiredBN.sub(currentBalance);
            totalNeeded = totalNeeded.add(needed);
            console.log(`[StateAllocator] ${accountConfig.entityName} needs ${this.formatBalance(needed.toString())} (has ${this.formatBalance(currentBalance.toString())}, needs ${accountConfig.balance})`);
          } else {
            console.log(`[StateAllocator] ${accountConfig.entityName} already has sufficient balance (${this.formatBalance(currentBalance.toString())} >= ${accountConfig.balance})`);
          }
        }
        
        // Check wallet balance
        const accountInfo = await this.api!.query.system.account(this.config.walletAccount.address);
        const accountData = (accountInfo as any).data;
        const freeBalance = new BN(accountData.free.toString());
        const reservedBalance = new BN(accountData.reserved.toString());
        const availableBalance = freeBalance.sub(reservedBalance);
        
        const token = this.config.chain.includes('polkadot') ? 'DOT' : 'WND';
        console.log(`[StateAllocator] Wallet balance on ${chainName}: ${this.formatBalance(availableBalance.toString(), token)}`);
        
        // If no transfers needed, skip wallet balance check
        if (totalNeeded.isZero()) {
          console.log(`[StateAllocator] All accounts have sufficient balances, no transfers needed`);
        } else {
          // Reserve some balance for fees (rough estimate: 0.1 DOT per transfer, minimum 0.1 DOT)
          const transferCount = config.accounts.length;
          const feeReserve = this.parseBalance('0.1 DOT').planck;
          const requiredBalance = totalNeeded.add(new BN(feeReserve));
          
          if (availableBalance.lt(requiredBalance)) {
            const needed = this.formatBalance(requiredBalance.sub(availableBalance).toString());
            const current = this.formatBalance(availableBalance.toString(), token);
            throw new FundingRequiredError(
              `⚠️  INSUFFICIENT BALANCE\n\n` +
              `   Chain: ${chainName} (${this.config.chain})\n` +
              `   Your Wallet: ${this.config.walletAccount.address}\n\n` +
              `   Current Balance: ${current}\n` +
              `   Required: ${needed} (for ${transferCount} entities + fees)\n\n` +
              `   Please fund your wallet and try again.`,
              this.config.walletAccount.address,
              this.config.chain === 'westend' ? 'https://faucet.polkadot.io/westend' : 'https://faucet.polkadot.io',
              current,
              needed
            );
          }
        }
      } catch (error) {
        if (error instanceof FundingRequiredError) {
          throw error;
        }
        throw new Error(`Failed to check wallet balance: ${error}`);
      }
    }

    for (const accountConfig of config.accounts) {
      try {
        // Resolve entity name to address
        const entity = this.config.entityResolver(accountConfig.entityName);
        if (!entity) {
          result.errors.push(`Entity "${accountConfig.entityName}" not found`);
          result.success = false;
          continue;
        }

        // Allocate balance based on mode
        await this.allocateBalance(
          entity.address,
          accountConfig.balance,
          result
        );

        // Allocate assets if specified
        if (accountConfig.assets) {
          await this.allocateAssets(
            entity.address,
            accountConfig.assets,
            result
          );
        }
      } catch (error) {
        // If it's a FundingRequiredError, re-throw it immediately to stop execution
        if (error instanceof FundingRequiredError) {
          throw error;
        }
        // For synthetic/emulated modes, throw immediately (not implemented)
        if (this.config.mode === 'synthetic' || this.config.mode === 'emulated') {
          throw error;
        }
        result.errors.push(
          `Failed to allocate state for "${accountConfig.entityName}": ${error}`
        );
        result.success = false;
      }
    }

    // For live mode, batch all transfers into a single transaction
    if (this.config.mode === 'live') {
      if (result.pendingTransfers && result.pendingTransfers.length > 0) {
        console.log(`[StateAllocator] Batching ${result.pendingTransfers.length} transfers for accounts that need funding`);
        await this.batchTransfers(result.pendingTransfers, result);
        result.pendingTransfers = []; // Clear after batching
      } else {
        console.log(`[StateAllocator] All accounts already have sufficient balances, skipping transfers`);
      }
    }

    return result;
  }

  /**
   * Allocate on-chain state
   */
  async allocateOnchainState(
    config: OnchainStateConfig
  ): Promise<AllocationResult> {
    this.ensureInitialized();
    
    const result: AllocationResult = {
      success: true,
      balances: new Map(),
      assets: new Map(),
      warnings: [],
      errors: [],
    };

    try {
      // Allocate balance overrides
      if (config.balances) {
        await this.applyBalanceOverrides(config.balances, result);
      }

      // Set up staking state
      if (config.staking) {
        await this.setupStakingState(config.staking, result);
      }

      // Set up governance state
      if (config.governance) {
        await this.setupGovernanceState(config.governance, result);
      }
    } catch (error) {
      result.errors.push(`Failed to allocate on-chain state: ${error}`);
      result.success = false;
    }

    return result;
  }

  /**
   * Set up local storage state
   */
  async allocateLocalState(config: LocalStateConfig): Promise<void> {
    this.ensureInitialized();
    
    // Apply storage key-value pairs
    for (const [key, value] of Object.entries(config.storage)) {
      try {
        localStorage.setItem(key, value);
      } catch (error) {
        console.warn(`Failed to set localStorage key "${key}":`, error);
      }
    }

    // Set up chat history if provided
    if (config.chatHistory) {
      await this.setupChatHistory(config.chatHistory);
    }
  }

  /**
   * Clear all allocated state
   */
  async clearAllocatedState(): Promise<void> {
    this.ensureInitialized();
    
    try {
      // NOTE: Chopsticks cleanup removed - emulated mode is disabled
      // if (this.config.mode === 'emulated' && this.chopsticksChain) {
      //   this.chopsticksChain = null;
      // }

      // Note: We don't clear localStorage here as it might contain other app data
      // Only clear scenario-specific keys if needed
      
      console.log('[StateAllocator] Cleared allocated state');
    } catch (error) {
      console.warn(`[StateAllocator] Error clearing state: ${error}`);
    }
  }

  /**
   * Disconnect and cleanup resources
   */
  async disconnect(): Promise<void> {
    // Note: Execution session cleanup is handled by RpcManager
    // We just clear our reference
    if (this.executionSession) {
      this.executionSession = null;
    }
    
    if (this.api) {
      await this.api.disconnect();
      this.api = null;
    }
    
    // NOTE: Chopsticks cleanup removed - emulated mode is disabled
    // if (this.chopsticksChain) {
    //   this.chopsticksChain = null;
    // }
    
    this.initialized = false;
  }

  // ===========================================================================
  // BALANCE ALLOCATION
  // ===========================================================================

  private async allocateBalance(
    address: string,
    balance: string,
    result: AllocationResult
  ): Promise<void> {
    const parsedBalance = this.parseBalance(balance);
    const requiredBN = new BN(parsedBalance.planck);
    
    switch (this.config.mode) {
      case 'synthetic':
        // TODO: Synthetic mode disabled
        // Future implementation: Don't create state at all
        // Instead: Mock DotBot's LLM responses entirely
        // Throw error immediately - don't catch and return in result
        throw new Error('Synthetic mode is not implemented yet. Use live mode.');
        
      case 'emulated':
        // TODO: Emulated mode disabled
        // Future implementation:
        // 1. Create Chopsticks fork
        // 2. Set balances on fork using setStorage
        // 3. Reconfigure DotBot to use Chopsticks API (not real chain)
        // This ensures DotBot sees the same state we set up
        // Throw error immediately - don't catch and return in result
        throw new Error('Emulated mode is not implemented yet. Use live mode.');
        
      case 'live': {
        // LIVE MODE: Create REAL balances on REAL chain
        // DotBot will query the real chain and see these balances
        // ✅ No duplicate state - everything is on the real chain
        const currentBalance = await this.getCurrentBalance(address);
        if (currentBalance.lt(requiredBN)) {
          // Only transfer the difference
          const needed = requiredBN.sub(currentBalance);
          if (!result.pendingTransfers) {
            result.pendingTransfers = [];
          }
          result.pendingTransfers.push({ address, planck: needed.toString() });
          console.log(`[StateAllocator] Live: Will transfer ${this.formatBalance(needed.toString())} to ${address} (has ${this.formatBalance(currentBalance.toString())}, needs ${balance})`);
        } else {
          console.log(`[StateAllocator] Live: ${address} already has sufficient balance (${this.formatBalance(currentBalance.toString())} >= ${balance}), skipping transfer`);
        }
        result.balances.set(address, { free: parsedBalance.planck });
        break;
      }
    }
  }

  /**
   * Get current balance for an address
   */
  private async getCurrentBalance(address: string): Promise<BN> {
    switch (this.config.mode) {
      case 'synthetic':
        // In synthetic mode, return 0 (no real balance to check)
        return new BN(0);
        
      case 'emulated':
        // Query balance from Chopsticks API (emulated mode)
        // NOTE: Emulated mode is currently disabled
        throw new Error(
          'Emulated mode is not currently supported. Chopsticks setup has been moved to the server. ' +
          'Please use "live" or "synthetic" mode instead.'
        );
        
      case 'live': {
        // Query balance from live API
        if (!this.api) {
          throw new Error('API not initialized for live mode');
        }
        await this.api.isReady;
        const accountInfo = await this.api.query.system.account(address);
        const accountData = (accountInfo as any).data;
        return new BN(accountData.free.toString());
      }
        
      default:
        return new BN(0);
    }
  }

  /**
   * Set balance on Chopsticks fork (emulated mode)
   * 
   * NOTE: Emulated mode is currently disabled. This would need server-side implementation.
   */
  private async setChopsticksBalance(
    _address: string,
    _planck: string,
    _result: AllocationResult
  ): Promise<void> {
    throw new Error(
      'Emulated mode is not currently supported. Chopsticks setup has been moved to the server. ' +
      'Please use "live" or "synthetic" mode instead.'
    );
  }

  /**
   * Batch all transfers into a single transaction (live mode only)
   * 
   * Uses a pluggable Signer interface, allowing different signing implementations:
   * - BrowserWalletSigner: Uses wallet extensions (Talisman, Subwallet, etc.)
   * - KeyringSigner: Uses @polkadot/keyring for CLI/backend/testing
   * - Custom signers: Implement the Signer interface for custom behavior
   * 
   * The user signs once via their wallet extension, and all transfers execute together.
   */
  private async batchTransfers(
    transfers: Array<{ address: string; planck: string }>,
    result: AllocationResult
  ): Promise<void> {
    if (!this.api || !this.config.walletAccount || !this.config.signer) {
      throw new Error('API, wallet account, and signer required for live mode transfers');
    }

    try {
      await this.api.isReady;

      console.log(`[StateAllocator] Batching ${transfers.length} transfers into single transaction`);
      
      // Create all transfer extrinsics
      const transferExtrinsics = transfers.map(({ address, planck }) => {
        const amountBN = new BN(planck);
        return this.api!.tx.balances.transferKeepAlive(address, amountBN);
      });

      // Create batch transaction - all transfers execute atomically
      const batchExtrinsic = this.api.tx.utility.batchAll(transferExtrinsics);

      console.log(`[StateAllocator] ⏳ Waiting for wallet signature...`);
      console.log(`[StateAllocator] From: ${this.config.walletAccount.address}`);
      console.log(`[StateAllocator] Transfers: ${transfers.length} accounts`);
      console.log(`[StateAllocator] Please approve the transaction in your wallet extension (Talisman/Subwallet/etc.)`);

      // Sign using the pluggable signer (BrowserWalletSigner in live mode)
      // This will trigger the wallet extension popup
      const signedExtrinsic = await this.config.signer.signExtrinsic(
        batchExtrinsic,
        this.config.walletAccount.address
      );

      console.log(`[StateAllocator] ✅ Transaction signed! Sending to network...`);

      // Send the signed batch transaction
      const hash = await new Promise<string>((resolve, reject) => {
        signedExtrinsic.send((txResult: any) => {
          if (txResult.status.isInBlock) {
            console.log(`[StateAllocator] ✅ Batch transaction in block: ${txResult.txHash.toHex()}`);
            resolve(txResult.txHash.toHex());
          } else if (txResult.status.isFinalized) {
            console.log(`[StateAllocator] ✅ Batch transaction finalized: ${txResult.txHash.toHex()}`);
          } else if (txResult.isError) {
            reject(new Error('Batch transaction failed'));
          }
        }).catch((error: any) => {
          console.error('[StateAllocator] ❌ Batch send failed:', error);
          reject(error);
        });
      });

      // Track transaction hash
      if (!result.txHashes) {
        result.txHashes = [];
      }
      result.txHashes.push(hash);

      console.log(`[StateAllocator] ✅ Batch transfer complete (tx: ${hash})`);
    } catch (error) {
      result.errors.push(`Failed to batch transfers: ${error}`);
      throw error;
    }
  }


  // ===========================================================================
  // ASSET ALLOCATION
  // ===========================================================================

  private async allocateAssets(
    address: string,
    assets: AssetState[],
    result: AllocationResult
  ): Promise<void> {
    const allocatedAssets: AssetState[] = [];
    
    for (const asset of assets) {
      switch (this.config.mode) {
        case 'synthetic':
          allocatedAssets.push(asset);
          break;
          
        case 'emulated':
          await this.setChopsticksAsset(address, asset);
          allocatedAssets.push(asset);
          break;
          
        case 'live':
          result.warnings.push(
            `Live asset allocation for ${asset.symbol || asset.assetId} not implemented`
          );
          break;
      }
    }
    
    result.assets.set(address, allocatedAssets);
  }

  /**
   * Set asset balance on Chopsticks fork (emulated mode)
   * 
   * NOTE: Emulated mode is currently disabled. This would need server-side implementation.
   */
  private async setChopsticksAsset(
    _address: string,
    _asset: AssetState
  ): Promise<void> {
    throw new Error(
      'Emulated mode is not currently supported. Chopsticks setup has been moved to the server. ' +
      'Please use "live" or "synthetic" mode instead.'
    );
  }

  // ===========================================================================
  // ON-CHAIN STATE SETUP
  // ===========================================================================

  private async applyBalanceOverrides(
    overrides: BalanceOverrides,
    result: AllocationResult
  ): Promise<void> {
    for (const [address, balance] of Object.entries(overrides)) {
      await this.allocateBalance(address, balance.free, result);
    }
  }

  private async setupStakingState(
    staking: StakingSetup,
    result: AllocationResult
  ): Promise<void> {
    // TODO: Implement staking state setup
    // This would set up validators, nominators, and staking era info
    
    if (staking.validators?.length) {
      console.log(`[StateAllocator] Setting up ${staking.validators.length} validators`);
      result.warnings.push('Staking validator setup not fully implemented');
    }
    
    if (staking.nominators?.length) {
      console.log(`[StateAllocator] Setting up ${staking.nominators.length} nominators`);
      result.warnings.push('Staking nominator setup not fully implemented');
    }
  }

  private async setupGovernanceState(
    governance: GovernanceSetup,
    result: AllocationResult
  ): Promise<void> {
    // TODO: Implement governance state setup
    // This would create referenda, set up delegations, etc.
    
    if (governance.referenda?.length) {
      console.log(`[StateAllocator] Setting up ${governance.referenda.length} referenda`);
      result.warnings.push('Governance referenda setup not fully implemented');
    }
    
    if (governance.delegations?.length) {
      console.log(`[StateAllocator] Setting up ${governance.delegations.length} delegations`);
      result.warnings.push('Governance delegation setup not fully implemented');
    }
  }

  // ===========================================================================
  // LOCAL STATE SETUP
  // ===========================================================================

  private async setupChatHistory(snapshot: ChatSnapshot): Promise<void> {
    if (!snapshot) return;

    try {
      // Convert ChatSnapshot to ChatInstanceData format
      const network = this.getNetworkFromChain(this.config.chain);
      const environment = snapshot.environment === 'mainnet' ? 'mainnet' : 'testnet';

      // Create or load chat instance
      let instance = await this.chatManager.loadInstance(snapshot.chatId);
      
      if (!instance) {
        // Create new instance from snapshot
        instance = await this.chatManager.createInstance({
          environment,
          network,
          walletAddress: '', // Will be set when wallet is connected
          title: `Scenario Chat ${snapshot.chatId.slice(0, 8)}`,
        });
      }

      // Convert snapshot messages to ConversationItem format
      const messages: ConversationItem[] = snapshot.messages.map((msg, index) => {
        const id = `${snapshot.chatId}-msg-${index}`;
        
        if (msg.role === 'system') {
          const systemMsg: SystemMessage = {
            id,
            type: 'system',
            content: msg.content,
            timestamp: msg.timestamp,
          };
          return systemMsg;
        } else {
          const textMsg: TextMessage = {
            id,
            type: msg.role === 'user' ? 'user' : 'bot',
            content: msg.content,
            timestamp: msg.timestamp,
          };
          return textMsg;
        }
      });

      // Add messages to instance
      for (const message of messages) {
        await this.chatManager.addMessage(snapshot.chatId, message);
      }

      console.log(`[StateAllocator] Restored chat history: ${snapshot.chatId} (${messages.length} messages)`);
    } catch (error) {
      console.warn(`Failed to restore chat history: ${error}`);
      // Don't throw - chat history restoration is optional
    }
  }

  /**
   * Convert ScenarioChain to Network type
   */
  private getNetworkFromChain(chain: ScenarioChain): Network {
    const chainToNetwork: Record<ScenarioChain, Network> = {
      'polkadot': 'polkadot',
      'kusama': 'kusama',
      'westend': 'westend',
      'asset-hub-polkadot': 'polkadot',
      'asset-hub-westend': 'westend',
    };
    return chainToNetwork[chain] || 'polkadot';
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('StateAllocator not initialized. Call initialize() first.');
    }
  }

  /**
   * Parse a human-readable balance string to planck
   */
  private parseBalance(balance: string): { human: string; planck: string } {
    // Handle formats like "5 DOT", "100 WND", "0.1 DOT"
    const match = balance.match(/^([\d.]+)\s*(\w+)?$/);
    if (!match) {
      throw new Error(`Invalid balance format: ${balance}`);
    }
    
    const [, amount, token] = match;
    const decimals = this.getDecimals(token);
    const planck = this.toPlanck(amount, decimals);
    
    return { human: balance, planck };
  }

  private getDecimals(token?: string): number {
    const tokenUpper = token?.toUpperCase();
    
    switch (tokenUpper) {
      case 'DOT':
        return 10;
      case 'KSM':
        return 12;
      case 'WND':
        return 12;
      default:
        // Default to chain-specific decimals
        return this.config.chain.includes('polkadot') ? 10 : 12;
    }
  }

  private toPlanck(amount: string, decimals: number): string {
    const [whole, fraction = ''] = amount.split('.');
    const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
    const planck = whole + paddedFraction;
    // Remove leading zeros but keep at least one digit
    return planck.replace(/^0+/, '') || '0';
  }

  /**
   * Format planck value to human-readable balance
   */
  private formatBalance(planck: string, token?: string): string {
    const decimals = this.getDecimals(token);
    const planckBN = new BN(planck);
    const divisor = new BN(10).pow(new BN(decimals));
    const whole = planckBN.div(divisor);
    const fraction = planckBN.mod(divisor);
    
    // Format with appropriate decimals
    const fractionStr = fraction.toString().padStart(decimals, '0');
    const trimmedFraction = fractionStr.replace(/0+$/, '');
    
    if (trimmedFraction === '') {
      return `${whole.toString()} ${token || (this.config.chain.includes('polkadot') ? 'DOT' : 'WND')}`;
    }
    
    return `${whole.toString()}.${trimmedFraction} ${token || (this.config.chain.includes('polkadot') ? 'DOT' : 'WND')}`;
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a StateAllocator with configuration
 */
export function createStateAllocator(
  config: StateAllocatorConfig
): StateAllocator {
  return new StateAllocator(config);
}

