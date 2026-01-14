/**
 * Unit tests for Session Manager
 */

import {
  DotBotSessionManager,
  InMemorySessionStore,
  createSessionManager,
  SessionStore,
  DotBotSession,
} from '../sessionManager';
import { DotBot, InMemoryChatStorage, ChatInstanceManager } from '@dotbot/core';
import { AIService } from '@dotbot/core/services/ai';
import type { WalletAccount } from '@dotbot/core/types/wallet';
import type { Environment, Network } from '@dotbot/core';
import type { AIProviderType } from '@dotbot/core/services/ai';

// Mock DotBot and dependencies
jest.mock('@dotbot/core', () => {
  const actual = jest.requireActual('@dotbot/core');
  return {
    ...actual,
    DotBot: {
      create: jest.fn(),
    },
    InMemoryChatStorage: jest.fn(),
    ChatInstanceManager: jest.fn(),
  };
});

jest.mock('@dotbot/core/services/ai', () => ({
  AIService: jest.fn(),
}));

describe('InMemorySessionStore', () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  describe('get()', () => {
    it('should return null for non-existent session', async () => {
      const result = await store.get('non-existent');
      expect(result).toBeNull();
    });

    it('should return session and update lastAccessed', async () => {
      const mockSession: DotBotSession = {
        sessionId: 'test-session',
        dotbot: {} as DotBot,
        wallet: {
          address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
          name: 'Test',
          source: 'polkadot-js',
        },
        environment: 'mainnet',
        network: 'polkadot',
        createdAt: new Date('2024-01-01'),
        lastAccessed: new Date('2024-01-01'),
      };

      await store.set('test-session', mockSession);
      const originalLastAccessed = mockSession.lastAccessed.getTime();

      // Wait a bit to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await store.get('test-session');
      expect(result).toBeDefined();
      expect(result?.sessionId).toBe('test-session');
      expect(result?.lastAccessed.getTime()).toBeGreaterThan(originalLastAccessed);
    });
  });

  describe('set()', () => {
    it('should store a session', async () => {
      const mockSession: DotBotSession = {
        sessionId: 'test-session',
        dotbot: {} as DotBot,
        wallet: {
          address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
          source: 'polkadot-js',
        },
        environment: 'mainnet',
        network: 'polkadot',
        createdAt: new Date(),
        lastAccessed: new Date(),
      };

      await store.set('test-session', mockSession);
      const result = await store.get('test-session');
      expect(result).toEqual(mockSession);
    });
  });

  describe('delete()', () => {
    it('should delete a session', async () => {
      const mockSession: DotBotSession = {
        sessionId: 'test-session',
        dotbot: {} as DotBot,
        wallet: {
          address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
          source: 'polkadot-js',
        },
        environment: 'mainnet',
        network: 'polkadot',
        createdAt: new Date(),
        lastAccessed: new Date(),
      };

      await store.set('test-session', mockSession);
      await store.delete('test-session');
      const result = await store.get('test-session');
      expect(result).toBeNull();
    });
  });

  describe('getAll()', () => {
    it('should return all sessions', async () => {
      const session1: DotBotSession = {
        sessionId: 'session-1',
        dotbot: {} as DotBot,
        wallet: {
          address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
          source: 'polkadot-js',
        },
        environment: 'mainnet',
        network: 'polkadot',
        createdAt: new Date(),
        lastAccessed: new Date(),
      };

      const session2: DotBotSession = {
        sessionId: 'session-2',
        dotbot: {} as DotBot,
        wallet: {
          address: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
          source: 'polkadot-js',
        },
        environment: 'testnet',
        network: 'westend',
        createdAt: new Date(),
        lastAccessed: new Date(),
      };

      await store.set('session-1', session1);
      await store.set('session-2', session2);

      const all = await store.getAll();
      expect(all).toHaveLength(2);
      expect(all.map(s => s.sessionId)).toContain('session-1');
      expect(all.map(s => s.sessionId)).toContain('session-2');
    });
  });
});

describe('DotBotSessionManager', () => {
  let manager: DotBotSessionManager;
  let mockStore: jest.Mocked<SessionStore>;
  let mockDotBot: jest.Mocked<DotBot>;
  let mockAIService: jest.Mocked<AIService>;
  let mockChatManager: jest.Mocked<ChatInstanceManager>;

  const mockWallet: WalletAccount = {
    address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    name: 'Test Account',
    source: 'polkadot-js',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock store
    mockStore = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      getAll: jest.fn(),
    } as any;

    // Create mock DotBot
    mockDotBot = {
      getEnvironment: jest.fn().mockReturnValue('mainnet'),
      getNetwork: jest.fn().mockReturnValue('polkadot'),
      getWallet: jest.fn().mockReturnValue(mockWallet),
      currentChat: null,
    } as any;

    // Create mock AI Service
    mockAIService = {
      getProviderType: jest.fn().mockReturnValue('asi-one'),
    } as any;

    // Create mock Chat Manager
    mockChatManager = {
      queryInstances: jest.fn().mockResolvedValue([]),
    } as any;

    // Setup mocks
    (AIService as jest.Mock).mockImplementation(() => mockAIService);
    (InMemoryChatStorage as jest.Mock).mockImplementation(() => ({}));
    (ChatInstanceManager as jest.Mock).mockImplementation(() => mockChatManager);
    (DotBot.create as jest.Mock).mockResolvedValue(mockDotBot);

    manager = new DotBotSessionManager(mockStore);
  });

  describe('getOrCreateSession()', () => {
    it('should create a new session when none exists', async () => {
      mockStore.get.mockResolvedValue(null);

      const session = await manager.getOrCreateSession({
        sessionId: 'new-session',
        wallet: mockWallet,
        environment: 'mainnet',
        network: 'polkadot',
      });

      expect(session).toBeDefined();
      expect(session.sessionId).toBe('new-session');
      expect(session.wallet.address).toBe(mockWallet.address);
      expect(session.environment).toBe('mainnet');
      expect(session.network).toBe('polkadot');
      expect(mockStore.set).toHaveBeenCalledWith('new-session', expect.any(Object));
      expect(DotBot.create).toHaveBeenCalled();
    });

    it('should return existing session if wallet/environment/network match', async () => {
      const existingSession: DotBotSession = {
        sessionId: 'existing-session',
        dotbot: mockDotBot,
        wallet: mockWallet,
        environment: 'mainnet',
        network: 'polkadot',
        createdAt: new Date('2024-01-01'),
        lastAccessed: new Date('2024-01-01'),
      };

      mockStore.get.mockResolvedValue(existingSession);

      const session = await manager.getOrCreateSession({
        sessionId: 'existing-session',
        wallet: mockWallet,
        environment: 'mainnet',
        network: 'polkadot',
      });

      expect(session).toBe(existingSession);
      expect(DotBot.create).not.toHaveBeenCalled();
      expect(mockStore.set).toHaveBeenCalledWith('existing-session', expect.objectContaining({
        sessionId: 'existing-session',
      }));
    });

    it('should replace session if wallet/environment/network differ', async () => {
      const existingSession: DotBotSession = {
        sessionId: 'existing-session',
        dotbot: mockDotBot,
        wallet: {
          address: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
          source: 'polkadot-js',
        },
        environment: 'testnet',
        network: 'westend',
        createdAt: new Date('2024-01-01'),
        lastAccessed: new Date('2024-01-01'),
      };

      mockStore.get.mockResolvedValue(existingSession);

      const session = await manager.getOrCreateSession({
        sessionId: 'existing-session',
        wallet: mockWallet,
        environment: 'mainnet',
        network: 'polkadot',
      });

      expect(session).toBeDefined();
      expect(session.wallet.address).toBe(mockWallet.address);
      expect(session.environment).toBe('mainnet');
      expect(mockStore.delete).toHaveBeenCalledWith('existing-session');
      expect(DotBot.create).toHaveBeenCalled();
    });

    it('should use default environment if not provided', async () => {
      mockStore.get.mockResolvedValue(null);

      const session = await manager.getOrCreateSession({
        sessionId: 'new-session',
        wallet: mockWallet,
      });

      expect(session.environment).toBe('mainnet');
    });

    it('should use AI provider from config', async () => {
      mockStore.get.mockResolvedValue(null);

      await manager.getOrCreateSession({
        sessionId: 'new-session',
        wallet: mockWallet,
        environment: 'mainnet',
        aiProvider: 'openai' as AIProviderType,
      });

      expect(AIService).toHaveBeenCalledWith(
        expect.objectContaining({
          providerType: 'openai',
        })
      );
    });
  });

  describe('getSession()', () => {
    it('should return session if exists', async () => {
      const existingSession: DotBotSession = {
        sessionId: 'test-session',
        dotbot: mockDotBot,
        wallet: mockWallet,
        environment: 'mainnet',
        network: 'polkadot',
        createdAt: new Date(),
        lastAccessed: new Date(),
      };

      mockStore.get.mockResolvedValue(existingSession);

      const session = await manager.getSession('test-session');

      expect(session).toBe(existingSession);
      expect(mockStore.set).toHaveBeenCalled(); // Should update lastAccessed
    });

    it('should return null if session does not exist', async () => {
      mockStore.get.mockResolvedValue(null);

      const session = await manager.getSession('non-existent');

      expect(session).toBeNull();
    });
  });

  describe('deleteSession()', () => {
    it('should delete session from store', async () => {
      await manager.deleteSession('test-session');

      expect(mockStore.delete).toHaveBeenCalledWith('test-session');
    });
  });

  describe('getAllSessions()', () => {
    it('should return all sessions from store', async () => {
      const sessions: DotBotSession[] = [
        {
          sessionId: 'session-1',
          dotbot: mockDotBot,
          wallet: mockWallet,
          environment: 'mainnet',
          network: 'polkadot',
          createdAt: new Date(),
          lastAccessed: new Date(),
        },
      ];

      mockStore.getAll.mockResolvedValue(sessions);

      const result = await manager.getAllSessions();

      expect(result).toBe(sessions);
    });
  });

  describe('cleanup()', () => {
    it('should remove sessions older than maxAge', async () => {
      const now = Date.now();
      const oldSession: DotBotSession = {
        sessionId: 'old-session',
        dotbot: mockDotBot,
        wallet: mockWallet,
        environment: 'mainnet',
        network: 'polkadot',
        createdAt: new Date(now - 100000),
        lastAccessed: new Date(now - 60000), // 60 seconds ago
      };

      const recentSession: DotBotSession = {
        sessionId: 'recent-session',
        dotbot: mockDotBot,
        wallet: mockWallet,
        environment: 'mainnet',
        network: 'polkadot',
        createdAt: new Date(now - 10000),
        lastAccessed: new Date(now - 5000), // 5 seconds ago
      };

      mockStore.getAll.mockResolvedValue([oldSession, recentSession]);

      const cleaned = await manager.cleanup(30000); // 30 second max age

      expect(cleaned).toBe(1);
      expect(mockStore.delete).toHaveBeenCalledWith('old-session');
      expect(mockStore.delete).not.toHaveBeenCalledWith('recent-session');
    });

    it('should not remove sessions within maxAge', async () => {
      const now = Date.now();
      const recentSession: DotBotSession = {
        sessionId: 'recent-session',
        dotbot: mockDotBot,
        wallet: mockWallet,
        environment: 'mainnet',
        network: 'polkadot',
        createdAt: new Date(now - 10000),
        lastAccessed: new Date(now - 5000), // 5 seconds ago
      };

      mockStore.getAll.mockResolvedValue([recentSession]);

      const cleaned = await manager.cleanup(30000); // 30 second max age

      expect(cleaned).toBe(0);
      expect(mockStore.delete).not.toHaveBeenCalled();
    });
  });
});

describe('createSessionManager()', () => {
  it('should create a manager with in-memory store', () => {
    const manager = createSessionManager();
    expect(manager).toBeInstanceOf(DotBotSessionManager);
  });

  it('should accept AI service config', () => {
    const config = {
      providerType: 'openai' as AIProviderType,
    };
    const manager = createSessionManager(config);
    expect(manager).toBeInstanceOf(DotBotSessionManager);
  });
});
