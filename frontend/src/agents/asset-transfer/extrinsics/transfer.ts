/**
 * Transfer Extrinsic Builder
 * 
 * Creates a transfer extrinsic for DOT or tokens.
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
 * Create a transfer extrinsic
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
  
  // Validate recipient address
  if (!recipient || recipient.trim().length === 0) {
    throw new Error('Recipient address is required');
  }

  // Validate amount
  if (!amount || amount === '0') {
    throw new Error('Transfer amount must be greater than zero');
  }

  return api.tx.balances.transfer(recipient, amount);
}

