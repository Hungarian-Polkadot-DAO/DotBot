/**
 * Transaction Simulation Service
 * Fork-based transaction validation using Chopsticks
 */

import type { ApiPromise } from '@polkadot/api';
import type { SubmittableExtrinsic } from '@polkadot/api/types';
import type { HexString } from '@polkadot/util/types';
import { BN } from '@polkadot/util';

import { createChopsticksDatabase, type Database } from './database';
import { classifyChopsticksError } from './chopsticksIgnorePolicy';
import { createSubsystemLogger, Subsystem } from '../logger';

export interface SimulationResult {
  success: boolean;
  error: string | null;
  estimatedFee: string;
  balanceChanges: Array<{
    value: BN;
    change: 'send' | 'receive';
  }>;
  events: any[];
}

export type SimulationStatusCallback = (status: {
  phase: 'initializing' | 'forking' | 'executing' | 'analyzing' | 'complete' | 'error';
  message: string;
  progress?: number;
  details?: string;
}) => void;

/**
 * Simulates transaction execution on a forked chain state
 * 
 * CRITICAL FIX: To avoid runtime/metadata mismatch, Chopsticks must fork at the EXACT
 * same block that the API instance (which created the extrinsic) is using. If Chopsticks
 * forks at a different block with different runtime metadata, call indices won't match
 * and simulation will fail with "Unable to find Call with index [X, Y]" errors.
 */
export async function simulateTransaction(
  api: ApiPromise,
  rpcEndpoints: string | string[],
  extrinsic: SubmittableExtrinsic<'promise'>,
  senderAddress: string,
  onStatusUpdate?: SimulationStatusCallback
): Promise<SimulationResult> {
  const startTime = Date.now();
  let chain: any = null;
  let storage: Database | null = null;
  
  const updateStatus = (phase: 'initializing' | 'forking' | 'executing' | 'analyzing' | 'complete' | 'error', message: string, progress?: number, details?: string) => {
    if (onStatusUpdate) {
      onStatusUpdate({ phase, message, progress, details });
    }
  };
  
  try {
    updateStatus('initializing', 'Preparing transaction simulation...', 10);
    
    const { BuildBlockMode, setup } = await import('@acala-network/chopsticks-core');
    
    updateStatus('initializing', 'Setting up simulation environment...', 20);
    const dbName = `dotbot-sim-cache:${api.genesisHash.toHex()}`;
    storage = createChopsticksDatabase(dbName);
    
    // Get chain name for error classification
    const chainName = (await api.rpc.system.chain()).toString();
    
    updateStatus('forking', 'Fetching current blockchain state...', 30);
    
    // Filter to only WebSocket endpoints (wss:// or ws://) - Chopsticks requires WebSocket
    const allEndpoints = Array.isArray(rpcEndpoints) ? rpcEndpoints : [rpcEndpoints];
    const endpoints = allEndpoints.filter(endpoint => 
      typeof endpoint === 'string' && (endpoint.startsWith('wss://') || endpoint.startsWith('ws://'))
    );
    
    if (endpoints.length === 0) {
      throw new Error('No valid WebSocket endpoints provided. Chopsticks requires WebSocket (wss://) endpoints, not HTTP (https://)');
    }
    
    // CRITICAL FIX: Get the block hash from the API instance that created the extrinsic
    // This ensures Chopsticks forks at the SAME runtime version, avoiding metadata mismatch
    // The extrinsic's call indices are tied to the API instance's metadata
    let blockHashForFork: string | undefined = undefined;
    try {
      // Get the current finalized block from the API instance
      // Using finalized block (not latest) because:
      // 1. It's more stable (won't reorg)
      // 2. It's more likely to exist on all endpoints
      // 3. It matches the state the API instance is using
      const finalizedHash = await api.rpc.chain.getFinalizedHead();
      blockHashForFork = finalizedHash.toHex();
      const simulationLogger = createSubsystemLogger(Subsystem.SIMULATION);
      simulationLogger.debug({ 
        blockHash: blockHashForFork.slice(0, 12) + '...'
      }, 'Using finalized block for fork');
    } catch (error) {
      const simulationLogger = createSubsystemLogger(Subsystem.SIMULATION);
      simulationLogger.warn({ 
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to get finalized block, will let Chopsticks choose');
      // If we can't get the finalized block, let Chopsticks fetch latest
      // This is the fallback behavior (might cause metadata mismatch)
      blockHashForFork = undefined;
    }
    
    // Try to fork at the finalized block first (for metadata consistency)
    // If that block doesn't exist on the endpoint (pruned node), fall back to letting Chopsticks choose
    updateStatus('forking', 'Creating chain fork at finalized block...', 40);
    
    try {
      chain = await setup({
        endpoint: endpoints,
        block: blockHashForFork, // Fork at API's current finalized block to match metadata
        buildBlockMode: BuildBlockMode.Batch,
        mockSignatureHost: true,
        db: storage,
      });
    } catch (setupError) {
      const errorMessage = setupError instanceof Error ? setupError.message : String(setupError);
      
      // If the block doesn't exist on the endpoint (pruned node), retry without specifying block
      if (blockHashForFork && (
        errorMessage.includes('Cannot find header') ||
        errorMessage.includes('not found') ||
        errorMessage.includes('does not exist')
      )) {
        const logger = createSubsystemLogger(Subsystem.SIMULATION);
        logger.warn({ 
          blockHash: blockHashForFork.slice(0, 12) + '...'
        }, 'Block not found on endpoint (likely pruned node). Falling back to latest block. This may cause metadata mismatch if runtime versions differ.');
        
        updateStatus('forking', 'Block not found on endpoint, using latest block...', 40);
        
        // Retry without specifying block - let Chopsticks fetch latest
        // This may cause metadata mismatch, but it's better than failing completely
        chain = await setup({
          endpoint: endpoints,
          block: undefined, // Let Chopsticks fetch latest block from endpoint
          buildBlockMode: BuildBlockMode.Batch,
          mockSignatureHost: true,
          db: storage,
        });
      } else {
        // Re-throw if it's a different error
        throw setupError;
      }
    }
    
    // Helper to convert block hash to hex string (always returns 0x-prefixed)
    const toHexString = (blockHash: any): `0x${string}` => {
      // Handle null/undefined
      if (!blockHash) {
        throw new Error('Block hash is null or undefined');
      }
      
      // Already a string? Return it (ensure 0x prefix)
      if (typeof blockHash === 'string') {
        return blockHash.startsWith('0x') ? blockHash as `0x${string}` : `0x${blockHash}` as `0x${string}`;
      }
      
      // Is it an object with a 'hash' property? (e.g., {number: 123, hash: "0x..."})
      if (typeof blockHash === 'object' && blockHash !== null && 'hash' in blockHash) {
        const hash = blockHash.hash;
        if (typeof hash === 'string') {
          return hash.startsWith('0x') ? hash as `0x${string}` : `0x${hash}` as `0x${string}`;
        }
        // Recursively convert the hash property
        return toHexString(hash);
      }
      
      // Has .toHex() method? Call it
      if (typeof blockHash.toHex === 'function') {
        const hex = blockHash.toHex();
        return hex.startsWith('0x') ? hex as `0x${string}` : `0x${hex}` as `0x${string}`;
      }
      
      // Is it a Uint8Array? Convert to hex
      if (blockHash instanceof Uint8Array) {
        const hex = Array.from(blockHash)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        return `0x${hex}` as `0x${string}`;
      }
      
      // Has .toString() that returns hex? Try it
      if (typeof blockHash.toString === 'function') {
        const str = blockHash.toString();
        // Check if it looks like hex (starts with 0x or is all hex chars)
        if (str.startsWith('0x') || /^[0-9a-fA-F]+$/.test(str)) {
          return str.startsWith('0x') ? str as `0x${string}` : `0x${str}` as `0x${string}`;
        }
      }
      
      throw new Error(`Cannot convert block hash to hex string. Type: ${typeof blockHash}, Value: ${JSON.stringify(blockHash)}`);
    };
    
    // Get block info from the chain after setup
    let blockHashHex: `0x${string}` | null = null;
    let blockNumber: any = null;
    
    try {
      const chainBlockHash = await chain.head;
      blockHashHex = toHexString(chainBlockHash);
      
      // Try to extract block number from chainBlockHash if it's an object with number property
      // Otherwise, try to get it from the API
      if (typeof chainBlockHash === 'object' && chainBlockHash !== null && 'number' in chainBlockHash) {
        // chainBlockHash is {number: 123, hash: "0x..."}
        blockNumber = { number: { toNumber: () => chainBlockHash.number } };
        updateStatus('forking', `Chain fork created at block #${chainBlockHash.number}...`, 45, `Block: ${blockHashHex.slice(0, 12)}...`);
      } else {
        // Try to get block number from the API using the hash
        try {
          const hashForHeader = (typeof chainBlockHash === 'object' && chainBlockHash !== null && 'hash' in chainBlockHash)
            ? chainBlockHash.hash
            : chainBlockHash;
          
          // Use the passed api parameter instead of chain.api
          const chainBlockNumber = await api.rpc.chain.getHeader(hashForHeader);
          blockNumber = chainBlockNumber;
          updateStatus('forking', `Chain fork created at block #${chainBlockNumber.number.toNumber()}...`, 45, `Block: ${blockHashHex.slice(0, 12)}...`);
        } catch {
          updateStatus('forking', `Chain fork created...`, 45, `Block: ${blockHashHex.slice(0, 12)}...`);
        }
      }
    } catch (err) {
      throw new Error(`Failed to get block hash from chain: ${err instanceof Error ? err.message : String(err)}`);
    }
    
    // Ensure we have a valid block hash
    if (!blockHashHex) {
      throw new Error('Failed to get block hash from chain');
    }
    
    updateStatus('executing', 'Simulating transaction execution...', 60, 'Running on forked chain state');
    
    if (extrinsic.registry !== api.registry) {
      const errorMsg = `Registry mismatch: extrinsic registry (${extrinsic.registry.constructor.name}) does not match API registry (${api.registry.constructor.name}). This will cause wasm unreachable errors.`;
      throw new Error(errorMsg);
    }

    const finalBlockHashHex = blockHashHex;

    const { outcome, storageDiff } = await chain.dryRunExtrinsic(
      {
        call: extrinsic.method.toHex(),
        address: senderAddress,
      },
      finalBlockHashHex
    );

    updateStatus('analyzing', 'Analyzing simulation results...', 80);

    const balanceDeltas = await computeBalanceDeltas(
      api,
      senderAddress,
      storageDiff
    );

    const { succeeded, failureReason } = parseOutcome(api, outcome, chainName);
    
    let fee = '0';
    try {
      updateStatus('analyzing', 'Calculating transaction fees...', 90);
      
      if (extrinsic.registry !== api.registry) {
        const errorMsg = `Registry mismatch: extrinsic registry (${extrinsic.registry.constructor.name}) does not match API registry (${api.registry.constructor.name}). This will cause wasm unreachable errors.`;
        throw new Error(errorMsg);
      }

      const { encodeAddress, decodeAddress } = await import('@polkadot/util-crypto');
      const publicKey = decodeAddress(senderAddress);
      const ss58Format = api.registry.chainSS58 || 0;
      const encodedSenderAddress = encodeAddress(publicKey, ss58Format);

      // NOTE: paymentInfo is ONLY used here to get fee estimate, NOT for validation
      // The actual transaction validation was done by Chopsticks dryRunExtrinsic above
      // If paymentInfo fails, we continue without fee (simulation still succeeded)
      const feeInfo = await extrinsic.paymentInfo(encodedSenderAddress);
      fee = feeInfo.partialFee.toString();
    } catch (feeError) {
      // paymentInfo can fail (wasm traps, runtime panics) but simulation already succeeded
      // This is a known limitation - fee calculation is separate from transaction validation
      const errorMessage = feeError instanceof Error ? feeError.message : String(feeError);
      const errorClassification = classifyChopsticksError(errorMessage, 'paymentInfo', chainName);

      if (errorClassification.ignore) {
        // Keep fee as '0' - caller can estimate separately if needed
      } else {
        const cleanError = errorMessage
          .replace(/^4003: Client error: /, '')
          .replace(/^Execution failed: Execution aborted due to trap: /, '')
          .replace(/WASM backtrace:[\s\S]*$/, '')
          .replace(/error while executing at[\s\S]*$/, '')
          .trim();

        return {
          success: false,
          error: `${errorClassification.classification}: ${cleanError}. ${errorClassification.reason || 'This indicates a structural problem with the extrinsic.'}`,
          estimatedFee: '0',
          balanceChanges: [],
          events: [],
        };
      }
    }
    
    try {
      await storage.deleteBlock(finalBlockHashHex);
      await storage.close();
      await chain.close();
    } catch {
      // Ignore cleanup errors
    }
    
    const duration = Date.now() - startTime;
    
    if (succeeded) {
      const balanceChangeText = balanceDeltas.length > 0 
        ? `Balance change: ${balanceDeltas[0].change === 'send' ? '-' : '+'}${balanceDeltas[0].value.toString()}`
        : 'No balance changes';
      updateStatus('complete', `✓ Simulation successful!`, 100, `Validated in ${duration}ms • ${balanceChangeText}`);
    } else {
      updateStatus('error', `✗ Simulation failed: ${failureReason || 'Unknown error'}`, 100);
    }
    
    return {
      success: succeeded,
      error: failureReason,
      estimatedFee: fee,
      balanceChanges: balanceDeltas,
      events: [],
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    updateStatus('error', `✗ Simulation error: ${errorMessage}`, 100);
    
    try {
      if (storage) await storage.close();
      if (chain) await chain.close();
    } catch {
      // Ignore cleanup errors
    }
    
    // Re-throw the error so caller knows Chopsticks failed
    return {
      success: false,
      error: `Chopsticks simulation failed: ${errorMessage}`,
      estimatedFee: '0',
      balanceChanges: [],
      events: [],
    };
  }
}

async function computeBalanceDeltas(
  api: ApiPromise,
  accountAddress: string,
  storageChanges: [HexString, HexString | null][]
): Promise<Array<{ value: BN; change: 'send' | 'receive' }>> {
  const deltas: Array<{ value: BN; change: 'send' | 'receive' }> = [];
  
  try {
    const accountKey = api.query.system.account.key(accountAddress);
    
    for (const [key, newVal] of storageChanges) {
      if (key === accountKey && newVal !== null) {
        const newState: any = api.createType('FrameSystemAccountInfo', newVal);
        const currentState: any = await api.query.system.account(accountAddress);
        
        const currentTotal = currentState.data.free.add(currentState.data.reserved);
        const newTotal = newState.data.free.add(newState.data.reserved);
        
        if (newTotal.gt(currentTotal)) {
          deltas.push({
            change: 'receive',
            value: newTotal.sub(currentTotal),
          });
        } else if (newTotal.lt(currentTotal)) {
          deltas.push({
            change: 'send',
            value: currentTotal.sub(newTotal),
          });
        }
      }
    }
  } catch {
    // Ignore parsing errors
  }
  
  return deltas;
}

function parseOutcome(
  api: ApiPromise,
  outcome: any,
  chainName: string
): { succeeded: boolean; failureReason: string | null } {
  if (outcome.isOk) {
    const result = outcome.asOk;
    
    if (result.isOk) {
      return { succeeded: true, failureReason: null };
    } else {
      const err = result.asErr;
      
      if (err.isModule) {
        const meta = api.registry.findMetaError(err.asModule);
        const msg = `${meta.section}.${meta.name}: ${meta.docs.join(', ')}`;
        return { succeeded: false, failureReason: msg };
      } else if (err.isToken) {
        return { 
          succeeded: false, 
          failureReason: `TokenError: ${err.asToken.type}` 
        };
      } else {
        return { 
          succeeded: false, 
          failureReason: `DispatchError: ${err.type}` 
        };
      }
    }
  } else {
    const invalid = outcome.asErr;
    const invalidType = invalid.type || 'Unknown';
    const invalidDetails = invalid.toString ? invalid.toString() : JSON.stringify(invalid);
    const errorMessage = `InvalidTransaction: ${invalidType} (${invalidDetails})`;

    const errorClassification = classifyChopsticksError(errorMessage, 'dryRun', chainName);

    if (errorClassification.ignore) {
      return {
        succeeded: true,
        failureReason: null
      };
    }

    return {
      succeeded: false,
      failureReason: errorMessage
    };
  }
}

export async function isChopsticksAvailable(): Promise<boolean> {
  try {
    await import('@acala-network/chopsticks-core');
    return true;
  } catch {
    return false;
  }
}
