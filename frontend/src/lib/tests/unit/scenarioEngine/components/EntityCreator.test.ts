/**
 * Unit tests for EntityCreator
 */

// Mock crypto dependencies BEFORE any imports that use them
jest.mock('@polkadot/util-crypto', () => ({
  cryptoWaitReady: jest.fn().mockResolvedValue(true),
  encodeAddress: (publicKey: Uint8Array, ss58Format?: number) => {
    // Simple mock: return a deterministic address based on public key
    const hash = Array.from(publicKey.slice(0, 8))
      .reduce((acc, byte) => acc + byte.toString(16), '');
    const prefix = ss58Format === 0 ? '1' : ss58Format === 42 ? '5' : 'C';
    return `${prefix}${hash.padEnd(47, '0')}`;
  },
  decodeAddress: (address: string) => {
    // Simple mock: return a deterministic public key from address
    const hash = address.slice(1);
    const publicKey = new Uint8Array(32);
    for (let i = 0; i < 32 && i < hash.length; i++) {
      publicKey[i] = parseInt(hash[i] || '0', 16) || i;
    }
    return publicKey;
  },
  blake2AsU8a: (data: Uint8Array, bitLength?: number) => {
    // Simple mock: return deterministic hash
    const byteLength = bitLength ? bitLength / 8 : 32;
    const hash = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i++) {
      hash[i] = (data[i % data.length] + i) % 256;
    }
    return hash;
  },
}));

jest.mock('@polkadot/util', () => ({
  u8aConcat: (...arrays: Uint8Array[]) => {
    // Concatenate all Uint8Arrays
    const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  },
}));

jest.mock('@polkadot/keyring', () => {
  return {
    Keyring: function(this: any, options?: { type?: string; ss58Format?: number}) {
      const ss58Format = options?.ss58Format ?? 42;
      
      this.addFromUri = function(uri: string) {
        // Deterministic address based on URI and SS58 format
        const hash = uri.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const prefix = ss58Format === 0 ? '1' : ss58Format === 42 ? '5' : 'C';
        const address = `${prefix}${hash.toString(16).padEnd(47, '0')}`;
        return {
          address,
        };
      };
      
      this.addFromMnemonic = function(mnemonic: string) {
        const hash = mnemonic.split(' ').reduce((acc, word) => acc + word.length, 0);
        const prefix = ss58Format === 0 ? '1' : ss58Format === 42 ? '5' : 'C';
        const address = `${prefix}${hash.toString(16).padEnd(47, '0')}`;
        return {
          address,
        };
      };
    },
  };
});

import { EntityCreator, createEntityCreator, PREDEFINED_NAMES } from '../../../../scenarioEngine/components/EntityCreator';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import type { TestEntity, EntityConfig } from '../../../../scenarioEngine/types';

describe('EntityCreator', () => {
  let creator: EntityCreator;

  beforeEach(() => {
    jest.clearAllMocks();
    creator = new EntityCreator({
      mode: 'synthetic',
      ss58Format: 42, // Westend
      seedPrefix: 'dotbot-scenario',
    });
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      await creator.initialize();
      expect(cryptoWaitReady).toHaveBeenCalled();
    });

    it('should not initialize twice', async () => {
      await creator.initialize();
      jest.clearAllMocks();
      await creator.initialize();
      // cryptoWaitReady should not be called again
      expect(cryptoWaitReady).not.toHaveBeenCalled();
    });

    it('should throw if methods called before initialization', async () => {
      const newCreator = new EntityCreator({ mode: 'synthetic' });
      await expect(newCreator.createKeypairEntity('Test')).rejects.toThrow(
        'EntityCreator not initialized'
      );
    });
  });

  describe('Keypair Creation', () => {
    beforeEach(async () => {
      await creator.initialize();
    });

    it('should create a keypair entity', async () => {
      const entity = await creator.createKeypairEntity('Alice');

      expect(entity).toBeDefined();
      expect(entity.name).toBe('Alice');
      expect(entity.type).toBe('keypair');
      expect(entity.address).toBeDefined();
      expect(typeof entity.address).toBe('string');
      expect(entity.address.length).toBeGreaterThan(0);
    });

    it('should create deterministic addresses', async () => {
      const entity1 = await creator.createKeypairEntity('Alice');
      const entity2 = await creator.createKeypairEntity('Alice');

      expect(entity1.address).toBe(entity2.address);
    });

    it('should create different addresses for different names', async () => {
      const alice = await creator.createKeypairEntity('Alice');
      const bob = await creator.createKeypairEntity('Bob');

      expect(alice.address).not.toBe(bob.address);
    });

    it('should include mnemonic in synthetic mode', async () => {
      const entity = await creator.createKeypairEntity('Alice');

      expect(entity.mnemonic).toBeDefined();
      expect(typeof entity.mnemonic).toBe('string');
    });

    it('should include mnemonic in emulated mode', async () => {
      const emulatedCreator = new EntityCreator({
        mode: 'emulated',
        ss58Format: 42,
      });
      await emulatedCreator.initialize();

      const entity = await emulatedCreator.createKeypairEntity('Alice');

      expect(entity.mnemonic).toBeDefined();
    });

    it('should not include mnemonic in live mode', async () => {
      const liveCreator = new EntityCreator({
        mode: 'live',
        ss58Format: 42,
      });
      await liveCreator.initialize();

      const entity = await liveCreator.createKeypairEntity('Alice');

      expect(entity.mnemonic).toBeUndefined();
    });

    it('should use correct SS58 format', async () => {
      const polkadotCreator = new EntityCreator({
        mode: 'synthetic',
        ss58Format: 0, // Polkadot
      });
      await polkadotCreator.initialize();

      const entity = await polkadotCreator.createKeypairEntity('Alice');

      // Address should start with '1' for Polkadot (SS58 format 0)
      expect(entity.address[0]).toBe('1');
    });

    it('should store entity in internal map', async () => {
      await creator.createKeypairEntity('Alice');
      const entity = creator.getEntity('Alice');

      expect(entity).toBeDefined();
      expect(entity?.name).toBe('Alice');
    });
  });

  describe('Predefined Entities', () => {
    beforeEach(async () => {
      await creator.initialize();
    });

    it('should create all predefined entities', async () => {
      const entities = await creator.createPredefinedEntities();

      expect(entities.size).toBe(PREDEFINED_NAMES.length);
      for (const name of PREDEFINED_NAMES) {
        expect(entities.has(name)).toBe(true);
        const entity = entities.get(name);
        expect(entity?.name).toBe(name);
        expect(entity?.type).toBe('keypair');
      }
    });

    it('should create subset of predefined entities', async () => {
      const entities = await creator.createPredefinedEntities(['Alice', 'Bob']);

      expect(entities.size).toBe(2);
      expect(entities.has('Alice')).toBe(true);
      expect(entities.has('Bob')).toBe(true);
    });

    it('should not recreate existing entities', async () => {
      await creator.createPredefinedEntities(['Alice']);
      const initialEntities = creator.getAllEntities();
      const initialAddress = initialEntities.get('Alice')?.address;

      // Try to create same entities again
      await creator.createPredefinedEntities(['Alice']);

      // Should still have the same entity with same address
      const finalEntities = creator.getAllEntities();
      expect(finalEntities.size).toBe(initialEntities.size);
      expect(finalEntities.get('Alice')?.address).toBe(initialAddress);
    });

    it('should create entities with deterministic addresses', async () => {
      const entities1 = await creator.createPredefinedEntities();
      const newCreator = new EntityCreator({
        mode: 'synthetic',
        ss58Format: 42,
        seedPrefix: 'dotbot-scenario',
      });
      await newCreator.initialize();
      const entities2 = await newCreator.createPredefinedEntities();

      // Same seed prefix should produce same addresses
      expect(entities1.get('Alice')?.address).toBe(entities2.get('Alice')?.address);
    });
  });

  describe('Multisig Creation', () => {
    beforeEach(async () => {
      await creator.initialize();
      // Create signatory entities first
      await creator.createKeypairEntity('Alice');
      await creator.createKeypairEntity('Bob');
      await creator.createKeypairEntity('Charlie');
    });

    it('should create a multisig entity', async () => {
      const multisig = await creator.createMultisigEntity(
        'Multisig1',
        ['Alice', 'Bob'],
        2
      );

      expect(multisig).toBeDefined();
      expect(multisig.name).toBe('Multisig1');
      expect(multisig.type).toBe('multisig');
      expect(multisig.signatories).toEqual([
        expect.any(String), // Alice address
        expect.any(String), // Bob address
      ]);
      expect(multisig.threshold).toBe(2);
      expect(multisig.address).toBeDefined();
    });

    it('should sort signatories for deterministic address', async () => {
      const multisig1 = await creator.createMultisigEntity(
        'Multisig1',
        ['Alice', 'Bob', 'Charlie'],
        2
      );
      const multisig2 = await creator.createMultisigEntity(
        'Multisig2',
        ['Charlie', 'Bob', 'Alice'],
        2
      );

      // Same signatories in different order should produce same address
      expect(multisig1.address).toBe(multisig2.address);
    });

    it('should calculate deterministic multisig address', async () => {
      const multisig1 = await creator.createMultisigEntity(
        'Multisig1',
        ['Alice', 'Bob'],
        2
      );
      const multisig2 = await creator.createMultisigEntity(
        'Multisig1',
        ['Alice', 'Bob'],
        2
      );

      expect(multisig1.address).toBe(multisig2.address);
    });

    it('should throw if signatory entity not found', async () => {
      await expect(
        creator.createMultisigEntity('Multisig1', ['Alice', 'Unknown'], 2)
      ).rejects.toThrow('Signatory entity "Unknown" not found');
    });

    it('should throw if threshold exceeds signatory count', async () => {
      await expect(
        creator.createMultisigEntity('Multisig1', ['Alice', 'Bob'], 3)
      ).rejects.toThrow('Threshold (3) cannot exceed signatory count (2)');
    });

    it('should use correct signatory addresses', async () => {
      const alice = creator.getEntity('Alice');
      const bob = creator.getEntity('Bob');

      const multisig = await creator.createMultisigEntity(
        'Multisig1',
        ['Alice', 'Bob'],
        2
      );

      expect(multisig.signatories).toBeDefined();
      expect(multisig.signatories!).toContain(alice?.address);
      expect(multisig.signatories!).toContain(bob?.address);
    });
  });

  describe('Proxy Creation', () => {
    beforeEach(async () => {
      await creator.initialize();
      await creator.createKeypairEntity('Alice');
    });

    it('should create a proxy entity', async () => {
      const proxy = await creator.createProxyEntity('Proxy1', 'Alice');

      expect(proxy).toBeDefined();
      expect(proxy.name).toBe('Proxy1');
      expect(proxy.type).toBe('proxy');
      expect(proxy.proxiedAccount).toBeDefined();
      expect(proxy.address).toBeDefined();
    });

    it('should set proxied account correctly', async () => {
      const alice = creator.getEntity('Alice');
      const proxy = await creator.createProxyEntity('Proxy1', 'Alice');

      expect(proxy.proxiedAccount).toBe(alice?.address);
    });

    it('should throw if proxied entity not found', async () => {
      await expect(
        creator.createProxyEntity('Proxy1', 'Unknown')
      ).rejects.toThrow('Proxied entity "Unknown" not found');
    });

    it('should create a keypair for the proxy', async () => {
      const proxy = await creator.createProxyEntity('Proxy1', 'Alice');

      // Proxy should have its own address (from keypair)
      expect(proxy.address).toBeDefined();
      expect(proxy.address).not.toBe(proxy.proxiedAccount);
    });
  });

  describe('Entity Configuration', () => {
    beforeEach(async () => {
      await creator.initialize();
    });

    it('should create entities from config array', async () => {
      const configs = [
        { name: 'Test1', type: 'keypair' as const },
        { name: 'Test2', type: 'keypair' as const },
        {
          name: 'Multisig1',
          type: 'multisig' as const,
          signatoryNames: ['Test1', 'Test2'],
          threshold: 2,
        },
      ];

      const entities = await creator.createFromConfigs(configs);

      expect(entities.size).toBe(3);
      expect(entities.has('Test1')).toBe(true);
      expect(entities.has('Test2')).toBe(true);
      expect(entities.has('Multisig1')).toBe(true);
    });

    it('should create keypairs before multisigs', async () => {
      const configs = [
        {
          name: 'Multisig1',
          type: 'multisig' as const,
          signatoryNames: ['Alice', 'Bob'],
          threshold: 2,
        },
        { name: 'Alice', type: 'keypair' as const },
        { name: 'Bob', type: 'keypair' as const },
      ];

      // Should work even if multisig is listed first
      const entities = await creator.createFromConfigs(configs);

      expect(entities.has('Multisig1')).toBe(true);
    });

    it('should throw if multisig config missing required fields', async () => {
      const configs = [
        {
          name: 'Multisig1',
          type: 'multisig' as const,
          // Missing signatoryNames and threshold
        },
      ];

      await expect(creator.createFromConfigs(configs)).rejects.toThrow(
        'requires signatoryNames and threshold'
      );
    });

    it('should throw if proxy config missing proxiedEntityName', async () => {
      await creator.createKeypairEntity('Alice');
      const configs = [
        {
          name: 'Proxy1',
          type: 'proxy' as const,
          // Missing proxiedEntityName
        },
      ];

      await expect(creator.createFromConfigs(configs)).rejects.toThrow(
        'requires proxiedEntityName'
      );
    });
  });

  describe('Entity Retrieval', () => {
    beforeEach(async () => {
      await creator.initialize();
      await creator.createKeypairEntity('Alice');
    });

    it('should get entity by name', () => {
      const entity = creator.getEntity('Alice');

      expect(entity).toBeDefined();
      expect(entity?.name).toBe('Alice');
    });

    it('should return undefined for non-existent entity', () => {
      const entity = creator.getEntity('Unknown');

      expect(entity).toBeUndefined();
    });

    it('should get all entities', () => {
      const entities = creator.getAllEntities();

      expect(entities).toBeInstanceOf(Map);
      expect(entities.size).toBe(1);
      expect(entities.has('Alice')).toBe(true);
    });

    it('should get entity address by name', () => {
      const address = creator.getAddress('Alice');

      expect(address).toBeDefined();
      expect(typeof address).toBe('string');
    });

    it('should throw if entity not found when getting address', () => {
      expect(() => creator.getAddress('Unknown')).toThrow(
        'Entity "Unknown" not found'
      );
    });
  });

  describe('Entity Management', () => {
    beforeEach(async () => {
      await creator.initialize();
      await creator.createKeypairEntity('Alice');
    });

    it('should clear all entities', () => {
      creator.clear();

      expect(creator.getAllEntities().size).toBe(0);
      expect(creator.getEntity('Alice')).toBeUndefined();
    });

    it('should export entities', () => {
      const exported = creator.export();

      expect(Array.isArray(exported)).toBe(true);
      expect(exported.length).toBe(1);
      expect(exported[0].name).toBe('Alice');
    });

    it('should exclude mnemonic in live mode when exporting', async () => {
      const liveCreator = new EntityCreator({
        mode: 'live',
        ss58Format: 42,
      });
      await liveCreator.initialize();
      await liveCreator.createKeypairEntity('Alice');

      const exported = liveCreator.export();

      expect(exported[0].mnemonic).toBeUndefined();
    });

    it('should include mnemonic in synthetic mode when exporting', () => {
      const exported = creator.export();

      expect(exported[0].mnemonic).toBeDefined();
    });
  });

  describe('Factory Function', () => {
    it('should create EntityCreator with factory function', () => {
      const created = createEntityCreator('synthetic', {
        ss58Format: 42,
        seedPrefix: 'test',
      });

      expect(created).toBeInstanceOf(EntityCreator);
    });

    it('should use default config when options not provided', () => {
      const created = createEntityCreator('synthetic');

      expect(created).toBeInstanceOf(EntityCreator);
    });
  });

  describe('Deterministic Behavior', () => {
    it('should produce same addresses with same seed prefix', async () => {
      const creator1 = new EntityCreator({
        mode: 'synthetic',
        ss58Format: 42,
        seedPrefix: 'test-seed',
      });
      await creator1.initialize();

      const creator2 = new EntityCreator({
        mode: 'synthetic',
        ss58Format: 42,
        seedPrefix: 'test-seed',
      });
      await creator2.initialize();

      const entity1 = await creator1.createKeypairEntity('Alice');
      const entity2 = await creator2.createKeypairEntity('Alice');

      expect(entity1.address).toBe(entity2.address);
    });

    it('should produce different addresses with different seed prefixes', async () => {
      const creator1 = new EntityCreator({
        mode: 'synthetic',
        ss58Format: 42,
        seedPrefix: 'seed1',
      });
      await creator1.initialize();

      const creator2 = new EntityCreator({
        mode: 'synthetic',
        ss58Format: 42,
        seedPrefix: 'seed2',
      });
      await creator2.initialize();

      const entity1 = await creator1.createKeypairEntity('Alice');
      const entity2 = await creator2.createKeypairEntity('Alice');

      expect(entity1.address).not.toBe(entity2.address);
    });
  });

  describe('Edge Cases', () => {
    beforeEach(async () => {
      await creator.initialize();
    });

    it('should handle empty entity name', async () => {
      const entity = await creator.createKeypairEntity('');

      expect(entity.name).toBe('');
      expect(entity.address).toBeDefined();
    });

    it('should handle special characters in entity name', async () => {
      const entity = await creator.createKeypairEntity('Test-Entity_123');

      expect(entity.name).toBe('Test-Entity_123');
      expect(entity.address).toBeDefined();
    });

    it('should handle multisig with single signatory', async () => {
      await creator.createKeypairEntity('Alice');

      const multisig = await creator.createMultisigEntity(
        'Multisig1',
        ['Alice'],
        1
      );

      expect(multisig.threshold).toBe(1);
      expect(multisig.signatories).toBeDefined();
      expect(multisig.signatories!.length).toBe(1);
    });

    it('should handle creating same entity twice', async () => {
      const entity1 = await creator.createKeypairEntity('Alice');
      const entity2 = await creator.createKeypairEntity('Alice');

      // Should return same entity (from cache)
      expect(entity1.address).toBe(entity2.address);
    });
  });
});

