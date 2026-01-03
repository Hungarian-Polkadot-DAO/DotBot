/**
 * Transfer Keep Alive Extrinsic Builder
 * 
 * Creates a transfer extrinsic that keeps the account alive.
 * Use this when you want to ensure the sender account remains alive
 * (has existential deposit) after the transfer.
 */

import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';

/**
 * Parameters for creating a transfer keep alive extrinsic
 */
export interface TransferKeepAliveExtrinsicParams {
  recipient: string;
  amount: string;
}

/**
 * Create a transferKeepAlive extrinsic
 * 
 * @param api Polkadot API instance
 * @param params Transfer parameters
 * @returns TransferKeepAlive extrinsic
 */
export function createTransferKeepAliveExtrinsic(
  api: ApiPromise,
  params: TransferKeepAliveExtrinsicParams
): SubmittableExtrinsic<'promise'> {
  const { recipient, amount } = params;
  
  // Validate API is ready
  if (!api || !api.tx || !api.tx.balances) {
    throw new Error('API not ready or balances pallet not available');
  }
  
  // Validate recipient address
  if (!recipient || recipient.trim().length === 0) {
    throw new Error('Recipient address is required');
  }

  // Validate amount - ensure it's a valid string representation of a number
  if (!amount || amount === '0') {
    throw new Error('Transfer amount must be greater than zero');
  }
  
  // Ensure amount is a valid numeric string (no decimals for Planck)
  const amountBN = typeof amount === 'string' ? amount : String(amount);
  if (!/^\d+$/.test(amountBN)) {
    throw new Error(`Invalid amount format: ${amount}. Amount must be in Planck (integer string)`);
  }

  try {
    // Use transferKeepAlive
    // Ensure we're using the correct API instance that matches the chain
    const extrinsic = api.tx.balances.transferKeepAlive(recipient, amountBN);
    
    // Validate extrinsic was created correctly
    if (!extrinsic || !extrinsic.method) {
      throw new Error('Failed to create transferKeepAlive extrinsic');
    }
    
    return extrinsic;
  } catch (error) {
    // Provide more context about the error
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create transferKeepAlive extrinsic: ${errorMessage}. API ready: ${api.isReady}, Chain: ${api.runtimeChain || 'unknown'}`);
  }
}

