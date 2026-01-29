/**
 * Execution Session
 * 
 * Locks an API instance for the duration of an extrinsic lifecycle.
 * 
 * CRITICAL: Once created, the API instance is immutable. If the endpoint dies,
 * the session fails and the user must retry. No silent switching.
 */

import { ApiPromise } from '@polkadot/api';
import type { Registry } from '@polkadot/types/types';

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
