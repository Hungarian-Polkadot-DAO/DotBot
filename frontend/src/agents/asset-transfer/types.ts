/**
 * Types for Asset Transfer Agent
 */

export interface TransferParams {
  /** Sender address */
  address: string;
  
  /** Recipient address */
  recipient: string;
  
  /** Amount to transfer (in smallest unit, e.g., Planck for DOT) */
  amount: string;
  
  /** Keep account alive (prevent reaping) */
  keepAlive?: boolean;
}

export interface BatchTransferParams {
  /** Sender address */
  address: string;
  
  /** Array of transfers */
  transfers: Array<{
    recipient: string;
    amount: string;
  }>;
}

