/**
 * Types for Asset Transfer Agent
 */

import { BaseAgentParams } from '../types';

export interface TransferParams extends BaseAgentParams {
  /** Recipient address */
  recipient: string;
  
  /** Amount to transfer (can be in human-readable format like "1.5" or in Planck like "15000000000") */
  amount: string | number;
  
  /** Keep account alive (prevent reaping) - defaults to false */
  keepAlive?: boolean;
  
  /** Whether to validate balance before creating extrinsic - defaults to true */
  validateBalance?: boolean;
}

export interface BatchTransferParams extends BaseAgentParams {
  /** Array of transfers */
  transfers: Array<{
    recipient: string;
    amount: string | number;
  }>;
  
  /** Whether to validate balance before creating extrinsic - defaults to true */
  validateBalance?: boolean;
}

