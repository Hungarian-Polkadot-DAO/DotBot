/**
 * Base Agent Class
 * 
 * Optional base class for shared agent functionality.
 * Agents can extend this or implement their own structure.
 */

import { ApiPromise } from '@polkadot/api';
import { AgentResult, BaseAgentParams, AgentError } from './types';

export abstract class BaseAgent {
  protected api: ApiPromise | null = null;

  /**
   * Initialize the agent with a Polkadot API instance
   */
  initialize(api: ApiPromise): void {
    this.api = api;
  }

  /**
   * Check if the agent is initialized
   */
  protected ensureInitialized(): void {
    if (!this.api) {
      throw new AgentError(
        'Agent not initialized. Call initialize() with an ApiPromise instance first.',
        'NOT_INITIALIZED'
      );
    }
  }

  /**
   * Get the API instance
   */
  protected getApi(): ApiPromise {
    this.ensureInitialized();
    return this.api!;
  }

  /**
   * Validate that an address is valid
   */
  protected validateAddress(address: string): boolean {
    // Basic validation - can be enhanced
    return address.length > 0;
  }

  /**
   * Get agent name (for logging/debugging)
   */
  abstract getAgentName(): string;
}

