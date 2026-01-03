/**
 * Transfer Extrinsic Builder
 * 
 * Creates a transfer extrinsic for DOT or tokens using transferAllowDeath.
 * This allows the sender's account to be reaped if balance falls below ED.
 */

import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';

/**
 * Parameters for creating a transfer extrinsic
 */
export interface TransferExtrinsicParams {
  recipient: string;
  amount: string;
}

/**
 * Create a transfer extrinsic using balances.transferAllowDeath
 * 
 * Note: This was formerly called balances.transfer in older Polkadot.js versions.
 * Transfers liquid free balance to another account. If the sender's balance falls 
 * below the Existential Deposit (ED) as a result, the account is reaped.
 * 
 * @param api Polkadot API instance
 * @param params Transfer parameters
 * @returns Transfer extrinsic
 */
export function createTransferExtrinsic(
  api: ApiPromise,
  params: TransferExtrinsicParams
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
    // Use transferAllowDeath (renamed from transfer in Polkadot.js v10+)
    // Ensure we're using the correct API instance that matches the chain
    const extrinsic = api.tx.balances.transferAllowDeath(recipient, amountBN);
    
    // Validate extrinsic was created correctly
    if (!extrinsic || !extrinsic.method) {
      throw new Error('Failed to create transfer extrinsic');
    }
    
    return extrinsic;
  } catch (error) {
    // Provide more context about the error
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create transfer extrinsic: ${errorMessage}. API ready: ${api.isReady}, Chain: ${api.runtimeChain || 'unknown'}`);
  }
}

