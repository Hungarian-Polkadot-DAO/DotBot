/**
 * Sequential Transaction Simulation
 * 
 * Simulates transactions sequentially on a forked chain where each transaction
 * sees the state changes from previous transactions.
 * 
 * NOTE: This module now checks for Chopsticks server availability first.
 * If the server is available, it delegates to the client.
 * Otherwise, it falls back to direct Chopsticks usage (backend only).
 */

import type { ApiPromise } from '@polkadot/api';
import type { SubmittableExtrinsic } from '@polkadot/api/types';
import { BN } from '@polkadot/util';
import { encodeAddress as _encodeAddress, decodeAddress as _decodeAddress } from '@polkadot/util-crypto';
import { SimulationResult, SimulationStatusCallback } from './chopsticks';
import { createSubsystemLogger, Subsystem } from '../logger';

// Import client functions - simulation is now client-server architecture
// All Chopsticks setup happens on the server (@dotbot/express)
import { 
  simulateSequentialTransactions as simulateSequentialTransactionsClient,
  isChopsticksAvailable as isChopsticksServerAvailable
} from './chopsticksClient';

// Create logger instance for sequential simulation
const simulationLogger = createSubsystemLogger(Subsystem.SIMULATION);

// =============================================================================
// Types
// =============================================================================

export interface SequentialSimulationResult {
  success: boolean;
  error: string | null;
  results: Array<{
    index: number;
    description: string;
    result: SimulationResult;
  }>;
  totalEstimatedFee: string;
  finalBalanceChanges: Array<{
    value: BN;
    change: 'send' | 'receive';
  }>;
}

export interface SequentialSimulationItem {
  extrinsic: SubmittableExtrinsic<'promise'>;
  description: string;
  senderAddress: string;
}

// NOTE: TransactionResult and other internal types removed
// All simulation logic is now on the server

// NOTE: All helper functions that use Chopsticks directly have been removed.
// All Chopsticks operations now happen on the server (@dotbot/express).
// This module only provides the client interface.

// =============================================================================
// Main Function
// =============================================================================

/**
 * Simulates sequential transactions using the Chopsticks server
 * 
 * NOTE: This function delegates to the client, which connects to the backend server.
 * All Chopsticks setup and execution happens on the server (@dotbot/express).
 */
export async function simulateSequentialTransactions(
  api: ApiPromise,
  rpcEndpoints: string | string[],
  items: SequentialSimulationItem[],
  onStatusUpdate?: SimulationStatusCallback
): Promise<SequentialSimulationResult> {
  // Check if server is available
  const serverAvailable = await isChopsticksServerAvailable();
  if (!serverAvailable) {
    const errorMsg = 'Chopsticks simulation server is not available. Please ensure the backend server is running and the simulation routes are mounted.';
    simulationLogger.error({}, errorMsg);
    throw new Error(errorMsg);
  }
  
  simulationLogger.debug({}, 'Using Chopsticks server for sequential simulation');
  
  // Delegate to client, which makes HTTP request to server
  return await simulateSequentialTransactionsClient(api, rpcEndpoints, items, onStatusUpdate);
}
