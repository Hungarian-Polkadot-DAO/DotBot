/**
 * Execution Broadcaster
 * 
 * Handles transaction broadcasting and monitoring.
 */

import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { ExecutionResult } from '../types';

/**
 * Broadcast transaction and monitor status
 */
export async function broadcastTransaction(
  extrinsic: SubmittableExtrinsic<'promise'>,
  api: ApiPromise,
  timeout: number
): Promise<ExecutionResult> {
  return new Promise<ExecutionResult>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      reject(new Error('Transaction timeout'));
    }, timeout);

    try {
      extrinsic.send((result) => {
        handleTransactionResult(result, api, extrinsic, timeoutHandle, resolve);
      }).catch((error: Error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });
    } catch (error) {
      clearTimeout(timeoutHandle);
      reject(error);
    }
  });
}

function handleTransactionResult(
  result: any,
  api: ApiPromise,
  extrinsic: SubmittableExtrinsic<'promise'>,
  timeoutHandle: NodeJS.Timeout,
  resolve: (value: ExecutionResult) => void
): void {
  if (result.status.isFinalized) {
    clearTimeout(timeoutHandle);
    const blockHash = result.status.asFinalized.toString();

    const failedEvent = result.events.find(({ event }: any) => {
      return api.events.system.ExtrinsicFailed.is(event);
    });

    if (failedEvent) {
      const errorEvent = failedEvent.event.toHuman();
      let errorDetails = 'Transaction failed';

      if (failedEvent.event.data && failedEvent.event.data.length > 0) {
        const dispatchError = failedEvent.event.data[0];

        if (dispatchError.isModule) {
          try {
            const decoded = api.registry.findMetaError(dispatchError.asModule);
            errorDetails = `${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`;
          } catch {
            // Could not decode error
          }
        }
      }

      resolve({
        success: false,
        error: errorDetails,
        errorCode: 'EXTRINSIC_FAILED',
        rawError: JSON.stringify(errorEvent),
      });
    } else {
      resolve({
        success: true,
        txHash: extrinsic.hash.toString(),
        blockHash,
        events: result.events.map((e: any) => e.event.toHuman()),
      });
    }
  }

  if (result.status.isInvalid || result.status.isDropped || result.status.isUsurped) {
    clearTimeout(timeoutHandle);
    const statusType = result.status.isInvalid ? 'Invalid' :
      result.status.isDropped ? 'Dropped' : 'Usurped';
    resolve({
      success: false,
      error: `Transaction ${statusType}`,
      errorCode: statusType.toUpperCase(),
    });
  }
}

/**
 * Monitor transaction status
 */
export async function monitorTransaction(
  txHash: string,
  api: ApiPromise
): Promise<void> {
  // Monitoring is handled by broadcastTransaction callback
  // This function is kept for API compatibility
}

