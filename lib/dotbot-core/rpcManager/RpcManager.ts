/**
 * RPC Manager
 * 
 * Manages multiple RPC endpoints with automatic failover, health tracking,
 * and intelligent endpoint selection.
 * 
 * Execution sessions lock an API instance to prevent metadata mismatches.
 * Once an extrinsic lifecycle starts, the ApiPromise must be immutable.
 * 
 * Health checks are both EVENT-DRIVEN and PERIODIC:
 * - Health is checked when connecting to an endpoint (event-driven)
 * - Periodic background polling keeps health data up-to-date (every 30 minutes by default, skipped when already connected)
 * - Endpoints marked healthy/unhealthy based on connection success/failure
 * - Health data is persisted to localStorage for cross-session persistence
 * 
 * CRITICAL DESIGN:
 * - getReadApi(): For read operations, can failover
 * - createExecutionSession(): For transactions, locks API instance (no failover)
 */

// Must run before @polkadot/api loads so its logger uses our patched console (suppress API-WS disconnect noise)
import '../polkadotConsolePatch';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { createSubsystemLogger, Subsystem } from '../services/logger';
import { ExecutionSession } from './ExecutionSession';
import { HealthTracker } from './healthTracker';
import type { RpcManagerConfig, EndpointHealth } from './types';

/**
 * RPC Manager for handling multiple endpoints with automatic failover
 */
export class RpcManager {
  private endpoints: string[];
  private healthMap: Map<string, EndpointHealth>;
  private healthTracker: HealthTracker;
  private currentEndpoint: string | null = null;
  private currentReadApi: ApiPromise | null = null;
  private connectionTimeout: number;
  private activeSessions: Set<ExecutionSession> = new Set();
  private rpcLogger = createSubsystemLogger(Subsystem.RPC);

  constructor(config: RpcManagerConfig) {
    this.endpoints = config.endpoints;
    this.connectionTimeout = config.connectionTimeout || 10000; // 10 seconds
    const failoverTimeout = config.failoverTimeout || 5 * 60 * 1000; // 5 minutes
    const healthDataMaxAge = config.healthDataMaxAge || 24 * 60 * 60 * 1000; // 24 hours
    const healthCheckInterval = config.healthCheckInterval || 30 * 60 * 1000; // 30 minutes

    // Initialize health map
    this.healthMap = new Map();
    
    // Initialize health tracker
    this.healthTracker = new HealthTracker(
      this.healthMap,
      this.endpoints,
      config.storageKey,
      healthDataMaxAge,
      failoverTimeout,
      healthCheckInterval
    );
    
    // Try to load persisted health data
    if (config.storageKey) {
      this.healthTracker.loadHealthData();
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
      this.healthTracker.startHealthMonitoring(() => this.performHealthCheck());
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
          this.healthTracker.markEndpointHealthy(endpoint, responseTime);
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
   * Clear cached read API if it's the given instance (so next getReadApi() will try endpoints again / failover).
   * Called when the read API disconnects or errors so we don't keep returning a dead connection.
   */
  private clearReadApiIf(api: ApiPromise): void {
    if (this.currentReadApi === api) {
      this.currentReadApi = null;
      this.currentEndpoint = null;
      this.rpcLogger.debug({}, 'Read API disconnected or errored - cleared cache for failover on next getReadApi()');
    }
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
    const orderedEndpoints = this.healthTracker.getOrderedEndpoints();
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
      const retryEndpoints = this.healthTracker.getOrderedEndpoints();
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
          api.on('disconnected', () => this.clearReadApiIf(api));
          api.on('error', () => this.clearReadApiIf(api));
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
        api.on('disconnected', () => this.clearReadApiIf(api));
        api.on('error', () => this.clearReadApiIf(api));
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
        this.healthTracker.markEndpointFailed(endpoint);
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
    const orderedEndpoints = this.healthTracker.getOrderedEndpoints();
    
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
        this.healthTracker.markEndpointFailed(endpoint);
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
    return this.healthTracker.getHealthStatus();
  }

  /**
   * Get number of active execution sessions
   */
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  /**
   * Perform a health check on all endpoints
   * This performs a lightweight connection test.
   * Skips opening new connections when we already have a healthy read API (reduces connection churn and log noise).
   */
  async performHealthCheck(): Promise<void> {
    if (this.currentReadApi?.isConnected) {
      this.rpcLogger.debug({ endpoint: this.currentEndpoint }, 'Skipping health check: read API already connected');
      return;
    }

    // Only probe a subset of endpoints per run to limit connection churn (prefer first/health-ordered)
    const endpointsToCheck = this.healthTracker.getOrderedEndpoints().slice(0, 5);
    const checkPromises = endpointsToCheck.map(async (endpoint) => {
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
            this.healthTracker.markEndpointHealthy(endpoint, responseTime);
            safeResolve();
          };
          
          const errorHandler = () => {
            if (isResolved) return;
            isResolved = true; // Set BEFORE disconnect to prevent re-entry
            clearTimeout(timeout);
            safeDisconnect();
            this.healthTracker.markEndpointFailed(endpoint);
            safeResolve();
          };
          
          const timeout = setTimeout(() => {
            if (isResolved) return;
            isResolved = true; // Set BEFORE disconnect to prevent re-entry
            safeDisconnect();
            this.healthTracker.markEndpointFailed(endpoint);
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
              this.healthTracker.markEndpointHealthy(endpoint, responseTime);
              safeResolve();
            }
          }
        });
      } catch (error) {
        this.healthTracker.markEndpointFailed(endpoint);
      }
    });
    
    await Promise.all(checkPromises);
    const healthyCount = Array.from(this.healthMap.values()).filter(h => h.healthy).length;
    this.rpcLogger.info({ 
      healthyCount,
      totalEndpoints: this.endpoints.length,
      checked: endpointsToCheck.length
    }, `Health check complete: ${healthyCount}/${this.endpoints.length} endpoints healthy (checked ${endpointsToCheck.length})`);
  }

  /**
   * Cleanup: disconnect all APIs and stop monitoring
   */
  async destroy(): Promise<void> {
    this.healthTracker.stopHealthMonitoring();
    
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
