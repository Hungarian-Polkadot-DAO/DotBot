/**
 * Execution Array Types
 * 
 * Types for managing and executing operations from agents.
 */

import { SubmittableExtrinsic } from '@polkadot/api/types';
import { AgentResult } from '../agents/types';

/**
 * Execution status for a single operation
 * 
 * Note: This extends the prompt system's ExecutionStatus with more granular
 * transaction lifecycle statuses. The prompt system uses simpler statuses for planning,
 * while the runtime uses these detailed statuses for actual execution tracking.
 */
export type ExecutionStatus =
  | 'pending'      // Waiting to be executed
  | 'ready'        // Ready for user approval
  | 'executing'    // Currently executing (maps to signing/broadcasting for extrinsics)
  | 'signing'      // User is signing (extrinsic-specific)
  | 'broadcasting' // Transaction is being broadcast (extrinsic-specific)
  | 'in_block'     // Transaction is in a block (extrinsic-specific)
  | 'finalized'    // Transaction is finalized (extrinsic-specific)
  | 'completed'    // Operation completed successfully
  | 'failed'       // Operation failed
  | 'cancelled';   // User cancelled the operation

/**
 * Execution type from AgentResult
 */
export type ExecutionType = 'extrinsic' | 'data_fetch' | 'validation' | 'user_input';

/**
 * Execution item in the array
 */
export interface ExecutionItem {
  /** Unique identifier for this execution item */
  id: string;
  
  /** Agent result that created this item */
  agentResult: AgentResult;
  
  /** Current execution status */
  status: ExecutionStatus;
  
  /** Execution type */
  executionType: ExecutionType;
  
  /** Human-readable description */
  description: string;
  
  /** Estimated fee (if applicable) */
  estimatedFee?: string;
  
  /** Warnings (if any) */
  warnings?: string[];
  
  /** Additional metadata */
  metadata?: Record<string, any>;
  
  /** Execution result (populated after execution) */
  result?: ExecutionResult;
  
  /** Error message (if execution failed) */
  error?: string;
  
  /** Timestamp when item was created */
  createdAt: number;
  
  /** Timestamp when execution started */
  startedAt?: number;
  
  /** Timestamp when execution completed */
  completedAt?: number;
  
  /** Index in the execution array */
  index: number;
}

/**
 * Result of executing an operation
 */
export interface ExecutionResult {
  /** Whether execution was successful */
  success: boolean;
  
  /** Transaction hash (for extrinsics) */
  txHash?: string;
  
  /** Block hash where transaction was included */
  blockHash?: string;
  
  /** Block number */
  blockNumber?: number;
  
  /** Transaction index in block */
  txIndex?: number;
  
  /** Events emitted by the transaction */
  events?: any[];
  
  /** Returned data (for non-extrinsic operations) */
  data?: any;
  
  /** Error message (if failed) */
  error?: string;
  
  /** Error code (if failed) */
  errorCode?: string;
  
  /** Raw error details (JSON stringified, for debugging) */
  rawError?: string;
}

/**
 * Options for executing the array
 */
export interface ExecutionOptions {
  /** Continue execution if one item fails (default: false) */
  continueOnError?: boolean;
  
  /** Allow batching compatible extrinsics (default: true) */
  allowBatching?: boolean;
  
  /** Timeout per operation in milliseconds (default: 300000 = 5 minutes) */
  timeout?: number;
  
  /** Execute operations sequentially (default: true) */
  sequential?: boolean;
  
  /** Auto-approve operations (default: false - requires user approval) */
  autoApprove?: boolean;
}

/**
 * Execution array state
 */
export interface ExecutionArrayState {
  /** All execution items */
  items: ExecutionItem[];
  
  /** Current execution index */
  currentIndex: number;
  
  /** Whether execution is in progress */
  isExecuting: boolean;
  
  /** Whether execution is paused */
  isPaused: boolean;
  
  /** Total number of items */
  totalItems: number;
  
  /** Number of completed items */
  completedItems: number;
  
  /** Number of failed items */
  failedItems: number;
  
  /** Number of cancelled items */
  cancelledItems: number;
}

/**
 * Callback function types
 */
export type StatusCallback = (item: ExecutionItem) => void;
export type ProgressCallback = (state: ExecutionArrayState) => void;
export type ErrorCallback = (item: ExecutionItem, error: Error) => void;
export type CompletionCallback = (state: ExecutionArrayState) => void;

/**
 * Signing request for user approval
 */
export interface SigningRequest {
  /** Execution item ID */
  itemId: string;
  
  /** Extrinsic to sign */
  extrinsic: SubmittableExtrinsic<'promise'>;
  
  /** Human-readable description */
  description: string;
  
  /** Estimated fee */
  estimatedFee?: string;
  
  /** Warnings */
  warnings?: string[];
  
  /** Metadata */
  metadata?: Record<string, any>;
  
  /** Account address */
  accountAddress: string;
  
  /** Resolve function - call with true to approve, false to reject */
  resolve: (approved: boolean) => void;
}

/**
 * Batch signing request
 */
export interface BatchSigningRequest {
  /** Execution item IDs */
  itemIds: string[];
  
  /** Batch extrinsic */
  extrinsic: SubmittableExtrinsic<'promise'>;
  
  /** Descriptions of all operations */
  descriptions: string[];
  
  /** Total estimated fee */
  estimatedFee?: string;
  
  /** Warnings */
  warnings?: string[];
  
  /** Account address */
  accountAddress: string;
  
  /** Resolve function */
  resolve: (approved: boolean) => void;
}

