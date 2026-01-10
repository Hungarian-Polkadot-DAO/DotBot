/**
 * Execution Simulator
 * 
 * Handles transaction simulation using Chopsticks or paymentInfo fallback.
 */

import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { ExecutionItem, ExecutionResult } from '../types';
import { ExecutionArray } from '../executionArray';
import { RpcManager, RpcEndpoints } from '../../rpcManager';

export interface SimulationContext {
  api: ApiPromise;
  accountAddress: string;
  assetHubManager: RpcManager | null;
  relayChainManager: RpcManager | null;
  onStatusUpdate?: (status: any) => void;
}

/**
 * Run simulation for an extrinsic
 */
export async function runSimulation(
  extrinsic: SubmittableExtrinsic<'promise'>,
  context: SimulationContext,
  executionArray: ExecutionArray,
  item: ExecutionItem
): Promise<void> {
  try {
    const { simulateTransaction, isChopsticksAvailable } = await import('../../services/simulation');

    // Create a callback that updates this specific item's simulation status
    const itemSimulationCallback = (status: any) => {
      executionArray.updateSimulationStatus(item.id, status);
      // Also call the original callback if provided (for backward compatibility)
      if (context.onStatusUpdate) {
        context.onStatusUpdate(status);
      }
    };

    // Create new context with item-specific callback
    const itemContext: SimulationContext = {
      ...context,
      onStatusUpdate: itemSimulationCallback,
    };

    if (await isChopsticksAvailable()) {
      await runChopsticksSimulation(extrinsic, itemContext, executionArray, item, simulateTransaction);
    } else {
      await runPaymentInfoValidation(extrinsic, itemContext);
    }

    // Mark simulation as complete
    const currentSimStatus = executionArray.getItem(item.id)?.simulationStatus;
    if (currentSimStatus) {
      executionArray.updateSimulationStatus(item.id, {
        ...currentSimStatus,
        phase: 'complete',
        message: 'Simulation completed successfully',
      });
    }

    executionArray.updateStatus(item.id, 'ready');
  } catch (error) {
    handleSimulationError(error, executionArray, item);
  }
}

async function runChopsticksSimulation(
  extrinsic: SubmittableExtrinsic<'promise'>,
  context: SimulationContext,
  executionArray: ExecutionArray,
  item: ExecutionItem,
  simulateTransaction: any
): Promise<void> {
  const isAssetHub = context.api.registry.chainSS58 === 0;
  const manager = isAssetHub ? context.assetHubManager : context.relayChainManager;

  const rpcEndpoints = getRpcEndpoints(manager, isAssetHub);

  const { encodeAddress, decodeAddress } = await import('@polkadot/util-crypto');
  const senderPublicKey = decodeAddress(context.accountAddress);
  const senderSS58Format = context.api.registry.chainSS58 || 0;
  const encodedSender = encodeAddress(senderPublicKey, senderSS58Format);

  const simulationResult = await simulateTransaction(
    context.api,
    rpcEndpoints,
    extrinsic,
    encodedSender,
    context.onStatusUpdate
  );

  if (!simulationResult.success) {
    const errorMessage = simulationResult.error || 'Simulation failed';
    const cleanError = errorMessage
      .replace(/^Chopsticks simulation failed: /, '')
      .replace(/^Simulation failed: /, '')
      .replace(/^Transaction validation failed: /, '');

    // Update simulation status to show error
    const currentSimStatus = executionArray.getItem(item.id)?.simulationStatus;
    if (currentSimStatus) {
      executionArray.updateSimulationStatus(item.id, {
        ...currentSimStatus,
        phase: 'error',
        message: `Simulation failed: ${cleanError}`,
        result: {
          success: false,
          error: cleanError,
          wouldSucceed: false,
        },
      });
    }

    executionArray.updateStatus(item.id, 'failed', 'Transaction simulation failed');
    executionArray.updateResult(item.id, {
      success: false,
      error: cleanError,
      errorCode: 'SIMULATION_FAILED',
      rawError: errorMessage,
    });

    throw new Error(cleanError);
  }
}

async function runPaymentInfoValidation(
  extrinsic: SubmittableExtrinsic<'promise'>,
  context: SimulationContext
): Promise<void> {
  try {
    const { encodeAddress, decodeAddress } = await import('@polkadot/util-crypto');
    const senderPublicKey = decodeAddress(context.accountAddress);
    const senderSS58Format = context.api.registry.chainSS58 || 0;
    const encodedSenderAddress = encodeAddress(senderPublicKey, senderSS58Format);

    await extrinsic.paymentInfo(encodedSenderAddress);
  } catch {
    // paymentInfo can fail with wasm trap - continue without validation
  }
}

function getRpcEndpoints(manager: RpcManager | null, isAssetHub: boolean): string[] {
  if (manager) {
    const healthStatus = manager.getHealthStatus();
    const currentEndpoint = manager.getCurrentEndpoint();
    const now = Date.now();
    const failoverTimeout = 5 * 60 * 1000;

    const orderedEndpoints = healthStatus
      .filter(h => {
        if (h.healthy) return true;
        if (!h.lastFailure) return true;
        return (now - h.lastFailure) >= failoverTimeout;
      })
      .sort((a, b) => {
        if (a.endpoint === currentEndpoint) return -1;
        if (b.endpoint === currentEndpoint) return 1;
        if (a.healthy !== b.healthy) return a.healthy ? -1 : 1;
        return (a.failureCount || 0) - (b.failureCount || 0);
      })
      .map(h => h.endpoint);

    if (orderedEndpoints.length > 0) {
      return orderedEndpoints;
    }

    return healthStatus.map(h => h.endpoint);
  }

  // Fallback to Polkadot mainnet endpoints if no manager available
  return isAssetHub
    ? RpcEndpoints.POLKADOT_ASSET_HUB.slice(0, 2)
    : RpcEndpoints.POLKADOT_RELAY_CHAIN.slice(0, 2);
}

function handleSimulationError(
  error: unknown,
  executionArray: ExecutionArray,
  item: ExecutionItem
): never {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorLower = errorMessage.toLowerCase();

  const isRuntimePanic =
    errorLower.includes('unreachable') ||
    errorLower.includes('panic') ||
    errorLower.includes('taggedtransactionqueue') ||
    errorLower.includes('transactionpaymentapi') ||
    errorLower.includes('wasm trap');

  const isSimulationFailure = errorLower.includes('simulation failed') || errorLower.includes('chopsticks');

  const finalError = isRuntimePanic
    ? 'Runtime validation panic: Transaction shape is invalid for this chain'
    : isSimulationFailure
      ? `Simulation failed: ${errorMessage}`
      : `Validation failed: ${errorMessage}`;

  // Update simulation status to show error
  const currentSimStatus = executionArray.getItem(item.id)?.simulationStatus;
  if (currentSimStatus) {
    executionArray.updateSimulationStatus(item.id, {
      ...currentSimStatus,
      phase: 'error',
      message: finalError,
      result: {
        success: false,
        error: finalError,
        wouldSucceed: false,
      },
    });
  }

  executionArray.updateStatus(
    item.id,
    'failed',
    isRuntimePanic ? 'Runtime panic - invalid transaction shape' : 'Transaction validation failed'
  );
  executionArray.updateResult(item.id, {
    success: false,
    error: finalError,
    errorCode: isRuntimePanic ? 'RUNTIME_VALIDATION_PANIC' : isSimulationFailure ? 'SIMULATION_FAILED' : 'VALIDATION_FAILED',
    rawError: errorMessage,
  });

  throw new Error(`Transaction validation failed: ${errorMessage}`);
}

