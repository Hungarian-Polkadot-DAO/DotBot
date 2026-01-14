/**
 * DotBot Session Manager
 * 
 * Manages DotBot instances per session (user/wallet/environment combination).
 * Handles AI service creation and configuration.
 * 
 * This is the proper way to manage DotBot instances in a multi-user environment.
 * Routes should use this manager instead of managing instances directly.
 * 
 * This is part of @dotbot/express (backend-specific), not @dotbot/core.
 * 
 * Redis-ready: Uses SessionStore interface for pluggable storage backends.
 */

import { DotBot, DotBotConfig, Environment, Network, InMemoryChatStorage, ChatInstanceManager } from '@dotbot/core';
import type { WalletAccount } from '@dotbot/core/types/wallet';
import { AIService, AIServiceConfig, AIProviderType } from '@dotbot/core/services/ai';
import { ENVIRONMENT_NETWORKS } from '@dotbot/core/types/chatInstance';
import { sessionLogger } from './utils/logger';

/**
 * Session Store Interface
 * 
 * Drop-in interface for different storage backends (InMemory, Redis, etc.)
 */
export interface SessionStore {
  get(id: string): Promise<DotBotSession | null>;
  set(id: string, session: DotBotSession): Promise<void>;
  delete(id: string): Promise<void>;
  getAll(): Promise<DotBotSession[]>;
}

export interface SessionConfig {
  sessionId: string;
  wallet: WalletAccount;
  environment?: Environment;
  network?: Network;
  aiProvider?: AIProviderType;
}

export interface DotBotSession {
  sessionId: string;
  dotbot: DotBot;
  wallet: WalletAccount;
  environment: Environment;
  network: Network;
  createdAt: Date;
  lastAccessed: Date;
  aiProvider?: AIProviderType; // Store for Redis recreation
}

/**
 * Serializable session data (for Redis storage)
 * DotBot instance is recreated on retrieval
 */
interface SerializableSessionData {
  sessionId: string;
  wallet: WalletAccount;
  environment: Environment;
  network: Network;
  createdAt: string; // ISO string
  lastAccessed: string; // ISO string
  aiProvider?: AIProviderType;
}

/**
 * In-Memory Session Store
 * 
 * Simple Map-based storage for single-instance deployments.
 */
export class InMemorySessionStore implements SessionStore {
  private sessions: Map<string, DotBotSession> = new Map();

  async get(id: string): Promise<DotBotSession | null> {
    const session = this.sessions.get(id);
    if (session) {
      session.lastAccessed = new Date();
    }
    return session || null;
  }

  async set(id: string, session: DotBotSession): Promise<void> {
    this.sessions.set(id, session);
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async getAll(): Promise<DotBotSession[]> {
    return Array.from(this.sessions.values());
  }
}

/**
 * Redis Session Store
 * 
 * Stores session metadata in Redis and recreates DotBot instances on retrieval.
 * 
 * Note: DotBot instances cannot be serialized, so we store metadata and recreate
 * the instance when needed. Pass a recreation function that can create DotBot instances.
 */
export class RedisSessionStore implements SessionStore {
  private redisClient: any; // Redis client (from 'redis' or 'ioredis' package)
  private keyPrefix: string;
  private recreateSession: (data: SerializableSessionData) => Promise<DotBotSession>;
  private defaultAIServiceConfig?: AIServiceConfig;

  constructor(
    redisClient: any,
    recreateSession: (data: SerializableSessionData, aiServiceConfig?: AIServiceConfig) => Promise<DotBotSession>,
    defaultAIServiceConfig?: AIServiceConfig,
    keyPrefix: string = 'dotbot:session:'
  ) {
    this.redisClient = redisClient;
    this.recreateSession = (data) => recreateSession(data, defaultAIServiceConfig);
    this.defaultAIServiceConfig = defaultAIServiceConfig;
    this.keyPrefix = keyPrefix;
  }

  private getKey(id: string): string {
    return `${this.keyPrefix}${id}`;
  }

  async get(id: string): Promise<DotBotSession | null> {
    try {
      const data = await this.redisClient.get(this.getKey(id));
      if (!data) {
        return null;
      }

      const sessionData: SerializableSessionData = JSON.parse(data);
      
      // Recreate DotBot instance
      const session = await this.recreateSession(sessionData);
      
      // Update lastAccessed
      session.lastAccessed = new Date();
      await this.set(id, session);

      return session;
    } catch (error) {
      console.error('Redis get error:', error);
      return null;
    }
  }

  async set(id: string, session: DotBotSession): Promise<void> {
    try {
      // Store only serializable data
      const sessionData: SerializableSessionData = {
        sessionId: session.sessionId,
        wallet: session.wallet,
        environment: session.environment,
        network: session.network,
        createdAt: session.createdAt.toISOString(),
        lastAccessed: session.lastAccessed.toISOString(),
        aiProvider: session.aiProvider,
      };

      await this.redisClient.set(
        this.getKey(id),
        JSON.stringify(sessionData),
        'EX',
        3600 // TTL: 1 hour (adjust as needed)
      );
    } catch (error) {
      console.error('Redis set error:', error);
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.redisClient.del(this.getKey(id));
    } catch (error) {
      console.error('Redis delete error:', error);
      throw error;
    }
  }

  async getAll(): Promise<DotBotSession[]> {
    try {
      const keys = await this.redisClient.keys(`${this.keyPrefix}*`);
      if (keys.length === 0) {
        return [];
      }

      const sessions: DotBotSession[] = [];
      for (const key of keys) {
        const data = await this.redisClient.get(key);
        if (data) {
          const sessionData: SerializableSessionData = JSON.parse(data);
          sessions.push(await this.recreateSession(sessionData));
        }
      }

      return sessions;
    } catch (error) {
      console.error('Redis getAll error:', error);
      return [];
    }
  }
}

/**
 * Manages DotBot instances per session
 * 
 * Handles:
 * - Creating DotBot instances with proper AI service configuration
 * - Session lifecycle management
 * - AI service creation from environment variables
 * - Multi-user support (one instance per session)
 * - Pluggable storage backends (InMemory, Redis, etc.)
 */
export class DotBotSessionManager {
  private store: SessionStore;
  private defaultAIServiceConfig?: AIServiceConfig;

  constructor(store?: SessionStore, defaultAIServiceConfig?: AIServiceConfig) {
    this.store = store || new InMemorySessionStore();
    this.defaultAIServiceConfig = defaultAIServiceConfig;
  }

  /**
   * Create AI service from environment variables or config
   */
  private createAIService(provider?: AIProviderType): AIService {
    const config: AIServiceConfig = {
      ...this.defaultAIServiceConfig,
      providerType: provider || this.defaultAIServiceConfig?.providerType,
    };
    return new AIService(config);
  }

  /**
   * Recreate a DotBot session from serialized data
   * Used by RedisSessionStore to recreate instances
   */
  private async recreateSession(data: SerializableSessionData): Promise<DotBotSession> {
    const aiService = this.createAIService(data.aiProvider);
    
    const chatManager = new ChatInstanceManager({
      storage: new InMemoryChatStorage(),
    });

    const dotbotConfig: DotBotConfig = {
      wallet: data.wallet,
      environment: data.environment,
      network: data.network,
      aiService: aiService as any, // Type assertion to handle source/dist type mismatch
      chatManager,
      autoApprove: false,
    };

    const dotbot = await DotBot.create(dotbotConfig);
    
    return {
      sessionId: data.sessionId,
      dotbot,
      wallet: data.wallet,
      environment: data.environment,
      network: data.network,
      createdAt: new Date(data.createdAt),
      lastAccessed: new Date(data.lastAccessed),
      aiProvider: data.aiProvider,
    };
  }

  /**
   * Get or create a DotBot session
   * 
   * If a session exists for the same sessionId, wallet, environment, and network,
   * it returns the existing instance. Otherwise, creates a new one.
   */
  async getOrCreateSession(config: SessionConfig): Promise<DotBotSession> {
    const { sessionId, wallet, environment = 'mainnet', network, aiProvider } = config;
    
    // Determine effective network - use provided network or default for environment
    const effectiveNetwork = network || this.getDefaultNetwork(environment);
    
    sessionLogger.info({ 
      sessionId,
      walletAddress: wallet.address,
      walletName: wallet.name,
      walletSource: wallet.source,
      environment,
      network: effectiveNetwork,
      aiProvider
    }, 'getOrCreateSession: Checking for existing session');

    // Check if session exists
    let existing: DotBotSession | null = null;
    try {
      existing = await this.store.get(sessionId);
      sessionLogger.debug({ 
        sessionId,
        found: !!existing,
        existingWallet: existing?.wallet.address,
        existingEnvironment: existing?.environment,
        existingNetwork: existing?.network
      }, 'getOrCreateSession: Store lookup result');
    } catch (storeError: any) {
      sessionLogger.error({ 
        error: storeError.message,
        sessionId 
      }, 'getOrCreateSession: Failed to check store');
      throw storeError;
    }
    
    if (existing) {
      // Verify it's for the same wallet/environment/network
      const walletMatch = existing.wallet.address === wallet.address;
      const envMatch = existing.environment === environment;
      const networkMatch = existing.network === effectiveNetwork;
      
      sessionLogger.debug({ 
        sessionId,
        walletMatch,
        envMatch,
        networkMatch,
        existingWallet: existing.wallet.address,
        requestedWallet: wallet.address,
        existingEnv: existing.environment,
        requestedEnv: environment,
        existingNetwork: existing.network,
        requestedNetwork: effectiveNetwork
      }, 'getOrCreateSession: Session validation');

      if (walletMatch && envMatch && networkMatch) {
        // Update last accessed and save
        existing.lastAccessed = new Date();
        await this.store.set(sessionId, existing);
        sessionLogger.info({ 
          sessionId,
          lastAccessed: existing.lastAccessed.toISOString()
        }, 'getOrCreateSession: Reusing existing session');
        return existing;
      }
      
      // Different wallet/environment/network, remove old session
      sessionLogger.warn({ 
        sessionId,
        reason: 'wallet/environment/network mismatch',
        existingWallet: existing.wallet.address,
        requestedWallet: wallet.address,
        existingEnv: existing.environment,
        requestedEnv: environment,
        existingNetwork: existing.network,
        requestedNetwork: effectiveNetwork
      }, 'getOrCreateSession: Removing mismatched session');
      await this.store.delete(sessionId);
    }

    // Create new session
    sessionLogger.info({ 
      sessionId,
      environment,
      network: effectiveNetwork,
      aiProvider
    }, 'getOrCreateSession: Creating new session');

    let aiService: AIService;
    try {
      aiService = this.createAIService(aiProvider);
      sessionLogger.debug({ 
        sessionId,
        providerType: aiService.getProviderType?.() || 'unknown'
      }, 'getOrCreateSession: AI service created');
    } catch (aiError: any) {
      sessionLogger.error({ 
        error: aiError.message,
        sessionId,
        aiProvider
      }, 'getOrCreateSession: Failed to create AI service');
      throw aiError;
    }
    
    // Create chat manager with in-memory storage (backend use)
    // Frontend will use LocalStorageChatStorage
    const chatManager = new ChatInstanceManager({
      storage: new InMemoryChatStorage(),
    });

    const dotbotConfig: DotBotConfig = {
      wallet,
      environment,
      network: effectiveNetwork,
      aiService: aiService as any, // Type assertion to handle source/dist type mismatch
      chatManager,
      autoApprove: false, // Backend should handle signing properly
      stateful: false, // Backend is stateless - returns state to frontend
    };

    let dotbot: DotBot;
    try {
      sessionLogger.info({ 
        sessionId,
        environment,
        network: effectiveNetwork
      }, 'getOrCreateSession: Creating DotBot instance');
      dotbot = await DotBot.create(dotbotConfig);
      sessionLogger.info({ 
        sessionId,
        dotbotEnvironment: dotbot.getEnvironment(),
        dotbotNetwork: dotbot.getNetwork()
      }, 'getOrCreateSession: DotBot instance created');
    } catch (dotbotError: any) {
      sessionLogger.error({ 
        error: dotbotError.message,
        stack: dotbotError.stack,
        sessionId,
        environment,
        network: effectiveNetwork
      }, 'getOrCreateSession: Failed to create DotBot instance');
      throw dotbotError;
    }
    
    const session: DotBotSession = {
      sessionId,
      dotbot,
      wallet,
      environment,
      network: effectiveNetwork,
      createdAt: new Date(),
      lastAccessed: new Date(),
      aiProvider, // Store for Redis recreation
    };

    try {
      await this.store.set(sessionId, session);
      sessionLogger.info({ 
        sessionId,
        environment: session.environment,
        network: session.network,
        createdAt: session.createdAt.toISOString()
      }, 'getOrCreateSession: Session stored successfully');
    } catch (storeError: any) {
      sessionLogger.error({ 
        error: storeError.message,
        sessionId
      }, 'getOrCreateSession: Failed to store session');
      throw storeError;
    }

    return session;
  }

  /**
   * Get an existing session
   */
  async getSession(sessionId: string): Promise<DotBotSession | null> {
    const session = await this.store.get(sessionId);
    if (session) {
      session.lastAccessed = new Date();
      await this.store.set(sessionId, session);
    }
    return session;
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.store.delete(sessionId);
  }

  /**
   * Get all sessions
   */
  async getAllSessions(): Promise<DotBotSession[]> {
    return await this.store.getAll();
  }

  /**
   * Clean up old sessions (optional - for memory management)
   * Note: Redis handles TTL automatically, but this can be used for in-memory stores
   */
  async cleanup(maxAge: number = 30 * 60 * 1000): Promise<number> {
    const now = Date.now();
    let cleaned = 0;
    
    const sessions = await this.store.getAll();
    for (const session of sessions) {
      const age = now - session.lastAccessed.getTime();
      if (age > maxAge) {
        await this.store.delete(session.sessionId);
        cleaned++;
      }
    }
    
    return cleaned;
  }

  /**
   * Get default network for environment
   */
  private getDefaultNetwork(environment: Environment): Network {
    const networks = ENVIRONMENT_NETWORKS[environment];
    return networks?.[0] || 'polkadot';
  }
}

/**
 * Create a default session manager instance (in-memory)
 * 
 * This can be used as a singleton in the backend.
 */
export function createSessionManager(config?: AIServiceConfig): DotBotSessionManager {
  return new DotBotSessionManager(undefined, config);
}

/**
 * Create a session manager with Redis store
 * 
 * Example:
 * ```typescript
 * import { createClient } from 'redis';
 * const redisClient = createClient();
 * await redisClient.connect();
 * 
 * const manager = createRedisSessionManager(redisClient, {
 *   providerType: AIProviderType.ASI_ONE
 * });
 * ```
 */
export function createRedisSessionManager(
  redisClient: any,
  config?: AIServiceConfig,
  keyPrefix: string = 'dotbot:session:'
): DotBotSessionManager {
  // Create a temporary manager to access recreateSession method
  const tempManager = new DotBotSessionManager(undefined, config);
  const recreateSession = (data: SerializableSessionData, aiServiceConfig?: AIServiceConfig) => {
    // Create a new manager instance for recreation
    const recreateManager = new DotBotSessionManager(undefined, aiServiceConfig || config);
    return (recreateManager as any).recreateSession(data);
  };
  const redisStore = new RedisSessionStore(redisClient, recreateSession, config, keyPrefix);
  return new DotBotSessionManager(redisStore, config);
}
