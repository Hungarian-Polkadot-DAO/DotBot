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

import { Keyring } from '@polkadot/keyring';
import { 
  cryptoWaitReady,
  encodeAddress,
  decodeAddress,
  blake2AsU8a,
} from '@polkadot/util-crypto';
import { u8aConcat } from '@polkadot/util';

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
    
    // Initialize crypto libraries (required for keypair generation)
    await cryptoWaitReady();
    
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
   * 
   * IMPORTANT: The URI is the source of truth for signing.
   * The keypair is derived from the URI, and the same URI must be used
   * for signing to ensure the address matches.
   */
  async createKeypairEntity(name: string): Promise<TestEntity> {
    this.ensureInitialized();
    
    // Use Substrate derivation path for deterministic keypair generation
    // Format: //{seedPrefix}/{name} creates a deterministic keypair
    const uri = `//${this.config.seedPrefix}/${name}`;
    
    // Create keyring and add keypair from derivation path
    const keyring = new Keyring({ type: 'sr25519', ss58Format: this.config.ss58Format });
    const pair = keyring.addFromUri(uri);
    
    // Get address (already encoded with correct SS58 format from keyring)
    const address = pair.address;
    
    // Store the URI for signing in synthetic/emulated modes
    // In live mode, we don't expose the URI for security
    const entity: TestEntity = {
      name,
      address,
      uri: this.config.mode !== 'live' ? uri : undefined,
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
    
    // Calculate actual multisig address
    const multisigAddress = this.calculateMultisigAddress(signatories, threshold);
    
    const entity: TestEntity = {
      name,
      address: multisigAddress,
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
      uri: this.config.mode === 'live' ? undefined : entity.uri,
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
   * Calculate multisig address from signatories and threshold
   * 
   * Multisig addresses in Substrate are calculated deterministically from:
   * - Signatory addresses (sorted)
   * - Threshold
   * - Chain SS58 format
   * 
   * The address is derived using blake2b hash of concatenated signatory public keys + threshold.
   * Note: This is a simplified implementation. For production use, you may want to use
   * the actual multisig module's address derivation via API, but this deterministic
   * approach works for testing scenarios.
   */
  private calculateMultisigAddress(
    signatories: string[],
    threshold: number
  ): string {
    // Sort signatories for deterministic address (multisig addresses require sorted signatories)
    const sortedSignatories = [...signatories].sort();
    
    // Decode all signatory addresses to public keys
    const signatoryPublicKeys = sortedSignatories.map(addr => decodeAddress(addr));
    
    // Combine all signatory public keys
    const combinedPublicKeys = u8aConcat(...signatoryPublicKeys);
    
    // Add threshold as 4 bytes (little-endian)
    const thresholdBytes = new Uint8Array(4);
    new DataView(thresholdBytes.buffer).setUint32(0, threshold, true);
    
    // Concatenate public keys + threshold
    const combined = u8aConcat(combinedPublicKeys, thresholdBytes);
    
    // Hash using blake2b (256 bits = 32 bytes)
    const hash = blake2AsU8a(combined, 256);
    
    // Use first 32 bytes as the multisig public key
    const multisigPublicKey = hash.slice(0, 32);
    
    // Encode with correct SS58 format
    return encodeAddress(multisigPublicKey, this.config.ss58Format);
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

