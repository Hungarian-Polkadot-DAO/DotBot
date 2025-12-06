/**
 * Batch Transfer Extrinsic Builder
 * 
 * Creates a batch extrinsic for multiple transfers.
 * All transfers in the batch will be executed atomically.
 */

import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';

/**
 * Parameters for creating a batch transfer extrinsic
 */
export interface BatchTransferExtrinsicParams {
  transfers: Array<{
    recipient: string;
    amount: string;
  }>;
}

/**
 * Create a batch transfer extrinsic
 * 
 * @param api Polkadot API instance
 * @param params Batch transfer parameters
 * @returns Batch transfer extrinsic
 */
export function createBatchTransferExtrinsic(
  api: ApiPromise,
  params: BatchTransferExtrinsicParams
): SubmittableExtrinsic<'promise'> {
  const { transfers } = params;

  // Validate transfers array
  if (!transfers || transfers.length === 0) {
    throw new Error('At least one transfer is required for batch transfer');
  }

  if (transfers.length > 100) {
    throw new Error('Batch transfer cannot exceed 100 transfers');
  }

  // Validate each transfer
  const transferExtrinsics = transfers.map((transfer, index) => {
    if (!transfer.recipient || transfer.recipient.trim().length === 0) {
      throw new Error(`Transfer ${index + 1}: Recipient address is required`);
    }

    if (!transfer.amount || transfer.amount === '0') {
      throw new Error(`Transfer ${index + 1}: Amount must be greater than zero`);
    }

    return api.tx.balances.transfer(transfer.recipient, transfer.amount);
  });

  return api.tx.utility.batch(transferExtrinsics);
}

