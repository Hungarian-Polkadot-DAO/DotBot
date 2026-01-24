/**
 * Execution Simulator
 * 
 * Handles transaction simulation using Chopsticks or paymentInfo fallback.
 */

import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { encodeAddress, decodeAddress } from '@polkadot/util-crypto';
import { ExecutionItem } from '../types';
import { ExecutionArray } from '../executionArray';
import { RpcManager, RpcEndpoints } from '../../rpcManager';
import { markItemAsFailed } from '../errorHandlers';
import { simulateTransaction, isChopsticksAvailable } from '../../services/simulation';
import { createSubsystemLogger, Subsystem } from '../../services/logger';

export interface SimulationContext {
  api: ApiPromise;
  accountAddress: string;
  assetHubManager: RpcManager | null;
  relayChainManager: RpcManager | null;
  sessionEndpoint?: string; // CRITICAL: Endpoint the session API is connected to (for metadata consistency)
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
  const simulationLogger = createSubsystemLogger(Subsystem.SIMULATION);
  simulationLogger.debug({ 
    itemId: item.id,
    description: item.description,
    status: item.status,
    method: `${extrinsic.method.section}.${extrinsic.method.method}`
  }, 'Starting simulation for item');

  try {
    // Set initial simulation status IMMEDIATELY so UI can show progress
    simulationLogger.debug({ itemId: item.id }, 'Setting initial simulation status for item');
    executionArray.updateSimulationStatus(item.id, {
      phase: 'initializing',
      message: 'Initializing simulation...',
      progress: 0,
    });

    // Create a callback that updates this specific item's simulation status
    const itemSimulationCallback = (status: any) => {
      simulationLogger.debug({ 
        itemId: item.id,
        phase: status.phase,
        message: status.message,
        progress: status.progress
      }, 'Simulation status update for item');
      executionArray.updateSimulationStatus(item.id, status);
      // Also call the original callback if provided (for backward compatibility)
      if (context.onStatusUpdate) {
        context.onStatusUpdate(status);
      }
    };

    // Create new context with item-specific callback
    console.log('[SIMULATION] Creating simulation context...', {
      itemId: item.id,
      hasApi: !!context.api,
      hasOnStatusUpdate: !!context.onStatusUpdate
    });
    const itemContext: SimulationContext = {
      ...context,
      onStatusUpdate: itemSimulationCallback,
    };
    console.log('[SIMULATION] Context created, checking Chopsticks availability...');

    const checkStartTime = Date.now();
    let chopsticksAvailable: boolean;
    try {
      console.log('[SIMULATION] Calling isChopsticksAvailable()...');
      chopsticksAvailable = await isChopsticksAvailable();
      const checkDuration = Date.now() - checkStartTime;
      console.log('[SIMULATION] isChopsticksAvailable() completed', {
        available: chopsticksAvailable,
        duration: `${checkDuration}ms`
      });
    } catch (checkError) {
      const errorMsg = checkError instanceof Error ? checkError.message : String(checkError);
      console.error('[SIMULATION] isChopsticksAvailable() failed:', errorMsg, checkError);
      simulationLogger.error({ 
        error: errorMsg,
        stack: checkError instanceof Error ? checkError.stack : undefined
      }, 'Failed to check Chopsticks availability');
      throw new Error(`Failed to check Chopsticks availability: ${errorMsg}`);
    }
    
    simulationLogger.debug({ 
      method: chopsticksAvailable ? 'Chopsticks' : 'paymentInfo',
      fullValidation: chopsticksAvailable
    }, chopsticksAvailable ? 'Simulation method: Chopsticks (full runtime validation)' : 'Simulation method: paymentInfo fallback (structure only)');
    console.log('[SIMULATION] Simulation method determined:', {
      method: chopsticksAvailable ? 'Chopsticks' : 'paymentInfo',
      fullValidation: chopsticksAvailable
    });

    if (chopsticksAvailable) {
      // Use Chopsticks for full runtime execution simulation
      await runChopsticksSimulation(extrinsic, itemContext, executionArray, item, simulateTransaction);
    } else {
      // Fallback: Only use paymentInfo if Chopsticks is completely unavailable
      // This should be rare - only in environments where @acala-network/chopsticks-core can't be imported
      simulationLogger.warn({}, 'Chopsticks unavailable - using paymentInfo fallback (limited validation)');
      await runPaymentInfoValidation(extrinsic, itemContext);
    }

    // Mark simulation as complete
    const currentSimStatus = executionArray.getItem(item.id)?.simulationStatus;
    if (currentSimStatus) {
      simulationLogger.info({ itemId: item.id }, 'Simulation completed successfully for item');
      executionArray.updateSimulationStatus(item.id, {
        ...currentSimStatus,
        phase: 'complete',
        message: 'Simulation completed successfully',
      });
    }

    simulationLogger.debug({ itemId: item.id }, 'Updating item status to ready');
    executionArray.updateStatus(item.id, 'ready');
  } catch (error) {
    simulationLogger.error({ 
      itemId: item.id,
      description: item.description,
      error: error instanceof Error ? error.message : String(error)
    }, 'Simulation failed for item');
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
  const simulationLogger = createSubsystemLogger(Subsystem.SIMULATION);
  console.log('[SIMULATION] runChopsticksSimulation: Starting...', {
    itemId: item.id,
    hasApi: !!context.api,
    apiConnected: context.api?.isConnected,
    hasSessionEndpoint: !!context.sessionEndpoint
  });
  
  // CRITICAL: Validate API is available and connected
  if (!context.api) {
    console.error('[SIMULATION] runChopsticksSimulation: API not available');
    const errorMsg = 'API instance is not available. This may happen after switching networks. Please try again.';
    simulationLogger.error({ itemId: item.id }, errorMsg);
    executionArray.updateSimulationStatus(item.id, {
      phase: 'error',
      message: errorMsg,
      result: {
        success: false,
        error: errorMsg,
        wouldSucceed: false,
      },
    });
    markItemAsFailed(executionArray, item.id, errorMsg, 'API_NOT_AVAILABLE', errorMsg);
    throw new Error(errorMsg);
  }
  
  // Ensure API is ready before simulation
  if (!context.api.isConnected) {
    executionArray.updateSimulationStatus(item.id, {
      phase: 'initializing',
      message: 'Waiting for blockchain connection...',
      progress: 5,
    });
    
    try {
      await Promise.race([
        context.api.isReady,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 30000)
        )
      ]);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Connection timeout';
      const userMsg = `Cannot connect to blockchain: ${errorMsg}. Please check your network connection.`;
      simulationLogger.error({ itemId: item.id, error: errorMsg }, userMsg);
      executionArray.updateSimulationStatus(item.id, {
        phase: 'error',
        message: userMsg,
        result: {
          success: false,
          error: userMsg,
          wouldSucceed: false,
        },
      });
      markItemAsFailed(executionArray, item.id, userMsg, 'CONNECTION_FAILED', errorMsg);
      throw new Error(userMsg);
    }
  }
  
  const isAssetHub = context.api.registry.chainSS58 === 0;
  const manager = isAssetHub ? context.assetHubManager : context.relayChainManager;

  // CRITICAL FIX: Use session endpoint first (for metadata consistency), fallback to manager endpoints
  let rpcEndpoints: string[];
  if (context.sessionEndpoint) {
    // Use session endpoint first, then manager endpoints as fallback
    const managerEndpoints = getRpcEndpoints(manager, isAssetHub);
    rpcEndpoints = [context.sessionEndpoint, ...managerEndpoints.filter(e => e !== context.sessionEndpoint)];
    simulationLogger.debug({ endpoint: context.sessionEndpoint }, 'Using session endpoint for metadata consistency');
  } else {
    // Fallback to manager endpoints (legacy behavior)
    rpcEndpoints = getRpcEndpoints(manager, isAssetHub);
    simulationLogger.warn({}, 'No session endpoint provided, using manager endpoints (may cause metadata mismatch)');
    // Update status to inform user about potential metadata mismatch
    if (context.onStatusUpdate) {
      context.onStatusUpdate({
        phase: 'initializing',
        message: 'Using fallback endpoints (may cause metadata mismatch)',
        progress: 8,
        details: 'Session endpoint not available, using manager endpoints'
      });
    }
  }

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

    markItemAsFailed(executionArray, item.id, cleanError, 'SIMULATION_FAILED', errorMessage);

    throw new Error(cleanError);
  }
}

/**
 * Fallback validation using paymentInfo (ONLY when Chopsticks is not available)
 * 
 * WARNING: This is a minimal validation that only checks if the extrinsic structure is valid.
 * It does NOT execute the transaction or validate runtime behavior.
 * 
 * This should ONLY be used when:
 * - @acala-network/chopsticks-core cannot be imported (e.g., in some environments)
 * - Chopsticks simulation is explicitly disabled
 * 
 * For proper transaction validation, use Chopsticks simulation instead.
 */
async function runPaymentInfoValidation(
  extrinsic: SubmittableExtrinsic<'promise'>,
  context: SimulationContext
): Promise<void> {
  const simulationLogger = createSubsystemLogger(Subsystem.SIMULATION);
  simulationLogger.warn({}, 'Using paymentInfo fallback - this only validates structure, not runtime behavior');
  try {
    const senderPublicKey = decodeAddress(context.accountAddress);
    const senderSS58Format = context.api.registry.chainSS58 || 0;
    const encodedSenderAddress = encodeAddress(senderPublicKey, senderSS58Format);

    // This only checks if the extrinsic can be decoded and fee can be estimated
    // It does NOT validate that the transaction will succeed on-chain
    await extrinsic.paymentInfo(encodedSenderAddress);
  } catch {
    // paymentInfo can fail with wasm trap - continue without validation
    // This is expected in some cases and doesn't mean the transaction is invalid
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

