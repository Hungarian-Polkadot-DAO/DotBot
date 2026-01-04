/**
 * Transaction Simulation Service
 * Fork-based transaction validation using Chopsticks
 */

import type { ApiPromise } from '@polkadot/api';
import type { SubmittableExtrinsic } from '@polkadot/api/types';
import type { HexString } from '@polkadot/util/types';
import { BN } from '@polkadot/util';

import { ChopsticksDatabase } from './database';

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
  let storage: ChopsticksDatabase | null = null;
  
  const updateStatus = (phase: 'initializing' | 'forking' | 'executing' | 'analyzing' | 'complete' | 'error', message: string, progress?: number, details?: string) => {
    if (onStatusUpdate) {
      onStatusUpdate({ phase, message, progress, details });
    }
    
    // Enhanced console output with emojis and formatting
    const emoji = {
      initializing: '🔧',
      forking: '🌿',
      executing: '⚡',
      analyzing: '🔍',
      complete: '✅',
      error: '❌'
    }[phase];
    
    const progressBar = progress !== undefined 
      ? ` [${'█'.repeat(Math.floor(progress / 10))}${'░'.repeat(10 - Math.floor(progress / 10))}] ${progress}%`
      : '';
    
    const detailsText = details ? ` • ${details}` : '';
    
    console.log(`${emoji} [Chopsticks] ${message}${progressBar}${detailsText}`);
  };
  
  try {
    updateStatus('initializing', 'Preparing transaction simulation...', 10);
    
    const { BuildBlockMode, setup } = await import('@acala-network/chopsticks-core');
    
    updateStatus('initializing', 'Setting up simulation environment...', 20);
    const dbName = `dotbot-sim-cache:${api.genesisHash.toHex()}`;
    storage = new ChopsticksDatabase(dbName);
    
    updateStatus('forking', 'Fetching current blockchain state...', 30);
    
    // Filter to only WebSocket endpoints (wss:// or ws://) - Chopsticks requires WebSocket
    const allEndpoints = Array.isArray(rpcEndpoints) ? rpcEndpoints : [rpcEndpoints];
    const endpoints = allEndpoints.filter(endpoint => 
      typeof endpoint === 'string' && (endpoint.startsWith('wss://') || endpoint.startsWith('ws://'))
    );
    
    if (endpoints.length === 0) {
      throw new Error('No valid WebSocket endpoints provided. Chopsticks requires WebSocket (wss://) endpoints, not HTTP (https://)');
    }
    
    if (endpoints.length < allEndpoints.length) {
      console.warn(`[Chopsticks] Filtered out ${allEndpoints.length - endpoints.length} HTTP endpoint(s), using ${endpoints.length} WebSocket endpoint(s)`);
    }
    
    // CRITICAL: Always let Chopsticks fetch the latest block from the RPC endpoint
    // DO NOT use api.rpc.chain.getBlockHash() because:
    // 1. The API instance might have a cached/stale block hash
    // 2. That block might not exist on the endpoint (pruned node)
    // 3. This causes "Cannot find header" errors in Chopsticks
    //
    // By passing undefined, Chopsticks will fetch the latest block from the endpoint,
    // ensuring we always use a block that exists.
    
    updateStatus('forking', 'Creating chain fork (fetching latest block from endpoint)...', 40);
    
    chain = await setup({
      endpoint: endpoints,
      block: undefined, // Let Chopsticks fetch latest block from endpoint
      buildBlockMode: BuildBlockMode.Batch,
      mockSignatureHost: true,
      db: storage,
    });
    
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
      
      // Last resort: try to get hex representation
      console.warn('[Chopsticks] Unexpected block hash type:', typeof blockHash, blockHash);
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
        } catch (headerError) {
          // If getHeader fails, just log the hash without block number
          console.warn('[Chopsticks] Could not get block number, using hash only:', headerError);
          updateStatus('forking', `Chain fork created...`, 45, `Block: ${blockHashHex.slice(0, 12)}...`);
        }
      }
    } catch (err) {
      console.error('[Chopsticks] Failed to get block info from chain:', err);
      throw new Error(`Failed to get block hash from chain: ${err instanceof Error ? err.message : String(err)}`);
    }
    
    // Ensure we have a valid block hash
    if (!blockHashHex) {
      throw new Error('Failed to get block hash from chain');
    }
    
    updateStatus('executing', 'Simulating transaction execution...', 60, 'Running on forked chain state');
    
    // CRITICAL: Validate extrinsic registry matches API registry before simulation
    if (extrinsic.registry !== api.registry) {
      const errorMsg = `Registry mismatch: extrinsic registry (${extrinsic.registry.constructor.name}) does not match API registry (${api.registry.constructor.name}). This will cause wasm unreachable errors.`;
      console.error('[Chopsticks] Registry mismatch detected before simulation:', {
        extrinsicRegistry: extrinsic.registry.constructor.name,
        apiRegistry: api.registry.constructor.name,
        extrinsicChainSS58: extrinsic.registry.chainSS58,
        apiChainSS58: api.registry.chainSS58,
        method: `${extrinsic.method.section}.${extrinsic.method.method}`,
      });
      throw new Error(errorMsg);
    }
    
    // Use the block hash we got from the chain
    const finalBlockHashHex = blockHashHex;
    
    // Enhanced logging before dryRunExtrinsic
    console.log('[Chopsticks] Calling dryRunExtrinsic with:', {
      method: `${extrinsic.method.section}.${extrinsic.method.method}`,
      callIndex: Array.from(extrinsic.method.toU8a().slice(0, 2)),
      callHex: extrinsic.method.toHex().slice(0, 32) + '...',
      senderAddress,
      blockHash: finalBlockHashHex.slice(0, 16) + '...',
      registryMatch: extrinsic.registry === api.registry,
    });
    
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
    
    // Enhanced logging of outcome
    console.log('[Chopsticks] Simulation outcome:', {
      isOk: outcome.isOk,
      resultType: outcome.isOk ? (outcome.asOk?.isOk ? 'Ok' : 'Err') : 'Invalid',
      outcomeString: outcome.toString ? outcome.toString().slice(0, 200) : 'N/A',
    });
    
    const { succeeded, failureReason } = parseOutcome(api, outcome);
    
    // If simulation passed but we'll fail on paymentInfo, log warning
    if (succeeded) {
      console.log('[Chopsticks] ✓ dryRunExtrinsic passed, proceeding to paymentInfo validation...');
    } else {
      console.error('[Chopsticks] ✗ dryRunExtrinsic failed:', failureReason);
    }
    
    let fee = '0';
    try {
      updateStatus('analyzing', 'Calculating transaction fees...', 90);
      
      // CRITICAL: Validate extrinsic registry matches API registry before paymentInfo
      if (extrinsic.registry !== api.registry) {
        const errorMsg = `Registry mismatch: extrinsic registry (${extrinsic.registry.constructor.name}) does not match API registry (${api.registry.constructor.name}). This will cause wasm unreachable errors.`;
        console.error('[Chopsticks] Registry mismatch detected:', {
          extrinsicRegistry: extrinsic.registry.constructor.name,
          apiRegistry: api.registry.constructor.name,
          extrinsicChainSS58: extrinsic.registry.chainSS58,
          apiChainSS58: api.registry.chainSS58,
        });
        throw new Error(errorMsg);
      }
      
      // Ensure sender address is properly encoded for this chain
      const { encodeAddress, decodeAddress } = await import('@polkadot/util-crypto');
      const publicKey = decodeAddress(senderAddress);
      const ss58Format = api.registry.chainSS58 || 0;
      const encodedSenderAddress = encodeAddress(publicKey, ss58Format);
      
      // Enhanced logging before paymentInfo
      console.log('[Chopsticks] Calling paymentInfo with:', {
        method: `${extrinsic.method.section}.${extrinsic.method.method}`,
        callIndex: Array.from(extrinsic.method.toU8a().slice(0, 2)),
        senderAddress: encodedSenderAddress,
        registryMatch: extrinsic.registry === api.registry,
      });
      
      const feeInfo = await extrinsic.paymentInfo(encodedSenderAddress);
      fee = feeInfo.partialFee.toString();
    } catch (feeError) {
      const errorMessage = feeError instanceof Error ? feeError.message : String(feeError);
      const errorLower = errorMessage.toLowerCase();
      
      // CRITICAL: If paymentInfo fails with wasm unreachable, the extrinsic is malformed
      // This will also fail on the real network, so we must fail the simulation
      const isWasmUnreachable = 
        errorLower.includes('unreachable') ||
        errorLower.includes('wasm trap') ||
        errorLower.includes('transactionpaymentapi') ||
        errorLower.includes('taggedtransactionqueue');
      
      if (isWasmUnreachable) {
        // Get detailed extrinsic information for debugging
        let extrinsicDetails: any = {};
        try {
          extrinsicDetails = {
            method: `${extrinsic.method.section}.${extrinsic.method.method}`,
            callIndex: Array.from(extrinsic.method.toU8a().slice(0, 2)),
            callHex: extrinsic.method.toHex(),
            args: extrinsic.method.args.map((arg: any, idx: number) => {
              try {
                return {
                  index: idx,
                  type: arg.constructor.name,
                  value: arg.toString ? arg.toString() : (arg.toHuman ? JSON.stringify(arg.toHuman()) : String(arg)),
                  raw: arg.toHex ? arg.toHex() : 'N/A',
                };
              } catch {
                return { index: idx, error: 'Could not serialize argument' };
              }
            }),
            registry: {
              name: extrinsic.registry.constructor.name,
              chainSS58: extrinsic.registry.chainSS58,
              specName: (() => {
                try {
                  const props = extrinsic.registry.getChainProperties();
                  if (props && props.tokenSymbol && props.tokenSymbol.isSome) {
                    const symbols = props.tokenSymbol.unwrap();
                    return symbols[0]?.toString() || 'unknown';
                  }
                  return 'unknown';
                } catch {
                  return 'unknown';
                }
              })(),
            },
            apiRegistry: {
              name: api.registry.constructor.name,
              chainSS58: api.registry.chainSS58,
              specName: (() => {
                try {
                  const props = api.registry.getChainProperties();
                  if (props && props.tokenSymbol && props.tokenSymbol.isSome) {
                    const symbols = props.tokenSymbol.unwrap();
                    return symbols[0]?.toString() || 'unknown';
                  }
                  return 'unknown';
                } catch {
                  return 'unknown';
                }
              })(),
            },
            registryMatch: extrinsic.registry === api.registry,
            toHuman: extrinsic.toHuman ? extrinsic.toHuman() : 'N/A',
          };
        } catch (detailError) {
          extrinsicDetails = { error: 'Could not extract extrinsic details', detailError };
        }
        
        console.error('[Chopsticks] ✗ paymentInfo failed with wasm unreachable - extrinsic is malformed:', errorMessage);
        console.error('[Chopsticks] Extrinsic details:', JSON.stringify(extrinsicDetails, null, 2));
        
        // Fail the simulation - this extrinsic will fail on real network
        // Extract clean error message (remove RPC wrapper and WASM backtrace)
        const cleanError = errorMessage
          .replace(/^4003: Client error: /, '')
          .replace(/^Execution failed: Execution aborted due to trap: /, '')
          .replace(/WASM backtrace:.*$/s, '') // Remove WASM backtrace (multiline)
          .replace(/error while executing at.*$/s, '') // Remove execution trace
          .trim();
        
        return {
          success: false,
          error: `Extrinsic is malformed: ${cleanError}. The transaction structure is invalid for this chain's runtime and will fail on the real network.`,
          estimatedFee: '0',
          balanceChanges: [],
          events: [],
        };
      }
      
      // Non-critical paymentInfo failure (e.g., network error) - log warning but continue
      console.warn('[Chopsticks] Fee estimation failed (non-critical, simulation passed):', errorMessage);
      // Keep fee as '0' - caller can estimate separately if needed
    }
    
    // Cleanup
    try {
      await storage.deleteBlock(finalBlockHashHex);
      await storage.close();
      await chain.close();
    } catch (cleanupError) {
      console.warn('[Chopsticks] Cleanup warning:', cleanupError);
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
    
    // Attempt cleanup even on error
    try {
      if (storage) await storage.close();
      if (chain) await chain.close();
    } catch (cleanupError) {
      console.warn('[Chopsticks] Cleanup error:', cleanupError);
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
  outcome: any
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
    
    // Enhanced error message for InvalidTransaction
    console.error('[Chopsticks] InvalidTransaction detected:', {
      type: invalidType,
      details: invalidDetails,
      fullOutcome: outcome.toString ? outcome.toString() : 'N/A',
    });
    
    return { 
      succeeded: false, 
      failureReason: `InvalidTransaction: ${invalidType} (${invalidDetails})` 
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
