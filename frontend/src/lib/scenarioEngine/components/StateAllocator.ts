/**
 * StateAllocator
 * 
 * Sets up initial state for scenario execution.
 * 
 * ## Responsibilities
 * 
 * ### Wallet/Account Balances
 * - **Synthetic**: Mock data only
 * - **Emulated**: Use Chopsticks `dev_setStorage` to set balances
 * - **Live**: Actually fund accounts from dev account or faucet
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
 * await stateAllocator.allocateWalletState({
 *   accounts: [
 *     { entityName: "Alice", balance: "100 DOT" },  // Fund from dev account
 *     { entityName: "Bob", balance: "50 DOT" },
 *     { entityName: "Charlie", balance: "50 DOT" }
 *   ]
 * });
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
import { Keyring } from '@polkadot/keyring';
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
    this.config = config;
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
          console.log(`[StateAllocator] Connected to RPC for ${this.config.chain} via RPC manager`);
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
        result.errors.push(
          `Failed to allocate state for "${accountConfig.entityName}": ${error}`
        );
        result.success = false;
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
    
    // Clean up Chopsticks API
    if (this.chopsticksApi) {
      try {
        await this.chopsticksApi.disconnect();
      } catch (error) {
        console.warn('[StateAllocator] Error disconnecting Chopsticks API:', error);
      }
      this.chopsticksApi = null;
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
        // In live mode, transfer from faucet or funded account
        await this.transferLiveBalance(address, parsedBalance.planck, result);
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

  private async transferLiveBalance(
    address: string,
    planck: string,
    result: AllocationResult
  ): Promise<void> {
    if (!this.api) {
      throw new Error('API not initialized for live mode');
    }

    try {
      // For live mode, we need a funded account to transfer from
      // This should be provided via config or use a faucet
      // For now, we'll use a deterministic dev account based on the scenario seed
      const devAccount = this.getDevAccount();
      
      if (!devAccount) {
        result.warnings.push(
          `Live balance transfer requires a funded dev account. ` +
          `Please fund ${address} manually or configure a dev account.`
        );
        // Still track the expected balance
        result.balances.set(address, { free: planck });
        return;
      }

      // Create transfer extrinsic
      const amountBN = new BN(planck);
      const transferExtrinsic = this.api.tx.balances.transferKeepAlive(
        address,
        amountBN
      );

      // Sign and send transaction
      const hash = await new Promise<string>((resolve, reject) => {
        transferExtrinsic.signAndSend(devAccount, (txResult: any) => {
          if (txResult.status.isInBlock || txResult.status.isFinalized) {
            resolve(txResult.txHash.toString());
          } else if (txResult.isError) {
            reject(new Error(`Transaction failed: ${txResult.status.toString()}`));
          }
        }).catch(reject);
      });

      // Track transaction hash
      if (!result.txHashes) {
        result.txHashes = [];
      }
      result.txHashes.push(hash);

      result.balances.set(address, { free: planck });
      console.log(`[StateAllocator] Live transfer to ${address}: ${planck} planck (tx: ${hash})`);
    } catch (error) {
      result.errors.push(`Failed to transfer live balance to ${address}: ${error}`);
      // Still track expected balance even if transfer fails
      result.balances.set(address, { free: planck });
      throw error;
    }
  }

  /**
   * Get or create a dev account for live mode transfers
   * Uses a deterministic account based on scenario seed
   */
  private getDevAccount(): any | null {
    // For live mode, we need a real funded account
    // This could be:
    // 1. A configured dev account mnemonic in config
    // 2. A deterministic account from scenario seed
    // 3. A faucet account
    
    // For now, return null and let the caller handle it
    // In a real implementation, this would:
    // - Check config for devAccountMnemonic
    // - Or use a deterministic account from scenario seed
    // - Or use a faucet service
    
    return null;
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

