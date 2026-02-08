/**
 * RPC Manager Types
 * 
 * Type definitions for RPC endpoint management
 */

/**
 * Network type for multi-network support
 */
export type Network = 'polkadot' | 'kusama' | 'westend';

/**
 * Health status of an RPC endpoint
 */
export interface EndpointHealth {
  endpoint: string;
  healthy: boolean;
  lastChecked: number;
  failureCount: number;
  lastFailure?: number;
  avgResponseTime?: number;
}

/**
 * Configuration for RPC Manager
 */
export interface RpcManagerConfig {
  endpoints: string[];
  failoverTimeout?: number; // Time to wait before retrying a failed endpoint (default: 5 minutes)
  connectionTimeout?: number; // Connection attempt timeout (default: 10 seconds)
  storageKey?: string; // LocalStorage key for persisting health data (default: no persistence)
  healthDataMaxAge?: number; // Max age for persisted health data before invalidation (default: 24 hours)
  healthCheckInterval?: number; // Interval for periodic health checks in milliseconds (default: 30 minutes)
  enablePeriodicHealthChecks?: boolean; // Enable background health monitoring (default: true)
}
