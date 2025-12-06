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
  
  // Validate recipient address
  if (!recipient || recipient.trim().length === 0) {
    throw new Error('Recipient address is required');
  }

  // Validate amount
  if (!amount || amount === '0') {
    throw new Error('Transfer amount must be greater than zero');
  }

  return api.tx.balances.transferKeepAlive(recipient, amount);
}

