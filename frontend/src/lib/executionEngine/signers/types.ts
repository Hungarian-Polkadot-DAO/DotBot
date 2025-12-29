/**
 * Signer Abstraction
 * 
 * Abstract signing interface that allows the execution system to work
 * in ANY environment: browser, terminal, backend, tests, etc.
 */

import { SubmittableExtrinsic } from '@polkadot/api/types';
import { SigningRequest, BatchSigningRequest } from '../types';

/**
 * Signer interface
 * 
 * Implement this interface to provide signing capabilities
 * in any environment (browser, CLI, backend, tests, etc.)
 */
export interface Signer {
  /**
   * Sign a single transaction
   * 
   * @param extrinsic The extrinsic to sign
   * @param address The signer address
   * @returns Signed extrinsic
   */
  signExtrinsic(
    extrinsic: SubmittableExtrinsic<'promise'>,
    address: string
  ): Promise<SubmittableExtrinsic<'promise'>>;
  
  /**
   * Optional: Request user approval before signing
   * If not implemented, signing happens automatically
   * 
   * @param request Signing request with transaction details
   * @returns true if approved, false if rejected
   */
  requestApproval?(request: SigningRequest): Promise<boolean>;
  
  /**
   * Optional: Request approval for batch signing
   * 
   * @param request Batch signing request
   * @returns true if approved, false if rejected
   */
  requestBatchApproval?(request: BatchSigningRequest): Promise<boolean>;
  
  /**
   * Get signer type (for debugging/logging)
   */
  getType(): string;
}

/**
 * Signer options
 */
export interface SignerOptions {
  /** Whether to auto-approve all transactions (dangerous for production!) */
  autoApprove?: boolean;
}

