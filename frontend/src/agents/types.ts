/**
 * Shared types for all agents
 */

import { SubmittableExtrinsic } from '@polkadot/api/types';

/**
 * Result from an agent function call
 */
export interface AgentResult {
  /** The extrinsic to be signed and submitted */
  extrinsic: SubmittableExtrinsic<'promise'>;
  
  /** Human-readable description of what this extrinsic does */
  description: string;
  
  /** Estimated transaction fee (if available) */
  estimatedFee?: string;
  
  /** Any warnings or important information */
  warnings?: string[];
  
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Base parameters that all agent functions might need
 */
export interface BaseAgentParams {
  /** Account address */
  address: string;
  
  /** Network/chain identifier */
  network?: 'polkadot' | 'kusama' | string;
}

/**
 * Error thrown by agents
 */
export class AgentError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

