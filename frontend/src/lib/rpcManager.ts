/**
 * RPC Endpoint Manager
 * 
 * Manages multiple RPC endpoints with automatic failover, health tracking,
 * and intelligent endpoint selection.
 */

import { ApiPromise, WsProvider } from '@polkadot/api';

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
}

/**
 * RPC Manager for handling multiple endpoints with automatic failover
 * 
 * Health checks are EVENT-DRIVEN (not periodic):
 * - Health is checked when connecting to an endpoint
 * - Endpoints marked healthy/unhealthy based on connection success/failure
 * - No background polling - health updates happen during actual usage
 */
export class RpcManager {
  private endpoints: string[];
  private healthMap: Map<string, EndpointHealth>;
  private currentEndpoint: string | null = null;
  private failoverTimeout: number;
  private connectionTimeout: number;
  private storageKey?: string;
  private healthDataMaxAge: number;

  constructor(config: RpcManagerConfig) {
    this.endpoints = config.endpoints;
    this.failoverTimeout = config.failoverTimeout || 5 * 60 * 1000; // 5 minutes (300,000ms)
    this.connectionTimeout = config.connectionTimeout || 10000; // 10 seconds
    this.storageKey = config.storageKey;
    this.healthDataMaxAge = config.healthDataMaxAge || 24 * 60 * 60 * 1000; // 24 hours (86,400,000ms)

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
      
      // Restore health data for endpoints we still care about
      if (data.health && Array.isArray(data.health)) {
        data.health.forEach((h: EndpointHealth) => {
          if (this.endpoints.includes(h.endpoint)) {
            this.healthMap.set(h.endpoint, h);
          }
        });
        console.log(`✅ Loaded persisted RPC health data (${this.healthMap.size} endpoints, age: ${Math.round((now - data.timestamp) / 1000 / 60)} minutes)`);
      }
    } catch (error) {
      console.warn('⚠️ Failed to load RPC health data from localStorage:', error);
      if (this.storageKey) {
        localStorage.removeItem(this.storageKey);
      }
    }
  }
  
  /**
   * Save health data to localStorage
   */
  private saveHealthData(): void {
    if (!this.storageKey) return;
    
    try {
      const data = {
        timestamp: Date.now(),
        health: Array.from(this.healthMap.values())
      };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (error) {
      console.warn('⚠️ Failed to save RPC health data to localStorage:', error);
    }
  }

  /**
   * Get ordered list of endpoints by health and responsiveness
   */
  private getOrderedEndpoints(): string[] {
    const now = Date.now();
    
    // Filter out recently failed endpoints (within failover timeout)
    const availableEndpoints = this.endpoints.filter(endpoint => {
      const health = this.healthMap.get(endpoint);
      if (!health) return true;
      
      // If endpoint failed recently, check if enough time has passed
      if (health.lastFailure) {
        const timeSinceFailure = now - health.lastFailure;
        if (timeSinceFailure < this.failoverTimeout) {
          return false; // Skip this endpoint for now
        }
      }
      
      return true;
    });

    // Sort by health metrics
    return availableEndpoints.sort((a, b) => {
      const healthA = this.healthMap.get(a)!;
      const healthB = this.healthMap.get(b)!;

      // Prioritize healthy endpoints
      if (healthA.healthy !== healthB.healthy) {
        return healthA.healthy ? -1 : 1;
      }

      // Then by failure count (fewer failures = better)
      if (healthA.failureCount !== healthB.failureCount) {
        return healthA.failureCount - healthB.failureCount;
      }

      // Finally by response time (if available)
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
      health.failureCount++;
      health.lastFailure = Date.now();
      health.lastChecked = Date.now();
      this.healthMap.set(endpoint, health);
      console.warn(`⚠️ RPC endpoint marked as unhealthy: ${endpoint} (failures: ${health.failureCount})`);
      
      // Persist health data
      this.saveHealthData();
    }
  }

  /**
   * Mark an endpoint as healthy
   */
  private markEndpointHealthy(endpoint: string, responseTime?: number): void {
    const health = this.healthMap.get(endpoint);
    if (health) {
      health.healthy = true;
      health.lastChecked = Date.now();
      if (responseTime) {
        // Calculate average response time
        health.avgResponseTime = health.avgResponseTime 
          ? (health.avgResponseTime + responseTime) / 2 
          : responseTime;
      }
      this.healthMap.set(endpoint, health);
      
      // Persist health data
      this.saveHealthData();
    }
  }

  /**
   * Attempt to connect to an endpoint
   */
  private async tryConnect(endpoint: string): Promise<ApiPromise> {
    const startTime = Date.now();
    console.log(`🔗 Attempting connection to: ${endpoint}`);

    return new Promise((resolve, reject) => {
      const provider = new WsProvider(endpoint);
      const timeout = setTimeout(() => {
        provider.disconnect();
        reject(new Error(`Connection timeout (${this.connectionTimeout}ms)`));
      }, this.connectionTimeout);

      ApiPromise.create({ provider })
        .then(api => api.isReady)
        .then(api => {
          clearTimeout(timeout);
          const responseTime = Date.now() - startTime;
          console.log(`✅ Connected to ${endpoint} (${responseTime}ms)`);
          this.markEndpointHealthy(endpoint, responseTime);
          resolve(api);
        })
        .catch(error => {
          clearTimeout(timeout);
          provider.disconnect();
          console.error(`❌ Failed to connect to ${endpoint}:`, error.message);
          reject(error);
        });
    });
  }

  /**
   * Connect to the best available endpoint with automatic failover
   */
  async connect(): Promise<ApiPromise> {
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
      return this.connect(); // Recursive call with reset state
    }

    let lastError: Error | null = null;

    for (const endpoint of orderedEndpoints) {
      try {
        const api = await this.tryConnect(endpoint);
        this.currentEndpoint = endpoint;
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
   * Get the current active endpoint
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
   * Reset all health metrics (useful for testing or manual reset)
   */
  resetHealth(): void {
    this.endpoints.forEach(endpoint => {
      this.healthMap.set(endpoint, {
        endpoint,
        healthy: true,
        lastChecked: 0,
        failureCount: 0
      });
    });
    this.currentEndpoint = null;
  }
}

/**
 * Pre-configured RPC managers for common chains
 */
export const RpcEndpoints = {
  RELAY_CHAIN: [
    'wss://rpc.polkadot.io',
    'wss://polkadot-rpc.dwellir.com',
    'wss://polkadot.api.onfinality.io/public-ws',
    'wss://rpc-polkadot.luckyfriday.io'
  ],
  ASSET_HUB: [
    'wss://sys.ibp.network/statemint',
    'wss://sys.dotters.network/statemint',
    'wss://polkadot-asset-hub-rpc.polkadot.io'
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
    storageKey: 'dotbot_rpc_health_assethub', // Persist health data in localStorage
    healthDataMaxAge: 24 * 60 * 60 * 1000 // 24 hours (86,400,000ms) - Max age before invalidation
  });
}

