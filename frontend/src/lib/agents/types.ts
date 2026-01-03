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
 * Status update callback for visual feedback during simulation
 */
export type SimulationStatusCallback = (status: {
  phase: 'validating' | 'simulating' | 'analyzing' | 'retrying' | 'complete' | 'initializing' | 'forking' | 'executing' | 'error';
  message: string;
  attempt?: number;
  maxAttempts?: number;
  chain?: string;
  adjustments?: string[];
  progress?: number;
  details?: string;
  result?: {
    success: boolean;
    estimatedFee?: string;
    validationMethod?: 'chopsticks' | 'paymentInfo';
    balanceChanges?: Array<{ value: string; change: 'send' | 'receive' }>;
    runtimeInfo?: Record<string, any>;
    error?: string;
    wouldSucceed?: boolean;
  };
}) => void;

/**
 * Base parameters that all agent functions might need
 */
export interface BaseAgentParams {
  /** Account address (sender/actor) - must be SS58 format */
  address: string;
  
  /** Network/chain identifier */
  network?: 'polkadot' | 'kusama' | string;
  
  /** Optional callback for simulation status updates */
  onSimulationStatus?: SimulationStatusCallback;
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

/**
 * Dry-run result for extrinsic validation
 */
export interface DryRunResult {
  /** Whether the dry-run succeeded */
  success: boolean;
  
  /** Error message if failed */
  error?: string;
  
  /** Estimated fee in Planck */
  estimatedFee: string;
  
  /** Whether the transaction would succeed on-chain */
  wouldSucceed: boolean;
  
  /** Validation method used */
  validationMethod?: 'chopsticks' | 'paymentInfo';
  
  /** Additional runtime information */
  runtimeInfo?: Record<string, any>;
  
  /** Balance changes (from Chopsticks simulation) */
  balanceChanges?: Array<{
    value: string;
    change: 'send' | 'receive';
  }>;
}

