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
import { getStorage } from './env';
import { createSubsystemLogger, Subsystem } from './services/logger';

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
    'wss://polkadot.api.onfinality.io/public-ws',        // OnFinality
    'wss://polkadot-rpc.dwellir.com',                    // Dwellir public
    'wss://rpc.ibp.network/polkadot',                    // IBP network
    'wss://polkadot.dotters.network',                    // Dotters
    'wss://rpc-polkadot.luckyfriday.io',                 // LuckyFriday
    'wss://dot-rpc.stakeworld.io',                       // Stakeworld
    'wss://polkadot.public.curie.radiumblock.co/ws',     // RadiumBlock
    'wss://rockx-dot.w3node.com/polka-public-dot/ws',    // RockX public
    'wss://polkadot.rpc.subquery.network/public/ws',     // SubQuery
    'wss://polkadot.api.integritee.network/ws',          // Integritee (community)
    'wss://rpc.polkadot.io',                             // Parity (official)
  ],
  POLKADOT_ASSET_HUB: [
    'wss://statemint.api.onfinality.io/public-ws',       // OnFinality Asset Hub
    'wss://statemint-rpc.dwellir.com',                   // Dwellir Asset Hub
    'wss://dot-rpc.stakeworld.io/assethub',              // Stakeworld Asset Hub
    'wss://sys.ibp.network/statemint',                   // IBP network Asset Hub
    'wss://rpc-asset-hub.polkadot.io',                   // Parity Asset Hub (official)
  ],

  // Kusama Canary Network
  KUSAMA_RELAY_CHAIN: [
    'wss://kusama.api.onfinality.io/public-ws',          // OnFinality
    'wss://kusama-rpc.dwellir.com',                      // Dwellir
    'wss://rpc.ibp.network/kusama',                      // IBP network
    'wss://kusama.dotters.network',                      // Dotters
    'wss://ksm-rpc.stakeworld.io',                       // Stakeworld
    'wss://kusama.public.curie.radiumblock.co/ws',       // RadiumBlock
    'wss://rpc.polkadot.io/kusama',                      // Parity (mirror)
  ],
  KUSAMA_ASSET_HUB: [
    'wss://statemine.api.onfinality.io/public-ws',       // OnFinality Statemine
    'wss://statemine-rpc.dwellir.com',                   // Dwellir Statemine
    'wss://ksm-rpc.stakeworld.io/assethub',              // Stakeworld Statemine
    'wss://sys.ibp.network/statemine',                   // IBP network Statemine
    'wss://rpc.polkadot.io/ksmstatemine',                // Parity (mirror)
  ],

  // Westend Testnet
  // Ordered by reliability: best endpoints first based on real-world testing
  WESTEND_RELAY_CHAIN: [
    'wss://rpc.ibp.network/westend',                     // IBP network Westend (fast & reliable)
    'wss://westend.api.onfinality.io/public-ws',         // OnFinality Westend (reliable)
    'wss://westend-rpc-tn.dwellir.com',                  // Dwellir Westend Tunisia (backup)
    'wss://westend-rpc.polkadot.io',                     // Parity Westend (official but can be slow)
    'wss://westend-rpc.dwellir.com',                     // Dwellir Westend (often has issues)
    'wss://westend.public.curie.radiumblock.co/ws',      // RadiumBlock Westend
  ],
  WESTEND_ASSET_HUB: [
    'wss://westend-asset-hub-rpc.polkadot.io',           // Parity Westend Asset Hub (official)
    'wss://westmint.api.onfinality.io/public-ws',        // OnFinality Westend Asset Hub
    'wss://sys.ibp.network/westmint',                    // IBP network Westend Asset Hub
  ],

  ROCSTAR_RELAY_CHAIN: [
    'wss://rococo-rpc.polkadot.io',                      // Rococo
  ],
  ROCSTAR_ASSET_HUB: [
    'wss://rococo-asset-hub-rpc.polkadot.io',            // Rococo Asset Hub
  ],

  // Legacy or Aliases
  RELAY_CHAIN: [] as string[],
  ASSET_HUB: [] as string[],
};

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
  private _isActive = true;

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
  private isMonitoring = false;
  private activeSessions: Set<ExecutionSession> = new Set();
  private rpcLogger = createSubsystemLogger(Subsystem.RPC);

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
      // Don't run initial health check immediately - let endpoints be tried on first use
      // This prevents marking endpoints as failed before we even try them
      // Note: setInterval in startHealthMonitoring() already defers first check to healthCheckInterval
    }
  }
  
  /**
   * Load health data from storage
   * 
   * Implements smart reset logic to prevent stale health data from blocking good endpoints.
   */
  private loadHealthData(): void {
    if (!this.storageKey) return;
    
    try {
      const storage = getStorage();
      const stored = storage.getItem(this.storageKey);
      if (!stored) return;
      
      const data = JSON.parse(stored);
      const now = Date.now();
      
      // If health data is too old, discard it
      if (data.timestamp && (now - data.timestamp) > this.healthDataMaxAge) {
        storage.removeItem(this.storageKey);
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
      
      // If most endpoints are marked as failed, reset health data
      const availableEndpoints = this.endpoints.filter(endpoint => {
        const health = this.healthMap.get(endpoint);
        if (!health) return true;
        
        if (health.lastFailure) {
          const timeSinceFailure = now - health.lastFailure;
          // If failure was more than 2 minutes ago, allow it (reduced from 5 minutes for stale data)
          if (timeSinceFailure < Math.min(this.failoverTimeout, 2 * 60 * 1000)) {
            return false;
          }
        }
        return true;
      });
      
      // If less than 30% of endpoints are available, reset health data
      const availabilityRatio = availableEndpoints.length / this.endpoints.length;
      if (availabilityRatio < 0.3 && this.endpoints.length > 1) {
        this.rpcLogger.info({ 
          availableEndpoints: availableEndpoints.length,
          totalEndpoints: this.endpoints.length
        }, `Resetting health data - only ${availableEndpoints.length}/${this.endpoints.length} endpoints available`);
        
        // Reset health data - clear failures and response times for a fresh start
        this.endpoints.forEach(endpoint => {
          const health = this.healthMap.get(endpoint);
          if (health) {
            health.healthy = true;
            health.lastFailure = undefined;
            health.failureCount = 0;
            health.avgResponseTime = undefined;
            this.healthMap.set(endpoint, health);
          } else {
            this.healthMap.set(endpoint, {
              endpoint,
              healthy: true,
              lastChecked: 0,
              failureCount: 0
            });
          }
        });
        
        this.saveHealthData();
      }
    } catch (error) {
      const storage = getStorage();
      storage.removeItem(this.storageKey!);
    }
  }
  
  /**
   * Save health data to storage (localStorage in browser, in-memory in Node.js)
   */
  private saveHealthData(): void {
    if (!this.storageKey) return;
    
    try {
      const storage = getStorage();
      const healthArray = Array.from(this.healthMap.values());
      const data = {
        timestamp: Date.now(),
        healthMap: healthArray
      };
      storage.setItem(this.storageKey, JSON.stringify(data));
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

    // Filter out endpoints that failed recently
    const STALE_FAILURE_TIMEOUT = Math.min(this.failoverTimeout, 2 * 60 * 1000); // 2 minutes max
    
    const availableEndpoints = this.endpoints.filter(endpoint => {
      const health = this.healthMap.get(endpoint);
      if (!health) return true;
      
      if (health.lastFailure) {
        const timeSinceFailure = now - health.lastFailure;
        if (timeSinceFailure < STALE_FAILURE_TIMEOUT) {
          return false;
        }
      }
      return true;
    });


    // If all endpoints are filtered out, reset health and use all endpoints
    if (availableEndpoints.length === 0) {
      this.rpcLogger.warn({ totalEndpoints: this.endpoints.length }, `All endpoints filtered out - resetting health data`);
      
      // Reset health for all endpoints
      this.endpoints.forEach(endpoint => {
        const health = this.healthMap.get(endpoint);
        if (health) {
          health.lastFailure = undefined;
          health.healthy = true;
          this.healthMap.set(endpoint, health);
        }
      });
      
      // Return all endpoints in original order (best first)
      return [...this.endpoints];
    }

    // Sort available endpoints by health, failure count, response time, and original order
    const sorted = availableEndpoints.sort((a, b) => {
      const healthA = this.healthMap.get(a) || { healthy: true, failureCount: 0, avgResponseTime: Infinity };
      const healthB = this.healthMap.get(b) || { healthy: true, failureCount: 0, avgResponseTime: Infinity };
      const indexA = this.endpoints.indexOf(a);
      const indexB = this.endpoints.indexOf(b);

      // First: prioritize healthy endpoints
      if (healthA.healthy !== healthB.healthy) {
        return healthA.healthy ? -1 : 1;
      }
      // Second: prioritize endpoints with fewer failures
      if (healthA.failureCount !== healthB.failureCount) {
        return healthA.failureCount - healthB.failureCount;
      }
      // Third: use response time only if difference is significant (> 1 second)
      if (healthA.avgResponseTime && healthB.avgResponseTime && healthA.failureCount === healthB.failureCount) {
        const timeDiff = Math.abs(healthA.avgResponseTime - healthB.avgResponseTime);
        if (timeDiff > 1000) {
          return healthA.avgResponseTime - healthB.avgResponseTime;
        }
      }
      // Fourth: maintain original order when health metrics are similar
      return indexA - indexB;
    });
    
    // Check if ordering is incorrect - if a later endpoint is first, reset health data
    const firstEndpointOriginalIndex = this.endpoints.indexOf(sorted[0]) + 1;
    if (firstEndpointOriginalIndex > 3 && sorted.length >= 3) {
      this.rpcLogger.warn({ 
        firstEndpoint: sorted[0],
        firstEndpointOriginalIndex
      }, `Incorrect endpoint ordering detected - resetting health data`);
      
      this.endpoints.forEach(endpoint => {
        const health = this.healthMap.get(endpoint);
        if (health) {
          health.healthy = true;
          health.lastFailure = undefined;
          health.failureCount = 0;
          health.avgResponseTime = undefined;
          this.healthMap.set(endpoint, health);
        }
      });
      this.saveHealthData();
      
      // Re-sort with reset health data
      return availableEndpoints.sort((a, b) => {
        const indexA = this.endpoints.indexOf(a);
        const indexB = this.endpoints.indexOf(b);
        return indexA - indexB;
      });
    }
    
    return sorted;
  }
  
  /**
   * Mark an endpoint as failed
   */
  private markEndpointFailed(endpoint: string): void {
    const health = this.healthMap.get(endpoint);
    if (health) {
      health.healthy = false;
      health.lastChecked = Date.now(); // Mark as checked even on failure
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
   * Normalize various error types to a consistent Error object with message
   * 
   * Handles Error objects, strings, and unknown types consistently
   */
  private normalizeError(error: Error | string | unknown): { message: string; error: Error } {
    if (error instanceof Error) {
      return {
        message: error.message || 'Unknown error',
        error
      };
    }
    if (typeof error === 'string') {
      return {
        message: error,
        error: new Error(error)
      };
    }
    const message = 'Connection failed (unknown error type)';
    return {
      message,
      error: new Error(message)
    };
  }

  /**
   * Attempt to connect to an endpoint
   */
  private async tryConnect(endpoint: string): Promise<ApiPromise> {
    const startTime = Date.now();
    const API_INIT_TIMEOUT_MS = 12000; // 12 seconds - faster failure for slow testnet endpoints
    const DISCONNECT_GRACE_PERIOD_MS = 2000; // 2 seconds grace period for normal closures
    const MAX_TOTAL_TIMEOUT_MS = Math.max(this.connectionTimeout + API_INIT_TIMEOUT_MS + 5000, 20000); // Maximum total time (connection + API init + buffer)
    
    return new Promise<ApiPromise>((resolve, reject) => {
      const provider = new WsProvider(endpoint);
      let apiInitTimeoutHandle: NodeJS.Timeout | null = null;
      let disconnectGraceTimer: NodeJS.Timeout | null = null;
      let maxTimeoutHandle: NodeJS.Timeout | null = null;
      let isResolved = false;
      let isConnected = false;
      let apiInstance: ApiPromise | null = null;
      
      // Maximum timeout - ensures we ALWAYS reject if something hangs
      maxTimeoutHandle = setTimeout(() => {
        if (!isResolved) {
          cleanup();
          safeDisconnect();
          const error = new Error(`Maximum timeout (${MAX_TOTAL_TIMEOUT_MS}ms) exceeded for endpoint. The system will try the next endpoint.`);
          this.rpcLogger.error({ endpoint }, `Maximum timeout exceeded - forcing failover`);
          reject(error);
        }
      }, MAX_TOTAL_TIMEOUT_MS);
      
      const connectionTimeoutHandle = setTimeout(() => {
        if (!isResolved) {
          cleanup();
          reject(new Error(`Connection timeout (${this.connectionTimeout}ms). The system will try the next endpoint.`));
        }
      }, this.connectionTimeout);
      
      const safeDisconnect = () => {
        try {
          if (provider && typeof provider.disconnect === 'function') {
            provider.disconnect();
          }
        } catch {
          // Ignore disconnect errors
        }
      };
      
      const cleanup = () => {
        if (isResolved) return;
        isResolved = true;
        clearTimeout(connectionTimeoutHandle);
        if (maxTimeoutHandle) {
          clearTimeout(maxTimeoutHandle);
          maxTimeoutHandle = null;
        }
        if (apiInitTimeoutHandle) {
          clearTimeout(apiInitTimeoutHandle);
          apiInitTimeoutHandle = null;
        }
        if (disconnectGraceTimer) {
          clearTimeout(disconnectGraceTimer);
          disconnectGraceTimer = null;
        }
        safeDisconnect();
      };
      
      const errorHandler = (error: Error | string | unknown) => {
        if (isResolved) {
          return;
        }
        
        cleanup();
        
        const { message, error: errorObj } = this.normalizeError(error);
        this.rpcLogger.error({ endpoint, error: message }, `Provider error - triggering failover`);
        reject(errorObj);
      };
      
      const disconnectedHandler = () => {
        if (isResolved) return;
        
        // If API instance already exists, allow initialization to complete
        if (apiInstance) {
          return;
        }
        
        // Give a grace period for disconnections during initialization
        if (isConnected && !disconnectGraceTimer) {
          const gracePeriod = DISCONNECT_GRACE_PERIOD_MS;
          
          disconnectGraceTimer = setTimeout(() => {
            if (!isResolved && !apiInstance) {
              cleanup();
              safeDisconnect();
              const error = new Error(`Connection lost during initialization - endpoint disconnected (may be normal closure). The system will try the next endpoint.`);
              this.rpcLogger.error({ endpoint }, `Disconnected during API initialization after grace period - forcing failover`);
              reject(error);
            }
          }, gracePeriod);
          return;
        }
        
        // If not connected yet, reject immediately
        if (!isConnected) {
          cleanup();
          safeDisconnect();
          const error = new Error(`Connection lost during initialization - endpoint disconnected before connection established. The system will try the next endpoint.`);
          this.rpcLogger.error({ endpoint }, `Disconnected before connection established - forcing failover`);
          reject(error);
          return;
        }
      };
      
      const connectedHandler = async () => {
        if (isResolved) return;
        isConnected = true;
        clearTimeout(connectionTimeoutHandle);
        
        // Clear disconnect grace timer if connection is re-established
        if (disconnectGraceTimer) {
          clearTimeout(disconnectGraceTimer);
          disconnectGraceTimer = null;
        }
        
        try {
          // Check if provider is still connected before starting API creation
          if (!provider.isConnected) {
            cleanup();
            safeDisconnect();
            const error = new Error(`Provider disconnected before API initialization could start. The system will try the next endpoint.`);
            this.rpcLogger.error({ endpoint }, `Provider disconnected before API creation - forcing failover`);
            reject(error);
            return;
          }
          
          let apiPromise: Promise<ApiPromise>;
          try {
            apiPromise = ApiPromise.create({ provider });
          } catch (syncError) {
            cleanup();
            safeDisconnect();
            const { message: errorMessage } = this.normalizeError(syncError);
            const error = new Error(`Synchronous error during API creation: ${errorMessage}. The system will try the next endpoint.`);
            this.rpcLogger.error({ endpoint }, `Synchronous error during API creation - forcing failover`);
            reject(error);
            return;
          }
          
          apiPromise = apiPromise.catch((promiseError) => {
            if (isResolved) {
              return Promise.reject(promiseError);
            }
            throw promiseError;
          });
          
          const timeoutPromise = new Promise<never>((_, timeoutReject) => {
            apiInitTimeoutHandle = setTimeout(() => {
              if (!isResolved) {
                cleanup();
                safeDisconnect();
                timeoutReject(new Error(`API initialization timeout (${API_INIT_TIMEOUT_MS}ms) - endpoint may be slow or unresponsive. The system will try the next endpoint.`));
              }
            }, API_INIT_TIMEOUT_MS);
          });
          
          // Race between API creation and timeout - ensure all errors are caught
          const api = await Promise.race([apiPromise, timeoutPromise]);
          
          // Check if a disconnect happened while we were waiting
          if (isResolved) {
            return;
          }
          
          // Check if provider disconnected during API creation
          if (!provider.isConnected) {
            cleanup();
            safeDisconnect();
            const error = new Error(`Provider disconnected during API initialization. The system will try the next endpoint.`);
            this.rpcLogger.error({ endpoint }, `Provider disconnected during API creation - forcing failover`);
            reject(error);
            return;
          }
          
          apiInstance = api;
          
          if (isResolved) return;
          isResolved = true;
          
          // Clear all timeouts on success
          if (maxTimeoutHandle) {
            clearTimeout(maxTimeoutHandle);
            maxTimeoutHandle = null;
          }
          if (apiInitTimeoutHandle) {
            clearTimeout(apiInitTimeoutHandle);
            apiInitTimeoutHandle = null;
          }
          if (disconnectGraceTimer) {
            clearTimeout(disconnectGraceTimer);
            disconnectGraceTimer = null;
          }
          
          const responseTime = Date.now() - startTime;
          this.markEndpointHealthy(endpoint, responseTime);
          resolve(api);
        } catch (error) {
          const { message: errorMessage } = this.normalizeError(error);
          const normalizedErrorMessage = errorMessage.trim().toLowerCase();
          const isFatalError = 
            errorMessage.includes('FATAL') || 
            errorMessage.includes('Unable to initialize the API') ||
            normalizedErrorMessage.includes('fatal') ||
            normalizedErrorMessage.includes('unable to initialize');
          
          const providerDisconnected = !provider.isConnected;
          const isDisconnectionError = 
            errorMessage.includes('disconnected') || 
            errorMessage.includes('Normal Closure') ||
            errorMessage.includes('1000') ||
            errorMessage.includes('FATAL') ||
            errorMessage.includes('Unable to initialize') ||
            errorMessage.includes('WebSocket is not connected') ||
            providerDisconnected;
          
          // If this is a disconnection/FATAL error and provider is disconnected, reject immediately
          if ((isFatalError || isDisconnectionError || providerDisconnected) && !isResolved) {
            if (disconnectGraceTimer) {
              clearTimeout(disconnectGraceTimer);
              disconnectGraceTimer = null;
            }
            
            cleanup();
            safeDisconnect();
            
            const isNormalClosure = errorMessage.includes('Normal Closure') || errorMessage.includes('1000');
            const finalError = new Error(
              isNormalClosure 
                ? `Connection lost during initialization - endpoint disconnected with normal closure (1000). The system will try the next endpoint.`
                : isFatalError
                ? `API initialization failed - endpoint disconnected during metadata fetch. The system will try the next endpoint. Original error: ${errorMessage}`
                : `Connection lost during API initialization: ${errorMessage}. The system will try the next endpoint.`
            );
            
            this.rpcLogger.error({ endpoint, error: errorMessage }, `FATAL/disconnect error - forcing failover`);
            reject(finalError);
            return;
          }
          
          // Check if promise was already resolved/rejected
          if (isResolved) {
            if (isFatalError || isDisconnectionError) {
              this.rpcLogger.debug({ endpoint }, `FATAL/disconnect error caught but promise already resolved`);
            }
            return;
          }
          
          cleanup();
          
          const isNormalClosure = errorMessage.includes('Normal Closure') || errorMessage.includes('1000');
          const finalError = isDisconnectionError 
            ? new Error(
                isNormalClosure 
                  ? `Connection lost during initialization - endpoint disconnected with normal closure (1000). The system will try the next endpoint.`
                  : isFatalError
                  ? `API initialization failed - endpoint disconnected during metadata fetch. The system will try the next endpoint. Original error: ${errorMessage}`
                  : `Connection lost during API initialization: ${errorMessage}. The system will try the next endpoint.`
              )
            : (error instanceof Error ? error : new Error(errorMessage));
          
          this.rpcLogger.error({ endpoint, error: errorMessage }, `Failed to initialize API - forcing failover`);
          reject(finalError);
        }
      };
      
      provider.on('connected', connectedHandler);
      provider.on('error', errorHandler);
      provider.on('disconnected', disconnectedHandler);
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
    this.rpcLogger.info({ 
      totalEndpoints: this.endpoints.length,
      availableEndpoints: orderedEndpoints.length
    }, `Attempting to connect to RPC endpoints (${orderedEndpoints.length} available out of ${this.endpoints.length} total)`);

    if (orderedEndpoints.length === 0) {
      this.rpcLogger.warn({}, 'All endpoints marked as failed, resetting health for one final attempt');
      this.endpoints.forEach(endpoint => {
        const health = this.healthMap.get(endpoint);
        if (health) {
          health.lastFailure = undefined;
          this.healthMap.set(endpoint, health);
        }
      });
      
      // Try again with reset endpoints
      const retryEndpoints = this.getOrderedEndpoints();
      if (retryEndpoints.length === 0) {
        // Still no endpoints - give up
        throw new Error('No RPC endpoints available to connect to');
      }
      
      // Try each endpoint one more time
      let lastError: Error | null = null;
      for (const endpoint of retryEndpoints) {
        try {
          const api = await this.tryConnect(endpoint);
          this.currentEndpoint = endpoint;
          this.currentReadApi = api;
          return api;
        } catch (error) {
          const { error: errorObj } = this.normalizeError(error);
          lastError = errorObj;
        }
      }
      const lastErrorMessage = lastError?.message || 'Unknown error';
      throw new Error(
        `Failed to connect to any RPC endpoint after retry. Last error: ${lastErrorMessage}`
      );
    }

    let lastError: Error | null = null;

    for (let i = 0; i < orderedEndpoints.length; i++) {
      const endpoint = orderedEndpoints[i];
      this.rpcLogger.debug({ 
        endpoint,
        attempt: i + 1,
        total: orderedEndpoints.length
      }, `Trying endpoint ${i + 1}/${orderedEndpoints.length}: ${endpoint}`);
      
      try {
        const api = await this.tryConnect(endpoint);
        this.currentEndpoint = endpoint;
        this.currentReadApi = api;
        this.rpcLogger.info({ endpoint }, `Successfully connected to endpoint: ${endpoint}`);
        return api;
      } catch (error) {
        lastError = error as Error;
        this.rpcLogger.warn({ 
          endpoint,
          error: lastError.message,
          attempt: i + 1,
          total: orderedEndpoints.length
        }, `Failed to connect to endpoint ${i + 1}/${orderedEndpoints.length}, trying next endpoint`);
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
   * AUTOMATIC FAILOVER: This method automatically tries all available endpoints
   * in order until one succeeds. If an endpoint fails with any error (including
   * "FATAL: Unable to initialize the API" or normal closures), it will automatically
   * try the next endpoint. Components using this method do NOT need to implement
   * their own failover logic - it's handled here.
   * 
   * Use this for:
   * - Creating extrinsics
   * - Signing transactions
   * - Broadcasting transactions
   * 
   * @returns ExecutionSession with locked API instance
   * @throws Error if ALL endpoints fail (after trying each one)
   */
  async createExecutionSession(): Promise<ExecutionSession> {
    const orderedEndpoints = this.getOrderedEndpoints();
    
    this.rpcLogger.info({ 
      totalEndpoints: this.endpoints.length,
      availableEndpoints: orderedEndpoints.length
    }, `Creating execution session (${orderedEndpoints.length} available endpoints)`);

    if (orderedEndpoints.length === 0) {
      this.rpcLogger.warn({}, 'All endpoints marked as failed, resetting health for execution session');
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

    for (let i = 0; i < orderedEndpoints.length; i++) {
      const endpoint = orderedEndpoints[i];
      this.rpcLogger.debug({ 
        endpoint,
        attempt: i + 1,
        total: orderedEndpoints.length
      }, `Trying endpoint ${i + 1}/${orderedEndpoints.length} for execution session: ${endpoint}`);
      
      try {
        const api = await this.tryConnect(endpoint);
        const session = new ExecutionSession(api, endpoint);
        this.activeSessions.add(session);
        
        this.rpcLogger.info({ endpoint }, `Execution session created with endpoint: ${endpoint}`);
        
        // Monitor session health
        api.on('disconnected', () => {
          session.markInactive();
          this.activeSessions.delete(session);
        });
        
        return session;
      } catch (error) {
        const { message, error: errorObj } = this.normalizeError(error);
        lastError = errorObj;
        
        this.rpcLogger.warn({ 
          endpoint,
          error: message,
          attempt: i + 1,
          total: orderedEndpoints.length
        }, `Failed to connect to endpoint ${i + 1}/${orderedEndpoints.length}${i < orderedEndpoints.length - 1 ? ', trying next' : ''}`);
        this.markEndpointFailed(endpoint);
        // Continue loop to try next endpoint (automatic failover)
      }
    }

    // All endpoints failed - log and throw final error
    const lastErrorMessage = lastError?.message || 'Unknown error';
    this.rpcLogger.error({ 
      totalEndpoints: orderedEndpoints.length,
      lastError: lastErrorMessage
    }, `Failed to create execution session - all ${orderedEndpoints.length} endpoints failed`);
    
    throw new Error(
      `Failed to create execution session. Tried all ${orderedEndpoints.length} available endpoints, but all failed. ` +
      `Last error: ${lastErrorMessage}. ` +
      `Please check your network connection or try again later.`
    );
  }

  /**
   * Legacy method - use getReadApi() or createExecutionSession() instead
   * @deprecated Use getReadApi() for reads or createExecutionSession() for transactions
   */
  async connect(): Promise<ApiPromise> {
    this.rpcLogger.warn({}, 'RpcManager.connect() is deprecated. Use getReadApi() or createExecutionSession()');
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
    const checkPromises = this.endpoints.map(async (endpoint) => {
      const endpointStartTime = Date.now();
      try {
        const provider = new WsProvider(endpoint);
        
        return new Promise<void>((resolve) => {
          let isResolved = false;
          
          const safeResolve = () => {
            if (isResolved) return;
            isResolved = true;
            resolve();
          };
          
          const safeDisconnect = () => {
            if (isResolved) return; // Prevent re-entry
            try {
              if (provider && typeof provider.disconnect === 'function') {
                provider.disconnect();
              }
            } catch (err) {
              // Ignore disconnect errors
            }
          };
          
          const connectedHandler = () => {
            if (isResolved) return;
            isResolved = true; // Set BEFORE disconnect to prevent re-entry
            clearTimeout(timeout);
            const responseTime = Date.now() - endpointStartTime;
            safeDisconnect();
            this.markEndpointHealthy(endpoint, responseTime);
            safeResolve();
          };
          
          const errorHandler = () => {
            if (isResolved) return;
            isResolved = true; // Set BEFORE disconnect to prevent re-entry
            clearTimeout(timeout);
            safeDisconnect();
            this.markEndpointFailed(endpoint);
            safeResolve();
          };
          
          const timeout = setTimeout(() => {
            if (isResolved) return;
            isResolved = true; // Set BEFORE disconnect to prevent re-entry
            safeDisconnect();
            this.markEndpointFailed(endpoint);
            safeResolve();
          }, 5000);
          
          provider.on('connected', connectedHandler);
          provider.on('error', errorHandler);
          
          if (provider.isConnected) {
            if (!isResolved) {
              isResolved = true;
              clearTimeout(timeout);
              const responseTime = Date.now() - endpointStartTime;
              safeDisconnect();
              this.markEndpointHealthy(endpoint, responseTime);
              safeResolve();
            }
          }
        });
      } catch (error) {
        this.markEndpointFailed(endpoint);
      }
    });
    
    await Promise.all(checkPromises);
    const healthyCount = Array.from(this.healthMap.values()).filter(h => h.healthy).length;
    this.rpcLogger.info({ 
      healthyCount,
      totalEndpoints: this.endpoints.length
    }, `Health check complete: ${healthyCount}/${this.endpoints.length} endpoints healthy`);
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
  
  // Westend testnet endpoints are often slower, use shorter timeout to fail faster
  const connectionTimeout = network === 'westend' ? 5000 : 10000;
  
  return {
    relayChainManager: new RpcManager({
      endpoints: endpoints.relayChain,
      failoverTimeout: 5 * 60 * 1000,
      connectionTimeout,
      storageKey: `dotbot_rpc_health_${network}_relay`,
      healthDataMaxAge: 24 * 60 * 60 * 1000,
    }),
    assetHubManager: new RpcManager({
      endpoints: endpoints.assetHub,
      failoverTimeout: 5 * 60 * 1000,
      connectionTimeout,
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
