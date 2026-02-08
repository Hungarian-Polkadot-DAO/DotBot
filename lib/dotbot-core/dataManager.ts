/**
 * Data Manager
 * 
 * Comprehensive data management for GDPR compliance and user privacy.
 * Provides utilities to:
 * - Export all user data
 * - Delete all user data
 * - Manage specific data types
 * - Clear storage completely
 * 
 * Uses storage abstraction (getStorage) to work in both browser and Node.js.
 */

import { ChatInstanceManager } from './chat/chatInstanceManager';
import type { ChatInstanceData } from './chat/types';
import { getStorage } from './env';

/**
 * All localStorage keys used by DotBot
 */
export const STORAGE_KEYS = {
  /** Chat instances (ChatInstanceManager) */
  CHAT_INSTANCES: 'dotbot_chat_instances',
  
  /** RPC endpoint health tracking (matches RpcManager storage keys) */
  RPC_HEALTH_POLKADOT_RELAY: 'dotbot_rpc_health_polkadot_relay',
  RPC_HEALTH_POLKADOT_ASSETHUB: 'dotbot_rpc_health_polkadot_asset_hub',
  RPC_HEALTH_KUSAMA_RELAY: 'dotbot_rpc_health_kusama_relay',
  RPC_HEALTH_KUSAMA_ASSETHUB: 'dotbot_rpc_health_kusama_asset_hub',
  RPC_HEALTH_WESTEND_RELAY: 'dotbot_rpc_health_westend_relay',
  RPC_HEALTH_WESTEND_ASSETHUB: 'dotbot_rpc_health_westend_asset_hub',
  
  /** User preferences (future) */
  USER_PREFERENCES: 'dotbot_user_preferences',
  
  /** Wallet connection cache (future) */
  WALLET_CACHE: 'dotbot_wallet_cache',
  
  /** Analytics consent (future) */
  ANALYTICS_CONSENT: 'dotbot_analytics_consent',
} as const;

/**
 * Data export format for GDPR compliance
 */
export interface DataExport {
  /** When the export was created */
  exportedAt: string;
  
  /** DotBot version */
  version: string;
  
  /** All chat instances */
  chatInstances: ChatInstanceData[];
  
  /** RPC health data */
  rpcHealth: Record<string, any>;
  
  /** User preferences */
  preferences: Record<string, any>;
  
  /** Wallet cache */
  walletCache: any;
  
  /** Other data */
  other: Record<string, any>;
}

/**
 * Data deletion report
 */
export interface DeletionReport {
  /** When deletion occurred */
  deletedAt: string;
  
  /** What was deleted */
  deleted: {
    chatInstances: number;
    rpcHealthEntries: number;
    preferences: boolean;
    walletCache: boolean;
    other: number;
  };
  
  /** Total items deleted */
  totalItems: number;
  
  /** Verification that storage is clear */
  verifiedClear: boolean;
}

/**
 * Comprehensive data manager for DotBot
 */
export class DataManager {
  private chatManager: ChatInstanceManager;
  private storage = getStorage();

  constructor(chatManager?: ChatInstanceManager) {
    this.chatManager = chatManager || new ChatInstanceManager();
  }

  /**
   * Export all user data (GDPR Article 20 - Right to data portability)
   */
  async exportAllData(): Promise<DataExport> {
    const chatInstances = await this.chatManager.loadInstances();
    
    const rpcHealth: Record<string, any> = {};
    for (const [key, storageKey] of Object.entries(STORAGE_KEYS)) {
      if (key.startsWith('RPC_HEALTH_')) {
        const data = this.storage.getItem(storageKey);
        if (data) {
          try {
            rpcHealth[key] = JSON.parse(data);
          } catch {
            rpcHealth[key] = data;
          }
        }
      }
    }

    const preferences = this.getStorageItem(STORAGE_KEYS.USER_PREFERENCES) || {};
    const walletCache = this.getStorageItem(STORAGE_KEYS.WALLET_CACHE);
    
    // Get any other DotBot-related keys
    const other: Record<string, any> = {};
    const knownKeys = new Set<string>(Object.values(STORAGE_KEYS));
    
    // Enumerate storage keys (works with both localStorage and FileStorage)
    const length = this.storage.length ?? 0;
    for (let i = 0; i < length; i++) {
      const key = this.storage.key?.(i);
      if (key && key.startsWith('dotbot_') && !knownKeys.has(key)) {
        const value = this.storage.getItem(key);
        if (value) {
          try {
            other[key] = JSON.parse(value);
          } catch {
            other[key] = value;
          }
        }
      }
    }

    return {
      exportedAt: new Date().toISOString(),
      version: '0.2.0',
      chatInstances,
      rpcHealth,
      preferences,
      walletCache,
      other,
    };
  }

  /**
   * Export all data as JSON string
   */
  async exportAllDataAsJSON(): Promise<string> {
    const data = await this.exportAllData();
    return JSON.stringify(data, null, 2);
  }

  /**
   * Export all data and download as file
   */
  async exportAndDownload(filename?: string): Promise<void> {
    const json = await this.exportAllDataAsJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `dotbot-data-export-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Delete all user data (GDPR Article 17 - Right to erasure)
   * 
   * This is the "nuclear option" - deletes EVERYTHING.
   */
  async deleteAllData(): Promise<DeletionReport> {
    const report: DeletionReport = {
      deletedAt: new Date().toISOString(),
      deleted: {
        chatInstances: 0,
        rpcHealthEntries: 0,
        preferences: false,
        walletCache: false,
        other: 0,
      },
      totalItems: 0,
      verifiedClear: false,
    };

    // Delete chat instances
    const instances = await this.chatManager.loadInstances();
    report.deleted.chatInstances = instances.length;
    await this.chatManager.clearAllInstances();

    // Delete RPC health data
    for (const [key, storageKey] of Object.entries(STORAGE_KEYS)) {
      if (key.startsWith('RPC_HEALTH_')) {
        if (this.storage.getItem(storageKey)) {
          this.storage.removeItem(storageKey);
          report.deleted.rpcHealthEntries++;
        }
      }
    }

    // Delete user preferences
    if (this.storage.getItem(STORAGE_KEYS.USER_PREFERENCES)) {
      this.storage.removeItem(STORAGE_KEYS.USER_PREFERENCES);
      report.deleted.preferences = true;
    }

    // Delete wallet cache
    if (this.storage.getItem(STORAGE_KEYS.WALLET_CACHE)) {
      this.storage.removeItem(STORAGE_KEYS.WALLET_CACHE);
      report.deleted.walletCache = true;
    }

    // Delete any other DotBot-related keys
    const keysToDelete: string[] = [];
    const length = this.storage.length ?? 0;
    for (let i = 0; i < length; i++) {
      const key = this.storage.key?.(i);
      if (key && (key.startsWith('dotbot_') || key.startsWith('rpc_health_'))) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.storage.removeItem(key);
      report.deleted.other++;
    }

    // Calculate totals
    report.totalItems = 
      report.deleted.chatInstances +
      report.deleted.rpcHealthEntries +
      (report.deleted.preferences ? 1 : 0) +
      (report.deleted.walletCache ? 1 : 0) +
      report.deleted.other;

    // Verify nothing is left
    report.verifiedClear = await this.verifyDataCleared();

    return report;
  }

  /**
   * Delete only chat data (keep settings/preferences)
   */
  async deleteChatData(): Promise<number> {
    const instances = await this.chatManager.loadInstances();
    const count = instances.length;
    await this.chatManager.clearAllInstances();
    return count;
  }

  /**
   * Delete only RPC health data
   */
  deleteRpcHealthData(): number {
    let count = 0;
    for (const [key, storageKey] of Object.entries(STORAGE_KEYS)) {
      if (key.startsWith('RPC_HEALTH_')) {
        if (this.storage.getItem(storageKey)) {
          this.storage.removeItem(storageKey);
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Delete user preferences
   */
  deletePreferences(): boolean {
    if (this.storage.getItem(STORAGE_KEYS.USER_PREFERENCES)) {
      this.storage.removeItem(STORAGE_KEYS.USER_PREFERENCES);
      return true;
    }
    return false;
  }

  /**
   * Delete wallet cache
   */
  deleteWalletCache(): boolean {
    if (this.storage.getItem(STORAGE_KEYS.WALLET_CACHE)) {
      this.storage.removeItem(STORAGE_KEYS.WALLET_CACHE);
      return true;
    }
    return false;
  }

  /**
   * Verify that all DotBot data has been cleared
   */
  async verifyDataCleared(): Promise<boolean> {
    // Check chat instances
    const instances = await this.chatManager.loadInstances();
    if (instances.length > 0) return false;

    // Check all known keys
    for (const storageKey of Object.values(STORAGE_KEYS)) {
      if (this.storage.getItem(storageKey)) {
        return false;
      }
    }

    // Check for any remaining DotBot keys
    const length = this.storage.length ?? 0;
    for (let i = 0; i < length; i++) {
      const key = this.storage.key?.(i);
      if (key && (key.startsWith('dotbot_') || key.startsWith('dotbot_rpc_health_'))) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get storage usage information
   */
  async getStorageInfo(): Promise<{
    chatInstances: number;
    rpcHealthEntries: number;
    hasPreferences: boolean;
    hasWalletCache: boolean;
    otherKeys: string[];
    estimatedSize: string;
  }> {
    const instances = await this.chatManager.loadInstances();
    
    let rpcHealthCount = 0;
    for (const [key, storageKey] of Object.entries(STORAGE_KEYS)) {
      if (key.startsWith('RPC_HEALTH_') && this.storage.getItem(storageKey)) {
        rpcHealthCount++;
      }
    }

    const otherKeys: string[] = [];
    const knownKeys = new Set<string>(Object.values(STORAGE_KEYS));
    
    const length = this.storage.length ?? 0;
    for (let i = 0; i < length; i++) {
      const key = this.storage.key?.(i);
      if (key && key.startsWith('dotbot_') && !knownKeys.has(key)) {
        otherKeys.push(key);
      }
    }

    // Estimate storage size
    let totalSize = 0;
    for (let i = 0; i < length; i++) {
      const key = this.storage.key?.(i);
      if (key && (key.startsWith('dotbot_') || key.startsWith('dotbot_rpc_health_'))) {
        const value = this.storage.getItem(key);
        if (value) {
          totalSize += key.length + value.length;
        }
      }
    }

    return {
      chatInstances: instances.length,
      rpcHealthEntries: rpcHealthCount,
      hasPreferences: !!this.storage.getItem(STORAGE_KEYS.USER_PREFERENCES),
      hasWalletCache: !!this.storage.getItem(STORAGE_KEYS.WALLET_CACHE),
      otherKeys,
      estimatedSize: this.formatBytes(totalSize * 2), // UTF-16 = 2 bytes per char
    };
  }

  /**
   * Helper to get and parse storage item
   */
  private getStorageItem(key: string): any {
    const value = this.storage.getItem(key);
    if (!value) return null;
    
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  /**
   * Helper to format bytes to human-readable
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}

/**
 * Singleton instance for convenience
 */
let defaultDataManager: DataManager | null = null;

/**
 * Get the default data manager instance
 */
export function getDataManager(): DataManager {
  if (!defaultDataManager) {
    defaultDataManager = new DataManager();
  }
  return defaultDataManager;
}

/**
 * Quick export function
 */
export async function exportAllData(): Promise<DataExport> {
  return getDataManager().exportAllData();
}

/**
 * Quick export and download function
 */
export async function exportAndDownload(filename?: string): Promise<void> {
  return getDataManager().exportAndDownload(filename);
}

/**
 * Nuclear option - delete everything
 * 
 * GDPR-compliant data deletion.
 */
export async function nukeAllData(): Promise<DeletionReport> {
  return getDataManager().deleteAllData();
}

/**
 * Get storage usage
 */
export async function getStorageInfo() {
  return getDataManager().getStorageInfo();
}

/**
 * Verify data is cleared
 */
export async function verifyDataCleared(): Promise<boolean> {
  return getDataManager().verifyDataCleared();
}

