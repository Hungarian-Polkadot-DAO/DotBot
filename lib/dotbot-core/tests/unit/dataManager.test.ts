/**
 * Data Manager Tests
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

import { DataManager, STORAGE_KEYS, nukeAllData, getStorageInfo } from '../../dataManager';
import { ChatInstanceManager } from '../../chat/chatInstanceManager';
import { setStorage } from '../../env';

describe('DataManager', () => {
  let manager: DataManager;
  let chatManager: ChatInstanceManager;

  beforeEach(async () => {
    // Set the mocked storage as the storage instance
    // This ensures DataManager uses our mocked localStorage
    setStorage(mockLocalStorage as any);
    
    // Create new manager first to avoid reusing old state
    chatManager = new ChatInstanceManager();
    
    // Clear all instances via manager (this clears via storage abstraction)
    await chatManager.clearAllInstances();
    
    // Actually clear the storage data
    clearStorage();
    
    // Reset mock call counts
    mockLocalStorage.getItem.mockClear();
    mockLocalStorage.setItem.mockClear();
    mockLocalStorage.removeItem.mockClear();
    mockLocalStorage.clear.mockClear();
    
    // Create manager after everything is cleared
    manager = new DataManager(chatManager);
  });

  afterEach(async () => {
    // Actually clear the storage data
    clearStorage();
    // Also clear via manager to ensure async operations complete
    if (chatManager) {
      await chatManager.clearAllInstances();
    }
  });

  describe('exportAllData()', () => {
    it('should export empty data when no data exists', async () => {
      const exported = await manager.exportAllData();

      expect(exported.chatInstances).toEqual([]);
      expect(exported.rpcHealth).toEqual({});
      expect(exported.preferences).toEqual({});
      expect(exported.walletCache).toBeNull();
      expect(exported.other).toEqual({});
      expect(exported.exportedAt).toBeDefined();
      expect(exported.version).toBe('0.2.0');
    });

    it('should export chat instances', async () => {
      await chatManager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
        title: 'Test Chat',
      });

      const exported = await manager.exportAllData();

      expect(exported.chatInstances).toHaveLength(1);
      expect(exported.chatInstances[0].title).toBe('Test Chat');
    });

    it('should export RPC health data', async () => {
      localStorage.setItem(STORAGE_KEYS.RPC_HEALTH_POLKADOT_RELAY, JSON.stringify({
        endpoint: 'wss://rpc.polkadot.io',
        healthy: true,
      }));

      const exported = await manager.exportAllData();

      expect(exported.rpcHealth.RPC_HEALTH_POLKADOT_RELAY).toBeDefined();
      expect(exported.rpcHealth.RPC_HEALTH_POLKADOT_RELAY.healthy).toBe(true);
    });

    it('should export user preferences', async () => {
      localStorage.setItem(STORAGE_KEYS.USER_PREFERENCES, JSON.stringify({
        theme: 'dark',
        language: 'en',
      }));

      const exported = await manager.exportAllData();

      expect(exported.preferences.theme).toBe('dark');
      expect(exported.preferences.language).toBe('en');
    });

    it('should export wallet cache', async () => {
      localStorage.setItem(STORAGE_KEYS.WALLET_CACHE, JSON.stringify({
        lastConnected: 'polkadot-js',
      }));

      const exported = await manager.exportAllData();

      expect(exported.walletCache.lastConnected).toBe('polkadot-js');
    });

    it('should export other DotBot keys', async () => {
      localStorage.setItem('dotbot_custom_feature', 'test_value');

      const exported = await manager.exportAllData();

      expect(exported.other.dotbot_custom_feature).toBe('test_value');
    });

    it('should not export non-DotBot keys', async () => {
      localStorage.setItem('other_app_data', 'should not export');

      const exported = await manager.exportAllData();

      expect(exported.other.other_app_data).toBeUndefined();
    });
  });

  describe('exportAllDataAsJSON()', () => {
    it('should export as valid JSON string', async () => {
      await chatManager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      const json = await manager.exportAllDataAsJSON();

      expect(() => JSON.parse(json)).not.toThrow();
      const parsed = JSON.parse(json);
      expect(parsed.chatInstances).toHaveLength(1);
    });

    it('should be pretty-printed', async () => {
      const json = await manager.exportAllDataAsJSON();
      expect(json.includes('\n')).toBe(true);
      expect(json.includes('  ')).toBe(true);
    });
  });

  describe('deleteAllData()', () => {
    it('should delete all chat instances', async () => {
      await chatManager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
      });

      await chatManager.createInstance({
        environment: 'testnet',
        network: 'westend',
      });

      const report = await manager.deleteAllData();

      expect(report.deleted.chatInstances).toBe(2);
      
      const instances = await chatManager.loadInstances();
      expect(instances).toHaveLength(0);
    });

    it('should delete all RPC health data', async () => {
      localStorage.setItem(STORAGE_KEYS.RPC_HEALTH_POLKADOT_RELAY, 'data1');
      localStorage.setItem(STORAGE_KEYS.RPC_HEALTH_KUSAMA_RELAY, 'data2');
      localStorage.setItem(STORAGE_KEYS.RPC_HEALTH_WESTEND_RELAY, 'data3');

      const report = await manager.deleteAllData();

      expect(report.deleted.rpcHealthEntries).toBe(3);
      expect(localStorage.getItem(STORAGE_KEYS.RPC_HEALTH_POLKADOT_RELAY)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.RPC_HEALTH_KUSAMA_RELAY)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.RPC_HEALTH_WESTEND_RELAY)).toBeNull();
    });

    it('should delete user preferences', async () => {
      localStorage.setItem(STORAGE_KEYS.USER_PREFERENCES, JSON.stringify({ theme: 'dark' }));

      const report = await manager.deleteAllData();

      expect(report.deleted.preferences).toBe(true);
      expect(localStorage.getItem(STORAGE_KEYS.USER_PREFERENCES)).toBeNull();
    });

    it('should delete wallet cache', async () => {
      localStorage.setItem(STORAGE_KEYS.WALLET_CACHE, JSON.stringify({ wallet: 'test' }));

      const report = await manager.deleteAllData();

      expect(report.deleted.walletCache).toBe(true);
      expect(localStorage.getItem(STORAGE_KEYS.WALLET_CACHE)).toBeNull();
    });

    it('should delete other DotBot keys', async () => {
      localStorage.setItem('dotbot_custom_1', 'value1');
      localStorage.setItem('dotbot_custom_2', 'value2');

      const report = await manager.deleteAllData();

      expect(report.deleted.other).toBeGreaterThan(0);
      expect(localStorage.getItem('dotbot_custom_1')).toBeNull();
      expect(localStorage.getItem('dotbot_custom_2')).toBeNull();
    });

    it('should not delete non-DotBot keys', async () => {
      localStorage.setItem('other_app_data', 'keep this');

      await manager.deleteAllData();

      expect(localStorage.getItem('other_app_data')).toBe('keep this');
    });

    it('should report total items deleted', async () => {
      await chatManager.createInstance({ environment: 'mainnet', network: 'polkadot' });
      localStorage.setItem(STORAGE_KEYS.RPC_HEALTH_POLKADOT_RELAY, 'data');
      localStorage.setItem(STORAGE_KEYS.USER_PREFERENCES, 'prefs');
      localStorage.setItem('dotbot_custom', 'custom');

      const report = await manager.deleteAllData();

      expect(report.totalItems).toBeGreaterThan(0);
      expect(report.totalItems).toBe(
        report.deleted.chatInstances +
        report.deleted.rpcHealthEntries +
        (report.deleted.preferences ? 1 : 0) +
        (report.deleted.walletCache ? 1 : 0) +
        report.deleted.other
      );
    });

    it('should verify data is cleared', async () => {
      await chatManager.createInstance({ environment: 'mainnet', network: 'polkadot' });
      localStorage.setItem(STORAGE_KEYS.RPC_HEALTH_POLKADOT_RELAY, 'data');

      const report = await manager.deleteAllData();

      expect(report.verifiedClear).toBe(true);
    });

    it('should include deletion timestamp', async () => {
      const before = Date.now();
      const report = await manager.deleteAllData();
      const after = Date.now();

      const deletedAt = new Date(report.deletedAt).getTime();
      expect(deletedAt).toBeGreaterThanOrEqual(before);
      expect(deletedAt).toBeLessThanOrEqual(after);
    });
  });

  describe('deleteChatData()', () => {
    it('should delete only chat instances', async () => {
      await chatManager.createInstance({ environment: 'mainnet', network: 'polkadot' });
      localStorage.setItem(STORAGE_KEYS.USER_PREFERENCES, 'keep this');

      const count = await manager.deleteChatData();

      expect(count).toBe(1);
      const instances = await chatManager.loadInstances();
      expect(instances).toHaveLength(0);
      expect(localStorage.getItem(STORAGE_KEYS.USER_PREFERENCES)).toBe('keep this');
    });

    it('should return count of deleted instances', async () => {
      await chatManager.createInstance({ environment: 'mainnet', network: 'polkadot' });
      await chatManager.createInstance({ environment: 'testnet', network: 'westend' });

      const count = await manager.deleteChatData();

      expect(count).toBe(2);
    });
  });

  describe('deleteRpcHealthData()', () => {
    it('should delete only RPC health data', () => {
      localStorage.setItem(STORAGE_KEYS.RPC_HEALTH_POLKADOT_RELAY, 'data1');
      localStorage.setItem(STORAGE_KEYS.RPC_HEALTH_KUSAMA_RELAY, 'data2');
      localStorage.setItem(STORAGE_KEYS.USER_PREFERENCES, 'keep this');

      const count = manager.deleteRpcHealthData();

      expect(count).toBe(2);
      expect(localStorage.getItem(STORAGE_KEYS.RPC_HEALTH_POLKADOT_RELAY)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.RPC_HEALTH_KUSAMA_RELAY)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.USER_PREFERENCES)).toBe('keep this');
    });
  });

  describe('deletePreferences()', () => {
    it('should delete preferences if they exist', () => {
      localStorage.setItem(STORAGE_KEYS.USER_PREFERENCES, 'prefs');

      const deleted = manager.deletePreferences();

      expect(deleted).toBe(true);
      expect(localStorage.getItem(STORAGE_KEYS.USER_PREFERENCES)).toBeNull();
    });

    it('should return false if no preferences exist', () => {
      const deleted = manager.deletePreferences();
      expect(deleted).toBe(false);
    });
  });

  describe('deleteWalletCache()', () => {
    it('should delete wallet cache if it exists', () => {
      localStorage.setItem(STORAGE_KEYS.WALLET_CACHE, 'cache');

      const deleted = manager.deleteWalletCache();

      expect(deleted).toBe(true);
      expect(localStorage.getItem(STORAGE_KEYS.WALLET_CACHE)).toBeNull();
    });

    it('should return false if no wallet cache exists', () => {
      const deleted = manager.deleteWalletCache();
      expect(deleted).toBe(false);
    });
  });

  describe('verifyDataCleared()', () => {
    it('should return true when all data is cleared', async () => {
      const verified = await manager.verifyDataCleared();
      expect(verified).toBe(true);
    });

    it('should return false when chat instances exist', async () => {
      await chatManager.createInstance({ environment: 'mainnet', network: 'polkadot' });

      const verified = await manager.verifyDataCleared();
      expect(verified).toBe(false);
    });

    it('should return false when RPC health data exists', async () => {
      localStorage.setItem(STORAGE_KEYS.RPC_HEALTH_POLKADOT_RELAY, 'data');

      const verified = await manager.verifyDataCleared();
      expect(verified).toBe(false);
    });

    it('should return false when preferences exist', async () => {
      localStorage.setItem(STORAGE_KEYS.USER_PREFERENCES, 'prefs');

      const verified = await manager.verifyDataCleared();
      expect(verified).toBe(false);
    });

    it('should return false when custom DotBot keys exist', async () => {
      localStorage.setItem('dotbot_custom', 'data');

      const verified = await manager.verifyDataCleared();
      expect(verified).toBe(false);
    });

    it('should ignore non-DotBot keys', async () => {
      localStorage.setItem('other_app', 'data');

      const verified = await manager.verifyDataCleared();
      expect(verified).toBe(true);
    });
  });

  describe('getStorageInfo()', () => {
    it('should return empty info when no data exists', async () => {
      const info = await manager.getStorageInfo();

      expect(info.chatInstances).toBe(0);
      expect(info.rpcHealthEntries).toBe(0);
      expect(info.hasPreferences).toBe(false);
      expect(info.hasWalletCache).toBe(false);
      expect(info.otherKeys).toEqual([]);
      expect(info.estimatedSize).toBe('0 Bytes');
    });

    it('should count chat instances', async () => {
      await chatManager.createInstance({ environment: 'mainnet', network: 'polkadot' });
      await chatManager.createInstance({ environment: 'testnet', network: 'westend' });

      const info = await manager.getStorageInfo();

      expect(info.chatInstances).toBe(2);
    });

    it('should count RPC health entries', async () => {
      localStorage.setItem(STORAGE_KEYS.RPC_HEALTH_POLKADOT_RELAY, 'data1');
      localStorage.setItem(STORAGE_KEYS.RPC_HEALTH_KUSAMA_RELAY, 'data2');

      const info = await manager.getStorageInfo();

      expect(info.rpcHealthEntries).toBe(2);
    });

    it('should detect preferences', async () => {
      localStorage.setItem(STORAGE_KEYS.USER_PREFERENCES, 'prefs');

      const info = await manager.getStorageInfo();

      expect(info.hasPreferences).toBe(true);
    });

    it('should detect wallet cache', async () => {
      localStorage.setItem(STORAGE_KEYS.WALLET_CACHE, 'cache');

      const info = await manager.getStorageInfo();

      expect(info.hasWalletCache).toBe(true);
    });

    it('should list other DotBot keys', async () => {
      localStorage.setItem('dotbot_custom_1', 'data1');
      localStorage.setItem('dotbot_custom_2', 'data2');

      const info = await manager.getStorageInfo();

      expect(info.otherKeys).toContain('dotbot_custom_1');
      expect(info.otherKeys).toContain('dotbot_custom_2');
    });

    it('should estimate storage size', async () => {
      // Create instance and ensure it's saved
      await chatManager.createInstance({ environment: 'mainnet', network: 'polkadot' });
      
      // Add some additional data to ensure storage has content
      localStorage.setItem(STORAGE_KEYS.USER_PREFERENCES, JSON.stringify({ theme: 'dark' }));

      const info = await manager.getStorageInfo();

      expect(info.estimatedSize).not.toBe('0 Bytes');
      expect(info.estimatedSize).toMatch(/\d+(\.\d+)?\s+(Bytes|KB|MB)/);
    });
  });

  describe('Global convenience functions', () => {
    it('should provide nukeAllData() shortcut', async () => {
      await chatManager.createInstance({ environment: 'mainnet', network: 'polkadot' });

      const report = await nukeAllData();

      expect(report.deleted.chatInstances).toBe(1);
      expect(report.verifiedClear).toBe(true);
    });

    it('should provide getStorageInfo() shortcut', async () => {
      await chatManager.createInstance({ environment: 'mainnet', network: 'polkadot' });

      const info = await getStorageInfo();

      expect(info.chatInstances).toBe(1);
    });
  });

  describe('GDPR Compliance', () => {
    it('should allow complete data export before deletion', async () => {
      // User creates data
      await chatManager.createInstance({
        environment: 'mainnet',
        network: 'polkadot',
        title: 'My Chat',
      });
      localStorage.setItem(STORAGE_KEYS.USER_PREFERENCES, JSON.stringify({ theme: 'dark' }));

      // User exercises right to data portability (Article 20)
      const exported = await manager.exportAllData();
      expect(exported.chatInstances).toHaveLength(1);
      expect(exported.preferences.theme).toBe('dark');

      // User exercises right to erasure (Article 17)
      const report = await manager.deleteAllData();
      expect(report.verifiedClear).toBe(true);

      // Verify complete deletion
      const info = await manager.getStorageInfo();
      expect(info.chatInstances).toBe(0);
      expect(info.hasPreferences).toBe(false);
    });

    it('should verify complete erasure', async () => {
      // Create various data
      await chatManager.createInstance({ environment: 'mainnet', network: 'polkadot' });
      localStorage.setItem(STORAGE_KEYS.RPC_HEALTH_POLKADOT_RELAY, 'data');
      localStorage.setItem(STORAGE_KEYS.USER_PREFERENCES, 'prefs');
      localStorage.setItem('dotbot_custom', 'custom');

      // Delete everything
      await manager.deleteAllData();

      // Verify nothing remains
      const verified = await manager.verifyDataCleared();
      expect(verified).toBe(true);

      // Double-check with storage info
      const info = await manager.getStorageInfo();
      expect(info.chatInstances).toBe(0);
      expect(info.rpcHealthEntries).toBe(0);
      expect(info.hasPreferences).toBe(false);
      expect(info.hasWalletCache).toBe(false);
      expect(info.otherKeys).toEqual([]);
    });
  });
});

