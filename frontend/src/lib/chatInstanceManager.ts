/**
 * Chat Instance Manager
 * 
 * Manages chat instances including:
 * - CRUD operations
 * - Storage abstraction (LocalStorage, API, Hybrid)
 * - Environment/network validation
 * - Message management
 * 
 * Storage-agnostic design allows easy migration to backend/IndexedDB.
 */

import type {
  ChatInstanceData,
  Environment,
  CreateChatInstanceParams,
  UpdateChatInstanceParams,
  ChatInstanceFilter,
  ValidationResult,
  ExecutionMessage,
  ConversationItem
} from './types/chatInstance';
import { ENVIRONMENT_NETWORKS } from './types/chatInstance';
import type { Network } from './rpcManager';
import type { IChatStorage } from './storage/chatStorage';
import { LocalStorageChatStorage } from './storage/chatStorage';

/**
 * Chat Instance Manager Configuration
 */
export interface ChatInstanceManagerConfig {
  /** Storage implementation (defaults to LocalStorage) */
  storage?: IChatStorage;
  
  /** Auto-generate titles for new chats */
  autoGenerateTitles?: boolean;
  
  /** ID generation strategy */
  idGenerator?: () => string;
}

export class ChatInstanceManager {
  private storage: IChatStorage;
  private autoGenerateTitles: boolean;
  private idGenerator: () => string;

  constructor(config?: ChatInstanceManagerConfig) {
    this.storage = config?.storage || new LocalStorageChatStorage();
    this.autoGenerateTitles = config?.autoGenerateTitles ?? true;
    this.idGenerator = config?.idGenerator || this.defaultIdGenerator;
  }

  /**
   * Create a new chat instance
   */
  async createInstance(params: CreateChatInstanceParams): Promise<ChatInstanceData> {
    // Validate network is valid for environment
    const validation = this.validateNetworkForEnvironment(
      params.network,
      params.environment
    );
    
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid network for environment');
    }

    const instance: ChatInstanceData = {
      id: this.idGenerator(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      environment: params.environment,
      network: params.network,
      walletAddress: params.walletAddress,
      messages: [],
      title: params.title,
    };

    await this.storage.save(instance);
    return instance;
  }

  /**
   * Load all chat instances from storage
   */
  async loadInstances(): Promise<ChatInstanceData[]> {
    return await this.storage.loadAll();
  }

  /**
   * Load a specific chat instance by ID
   */
  async loadInstance(id: string): Promise<ChatInstanceData | null> {
    return await this.storage.load(id);
  }

  /**
   * Save or update a chat instance
   */
  async saveInstance(instance: ChatInstanceData): Promise<void> {
    await this.storage.save(instance);
  }

  /**
   * Update a chat instance (only mutable fields)
   */
  async updateInstance(id: string, updates: UpdateChatInstanceParams): Promise<ChatInstanceData> {
    const instance = await this.loadInstance(id);
    if (!instance) {
      throw new Error(`Chat instance ${id} not found`);
    }

    // Validate network change if provided
    if (updates.network && updates.network !== instance.network) {
      const validation = this.validateNetworkForEnvironment(
        updates.network,
        instance.environment
      );
      
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid network for environment');
      }
    }

    // Apply updates (only mutable fields)
    const updated: ChatInstanceData = {
      ...instance,
      network: updates.network ?? instance.network,
      walletAddress: updates.walletAddress ?? instance.walletAddress,
      title: updates.title ?? instance.title,
      archived: updates.archived ?? instance.archived,
      tags: updates.tags ?? instance.tags,
    };

    await this.storage.save(updated);
    return updated;
  }

  /**
   * Delete a chat instance
   */
  async deleteInstance(id: string): Promise<void> {
    await this.storage.delete(id);
  }

  /**
   * Add a message to a chat instance
   */
  async addMessage(instanceId: string, message: ConversationItem): Promise<void> {
    const instance = await this.loadInstance(instanceId);
    if (!instance) {
      throw new Error(`Chat instance ${instanceId} not found`);
    }

    instance.messages.push(message);
    await this.storage.save(instance);
  }

  /**
   * Update an execution message status
   */
  async updateExecutionMessage(
    instanceId: string,
    messageId: string,
    updates: Partial<ExecutionMessage>
  ): Promise<void> {
    const instance = await this.loadInstance(instanceId);
    if (!instance) {
      throw new Error(`Chat instance ${instanceId} not found`);
    }

    const message = instance.messages.find(m => m.id === messageId);
    if (!message || message.type !== 'execution') {
      throw new Error(`Execution message ${messageId} not found`);
    }

    // Update execution message
    Object.assign(message, updates);
    await this.storage.save(instance);
  }

  /**
   * Query chat instances with filters
   */
  async queryInstances(filter?: ChatInstanceFilter): Promise<ChatInstanceData[]> {
    let instances = await this.loadInstances();

    if (!filter) return instances;

    if (filter.environment) {
      instances = instances.filter(i => i.environment === filter.environment);
    }

    if (filter.network) {
      instances = instances.filter(i => i.network === filter.network);
    }

    if (filter.walletAddress) {
      instances = instances.filter(i => i.walletAddress === filter.walletAddress);
    }

    if (filter.archived !== undefined) {
      instances = instances.filter(i => (i.archived ?? false) === filter.archived);
    }

    if (filter.fromDate) {
      instances = instances.filter(i => i.updatedAt >= filter.fromDate!);
    }

    if (filter.toDate) {
      instances = instances.filter(i => i.updatedAt <= filter.toDate!);
    }

    return instances;
  }

  /**
   * Get chat instances grouped by environment
   */
  async getInstancesByEnvironment(): Promise<Record<Environment, ChatInstanceData[]>> {
    const instances = await this.loadInstances();
    
    return {
      mainnet: instances.filter(i => i.environment === 'mainnet'),
      testnet: instances.filter(i => i.environment === 'testnet'),
    };
  }

  /**
   * Generate a title from the first user message
   */
  generateTitle(messages: ConversationItem[]): string {
    const firstUserMessage = messages.find(m => m.type === 'user');
    
    if (!firstUserMessage || firstUserMessage.type !== 'user') {
      return 'New Chat';
    }

    const content = firstUserMessage.content;
    const maxLength = 50;
    
    return content.length > maxLength
      ? content.substring(0, maxLength - 3) + '...'
      : content;
  }

  /**
   * Auto-generate and set title if not provided
   */
  async autoGenerateTitle(instanceId: string): Promise<string> {
    const instance = await this.loadInstance(instanceId);
    if (!instance) {
      throw new Error(`Chat instance ${instanceId} not found`);
    }

    if (instance.title) {
      return instance.title;
    }

    const title = this.generateTitle(instance.messages);
    await this.updateInstance(instanceId, { title });
    
    return title;
  }

  /**
   * Validate that a network is valid for an environment
   */
  validateNetworkForEnvironment(
    network: Network,
    environment: Environment
  ): ValidationResult {
    const validNetworks = ENVIRONMENT_NETWORKS[environment];
    
    if (!validNetworks.includes(network)) {
      return {
        valid: false,
        error: `Network '${network}' is not valid for environment '${environment}'. Valid networks: ${validNetworks.join(', ')}`
      };
    }

    return { valid: true };
  }

  /**
   * Check if switching to a network requires a new chat instance
   */
  requiresNewInstance(
    currentInstance: ChatInstanceData,
    targetNetwork: Network
  ): boolean {
    const currentEnv = currentInstance.environment;
    const targetEnv = this.getEnvironmentForNetwork(targetNetwork);
    
    // Different environment = new instance required
    return currentEnv !== targetEnv;
  }

  /**
   * Get the environment for a given network
   */
  getEnvironmentForNetwork(network: Network): Environment {
    for (const [env, networks] of Object.entries(ENVIRONMENT_NETWORKS)) {
      if (networks.includes(network)) {
        return env as Environment;
      }
    }
    
    // Default to mainnet for unknown networks
    return 'mainnet';
  }

  /**
   * Clear all chat instances (use with caution!)
   */
  async clearAllInstances(): Promise<void> {
    await this.storage.clear();
  }

  /**
   * Export chat instances as JSON
   */
  async exportInstances(): Promise<string> {
    const instances = await this.loadInstances();
    return JSON.stringify(instances, null, 2);
  }

  /**
   * Import chat instances from JSON
   */
  async importInstances(jsonData: string): Promise<void> {
    try {
      const instances = JSON.parse(jsonData) as ChatInstanceData[];
      
      // Validate structure
      if (!Array.isArray(instances)) {
        throw new Error('Invalid format: expected array of chat instances');
      }

      // Merge with existing instances (avoid duplicates)
      const existing = await this.loadInstances();
      const existingIds = new Set(existing.map(i => i.id));
      
      const newInstances = instances.filter(i => !existingIds.has(i.id));

      // Save each new instance
      for (const instance of newInstances) {
        await this.storage.save(instance);
      }
    } catch (error) {
      console.error('Failed to import chat instances:', error);
      // Re-throw the original error if it has a specific message
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to import chat instances');
    }
  }

  /**
   * Get storage type
   */
  getStorageType(): string {
    return this.storage.getType();
  }

  /**
   * Check if storage is available
   */
  async isStorageAvailable(): Promise<boolean> {
    return await this.storage.isAvailable();
  }

  /**
   * Default ID generator
   */
  private defaultIdGenerator(): string {
    return `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

