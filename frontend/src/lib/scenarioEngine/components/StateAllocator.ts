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
} from '../types';

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
  
  /** Chopsticks endpoint (for emulated mode) */
  chopsticksEndpoint?: string;
  
  /** RPC endpoint (for live mode) */
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

  constructor(config: StateAllocatorConfig) {
    this.config = config;
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Initialize the allocator
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    // TODO: Connect to Chopsticks or RPC based on mode
    // if (this.config.mode === 'emulated') {
    //   await this.connectToChopsticks();
    // } else if (this.config.mode === 'live') {
    //   await this.connectToRpc();
    // }
    
    this.initialized = true;
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
    
    // TODO: Implement state cleanup
    // - Reset Chopsticks fork
    // - Clear local storage
    // - Clear chat history
    
    console.log('[StateAllocator] Clearing allocated state...');
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
    // TODO: Implement Chopsticks balance setting
    // await chopsticks.setStorage({
    //   System: { Account: [[address, { data: { free: planck } }]] }
    // });
    
    result.balances.set(address, { free: planck });
    console.log(`[StateAllocator] Chopsticks balance set for ${address}: ${planck} planck`);
  }

  private async transferLiveBalance(
    address: string,
    planck: string,
    result: AllocationResult
  ): Promise<void> {
    // TODO: Implement live transfer (Westend faucet or funded account)
    // This is where real WND would be transferred on Westend testnet
    
    result.warnings.push(
      `Live balance transfer to ${address} requires implementation`
    );
    console.log(`[StateAllocator] Live transfer to ${address}: ${planck} planck (not implemented)`);
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
    // TODO: Implement Chopsticks asset balance setting
    console.log(`[StateAllocator] Chopsticks asset ${asset.assetId} for ${address}: ${asset.balance}`);
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

  private async setupChatHistory(snapshot: LocalStateConfig['chatHistory']): Promise<void> {
    if (!snapshot) return;
    
    // TODO: Integrate with ChatInstanceManager to restore chat
    // const chatManager = getChatInstanceManager();
    // await chatManager.importSnapshot(snapshot);
    
    console.log(`[StateAllocator] Setting up chat history: ${snapshot.chatId}`);
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

