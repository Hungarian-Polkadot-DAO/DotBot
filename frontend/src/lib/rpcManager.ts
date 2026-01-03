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

interface EndpointHealth {
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
  private isActive: boolean = true;

  constructor(api: ApiPromise, endpoint: string) {
    this.api = api;
    this.endpoint = endpoint;
    this.registry = api.registry;
    Object.freeze(this); // Prevent modification
  }

  /**
   * Check if session is still active (API is connected)
   */
  async isConnected(): Promise<boolean> {
    if (!this.isActive) return false;
    try {
      return this.api.isConnected;
    } catch {
      this.isActive = false;
      return false;
    }
  }

  /**
   * Mark session as inactive (endpoint died)
   */
  markInactive(): void {
    this.isActive = false;
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
      
      // Check if data is too old
      if (data.timestamp && (now - data.timestamp) > this.healthDataMaxAge) {
        console.log(`⚠️ RPC health data expired (age: ${Math.round((now - data.timestamp) / 1000 / 60)} minutes)`);
        localStorage.removeItem(this.storageKey);
        return;
      }
      
      // Restore health map
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
        console.log(`✅ Loaded RPC health data for ${this.healthMap.size} endpoints`);
      }
    } catch (error) {
      console.warn('⚠️ Failed to load RPC health data:', error);
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
    } catch (error) {
      console.warn('⚠️ Failed to save RPC health data:', error);
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
      console.warn(`⚠️ RPC endpoint marked as unhealthy: ${endpoint} (failures: ${health.failureCount})`);
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
      if (wasUnhealthy) {
        console.log(`✅ RPC endpoint recovered: ${endpoint}`);
      }
    }
  }
  
  /**
   * Attempt to connect to an endpoint
   */
  private async tryConnect(endpoint: string): Promise<ApiPromise> {
    const startTime = Date.now();
    return new Promise<ApiPromise>((resolve, reject) => {
      console.log(`🔗 Attempting connection to: ${endpoint}`);
      
      const provider = new WsProvider(endpoint);
      const timeoutHandle = setTimeout(() => {
        provider.disconnect();
        reject(new Error(`Connection timeout (${this.connectionTimeout}ms)`));
      }, this.connectionTimeout);
      
      provider.on('connected', async () => {
        clearTimeout(timeoutHandle);
        try {
          const api = await ApiPromise.create({ provider });
          const responseTime = Date.now() - startTime;
          console.log(`✅ Connected to ${endpoint} (${responseTime}ms)`);
          this.markEndpointHealthy(endpoint, responseTime);
          resolve(api);
        } catch (error) {
          provider.disconnect();
          console.error(`❌ Failed to connect to ${endpoint}:`, error instanceof Error ? error.message : String(error));
          reject(error);
        }
      });
      
      provider.on('error', (error) => {
        clearTimeout(timeoutHandle);
        provider.disconnect();
        console.error(`❌ Failed to connect to ${endpoint}:`, error.message);
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
      // All endpoints have recently failed, reset and try again
      console.warn('⚠️ All endpoints recently failed. Resetting failure timers and retrying...');
      this.endpoints.forEach(endpoint => {
        const health = this.healthMap.get(endpoint);
        if (health) {
          health.lastFailure = undefined;
          this.healthMap.set(endpoint, health);
        }
      });
      return this.getReadApi(); // Recursive call with reset state
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
      // All endpoints have recently failed, reset and try again
      console.warn('⚠️ All endpoints recently failed. Resetting failure timers and retrying...');
      this.endpoints.forEach(endpoint => {
        const health = this.healthMap.get(endpoint);
        if (health) {
          health.lastFailure = undefined;
          this.healthMap.set(endpoint, health);
        }
      });
      return this.createExecutionSession(); // Recursive call with reset state
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
        
        console.log(`🔒 Created execution session with ${endpoint}`);
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
    console.warn('⚠️ RpcManager.connect() is deprecated. Use getReadApi() or createExecutionSession()');
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
    console.log(`🩺 Starting periodic RPC health monitoring (interval: ${this.healthCheckInterval / 1000}s)`);
    
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck().catch(error => {
        console.warn('⚠️ Health check error:', error);
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
    console.log('🩺 Stopped periodic RPC health monitoring');
  }

  /**
   * Perform a health check on all endpoints
   * This performs a lightweight connection test
   */
  async performHealthCheck(): Promise<void> {
    console.log(`🩺 Performing health check on ${this.endpoints.length} endpoints...`);
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
    const duration = Date.now() - startTime;
    const healthyCount = Array.from(this.healthMap.values()).filter(h => h.healthy).length;
    console.log(`✅ Health check complete: ${healthyCount}/${this.endpoints.length} endpoints healthy (${duration}ms)`);
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
    
    console.log('🧹 RpcManager destroyed');
  }
}

/**
 * Predefined RPC endpoints
 */
export const RpcEndpoints = {
  RELAY_CHAIN: [
    'wss://rpc.polkadot.io',
    'wss://polkadot.api.onfinality.io/public-ws',
    'wss://polkadot-rpc.dwellir.com',
    'wss://polkadot.public.curie.radiumblock.io/ws',
  ],
  ASSET_HUB: [
    'wss://sys.dotters.network/statemint',
    'wss://statemint.api.onfinality.io/public-ws',
    'wss://sys.ibp.network/statemint',
    'wss://statemint-rpc.dwellir.com',
  ]
};

/**
 * Create a RPC manager for Polkadot Relay Chain
 */
export function createRelayChainManager(): RpcManager {
  return new RpcManager({
    endpoints: RpcEndpoints.RELAY_CHAIN,
    failoverTimeout: 5 * 60 * 1000, // 5 minutes (300,000ms) - Time before retrying a failed endpoint
    connectionTimeout: 10000, // 10 seconds - Timeout for each connection attempt
    storageKey: 'dotbot_rpc_health_relay', // Persist health data in localStorage
    healthDataMaxAge: 24 * 60 * 60 * 1000 // 24 hours (86,400,000ms) - Max age before invalidation
  });
}

/**
 * Create a RPC manager for Polkadot Asset Hub
 */
export function createAssetHubManager(): RpcManager {
  return new RpcManager({
    endpoints: RpcEndpoints.ASSET_HUB,
    failoverTimeout: 5 * 60 * 1000, // 5 minutes (300,000ms) - Time before retrying a failed endpoint
    connectionTimeout: 10000, // 10 seconds - Timeout for each connection attempt
    storageKey: 'dotbot_rpc_health_asset_hub', // Persist health data in localStorage
    healthDataMaxAge: 24 * 60 * 60 * 1000 // 24 hours (86,400,000ms) - Max age before invalidation
  });
}
