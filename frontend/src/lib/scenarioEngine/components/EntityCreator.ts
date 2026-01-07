/**
 * EntityCreator
 * 
 * Creates test entities (accounts) for scenario execution.
 * Supports keypairs, multisigs, and proxy accounts.
 * 
 * Entities are named (Alice, Bob, etc.) for easy reference in scenarios.
 */

import type {
  TestEntity,
  EntityConfig,
  ScenarioMode,
} from '../types';

// =============================================================================
// PREDEFINED ENTITIES
// =============================================================================

/** 
 * Predefined test account names
 * These will be generated with deterministic mnemonics for consistency
 */
export const PREDEFINED_NAMES = [
  'Alice',
  'Bob',
  'Charlie',
  'Dave',
  'Eve',
  'Ferdie',
  'Grace',
  'Heidi',
  'Ivan',
  'Judy',
] as const;

export type PredefinedName = typeof PREDEFINED_NAMES[number];

// =============================================================================
// ENTITY CREATOR CLASS
// =============================================================================

export interface EntityCreatorConfig {
  /** Execution mode affects whether mnemonics are exposed */
  mode: ScenarioMode;
  
  /** SS58 format for address encoding (0 = Polkadot, 42 = Westend) */
  ss58Format?: number;
  
  /** Seed prefix for deterministic generation */
  seedPrefix?: string;
}

export class EntityCreator {
  private config: EntityCreatorConfig;
  private entities: Map<string, TestEntity> = new Map();
  private initialized: boolean = false;

  constructor(config: EntityCreatorConfig) {
    this.config = {
      ss58Format: 42, // Default to Westend for testing
      seedPrefix: 'dotbot-scenario',
      ...config,
    };
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Initialize the entity creator
   * Loads any required crypto libraries
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    // TODO: Initialize @polkadot/keyring and crypto
    // await cryptoWaitReady();
    
    this.initialized = true;
  }

  /**
   * Create predefined test entities (Alice, Bob, etc.)
   * These are created with deterministic seeds for reproducibility.
   * 
   * Note: Deterministic addresses work identically on all networks (Polkadot, Kusama, Westend).
   * Only the SS58 prefix changes (configured via ss58Format), the underlying keypair remains the same.
   */
  async createPredefinedEntities(
    names: PredefinedName[] = [...PREDEFINED_NAMES]
  ): Promise<Map<string, TestEntity>> {
    this.ensureInitialized();
    
    for (const name of names) {
      if (!this.entities.has(name)) {
        const entity = await this.createKeypairEntity(name);
        this.entities.set(name, entity);
      }
    }
    
    return new Map(this.entities);
  }

  /**
   * Create a single keypair entity
   */
  async createKeypairEntity(name: string): Promise<TestEntity> {
    this.ensureInitialized();
    
    // TODO: Implement actual keypair generation
    // const mnemonic = mnemonicGenerate();
    // const pair = keyring.addFromMnemonic(mnemonic);
    
    const entity: TestEntity = {
      name,
      address: this.generatePlaceholderAddress(name),
      mnemonic: this.config.mode !== 'live' 
        ? this.generateDeterministicMnemonic(name)
        : undefined,
      type: 'keypair',
    };
    
    this.entities.set(name, entity);
    return entity;
  }

  /**
   * Create a multisig entity from existing entities
   */
  async createMultisigEntity(
    name: string,
    signatoryNames: string[],
    threshold: number
  ): Promise<TestEntity> {
    this.ensureInitialized();
    
    // Resolve signatory addresses
    const signatories: string[] = [];
    for (const sigName of signatoryNames) {
      const entity = this.entities.get(sigName);
      if (!entity) {
        throw new Error(`Signatory entity "${sigName}" not found. Create it first.`);
      }
      signatories.push(entity.address);
    }
    
    if (threshold > signatories.length) {
      throw new Error(
        `Threshold (${threshold}) cannot exceed signatory count (${signatories.length})`
      );
    }
    
    // TODO: Calculate actual multisig address
    // const multisigAddress = createMultisigAddress(signatories, threshold, ss58Format);
    
    const entity: TestEntity = {
      name,
      address: this.generateMultisigPlaceholderAddress(name, signatories, threshold),
      type: 'multisig',
      signatories,
      threshold,
    };
    
    this.entities.set(name, entity);
    return entity;
  }

  /**
   * Create a proxy entity
   */
  async createProxyEntity(
    name: string,
    proxiedEntityName: string
  ): Promise<TestEntity> {
    this.ensureInitialized();
    
    const proxiedEntity = this.entities.get(proxiedEntityName);
    if (!proxiedEntity) {
      throw new Error(`Proxied entity "${proxiedEntityName}" not found. Create it first.`);
    }
    
    // Create a keypair for the proxy
    const proxyKeypair = await this.createKeypairEntity(`${name}_keypair`);
    
    const entity: TestEntity = {
      name,
      address: proxyKeypair.address,
      mnemonic: proxyKeypair.mnemonic,
      type: 'proxy',
      proxiedAccount: proxiedEntity.address,
    };
    
    this.entities.set(name, entity);
    return entity;
  }

  /**
   * Create entities from configuration array
   */
  async createFromConfigs(configs: EntityConfig[]): Promise<Map<string, TestEntity>> {
    this.ensureInitialized();
    
    // First pass: create all keypairs
    for (const config of configs) {
      if (config.type === 'keypair') {
        await this.createKeypairEntity(config.name);
      }
    }
    
    // Second pass: create multisigs and proxies (they depend on keypairs)
    for (const config of configs) {
      if (config.type === 'multisig') {
        if (!config.signatoryNames || !config.threshold) {
          throw new Error(`Multisig "${config.name}" requires signatoryNames and threshold`);
        }
        await this.createMultisigEntity(
          config.name,
          config.signatoryNames,
          config.threshold
        );
      } else if (config.type === 'proxy') {
        if (!config.proxiedEntityName) {
          throw new Error(`Proxy "${config.name}" requires proxiedEntityName`);
        }
        await this.createProxyEntity(config.name, config.proxiedEntityName);
      }
    }
    
    return new Map(this.entities);
  }

  /**
   * Get an entity by name
   */
  getEntity(name: string): TestEntity | undefined {
    return this.entities.get(name);
  }

  /**
   * Get all entities
   */
  getAllEntities(): Map<string, TestEntity> {
    return new Map(this.entities);
  }

  /**
   * Get entity address by name
   */
  getAddress(name: string): string {
    const entity = this.entities.get(name);
    if (!entity) {
      throw new Error(`Entity "${name}" not found`);
    }
    return entity.address;
  }

  /**
   * Clear all entities
   */
  clear(): void {
    this.entities.clear();
  }

  /**
   * Export entities for serialization (excludes sensitive data in live mode)
   */
  export(): TestEntity[] {
    return Array.from(this.entities.values()).map(entity => ({
      ...entity,
      mnemonic: this.config.mode === 'live' ? undefined : entity.mnemonic,
    }));
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('EntityCreator not initialized. Call initialize() first.');
    }
  }

  /**
   * Generate a deterministic mnemonic from entity name
   * This ensures same entities get same addresses across runs
   */
  private generateDeterministicMnemonic(name: string): string {
    // TODO: Implement proper deterministic mnemonic generation
    // This is a placeholder that should be replaced with:
    // mnemonicGenerate(12, seedFromString(`${this.config.seedPrefix}/${name}`))
    return `${this.config.seedPrefix} ${name.toLowerCase()} seed phrase placeholder twelve words`;
  }

  /**
   * Generate a placeholder address (will be replaced with real implementation)
   */
  private generatePlaceholderAddress(name: string): string {
    // TODO: Generate real address from mnemonic
    // Placeholder format for development
    const prefix = this.config.ss58Format === 0 ? '1' : '5';
    const hash = this.simpleHash(name);
    return `${prefix}${hash}`;
  }

  /**
   * Generate a placeholder multisig address
   */
  private generateMultisigPlaceholderAddress(
    name: string,
    signatories: string[],
    threshold: number
  ): string {
    // TODO: Calculate real multisig address
    const prefix = this.config.ss58Format === 0 ? '1' : '5';
    const hash = this.simpleHash(`${name}-${signatories.join('-')}-${threshold}`);
    return `${prefix}Multisig${hash.slice(0, 30)}`;
  }

  /**
   * Simple hash for placeholder addresses
   */
  private simpleHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    // Convert to base58-like string
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let result = '';
    let n = Math.abs(hash);
    while (result.length < 40) {
      result += chars[n % chars.length];
      n = Math.floor(n / chars.length) + input.charCodeAt(result.length % input.length);
    }
    return result;
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create an EntityCreator with default configuration
 */
export function createEntityCreator(
  mode: ScenarioMode,
  options?: Partial<EntityCreatorConfig>
): EntityCreator {
  return new EntityCreator({
    mode,
    ...options,
  });
}

