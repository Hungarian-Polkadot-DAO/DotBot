/**
 * Unit tests for StateAllocator
 * 
 * Tests StateAllocator with all external dependencies mocked.
 */

// Mock browser globals (window, localStorage) for Node.js environment
const mockLocalStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};

(global as any).window = {
  localStorage: mockLocalStorage,
  location: {
    href: 'http://localhost:3000',
    origin: 'http://localhost:3000',
    pathname: '/',
    search: '',
    hash: '',
  },
};

(global as any).localStorage = mockLocalStorage;

// Mock external dependencies
jest.mock('@polkadot/api', () => ({
  ApiPromise: {
    create: jest.fn(),
  },
  WsProvider: jest.fn(),
}));

jest.mock('@acala-network/chopsticks-core', () => ({
  BuildBlockMode: { Batch: 'Batch' },
  setup: jest.fn(),
}));

jest.mock('../../../../services/simulation/database', () => ({
  ChopsticksDatabase: jest.fn(),
  createChopsticksDatabase: jest.fn(() => ({
    // Mock storage implementation
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
  })),
}));

jest.mock('../../../../chatInstanceManager', () => ({
  ChatInstanceManager: jest.fn(),
}));

jest.mock('@polkadot/util-crypto', () => ({
  decodeAddress: jest.fn((address: string) => {
    // Return a mock Uint8Array (32 bytes) based on address
    const mockKey = new Uint8Array(32);
    for (let i = 0; i < 32 && i < address.length; i++) {
      mockKey[i] = address.charCodeAt(i) % 256;
    }
    return mockKey;
  }),
}));

import { StateAllocator, createStateAllocator } from '../../../../scenarioEngine/components/StateAllocator';
import type { TestEntity, ScenarioMode, ScenarioChain } from '../../../../scenarioEngine/types';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { setup, BuildBlockMode } from '@acala-network/chopsticks-core';
import { ChopsticksDatabase } from '../../../../services/simulation/database';
import { ChatInstanceManager } from '../../../../chatInstanceManager';

describe('StateAllocator', () => {
  let mockEntityResolver: (name: string) => TestEntity | undefined;
  let mockEntities: Map<string, TestEntity>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock entities
    mockEntities = new Map([
      ['Alice', {
        name: 'Alice',
        address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
        type: 'keypair',
      }],
      ['Bob', {
        name: 'Bob',
        address: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
        type: 'keypair',
      }],
    ]);

    mockEntityResolver = (name: string) => mockEntities.get(name);

    // Reset localStorage mocks
    mockLocalStorage.getItem.mockClear();
    mockLocalStorage.setItem.mockClear();
    mockLocalStorage.removeItem.mockClear();
    mockLocalStorage.clear.mockClear();
  });

  describe('Initialization', () => {
    it('should initialize successfully in synthetic mode', async () => {
      const allocator = new StateAllocator({
        mode: 'synthetic',
        chain: 'westend',
        entityResolver: mockEntityResolver,
      });

      await allocator.initialize();
      // Should not throw
      expect(true).toBe(true);
    });

    it('should initialize successfully in emulated mode', async () => {
      const mockChain = {
        setStorage: jest.fn().mockResolvedValue(undefined),
        head: Promise.resolve('0x123'),
      };
      
      (setup as jest.Mock).mockResolvedValue(mockChain);
      (ChopsticksDatabase as jest.Mock).mockImplementation(() => ({}));

      const allocator = new StateAllocator({
        mode: 'emulated',
        chain: 'westend',
        entityResolver: mockEntityResolver,
      });

      await allocator.initialize();
      expect(setup).toHaveBeenCalled();
    });

    it('should initialize successfully in live mode with RPC manager', async () => {
      const mockApi = {
        isConnected: true,
        disconnect: jest.fn().mockResolvedValue(undefined),
      };
      
      const mockSession = {
        api: mockApi,
        isActive: true,
      };

      const mockRpcManager = {
        createExecutionSession: jest.fn().mockResolvedValue(mockSession),
        getHealthStatus: jest.fn().mockReturnValue([]),
        getCurrentEndpoint: jest.fn().mockReturnValue(null),
      };

      const allocator = new StateAllocator({
        mode: 'live',
        chain: 'westend',
        entityResolver: mockEntityResolver,
        rpcManagerProvider: () => ({
          relayChainManager: mockRpcManager as any,
        }),
      });

      await allocator.initialize();
      expect(mockRpcManager.createExecutionSession).toHaveBeenCalled();
    });

    it('should initialize successfully in live mode without RPC manager', async () => {
      const mockApi = {
        isConnected: true,
        disconnect: jest.fn().mockResolvedValue(undefined),
      };

      (ApiPromise.create as jest.Mock).mockResolvedValue(mockApi);
      (WsProvider as jest.Mock).mockImplementation(() => ({
        on: jest.fn(),
        isConnected: true,
      }));

      const allocator = new StateAllocator({
        mode: 'live',
        chain: 'westend',
        entityResolver: mockEntityResolver,
      });

      await allocator.initialize();
      expect(ApiPromise.create).toHaveBeenCalled();
    });

    it('should not initialize twice', async () => {
      const allocator = new StateAllocator({
        mode: 'synthetic',
        chain: 'westend',
        entityResolver: mockEntityResolver,
      });

      await allocator.initialize();
      await allocator.initialize(); // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('Balance Allocation', () => {
    it('should throw error for synthetic mode (not implemented)', async () => {
      const allocator = new StateAllocator({
        mode: 'synthetic',
        chain: 'westend',
        entityResolver: mockEntityResolver,
      });

      await allocator.initialize();

      // Synthetic mode is not implemented yet - should throw error
      await expect(
        allocator.allocateWalletState({
          accounts: [
            { entityName: 'Alice', balance: '100 WND' },
          ],
        })
      ).rejects.toThrow('Synthetic mode is not implemented yet');
    });

    it('should throw error for emulated mode (not implemented)', async () => {
      const mockChain = {
        setStorage: jest.fn().mockResolvedValue(undefined),
        head: Promise.resolve('0x123'),
      };
      
      (setup as jest.Mock).mockResolvedValue(mockChain);
      (ChopsticksDatabase as jest.Mock).mockImplementation(() => ({}));

      const allocator = new StateAllocator({
        mode: 'emulated',
        chain: 'westend',
        entityResolver: mockEntityResolver,
        rpcEndpoint: 'wss://westend-rpc.polkadot.io', // Provide endpoint for getRpcEndpoints
      });

      await allocator.initialize();

      // Emulated mode is not implemented yet - should throw error
      await expect(
        allocator.allocateWalletState({
          accounts: [
            { entityName: 'Alice', balance: '50 WND' },
          ],
        })
      ).rejects.toThrow('Emulated mode is not implemented yet');
    });

    it('should handle missing entity', async () => {
      const allocator = new StateAllocator({
        mode: 'synthetic',
        chain: 'westend',
        entityResolver: mockEntityResolver,
      });

      await allocator.initialize();

      const result = await allocator.allocateWalletState({
        accounts: [
          { entityName: 'NonExistent', balance: '100 WND' },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('NonExistent');
    });

    it('should throw error for synthetic mode when parsing different balance formats', async () => {
      const allocator = new StateAllocator({
        mode: 'synthetic',
        chain: 'polkadot',
        entityResolver: mockEntityResolver,
      });

      await allocator.initialize();

      // Synthetic mode is not implemented yet - should throw error
      await expect(
        allocator.allocateWalletState({
          accounts: [
            { entityName: 'Alice', balance: '5 DOT' },
            { entityName: 'Bob', balance: '0.1 DOT' },
          ],
        })
      ).rejects.toThrow('Synthetic mode is not implemented yet');
    });
  });

  describe('Local Storage Allocation', () => {
    it('should set localStorage items', async () => {
      const allocator = new StateAllocator({
        mode: 'synthetic',
        chain: 'westend',
        entityResolver: mockEntityResolver,
      });

      await allocator.initialize();

      await allocator.allocateLocalState({
        storage: {
          'test-key': 'test-value',
          'another-key': 'another-value',
        },
      });

      expect(localStorage.setItem).toHaveBeenCalledWith('test-key', 'test-value');
      expect(localStorage.setItem).toHaveBeenCalledWith('another-key', 'another-value');
    });

    it('should restore chat history', async () => {
      const mockChatManager = {
        loadInstance: jest.fn().mockResolvedValue(null),
        createInstance: jest.fn().mockResolvedValue({
          id: 'chat-123',
          messages: [],
        }),
        addMessage: jest.fn().mockResolvedValue(undefined),
      };

      (ChatInstanceManager as jest.Mock).mockImplementation(() => mockChatManager);

      const allocator = new StateAllocator({
        mode: 'synthetic',
        chain: 'westend',
        entityResolver: mockEntityResolver,
      });

      await allocator.initialize();

      await allocator.allocateLocalState({
        storage: {},
        chatHistory: {
          chatId: 'chat-123',
          environment: 'testnet',
          messages: [
            { role: 'user', content: 'Hello', timestamp: 1000 },
            { role: 'assistant', content: 'Hi there', timestamp: 2000 },
          ],
        },
      });

      expect(mockChatManager.createInstance).toHaveBeenCalled();
      expect(mockChatManager.addMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('State Cleanup', () => {
    it('should disconnect and cleanup resources', async () => {
      const mockApi = {
        isConnected: true,
        disconnect: jest.fn().mockResolvedValue(undefined),
      };

      const allocator = new StateAllocator({
        mode: 'synthetic',
        chain: 'westend',
        entityResolver: mockEntityResolver,
      });

      await allocator.initialize();
      await allocator.disconnect();

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('Factory Function', () => {
    it('should create StateAllocator with factory function', () => {
      const allocator = createStateAllocator({
        mode: 'synthetic',
        chain: 'westend',
        entityResolver: mockEntityResolver,
      });

      expect(allocator).toBeInstanceOf(StateAllocator);
    });
  });
});

