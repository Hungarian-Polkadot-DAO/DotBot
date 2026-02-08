/**
 * Health Tracker
 * 
 * Manages health tracking for RPC endpoints including:
 * - Loading/saving health data from storage
 * - Marking endpoints as healthy/failed
 * - Ordering endpoints by health status
 * - Periodic health monitoring
 */

import { getStorage } from '../env';
import { createSubsystemLogger, Subsystem } from '../services/logger';
import type { EndpointHealth } from './types';

/**
 * Health Tracker for RPC endpoints
 * 
 * Handles all health-related operations for endpoint management
 */
export class HealthTracker {
  private healthMap: Map<string, EndpointHealth>;
  private endpoints: string[];
  private storageKey?: string;
  private healthDataMaxAge: number;
  private failoverTimeout: number;
  private healthCheckInterval: number;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private isMonitoring = false;
  private rpcLogger = createSubsystemLogger(Subsystem.RPC);

  constructor(
    healthMap: Map<string, EndpointHealth>,
    endpoints: string[],
    storageKey: string | undefined,
    healthDataMaxAge: number,
    failoverTimeout: number,
    healthCheckInterval: number
  ) {
    this.healthMap = healthMap;
    this.endpoints = endpoints;
    this.storageKey = storageKey;
    this.healthDataMaxAge = healthDataMaxAge;
    this.failoverTimeout = failoverTimeout;
    this.healthCheckInterval = healthCheckInterval;
  }

  /**
   * Load health data from storage
   * 
   * Implements smart reset logic to prevent stale health data from blocking good endpoints.
   */
  loadHealthData(): void {
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
        }, `Resetting stale RPC health data (${availableEndpoints.length}/${this.endpoints.length} marked available); will try all endpoints again`);
        
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
  saveHealthData(): void {
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
  getOrderedEndpoints(): string[] {
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
  markEndpointFailed(endpoint: string): void {
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
  markEndpointHealthy(endpoint: string, responseTime?: number): void {
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
   * Start periodic health monitoring
   * 
   * @param performHealthCheck Function that performs the actual health check
   */
  startHealthMonitoring(performHealthCheck: () => Promise<void>): void {
    if (this.isMonitoring) {
      return;
    }
    
    this.isMonitoring = true;
    
    this.healthCheckTimer = setInterval(() => {
      performHealthCheck().catch(() => {
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
   * Get health status of all endpoints
   */
  getHealthStatus(): EndpointHealth[] {
    return Array.from(this.healthMap.values());
  }
}
