/**
 * Shared types for all agents
 */

import { SubmittableExtrinsic } from '@polkadot/api/types';

/**
 * Result from an agent function call
 * Can return extrinsics, data, or mixed results
 */
export interface AgentResult {
  /** The extrinsic to be signed and submitted (if applicable) */
  extrinsic?: SubmittableExtrinsic<'promise'>;
  
  /** Human-readable description of what this operation does */
  description: string;
  
  /** Estimated transaction fee (if available) */
  estimatedFee?: string;
  
  /** Any warnings or important information */
  warnings?: string[];
  
  /** Additional metadata */
  metadata?: Record<string, any>;
  
  /** Returned data (for non-extrinsic operations) */
  data?: any;
  
  /** Result type: 'extrinsic', 'data', 'mixed', or 'confirmation' */
  resultType: 'extrinsic' | 'data' | 'mixed' | 'confirmation';
  
  /** Whether this result requires user confirmation before execution */
  requiresConfirmation: boolean;
  
  /** Execution type for Execution Array */
  executionType: 'extrinsic' | 'data_fetch' | 'validation' | 'user_input';
}

/**
 * Base parameters that all agent functions might need
 */
export interface BaseAgentParams {
  /** Account address (sender/actor) */
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

/**
 * Validation result for parameters
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Balance information
 */
export interface BalanceInfo {
  free: string;
  reserved: string;
  frozen: string;
  available: string; // free - frozen
}

