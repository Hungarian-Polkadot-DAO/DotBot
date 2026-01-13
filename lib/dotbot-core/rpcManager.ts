/**
 * RPC Endpoint Manager
 * 
 * Manages multiple RPC endpoints with automatic failover, health tracking,
 * and intelligent endpoint selection.
 * 
 * CRITICAL: Execution sessions lock an API instance to prevent metadata mismatches.
 * Once an extrinsic lifecycle starts, the ApiPromise must be immutable.
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import type { Registry } from '@polkadot/types/types';

export interface EndpointHealth {
  endpoint: string;
  healthy: boolean;
  lastChecked: number;
  failureCount: number;
  lastFailure?: number;
  avgResponseTime?: number;
}

interface RpcManagerConfig {
  endpoints: string[];
  failoverTimeout?: number; // Time to wait before retrying a failed endpoint (default: 5 minutes)
  connectionTimeout?: number; // Connection attempt timeout (default: 10 seconds)
  storageKey?: string; // LocalStorage key for persisting health data (default: no persistence)
  healthDataMaxAge?: number; // Max age for persisted health data before invalidation (default: 24 hours)
  healthCheckInterval?: number; // Interval for periodic health checks in milliseconds (default: 10 minutes)
  enablePeriodicHealthChecks?: boolean; // Enable background health monitoring (default: true)
}

/**
 * Execution Session - Locks an API instance for the duration of an extrinsic lifecycle
 * 
 * Once created, the API instance is immutable. If the endpoint dies, the session fails
 * and the user must retry. No silent switching.
 */
export class ExecutionSession {
  public readonly api: ApiPromise;
  public readonly endpoint: string;
  public readonly registry: Registry;
  private _isActive: boolean = true;

  constructor(api: ApiPromise, endpoint: string) {
    this.api = api;
    this.endpoint = endpoint;
    this.registry = api.registry;
    
    // Make readonly properties non-writable at runtime
    Object.defineProperty(this, 'endpoint', {
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'api', {
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'registry', {
      writable: false,
      configurable: false,
    });
    
    // Freeze nested objects
    Object.freeze(this.api);
    Object.freeze(this.registry);
    // Note: We don't freeze 'this' because _isActive needs to be mutable
  }

  /**
   * Get whether session is active (read-only accessor)
   */
  get isActive(): boolean {
    return this._isActive;
  }

  /**
   * Check if session is still active (API is connected)
   */
  async isConnected(): Promise<boolean> {
    if (!this._isActive) return false;
    try {
      return this.api.isConnected;
    } catch {
      this._isActive = false;
      return false;
    }
  }

  /**
   * Mark session as inactive (endpoint died)
   */
  markInactive(): void {
    this._isActive = false;
  }

  /**
   * Validate that an extrinsic belongs to this session's registry
   */
  assertSameRegistry(extrinsic: any): void {
    if (!extrinsic || !extrinsic.registry) {
      throw new Error('Invalid extrinsic: missing registry');
    }
    if (extrinsic.registry !== this.registry) {
      throw new Error(
        `Cross-registry extrinsic detected. ` +
        `Extrinsic registry: ${extrinsic.registry.hash}, ` +
        `Session registry: ${this.registry.hash}. ` +
        `This extrinsic was created with a different API instance.`
      );
    }
  }
}

/**
 * RPC Manager for handling multiple endpoints with automatic failover
 * 
 * Health checks are both EVENT-DRIVEN and PERIODIC:
 * - Health is checked when connecting to an endpoint (event-driven)
 * - Periodic background polling keeps health data up-to-date (every 10 minutes by default)
 * - Endpoints marked healthy/unhealthy based on connection success/failure
 * - Health data is persisted to localStorage for cross-session persistence
 * 
 * CRITICAL DESIGN:
 * - getReadApi(): For read operations, can failover
 * - createExecutionSession(): For transactions, locks API instance (no failover)
 */
export class RpcManager {
  private endpoints: string[];
  private healthMap: Map<string, EndpointHealth>;
  private currentEndpoint: string | null = null;
  private currentReadApi: ApiPromise | null = null;
  private failoverTimeout: number;
  private connectionTimeout: number;
  private storageKey?: string;
  private healthDataMaxAge: number;
  private healthCheckInterval: number;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private isMonitoring: boolean = false;
  private activeSessions: Set<ExecutionSession> = new Set();

  constructor(config: RpcManagerConfig) {
    this.endpoints = config.endpoints;
    this.failoverTimeout = config.failoverTimeout || 5 * 60 * 1000; // 5 minutes (300,000ms)
    this.connectionTimeout = config.connectionTimeout || 10000; // 10 seconds
    this.storageKey = config.storageKey;
    this.healthDataMaxAge = config.healthDataMaxAge || 24 * 60 * 60 * 1000; // 24 hours (86,400,000ms)
    this.healthCheckInterval = config.healthCheckInterval || 10 * 60 * 1000; // 10 minutes (600,000ms)

    // Initialize health map
    this.healthMap = new Map();
    
    // Try to load persisted health data
    if (this.storageKey) {
      this.loadHealthData();
    }
    
    // If no valid persisted data, initialize with defaults
    if (this.healthMap.size === 0) {
      this.endpoints.forEach(endpoint => {
        this.healthMap.set(endpoint, {
          endpoint,
          healthy: true,
          lastChecked: 0,
          failureCount: 0
        });
      });
    }
    
    // Start periodic health monitoring if enabled (default: true)
    if (config.enablePeriodicHealthChecks !== false) {
      this.startHealthMonitoring();
    }
  }
  
  /**
   * Load health data from localStorage
   */
  private loadHealthData(): void {
    if (!this.storageKey) return;
    
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return;
      
      const data = JSON.parse(stored);
      const now = Date.now();
      
      if (data.timestamp && (now - data.timestamp) > this.healthDataMaxAge) {
        localStorage.removeItem(this.storageKey);
        return;
      }
      
      if (data.healthMap && Array.isArray(data.healthMap)) {
        data.healthMap.forEach((entry: any) => {
          if (entry.endpoint && this.endpoints.includes(entry.endpoint)) {
            this.healthMap.set(entry.endpoint, {
              endpoint: entry.endpoint,
              healthy: entry.healthy !== false,
              lastChecked: entry.lastChecked || 0,
              failureCount: entry.failureCount || 0,
              lastFailure: entry.lastFailure,
              avgResponseTime: entry.avgResponseTime
            });
          }
        });
      }
    } catch (error) {
      localStorage.removeItem(this.storageKey);
    }
  }
  
  /**
   * Save health data to localStorage
   */
  private saveHealthData(): void {
    if (!this.storageKey) return;
    
    try {
      const healthArray = Array.from(this.healthMap.values());
      const data = {
        timestamp: Date.now(),
        healthMap: healthArray
      };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch {
      // Ignore storage errors
    }
  }
  
  /**
   * Get ordered list of endpoints (best first)
   */
  private getOrderedEndpoints(): string[] {
    const now = Date.now();
    
    // Ensure all endpoints have health entries
    this.endpoints.forEach(endpoint => {
      if (!this.healthMap.has(endpoint)) {
        this.healthMap.set(endpoint, {
          endpoint,
          healthy: true,
          lastChecked: 0,
          failureCount: 0
        });
      }
    });

    const availableEndpoints = this.endpoints.filter(endpoint => {
      const health = this.healthMap.get(endpoint);
      if (!health) return true; // Should not happen after initialization, but defensive
      
      if (health.lastFailure) {
        const timeSinceFailure = now - health.lastFailure;
        if (timeSinceFailure < this.failoverTimeout) {
          return false;
        }
      }
      return true;
    });

    return availableEndpoints.sort((a, b) => {
      const healthA = this.healthMap.get(a) || { healthy: true, failureCount: 0, avgResponseTime: Infinity };
      const healthB = this.healthMap.get(b) || { healthy: true, failureCount: 0, avgResponseTime: Infinity };

      if (healthA.healthy !== healthB.healthy) {
        return healthA.healthy ? -1 : 1;
      }
      if (healthA.failureCount !== healthB.failureCount) {
        return healthA.failureCount - healthB.failureCount;
      }
      if (healthA.avgResponseTime && healthB.avgResponseTime) {
        return healthA.avgResponseTime - healthB.avgResponseTime;
      }
      return 0;
    });
  }
  
  /**
   * Mark an endpoint as failed
   */
  private markEndpointFailed(endpoint: string): void {
    const health = this.healthMap.get(endpoint);
    if (health) {
      health.healthy = false;
      health.lastFailure = Date.now();
      health.failureCount = (health.failureCount || 0) + 1;
      this.healthMap.set(endpoint, health);
      this.saveHealthData();
    }
  }
  
  /**
   * Mark an endpoint as healthy
   */
  private markEndpointHealthy(endpoint: string, responseTime?: number): void {
    const health = this.healthMap.get(endpoint);
    if (health) {
      const wasUnhealthy = !health.healthy;
      health.healthy = true;
      health.lastChecked = Date.now();
      health.lastFailure = undefined;
      if (responseTime !== undefined) {
        // Update average response time (simple moving average)
        health.avgResponseTime = health.avgResponseTime
          ? (health.avgResponseTime * 0.7 + responseTime * 0.3)
          : responseTime;
      }
      this.healthMap.set(endpoint, health);
      this.saveHealthData();
    }
  }
  
  /**
   * Attempt to connect to an endpoint
   */
  private async tryConnect(endpoint: string): Promise<ApiPromise> {
    const startTime = Date.now();
    return new Promise<ApiPromise>((resolve, reject) => {
      const provider = new WsProvider(endpoint);
      
      // Use a shorter timeout for API initialization (20 seconds instead of default 60)
      const apiInitTimeout = 20000;
      let apiInitTimeoutHandle: NodeJS.Timeout | null = null;
      
      const connectionTimeoutHandle = setTimeout(() => {
        provider.disconnect();
        if (apiInitTimeoutHandle) clearTimeout(apiInitTimeoutHandle);
        reject(new Error(`Connection timeout (${this.connectionTimeout}ms)`));
      }, this.connectionTimeout);
      
      provider.on('connected', async () => {
        clearTimeout(connectionTimeoutHandle);
        try {
          // Wrap ApiPromise.create with a timeout to fail faster
          // ApiPromise.create() has a default 60s timeout, but we want to fail faster
          const apiPromise = ApiPromise.create({ provider });
          
          // Race between API creation and timeout
          const timeoutPromise = new Promise<never>((_, timeoutReject) => {
            apiInitTimeoutHandle = setTimeout(() => {
              provider.disconnect();
              timeoutReject(new Error(`API initialization timeout (${apiInitTimeout}ms) - endpoint may be slow or unresponsive`));
            }, apiInitTimeout);
          });
          
          const api = await Promise.race([apiPromise, timeoutPromise]);
          
          // Clear timeout on success
          if (apiInitTimeoutHandle) {
            clearTimeout(apiInitTimeoutHandle);
            apiInitTimeoutHandle = null;
          }
          
          const responseTime = Date.now() - startTime;
          this.markEndpointHealthy(endpoint, responseTime);
          resolve(api);
        } catch (error) {
          if (apiInitTimeoutHandle) clearTimeout(apiInitTimeoutHandle);
          provider.disconnect();
          console.error(`Failed to connect to ${endpoint}:`, error instanceof Error ? error.message : String(error));
          reject(error);
        }
      });
      
      provider.on('error', (error) => {
        clearTimeout(connectionTimeoutHandle);
        if (apiInitTimeoutHandle) clearTimeout(apiInitTimeoutHandle);
        provider.disconnect();
        console.error(`Failed to connect to ${endpoint}:`, error.message);
        reject(error);
      });
    });
  }

  /**
   * Get API for READ operations (can failover)
   * 
   * This is for queries, balance checks, etc. that don't create transactions.
   * If the current endpoint fails, it will automatically try another.
   */
  async getReadApi(): Promise<ApiPromise> {
    // If we have a current read API and it's still connected, reuse it
    if (this.currentReadApi && this.currentReadApi.isConnected) {
      return this.currentReadApi;
    }
    
    // Otherwise, connect to best available endpoint
    const orderedEndpoints = this.getOrderedEndpoints();

    if (orderedEndpoints.length === 0) {
      this.endpoints.forEach(endpoint => {
        const health = this.healthMap.get(endpoint);
        if (health) {
          health.lastFailure = undefined;
          this.healthMap.set(endpoint, health);
        }
      });
      return this.getReadApi();
    }

    let lastError: Error | null = null;

    for (const endpoint of orderedEndpoints) {
      try {
        const api = await this.tryConnect(endpoint);
        this.currentEndpoint = endpoint;
        this.currentReadApi = api;
        return api;
      } catch (error) {
        lastError = error as Error;
        this.markEndpointFailed(endpoint);
        // Continue to next endpoint
      }
    }

    // All endpoints failed
    throw new Error(
      `Failed to connect to any RPC endpoint. Last error: ${lastError?.message || 'Unknown'}`
    );
  }

  /**
   * Create an EXECUTION SESSION - locks an API instance for transaction lifecycle
   * 
   * CRITICAL: Once created, the API instance is immutable. If the endpoint dies,
   * the session fails and the user must retry. No silent switching.
   * 
   * Use this for:
   * - Creating extrinsics
   * - Signing transactions
   * - Broadcasting transactions
   * 
   * @returns ExecutionSession with locked API instance
   */
  async createExecutionSession(): Promise<ExecutionSession> {
    const orderedEndpoints = this.getOrderedEndpoints();

    if (orderedEndpoints.length === 0) {
      this.endpoints.forEach(endpoint => {
        const health = this.healthMap.get(endpoint);
        if (health) {
          health.lastFailure = undefined;
          this.healthMap.set(endpoint, health);
        }
      });
      return this.createExecutionSession();
    }

    let lastError: Error | null = null;

    for (const endpoint of orderedEndpoints) {
      try {
        const api = await this.tryConnect(endpoint);
        const session = new ExecutionSession(api, endpoint);
        this.activeSessions.add(session);
        
        // Monitor session health
        api.on('disconnected', () => {
          session.markInactive();
          this.activeSessions.delete(session);
        });
        
        return session;
      } catch (error) {
        lastError = error as Error;
        this.markEndpointFailed(endpoint);
        // Continue to next endpoint
      }
    }

    // All endpoints failed
    throw new Error(
      `Failed to create execution session. All endpoints failed. Last error: ${lastError?.message || 'Unknown'}`
    );
  }

  /**
   * Legacy method - use getReadApi() or createExecutionSession() instead
   * @deprecated Use getReadApi() for reads or createExecutionSession() for transactions
   */
  async connect(): Promise<ApiPromise> {
    console.warn('RpcManager.connect() is deprecated. Use getReadApi() or createExecutionSession()');
    return this.getReadApi();
  }

  /**
   * Get the current active endpoint (for read API)
   */
  getCurrentEndpoint(): string | null {
    return this.currentEndpoint;
  }

  /**
   * Get health status of all endpoints
   */
  getHealthStatus(): EndpointHealth[] {
    return Array.from(this.healthMap.values());
  }

  /**
   * Get number of active execution sessions
   */
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  /**
   * Start periodic health monitoring
   */
  startHealthMonitoring(): void {
    if (this.isMonitoring) {
      return;
    }
    
    this.isMonitoring = true;
    
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck().catch(() => {
        // Ignore health check errors
      });
    }, this.healthCheckInterval);
  }

  /**
   * Stop periodic health monitoring
   */
  stopHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    this.isMonitoring = false;
  }

  /**
   * Perform a health check on all endpoints
   * This performs a lightweight connection test
   */
  async performHealthCheck(): Promise<void> {
    const startTime = Date.now();
    
    const checkPromises = this.endpoints.map(async (endpoint) => {
      try {
        const provider = new WsProvider(endpoint);
        
        return new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            provider.disconnect();
            this.markEndpointFailed(endpoint);
            resolve();
          }, 5000); // 5 second timeout for health checks
          
          provider.on('connected', () => {
            clearTimeout(timeout);
            provider.disconnect();
            this.markEndpointHealthy(endpoint);
            resolve();
          });
          
          provider.on('error', () => {
            clearTimeout(timeout);
            provider.disconnect();
            this.markEndpointFailed(endpoint);
            resolve();
          });
          
          // If already connected, resolve immediately
          if (provider.isConnected) {
            clearTimeout(timeout);
            provider.disconnect();
            this.markEndpointHealthy(endpoint);
            resolve();
          }
        });
      } catch (error) {
        this.markEndpointFailed(endpoint);
      }
    });
    
    await Promise.all(checkPromises);
    const healthyCount = Array.from(this.healthMap.values()).filter(h => h.healthy).length;
    console.info(`Health check complete: ${healthyCount}/${this.endpoints.length} endpoints healthy`);
  }

  /**
   * Cleanup: disconnect all APIs and stop monitoring
   */
  async destroy(): Promise<void> {
    this.stopHealthMonitoring();
    
    // Disconnect read API
    if (this.currentReadApi) {
      await this.currentReadApi.disconnect();
      this.currentReadApi = null;
    }
    
    // Mark all sessions as inactive (but don't disconnect - let them handle it)
    this.activeSessions.forEach(session => {
      session.markInactive();
    });
    this.activeSessions.clear();
    
  }
}

/**
 * Network type for multi-network support
 */
export type Network = 'polkadot' | 'kusama' | 'westend';

/**
 * Predefined RPC endpoints organized by network
 */
export const RpcEndpoints = {
  // Polkadot Mainnet
  POLKADOT_RELAY_CHAIN: [
    'wss://polkadot.api.onfinality.io/public-ws',        // OnFinality (public)
    'wss://polkadot-rpc.dwellir.com',                    // Dwellir public WS
    'wss://polkadot-rpc-tn.dwellir.com',                 // Dwellir (Tunisia)
    'wss://rpc.ibp.network/polkadot',                    // IBP network
    'wss://polkadot.dotters.network',                    // Dotters network
    'wss://rpc-polkadot.luckyfriday.io',                 // LuckyFriday
    'wss://dot-rpc.stakeworld.io',                       // Stakeworld
    'wss://polkadot.public.curie.radiumblock.co/ws',     // RadiumBlock
    'wss://rockx-dot.w3node.com/polka-public-dot/ws',    // RockX public WS
    'wss://polkadot.rpc.subquery.network/public/ws',     // SubQuery network
  ],
  POLKADOT_ASSET_HUB: [
    'wss://statemint.api.onfinality.io/public-ws',       // OnFinality Asset Hub public WS
    'wss://statemint-rpc.dwellir.com',                   // Dwellir Asset Hub WS
    'wss://dot-rpc.stakeworld.io/assethub',              // Stakeworld Asset Hub
    'wss://sys.ibp.network/statemint',                   // IBP network Asset Hub
    'wss://statemint-rpc-tn.dwellir.com',                // Dwellir Asset Hub (Tunisia)
  ],

  // Kusama Canary Network
  KUSAMA_RELAY_CHAIN: [
    'wss://kusama.api.onfinality.io/public-ws',          // OnFinality Kusama
    'wss://kusama-rpc.dwellir.com',                      // Dwellir Kusama
    'wss://kusama-rpc-tn.dwellir.com',                   // Dwellir Kusama (Tunisia)
    'wss://rpc.ibp.network/kusama',                      // IBP network Kusama
    'wss://kusama.dotters.network',                      // Dotters Kusama
    'wss://ksm-rpc.stakeworld.io',                       // Stakeworld Kusama
    'wss://kusama.public.curie.radiumblock.co/ws',       // RadiumBlock Kusama
  ],
  KUSAMA_ASSET_HUB: [
    'wss://statemine.api.onfinality.io/public-ws',       // OnFinality Kusama Asset Hub
    'wss://statemine-rpc.dwellir.com',                   // Dwellir Kusama Asset Hub
    'wss://ksm-rpc.stakeworld.io/assethub',              // Stakeworld Kusama Asset Hub
    'wss://sys.ibp.network/statemine',                   // IBP network Kusama Asset Hub
  ],

  // Westend Testnet
  WESTEND_RELAY_CHAIN: [
    'wss://westend-rpc.polkadot.io',                     // Parity Westend (official)
    'wss://westend.api.onfinality.io/public-ws',         // OnFinality Westend
    'wss://westend-rpc.dwellir.com',                     // Dwellir Westend
    'wss://rpc.ibp.network/westend',                     // IBP network Westend
    'wss://westend-rpc-tn.dwellir.com',                  // Dwellir Westend (Tunisia)
  ],
  WESTEND_ASSET_HUB: [
    'wss://westend-asset-hub-rpc.polkadot.io',           // Parity Westend Asset Hub (official)
    'wss://westmint.api.onfinality.io/public-ws',        // OnFinality Westend Asset Hub
    'wss://sys.ibp.network/westmint',                    // IBP network Westend Asset Hub
  ],

  // Legacy aliases (backward compatibility)
  RELAY_CHAIN: [] as string[],  // Will be set below
  ASSET_HUB: [] as string[],    // Will be set below
};

// Set legacy aliases to Polkadot for backward compatibility
RpcEndpoints.RELAY_CHAIN = RpcEndpoints.POLKADOT_RELAY_CHAIN;
RpcEndpoints.ASSET_HUB = RpcEndpoints.POLKADOT_ASSET_HUB;

/**
 * Get RPC endpoints for a specific network
 */
export function getEndpointsForNetwork(network: Network): {
  relayChain: string[];
  assetHub: string[];
} {
  switch (network) {
    case 'polkadot':
      return {
        relayChain: RpcEndpoints.POLKADOT_RELAY_CHAIN,
        assetHub: RpcEndpoints.POLKADOT_ASSET_HUB,
      };
    case 'kusama':
      return {
        relayChain: RpcEndpoints.KUSAMA_RELAY_CHAIN,
        assetHub: RpcEndpoints.KUSAMA_ASSET_HUB,
      };
    case 'westend':
      return {
        relayChain: RpcEndpoints.WESTEND_RELAY_CHAIN,
        assetHub: RpcEndpoints.WESTEND_ASSET_HUB,
      };
    default:
      throw new Error(`Unknown network: ${network}`);
  }
}

/**
 * Create RPC managers for a specific network
 */
export function createRpcManagersForNetwork(network: Network): {
  relayChainManager: RpcManager;
  assetHubManager: RpcManager;
} {
  const endpoints = getEndpointsForNetwork(network);
  
  return {
    relayChainManager: new RpcManager({
      endpoints: endpoints.relayChain,
      failoverTimeout: 5 * 60 * 1000,
      connectionTimeout: 10000,
      storageKey: `dotbot_rpc_health_${network}_relay`,
      healthDataMaxAge: 24 * 60 * 60 * 1000,
    }),
    assetHubManager: new RpcManager({
      endpoints: endpoints.assetHub,
      failoverTimeout: 5 * 60 * 1000,
      connectionTimeout: 10000,
      storageKey: `dotbot_rpc_health_${network}_asset_hub`,
      healthDataMaxAge: 24 * 60 * 60 * 1000,
    }),
  };
}

// ============================================================================
// Polkadot Factory Functions
// ============================================================================

/**
 * Create a RPC manager for Polkadot Relay Chain
 */
export function createPolkadotRelayChainManager(): RpcManager {
  return new RpcManager({
    endpoints: RpcEndpoints.POLKADOT_RELAY_CHAIN,
    failoverTimeout: 5 * 60 * 1000,
    connectionTimeout: 10000,
    storageKey: 'dotbot_rpc_health_polkadot_relay',
    healthDataMaxAge: 24 * 60 * 60 * 1000,
  });
}

/**
 * Create a RPC manager for Polkadot Asset Hub
 */
export function createPolkadotAssetHubManager(): RpcManager {
  return new RpcManager({
    endpoints: RpcEndpoints.POLKADOT_ASSET_HUB,
    failoverTimeout: 5 * 60 * 1000,
    connectionTimeout: 10000,
    storageKey: 'dotbot_rpc_health_polkadot_asset_hub',
    healthDataMaxAge: 24 * 60 * 60 * 1000,
  });
}

// ============================================================================
// Kusama Factory Functions
// ============================================================================

/**
 * Create a RPC manager for Kusama Relay Chain
 */
export function createKusamaRelayChainManager(): RpcManager {
  return new RpcManager({
    endpoints: RpcEndpoints.KUSAMA_RELAY_CHAIN,
    failoverTimeout: 5 * 60 * 1000,
    connectionTimeout: 10000,
    storageKey: 'dotbot_rpc_health_kusama_relay',
    healthDataMaxAge: 24 * 60 * 60 * 1000,
  });
}

/**
 * Create a RPC manager for Kusama Asset Hub
 */
export function createKusamaAssetHubManager(): RpcManager {
  return new RpcManager({
    endpoints: RpcEndpoints.KUSAMA_ASSET_HUB,
    failoverTimeout: 5 * 60 * 1000,
    connectionTimeout: 10000,
    storageKey: 'dotbot_rpc_health_kusama_asset_hub',
    healthDataMaxAge: 24 * 60 * 60 * 1000,
  });
}

// ============================================================================
// Westend Factory Functions
// ============================================================================

/**
 * Create a RPC manager for Westend Relay Chain
 */
export function createWestendRelayChainManager(): RpcManager {
  return new RpcManager({
    endpoints: RpcEndpoints.WESTEND_RELAY_CHAIN,
    failoverTimeout: 5 * 60 * 1000,
    connectionTimeout: 10000,
    storageKey: 'dotbot_rpc_health_westend_relay',
    healthDataMaxAge: 24 * 60 * 60 * 1000,
  });
}

/**
 * Create a RPC manager for Westend Asset Hub
 */
export function createWestendAssetHubManager(): RpcManager {
  return new RpcManager({
    endpoints: RpcEndpoints.WESTEND_ASSET_HUB,
    failoverTimeout: 5 * 60 * 1000,
    connectionTimeout: 10000,
    storageKey: 'dotbot_rpc_health_westend_asset_hub',
    healthDataMaxAge: 24 * 60 * 60 * 1000,
  });
}

// ============================================================================
// Legacy Factory Functions (backward compatibility)
// ============================================================================

/**
 * Create a RPC manager for Relay Chain (defaults to Polkadot)
 * @deprecated Use createPolkadotRelayChainManager() or createRpcManagersForNetwork()
 */
export function createRelayChainManager(): RpcManager {
  return createPolkadotRelayChainManager();
}

/**
 * Create a RPC manager for Asset Hub (defaults to Polkadot)
 * @deprecated Use createPolkadotAssetHubManager() or createRpcManagersForNetwork()
 */
export function createAssetHubManager(): RpcManager {
  return createPolkadotAssetHubManager();
}
