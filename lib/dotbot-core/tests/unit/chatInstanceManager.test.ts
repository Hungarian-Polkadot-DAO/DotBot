/**
 * Chat Instance Manager Tests
 * 
 * Updated for async storage API.
 */

// Mock browser globals for Node.js environment
const mockStorage: { [key: string]: string } = {};

const clearStorage = () => {
  Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
};

const mockLocalStorage = {
  getItem: jest.fn((key: string) => mockStorage[key] || null),
  setItem: jest.fn((key: string, value: string) => {
    mockStorage[key] = value;
  }),
  removeItem: jest.fn((key: string) => {
    delete mockStorage[key];
  }),
  clear: jest.fn(() => clearStorage()),
  get length() {
    return Object.keys(mockStorage).length;
  },
  key: jest.fn((index: number) => {
    const keys = Object.keys(mockStorage);
    return keys[index] || null;
  }),
};

(global as any).localStorage = mockLocalStorage;

import { ChatInstanceManager } from '../../chat/chatInstanceManager';
import type {
  ChatInstanceData,
  Environment,
  ConversationItem,
  ExecutionMessage
} from '../../chat/types';
import type { ExecutionArrayState } from '../../executionEngine/types';

describe('ChatInstanceManager', () => {
  let manager: ChatInstanceManager;

  beforeEach(async () => {
    // Actually clear the storage data
    clearStorage();
    // Reset mock call counts
    mockLocalStorage.getItem.mockClear();
    mockLocalStorage.setItem.mockClear();
    mockLocalStorage.removeItem.mockClear();
    mockLocalStorage.clear.mockClear();
    manager = new ChatInstanceManager();
    // Ensure all instances are cleared before each test
    try {
      await manager.clearAllInstances();
    } catch (error) {
      // Ignore errors during cleanup - storage might already be empty
    }
  });

  afterEach(async () => {
    // Actually clear the storage data
    clearStorage();
    // Also clear via manager to ensure async operations complete
    if (manager) {
      try {
        await manager.clearAllInstances();
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
    // Give async operations time to complete
    await new Promise(resolve => setImmediate(resolve));
  });

  describe('createInstance()', () => {
    it('should create a new chat instance', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
        walletAddress: '0x123',
      });

      expect(instance.id).toBeDefined();
      expect(instance.environment).toBe('mainnet');
      expect(instance.network).toBe('polkadot');
      expect(instance.walletAddress).toBe('0x123');
      expect(instance.messages).toEqual([]);
      expect(instance.createdAt).toBeGreaterThan(0);
      expect(instance.updatedAt).toBeGreaterThan(0);
    });

    it('should create instance with custom title', async () => {
      const instance = await manager.createInstance({
        environment: 'testnet',
        network: 'westend',
        title: 'My Test Chat',
      });

      expect(instance.title).toBe('My Test Chat');
    });

    it('should validate network for environment', async () => {
      await expect(async () => {
        await manager.createInstance({
          environment: 'mainnet',
          network: 'westend', // Westend not valid for mainnet
        });
      }).rejects.toThrow();
    });

    it('should allow polkadot for mainnet', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      expect(instance.network).toBe('polkadot');
    });

    it('should allow kusama for mainnet', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'kusama',
      });

      expect(instance.network).toBe('kusama');
    });

    it('should allow westend for testnet', async () => {
      const instance = await manager.createInstance({
        environment: 'testnet',
        network: 'westend',
      });

      expect(instance.network).toBe('westend');
    });

    it('should not allow polkadot for testnet', async () => {
      await expect(async () => {
        await manager.createInstance({
          environment: 'testnet',
          network: 'polkadot',
        });
      }).rejects.toThrow(/not valid for environment/);
    });
  });

  describe('loadInstances()', () => {
    it('should load empty array when no instances exist', async () => {
      const instances = await manager.loadInstances();
      expect(instances).toEqual([]);
    });

    it('should load all saved instances', async () => {
      await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      await manager.createInstance({
        environment: 'testnet',
        network: 'westend',
      });

      const instances = await manager.loadInstances();
      expect(instances).toHaveLength(2);
    });

    it('should sort instances by updatedAt descending', async () => {
      const first = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
        title: 'First',
      });

      // Wait a bit to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      const second = await manager.createInstance({
        environment: 'testnet',
        network: 'westend',
        title: 'Second',
      });

      const instances = await manager.loadInstances();
      expect(instances[0].id).toBe(second.id); // Most recent first
      expect(instances[1].id).toBe(first.id);
    });
  });

  describe('loadInstance()', () => {
    it('should load a specific instance by ID', async () => {
      const created = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      const loaded = await manager.loadInstance(created.id);
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(created.id);
    });

    it('should return null for non-existent ID', async () => {
      const loaded = await manager.loadInstance('non-existent');
      expect(loaded).toBeNull();
    });
  });

  describe('saveInstance()', () => {
    it('should save a new instance', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      const loaded = await manager.loadInstance(instance.id);
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(instance.id);
    });

    it('should update an existing instance', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
        title: 'Original',
      });

      instance.title = 'Updated';
      await manager.saveInstance(instance);

      const loaded = await manager.loadInstance(instance.id);
      expect(loaded?.title).toBe('Updated');
    });

    it('should update updatedAt timestamp on save', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      const originalUpdatedAt = instance.updatedAt;

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      await manager.saveInstance(instance);

      const loaded = await manager.loadInstance(instance.id);
      expect(loaded?.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });
  });

  describe('updateInstance()', () => {
    it('should update instance fields', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
        title: 'Original',
      });

      const updated = await manager.updateInstance(instance.id, {
        title: 'Updated Title',
      });

      expect(updated.title).toBe('Updated Title');
      expect(updated.network).toBe('polkadot'); // Unchanged
    });

    it('should throw for non-existent instance', async () => {
      await expect(async () => {
        await manager.updateInstance('non-existent', { title: 'Test' });
      }).rejects.toThrow(/not found/);
    });

    it('should validate network changes', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      await expect(async () => {
        await manager.updateInstance(instance.id, {
          network: 'westend', // Invalid for mainnet
        });
      }).rejects.toThrow(/not valid for environment/);
    });

    it('should allow valid network changes within same environment', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      const updated = await manager.updateInstance(instance.id, {
        network: 'kusama', // Valid for mainnet
      });

      expect(updated.network).toBe('kusama');
    });

    it('should update archived status', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      const updated = await manager.updateInstance(instance.id, {
        archived: true,
      });

      expect(updated.archived).toBe(true);
    });

    it('should update tags', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      const updated = await manager.updateInstance(instance.id, {
        tags: ['important', 'trading'],
      });

      expect(updated.tags).toEqual(['important', 'trading']);
    });
  });

  describe('deleteInstance()', () => {
    it('should delete an instance', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      await manager.deleteInstance(instance.id);

      const loaded = await manager.loadInstance(instance.id);
      expect(loaded).toBeNull();
    });

    it('should not affect other instances when deleting', async () => {
      const instance1 = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      const instance2 = await manager.createInstance({
        environment: 'testnet',
        network: 'westend',
      });

      await manager.deleteInstance(instance1.id);

      const loaded = await manager.loadInstance(instance2.id);
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(instance2.id);
    });
  });

  describe('addMessage()', () => {
    it('should add a message to an instance', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      const message: ConversationItem = {
        id: 'msg1',
        type: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      };

      await manager.addMessage(instance.id, message);

      const loaded = await manager.loadInstance(instance.id);
      expect(loaded?.messages).toHaveLength(1);
      expect(loaded?.messages[0]).toEqual(message);
    });

    it('should throw for non-existent instance', async () => {
      const message: ConversationItem = {
        id: 'msg1',
        type: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      };

      // Create the promise and attach error handler to prevent unhandled rejection warning
      const promise = manager.addMessage('non-existent', message);
      
      // Attach a catch handler to prevent unhandled rejection
      // This doesn't prevent the rejection from propagating to expect().rejects
      promise.catch(() => {
        // Expected error, ignore
      });
      
      // Use expect().rejects pattern - this should work now that we've handled the promise
      await expect(promise).rejects.toThrow(/not found/);
    });

    it('should add multiple messages in order', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      await manager.addMessage(instance.id, {
        id: 'msg1',
        type: 'user',
        content: 'First',
        timestamp: Date.now(),
      });

      await manager.addMessage(instance.id, {
        id: 'msg2',
        type: 'bot',
        content: 'Second',
        timestamp: Date.now(),
      });

      const loaded = await manager.loadInstance(instance.id);
      expect(loaded?.messages).toHaveLength(2);
      expect(loaded?.messages[0].id).toBe('msg1');
      expect(loaded?.messages[1].id).toBe('msg2');
    });
  });

  describe('updateExecutionMessage()', () => {
    it('should update an execution message', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      const executionArrayState: ExecutionArrayState = {
        id: 'exec1',
        items: [],
        currentIndex: 0,
        isExecuting: false,
        isPaused: false,
        totalItems: 0,
        completedItems: 0,
        failedItems: 0,
        cancelledItems: 0,
      };

      const executionMessage: ExecutionMessage = {
        id: 'exec1',
        executionId: 'exec1',
        type: 'execution',
        timestamp: Date.now(),
        status: 'pending',
        executionArray: executionArrayState,
      };

      await manager.addMessage(instance.id, executionMessage);

      const updatedArrayState: ExecutionArrayState = {
        ...executionArrayState,
        isExecuting: true,
        currentIndex: 1,
      };

      await manager.updateExecutionMessage(instance.id, 'exec1', {
        status: 'executing',
        executionArray: updatedArrayState,
      });

      const loaded = await manager.loadInstance(instance.id);
      const message = loaded?.messages.find(m => m.id === 'exec1') as ExecutionMessage;
      expect(message.status).toBe('executing');
      expect(message.executionArray).toBeDefined();
      expect(message.executionArray!.isExecuting).toBe(true);
      expect(message.executionArray!.currentIndex).toBe(1);
    });

    it('should throw for non-existent instance', async () => {
      await expect(async () => {
        await manager.updateExecutionMessage('non-existent', 'msg1', {
          status: 'completed',
        });
      }).rejects.toThrow(/not found/);
    });

    it('should throw for non-execution message', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      await manager.addMessage(instance.id, {
        id: 'msg1',
        type: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      });

      await expect(async () => {
        await manager.updateExecutionMessage(instance.id, 'msg1', {
          status: 'completed',
        });
      }).rejects.toThrow(/Execution message/);
    });
  });

  describe('queryInstances()', () => {
    beforeEach(async () => {
      // Create test data
      await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
        walletAddress: '0x123',
        title: 'Polkadot Chat',
      });

      await manager.createInstance({
        environment: 'mainnet',
        network: 'kusama',
        walletAddress: '0x456',
        title: 'Kusama Chat',
      });

      await manager.createInstance({
        environment: 'testnet',
        network: 'westend',
        walletAddress: '0x123',
        title: 'Westend Chat',
      });
    });

    it('should return all instances without filter', async () => {
      const instances = await manager.queryInstances();
      expect(instances).toHaveLength(3);
    });

    it('should filter by environment', async () => {
      const instances = await manager.queryInstances({
        environment: 'mainnet',
      });

      expect(instances).toHaveLength(2);
      expect(instances.every(i => i.environment === 'mainnet')).toBe(true);
    });

    it('should filter by network', async () => {
      const instances = await manager.queryInstances({
        network: 'polkadot',
      });

      expect(instances).toHaveLength(1);
      expect(instances[0].network).toBe('polkadot');
    });

    it('should filter by wallet address', async () => {
      const instances = await manager.queryInstances({
        walletAddress: '0x123',
      });

      expect(instances).toHaveLength(2);
      expect(instances.every(i => i.walletAddress === '0x123')).toBe(true);
    });

    it('should filter by archived status', async () => {
      const instances = await manager.loadInstances();
      await manager.updateInstance(instances[0].id, { archived: true });

      const archived = await manager.queryInstances({ archived: true });
      expect(archived).toHaveLength(1);

      const active = await manager.queryInstances({ archived: false });
      expect(active).toHaveLength(2);
    });

    it('should filter by date range', async () => {
      const now = Date.now();
      const hourAgo = now - 3600 * 1000;

      const instances = await manager.queryInstances({
        fromDate: hourAgo,
        toDate: now + 1000,
      });

      expect(instances).toHaveLength(3);
    });

    it('should combine multiple filters', async () => {
      const instances = await manager.queryInstances({
        environment: 'mainnet',
        walletAddress: '0x123',
      });

      expect(instances).toHaveLength(1);
      expect(instances[0].network).toBe('polkadot');
    });
  });

  describe('getInstancesByEnvironment()', () => {
    it('should group instances by environment', async () => {
      await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      await manager.createInstance({
        environment: 'mainnet',
        network: 'kusama',
      });

      await manager.createInstance({
        environment: 'testnet',
        network: 'westend',
      });

      const grouped = await manager.getInstancesByEnvironment();

      expect(grouped.mainnet).toHaveLength(2);
      expect(grouped.testnet).toHaveLength(1);
    });

    it('should return empty arrays for environments with no instances', async () => {
      const grouped = await manager.getInstancesByEnvironment();

      expect(grouped.mainnet).toEqual([]);
      expect(grouped.testnet).toEqual([]);
    });
  });

  describe('generateTitle()', () => {
    it('should generate title from first user message', () => {
      const messages: ConversationItem[] = [
        {
          id: 'msg1',
          type: 'user',
          content: 'Send 10 DOT to Alice',
          timestamp: Date.now(),
        },
      ];

      const title = manager.generateTitle(messages);
      expect(title).toBe('Send 10 DOT to Alice');
    });

    it('should truncate long messages', () => {
      const longMessage = 'A'.repeat(100);
      const messages: ConversationItem[] = [
        {
          id: 'msg1',
          type: 'user',
          content: longMessage,
          timestamp: Date.now(),
        },
      ];

      const title = manager.generateTitle(messages);
      expect(title.length).toBe(50);
      expect(title.endsWith('...')).toBe(true);
    });

    it('should return "New Chat" for empty messages', () => {
      const title = manager.generateTitle([]);
      expect(title).toBe('New Chat');
    });

    it('should return "New Chat" when no user messages exist', () => {
      const messages: ConversationItem[] = [
        {
          id: 'msg1',
          type: 'bot',
          content: 'Hello',
          timestamp: Date.now(),
        },
      ];

      const title = manager.generateTitle(messages);
      expect(title).toBe('New Chat');
    });
  });

  describe('autoGenerateTitle()', () => {
    it('should auto-generate title from messages', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      await manager.addMessage(instance.id, {
        id: 'msg1',
        type: 'user',
        content: 'Transfer DOT',
        timestamp: Date.now(),
      });

      const title = await manager.autoGenerateTitle(instance.id);
      expect(title).toBe('Transfer DOT');

      const loaded = await manager.loadInstance(instance.id);
      expect(loaded?.title).toBe('Transfer DOT');
    });

    it('should not overwrite existing title', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
        title: 'Existing Title',
      });

      await manager.addMessage(instance.id, {
        id: 'msg1',
        type: 'user',
        content: 'Transfer DOT',
        timestamp: Date.now(),
      });

      const title = await manager.autoGenerateTitle(instance.id);
      expect(title).toBe('Existing Title');
    });
  });

  describe('validateNetworkForEnvironment()', () => {
    it('should validate polkadot for mainnet', () => {
      const result = manager.validateNetworkForEnvironment('polkadot', 'mainnet');
      expect(result.valid).toBe(true);
    });

    it('should validate kusama for mainnet', () => {
      const result = manager.validateNetworkForEnvironment('kusama', 'mainnet');
      expect(result.valid).toBe(true);
    });

    it('should validate westend for testnet', () => {
      const result = manager.validateNetworkForEnvironment('westend', 'testnet');
      expect(result.valid).toBe(true);
    });

    it('should reject westend for mainnet', () => {
      const result = manager.validateNetworkForEnvironment('westend', 'mainnet');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not valid for environment');
    });

    it('should reject polkadot for testnet', () => {
      const result = manager.validateNetworkForEnvironment('polkadot', 'testnet');
      expect(result.valid).toBe(false);
    });
  });

  describe('requiresNewInstance()', () => {
    it('should require new instance when switching environments', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      const requires = manager.requiresNewInstance(instance, 'westend');
      expect(requires).toBe(true);
    });

    it('should not require new instance within same environment', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      const requires = manager.requiresNewInstance(instance, 'kusama');
      expect(requires).toBe(false);
    });
  });

  describe('getEnvironmentForNetwork()', () => {
    it('should return mainnet for polkadot', () => {
      expect(manager.getEnvironmentForNetwork('polkadot')).toBe('mainnet');
    });

    it('should return mainnet for kusama', () => {
      expect(manager.getEnvironmentForNetwork('kusama')).toBe('mainnet');
    });

    it('should return testnet for westend', () => {
      expect(manager.getEnvironmentForNetwork('westend')).toBe('testnet');
    });
  });

  describe('clearAllInstances()', () => {
    it('should clear all instances', async () => {
      await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      await manager.createInstance({
        environment: 'testnet',
        network: 'westend',
      });

      await manager.clearAllInstances();

      const instances = await manager.loadInstances();
      expect(instances).toEqual([]);
    });
  });

  describe('exportInstances()', () => {
    it('should export instances as JSON', async () => {
      await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
        title: 'Test Chat',
      });

      const json = await manager.exportInstances();
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].title).toBe('Test Chat');
    });
  });

  describe('importInstances()', () => {
    it('should import instances from JSON', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
        title: 'Original',
      });

      const json = await manager.exportInstances();

      await manager.clearAllInstances();

      await manager.importInstances(json);

      const loaded = await manager.loadInstance(instance.id);
      expect(loaded).not.toBeNull();
      expect(loaded?.title).toBe('Original');
    });

    it('should not duplicate existing instances on import', async () => {
      const instance = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      const json = await manager.exportInstances();

      // Import again
      await manager.importInstances(json);

      const instances = await manager.loadInstances();
      expect(instances).toHaveLength(1);
    });

    it('should merge new instances with existing ones', async () => {
      const instance1 = await manager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
        title: 'First',
      });

      const json1 = await manager.exportInstances();

      await manager.clearAllInstances();

      const instance2 = await manager.createInstance({
        environment: 'testnet',
        network: 'westend',
        title: 'Second',
      });

      await manager.importInstances(json1);

      const instances = await manager.loadInstances();
      expect(instances).toHaveLength(2);
    });

    it('should throw on invalid JSON', async () => {
      await expect(async () => {
        await manager.importInstances('invalid json');
      }).rejects.toThrow();
    });

    it('should throw on non-array data', async () => {
      await expect(async () => {
        await manager.importInstances('{"not": "an array"}');
      }).rejects.toThrow(/expected array/);
    });
  });

  describe('Storage Interface', () => {
    it('should return storage type', () => {
      expect(manager.getStorageType()).toBe('localStorage');
    });

    it('should check storage availability', async () => {
      const available = await manager.isStorageAvailable();
      expect(available).toBe(true);
    });
  });
});
