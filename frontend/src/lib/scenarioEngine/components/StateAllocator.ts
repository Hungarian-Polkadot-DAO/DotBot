/**
 * StateAllocator
 * 
 * Sets up initial state for scenario execution.
 * 
 * ## Responsibilities
 * 
 * ### Wallet/Account Balances
 * - **Synthetic**: Mock data only
 * - **Emulated**: Use Chopsticks `setStorage` to set balances
 * - **Live**: Batch transfers from user's wallet (single signature via wallet extension)
 * 
 * ### On-chain Entities (Multisigs, Proxies)
 * - **Synthetic**: Mock multisig addresses
 * - **Emulated**: Create multisig addresses, mock on-chain data
 * - **Live**: Submit actual multisig creation transactions to Westend
 * 
 * ### Governance & Staking
 * - **Synthetic/Emulated**: Mock state
 * - **Live**: Set up actual proposals, nominations (if needed)
 * 
 * ### Local Storage & Chat History
 * - All modes: Populate browser localStorage with test data
 * 
 * ## Example: Multisig Demo Setup on Westend (Live Mode)
 * ```typescript
 * // User's wallet will be used to fund entities
 * await stateAllocator.allocateWalletState({
 *   accounts: [
 *     { entityName: "Alice", balance: "100 DOT" },  // Funded from user's wallet
 *     { entityName: "Bob", balance: "50 DOT" },
 *     { entityName: "Charlie", balance: "50 DOT" }
 *   ]
 * });
 * // All transfers are batched into a single transaction
 * // User signs once via wallet extension (Talisman, Subwallet, etc.)
 * 
 * // Create multisig on-chain (submits tx to Westend)
 * const multisigAddress = await stateAllocator.createMultisig({
 *   signatories: [Alice.address, Bob.address, Charlie.address],
 *   threshold: 2
 * });
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
import { ChopsticksDatabase } from '../../services/simulation/database';
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
  private initialized: boolean = false;
  private chopsticksChain: any = null; // Chopsticks chain instance for emulated mode
  private chopsticksApi: ApiPromise | null = null; // API instance for Chopsticks fork (emulated mode)
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
   */
  private async connectToChopsticks(): Promise<void> {
    try {
      const { BuildBlockMode, setup } = await import('@acala-network/chopsticks-core');
      
      // Get RPC endpoints for the chain (use RPC manager if available)
      const rpcEndpoints = this.getRpcEndpoints();
      if (!rpcEndpoints || rpcEndpoints.length === 0) {
        throw new Error(`No RPC endpoints available for chain: ${this.config.chain}`);
      }

      // For Chopsticks, use the first healthy endpoint (round-robin handled by RPC manager)
      // Chopsticks needs a single endpoint, so we use the best one from the manager
      const rpcEndpoint = rpcEndpoints[0];

      // Create database for caching
      const dbName = `dotbot-scenario-allocator:${this.config.chain}`;
      const storage = new ChopsticksDatabase(dbName);

      // Create Chopsticks chain fork
      this.chopsticksChain = await setup({
        endpoint: [rpcEndpoint],
        block: undefined, // Let Chopsticks fetch latest block
        buildBlockMode: BuildBlockMode.Batch,
        mockSignatureHost: true,
        db: storage,
      });

      // Diagnostic: Log available methods for debugging
      const availableMethods = Object.keys(this.chopsticksChain).filter(key => 
        typeof this.chopsticksChain[key] === 'function'
      );
      console.log(`[StateAllocator] Connected to Chopsticks fork for ${this.config.chain} using ${rpcEndpoint}`);
      console.log(`[StateAllocator] Chain object methods: ${availableMethods.join(', ')}`);
      console.log(`[StateAllocator] Chain has api: ${!!this.chopsticksChain.api}`);
      
      // Note: We use the setStorage utility function directly with the chain object
      // No separate API instance is needed for setting storage
      // If we need to query balances later, we can create an API instance then
      console.log(`[StateAllocator] Chopsticks chain ready. Will use setStorage utility for state manipulation.`);
    } catch (error) {
      throw new Error(`Failed to connect to Chopsticks: ${error}`);
    }
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

    // For live mode, check user's wallet balance and batch all transfers
    if (this.config.mode === 'live') {
      if (!this.config.walletAccount || !this.config.signer) {
        throw new Error('Wallet account and signer are required for live mode transfers');
      }
      
      // Check user's wallet balance
      const totalNeeded = config.accounts.reduce((sum, acc) => {
        const parsed = this.parseBalance(acc.balance);
        return sum.add(new BN(parsed.planck));
      }, new BN(0));
      
      try {
        const chainName = this.isAssetHubChain() ? 'Asset Hub' : 'Relay Chain';
        console.log(`[StateAllocator] Checking wallet balance on ${chainName} (chain: ${this.config.chain})`);
        
        await this.api!.isReady;
        
        const accountInfo = await this.api!.query.system.account(this.config.walletAccount.address);
        const accountData = (accountInfo as any).data;
        const freeBalance = new BN(accountData.free.toString());
        const reservedBalance = new BN(accountData.reserved.toString());
        const availableBalance = freeBalance.sub(reservedBalance);
        
        const token = this.config.chain.includes('polkadot') ? 'DOT' : 'WND';
        console.log(`[StateAllocator] Wallet balance on ${chainName}: ${this.formatBalance(availableBalance.toString(), token)}`);
        
        // Reserve some balance for fees (rough estimate: 0.1 DOT)
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
            `   Required: ${needed} (for ${config.accounts.length} entities + fees)\n\n` +
            `   Please fund your wallet and try again.`,
            this.config.walletAccount.address,
            this.config.chain === 'westend' ? 'https://faucet.polkadot.io/westend' : 'https://faucet.polkadot.io',
            current,
            needed
          );
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
        result.errors.push(
          `Failed to allocate state for "${accountConfig.entityName}": ${error}`
        );
        result.success = false;
      }
    }

    // For live mode, batch all transfers into a single transaction
    if (this.config.mode === 'live' && result.pendingTransfers && result.pendingTransfers.length > 0) {
      await this.batchTransfers(result.pendingTransfers, result);
      result.pendingTransfers = []; // Clear after batching
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
      // Reset Chopsticks fork if in emulated mode
      if (this.config.mode === 'emulated' && this.chopsticksChain) {
        // Chopsticks forks are ephemeral - just clear the reference
        this.chopsticksChain = null;
        console.log('[StateAllocator] Cleared Chopsticks fork');
      }

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
    
    if (this.chopsticksChain) {
      this.chopsticksChain = null;
    }
    
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
    
    switch (this.config.mode) {
      case 'synthetic':
        // In synthetic mode, we just track the expected balance
        result.balances.set(address, { free: parsedBalance.planck });
        console.log(`[StateAllocator] Synthetic balance for ${address}: ${balance}`);
        break;
        
      case 'emulated':
        // In emulated mode, use Chopsticks to set balance
        await this.setChopsticksBalance(address, parsedBalance.planck, result);
        break;
        
      case 'live':
        // In live mode, collect transfers to batch later
        if (!result.pendingTransfers) {
          result.pendingTransfers = [];
        }
        result.pendingTransfers.push({ address, planck: parsedBalance.planck });
        result.balances.set(address, { free: parsedBalance.planck });
        break;
    }
  }

  private async setChopsticksBalance(
    address: string,
    planck: string,
    result: AllocationResult
  ): Promise<void> {
    if (!this.chopsticksChain) {
      throw new Error('Chopsticks chain not initialized');
    }

    try {
      // Import the setStorage utility from Chopsticks
      // This is the correct way to set storage when using Chopsticks as a library
      const { setStorage } = await import('@acala-network/chopsticks-core');
      
      // Decode address to get account ID
      const accountId = decodeAddress(address);

      // Use the setStorage utility function with StorageConfig format
      // This is the correct way to set storage in Chopsticks when using it as a library
      await setStorage(this.chopsticksChain, {
        System: {
          Account: [
            [
              [accountId],
              {
                data: {
                  free: planck,
                  reserved: '0',
                  frozen: '0',
                  miscFrozen: '0',
                },
                nonce: '0',
              },
            ],
          ],
        },
      });

      result.balances.set(address, { free: planck });
      console.log(`[StateAllocator] Set balance via setStorage utility for ${address}: ${planck} planck`);
    } catch (error) {
      result.errors.push(`Failed to set Chopsticks balance for ${address}: ${error}`);
      throw error;
    }
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

  private async setChopsticksAsset(
    address: string,
    asset: AssetState
  ): Promise<void> {
    if (!this.chopsticksChain) {
      throw new Error('Chopsticks chain not initialized');
    }

    try {
      const accountId = decodeAddress(address);
      const assetId = typeof asset.assetId === 'number' ? asset.assetId : parseInt(asset.assetId);
      const balance = this.parseBalance(asset.balance);

      // For Asset Hub, set asset balance using Assets pallet
      // Format: Assets.Account(AssetId, AccountId) -> AssetAccount { balance, ... }
      // Use the setStorage utility function from Chopsticks
      const { setStorage } = await import('@acala-network/chopsticks-core');
      
      await setStorage(this.chopsticksChain, {
        Assets: {
          Account: [
            [
              [assetId, accountId],
              {
                balance: balance.planck,
                isFrozen: false,
                sufficient: true,
              },
            ],
          ],
        },
      });

      console.log(`[StateAllocator] Chopsticks asset ${asset.assetId} for ${address}: ${asset.balance}`);
    } catch (error) {
      console.warn(`Failed to set Chopsticks asset ${asset.assetId} for ${address}: ${error}`);
      // Don't throw - asset allocation is optional
    }
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

