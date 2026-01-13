/**
 * Chat Storage Interface
 * 
 * Abstract storage layer for chat instances.
 * This allows easy switching between:
 * - LocalStorage (current)
 * - IndexedDB (offline-first)
 * - Backend API (cloud sync)
 * - Hybrid (local cache + backend sync)
 */

import type { ChatInstanceData } from '../types/chatInstance';

/**
 * Storage interface that all implementations must follow
 */
export interface IChatStorage {
  /**
   * Load all chat instances
   */
  loadAll(): Promise<ChatInstanceData[]>;

  /**
   * Load a specific chat instance by ID
   */
  load(id: string): Promise<ChatInstanceData | null>;

  /**
   * Save or update a chat instance
   */
  save(instance: ChatInstanceData): Promise<void>;

  /**
   * Delete a chat instance
   */
  delete(id: string): Promise<void>;

  /**
   * Clear all chat instances
   */
  clear(): Promise<void>;

  /**
   * Check if storage is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get storage type identifier
   */
  getType(): string;
}

/**
 * LocalStorage implementation
 * 
 * Uses localStorage in browser, in-memory storage in Node.js.
 * Frontend should use this to persist data in browser localStorage.
 */
import { getStorage } from '../env';

export class LocalStorageChatStorage implements IChatStorage {
  private storageKey = 'dotbot_chat_instances';
  private storage = getStorage();

  async loadAll(): Promise<ChatInstanceData[]> {
    try {
      const stored = this.storage.getItem(this.storageKey);
      if (!stored) return [];

      const instances = JSON.parse(stored) as ChatInstanceData[];

      // Sort by updatedAt descending (most recent first)
      return instances.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (error) {
      console.error('[LocalStorage] Failed to load chat instances:', error);
      return [];
    }
  }

  async load(id: string): Promise<ChatInstanceData | null> {
    const instances = await this.loadAll();
    return instances.find(i => i.id === id) || null;
  }

  async save(instance: ChatInstanceData): Promise<void> {
    const instances = await this.loadAll();
    const index = instances.findIndex(i => i.id === instance.id);

    // Update timestamp
    instance.updatedAt = Date.now();

    if (index >= 0) {
      instances[index] = instance;
    } else {
      instances.push(instance);
    }

    try {
      this.storage.setItem(this.storageKey, JSON.stringify(instances));
    } catch (error) {
      console.error('[LocalStorage] Failed to save chat instance:', error);
      throw new StorageError('Failed to save chat instance', 'SAVE_FAILED', error);
    }
  }

  async delete(id: string): Promise<void> {
    const instances = await this.loadAll();
    const filtered = instances.filter(i => i.id !== id);

    try {
      this.storage.setItem(this.storageKey, JSON.stringify(filtered));
    } catch (error) {
      console.error('[LocalStorage] Failed to delete chat instance:', error);
      throw new StorageError('Failed to delete chat instance', 'DELETE_FAILED', error);
    }
  }

  async clear(): Promise<void> {
    try {
      this.storage.removeItem(this.storageKey);
    } catch (error) {
      console.error('[LocalStorage] Failed to clear chat instances:', error);
      throw new StorageError('Failed to clear chat instances', 'CLEAR_FAILED', error);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const test = '__storage_test__';
      this.storage.setItem(test, test);
      this.storage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }

  getType(): string {
    return 'localStorage';
  }
}

/**
 * In-Memory storage implementation
 * 
 * For backend/Node.js use - data is stored in memory only (not persisted).
 * Useful for server-side DotBot instances where persistence is handled separately.
 */
export class InMemoryChatStorage implements IChatStorage {
  private instances: Map<string, ChatInstanceData> = new Map();

  async loadAll(): Promise<ChatInstanceData[]> {
    const instances = Array.from(this.instances.values());
    return instances.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string): Promise<ChatInstanceData | null> {
    return this.instances.get(id) || null;
  }

  async save(instance: ChatInstanceData): Promise<void> {
    instance.updatedAt = Date.now();
    this.instances.set(instance.id, instance);
  }

  async delete(id: string): Promise<void> {
    this.instances.delete(id);
  }

  async clear(): Promise<void> {
    this.instances.clear();
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getType(): string {
    return 'inMemory';
  }
}

/**
 * Backend API storage implementation (future)
 * 
 * Template for backend API integration.
 * Uncomment and implement when backend is ready.
 */
export class ApiChatStorage implements IChatStorage {
  private apiUrl: string;
  private authToken?: string;

  constructor(apiUrl: string, authToken?: string) {
    this.apiUrl = apiUrl;
    this.authToken = authToken;
  }

  async loadAll(): Promise<ChatInstanceData[]> {
    try {
      const response = await fetch(`${this.apiUrl}/chat-instances`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data.instances || [];
    } catch (error) {
      console.error('[API] Failed to load chat instances:', error);
      throw new StorageError('Failed to load from server', 'NETWORK_ERROR', error);
    }
  }

  async load(id: string): Promise<ChatInstanceData | null> {
    try {
      const response = await fetch(`${this.apiUrl}/chat-instances/${id}`, {
        headers: this.getHeaders(),
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`[API] Failed to load chat instance ${id}:`, error);
      throw new StorageError('Failed to load from server', 'NETWORK_ERROR', error);
    }
  }

  async save(instance: ChatInstanceData): Promise<void> {
    try {
      const response = await fetch(`${this.apiUrl}/chat-instances/${instance.id}`, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(instance),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('[API] Failed to save chat instance:', error);
      throw new StorageError('Failed to save to server', 'NETWORK_ERROR', error);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const response = await fetch(`${this.apiUrl}/chat-instances/${id}`, {
        method: 'DELETE',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('[API] Failed to delete chat instance:', error);
      throw new StorageError('Failed to delete from server', 'NETWORK_ERROR', error);
    }
  }

  async clear(): Promise<void> {
    try {
      const response = await fetch(`${this.apiUrl}/chat-instances`, {
        method: 'DELETE',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('[API] Failed to clear chat instances:', error);
      throw new StorageError('Failed to clear from server', 'NETWORK_ERROR', error);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/health`, {
        headers: this.getHeaders(),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  getType(): string {
    return 'api';
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    return headers;
  }
}

/**
 * Hybrid storage implementation (future)
 * 
 * Combines local storage (fast, offline) with backend sync (persistent, cross-device).
 * Uses local as cache, syncs to backend when available.
 */
export class HybridChatStorage implements IChatStorage {
  private local: LocalStorageChatStorage;
  private remote: ApiChatStorage;
  private syncQueue: Set<string> = new Set();

  constructor(apiUrl: string, authToken?: string) {
    this.local = new LocalStorageChatStorage();
    this.remote = new ApiChatStorage(apiUrl, authToken);
  }

  async loadAll(): Promise<ChatInstanceData[]> {
    // Try remote first for freshest data
    try {
      const instances = await this.remote.loadAll();
      
      // Cache locally
      for (const instance of instances) {
        await this.local.save(instance);
      }
      
      return instances;
    } catch {
      // Fallback to local
      console.warn('[Hybrid] Using local cache (backend unavailable)');
      return await this.local.loadAll();
    }
  }

  async load(id: string): Promise<ChatInstanceData | null> {
    // Try local first (fast)
    const localInstance = await this.local.load(id);
    
    // Try to refresh from remote in background
    this.remote.load(id).then(remoteInstance => {
      if (remoteInstance) {
        this.local.save(remoteInstance);
      }
    }).catch(() => {
      // Ignore remote errors
    });
    
    return localInstance;
  }

  async save(instance: ChatInstanceData): Promise<void> {
    // Always save locally first (fast, offline-capable)
    await this.local.save(instance);
    
    // Try to sync to remote
    try {
      await this.remote.save(instance);
      this.syncQueue.delete(instance.id);
    } catch {
      // Queue for later sync
      this.syncQueue.add(instance.id);
      console.warn(`[Hybrid] Queued ${instance.id} for sync`);
    }
  }

  async delete(id: string): Promise<void> {
    await this.local.delete(id);
    
    try {
      await this.remote.delete(id);
    } catch {
      console.warn('[Hybrid] Failed to delete from remote');
    }
  }

  async clear(): Promise<void> {
    await this.local.clear();
    
    try {
      await this.remote.clear();
    } catch {
      console.warn('[Hybrid] Failed to clear remote');
    }
  }

  async isAvailable(): Promise<boolean> {
    return await this.local.isAvailable();
  }

  getType(): string {
    return 'hybrid';
  }

  /**
   * Sync pending changes to remote
   */
  async syncPending(): Promise<void> {
    if (this.syncQueue.size === 0) return;

    const idsToSync = Array.from(this.syncQueue);
    console.log(`[Hybrid] Syncing ${idsToSync.length} pending instances...`);

    for (const id of idsToSync) {
      try {
        const instance = await this.local.load(id);
        if (instance) {
          await this.remote.save(instance);
          this.syncQueue.delete(id);
        }
      } catch (error) {
        console.error(`[Hybrid] Failed to sync ${id}:`, error);
      }
    }
  }
}

/**
 * Custom error class for storage operations
 */
export class StorageError extends Error {
  constructor(
    message: string,
    public code: string,
    public cause?: unknown
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

/**
 * Storage factory
 * 
 * Creates the appropriate storage implementation based on configuration.
 */
export function createChatStorage(config?: {
  type?: 'localStorage' | 'inMemory' | 'api' | 'hybrid';
  apiUrl?: string;
  authToken?: string;
}): IChatStorage {
  const type = config?.type || 'localStorage';

  switch (type) {
    case 'localStorage':
      return new LocalStorageChatStorage();

    case 'inMemory':
      return new InMemoryChatStorage();

    case 'api':
      if (!config?.apiUrl) {
        throw new Error('API URL required for API storage');
      }
      return new ApiChatStorage(config.apiUrl, config.authToken);

    case 'hybrid':
      if (!config?.apiUrl) {
        throw new Error('API URL required for hybrid storage');
      }
      return new HybridChatStorage(config.apiUrl, config.authToken);

    default:
      throw new Error(`Unknown storage type: ${type}`);
  }
}

