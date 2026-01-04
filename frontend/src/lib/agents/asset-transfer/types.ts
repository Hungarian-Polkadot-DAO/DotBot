/**
 * Types for Asset Transfer Agent
 */

import { BaseAgentParams } from '../types';

/**
 * Chain selection for transfers
 * - 'assetHub': Asset Hub (recommended for DOT transfers post-migration)
 * - 'relay': Relay Chain (for staking, governance, validator operations)
 */
export type ChainType = 'assetHub' | 'relay';

export interface TransferParams extends BaseAgentParams {
  /** Recipient address */
  recipient: string;
  
  /** Amount to transfer (can be in human-readable format like "1.5" or in Planck like "15000000000") */
  amount: string | number;
  
  /** Target chain for the transfer - defaults to 'assetHub' for DOT */
  chain?: ChainType;
  
  /** Keep account alive (prevent reaping) - defaults to false */
  keepAlive?: boolean;
  
  /** Whether to validate balance before creating extrinsic - defaults to true */
  validateBalance?: boolean;
  
  /** Whether to enable simulation/dry-run validation - defaults to false (simulation OFF by default). Set to true to enable. */
  enableSimulation?: boolean;
}

export interface BatchTransferParams extends BaseAgentParams {
  /** Array of transfers */
  transfers: Array<{
    recipient: string;
    amount: string | number;
  }>;
  
  /** Target chain for the batch transfer - defaults to 'assetHub' for DOT */
  chain?: ChainType;
  
  /** Whether to validate balance before creating extrinsic - defaults to true */
  validateBalance?: boolean;
  
  /** Whether to enable simulation/dry-run validation - defaults to false (simulation OFF by default). Set to true to enable. */
  enableSimulation?: boolean;
}

