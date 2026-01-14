/**
 * Sequential Transaction Simulation
 * 
 * Simulates transactions sequentially on a forked chain where each transaction
 * sees the state changes from previous transactions.
 * 
 * Uses Chopsticks in BuildBlockMode.Instant to properly advance chain state.
 */

import type { ApiPromise } from '@polkadot/api';
import type { SubmittableExtrinsic } from '@polkadot/api/types';
import { BN } from '@polkadot/util';
import { encodeAddress, decodeAddress } from '@polkadot/util-crypto';
import { SimulationResult, SimulationStatusCallback } from './chopsticks';
import { createChopsticksDatabase, type Database } from './database';
import { createSubsystemLogger, Subsystem } from '../logger';

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

interface TransactionResult {
  success: boolean;
  error: string | null;
  newBlockHash: string;
  storageDiff: Map<string, any>;
  fee: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

function toHexString(blockHash: any): `0x${string}` {
  if (typeof blockHash === 'string') {
    return blockHash.startsWith('0x') 
      ? (blockHash as `0x${string}`) 
      : (`0x${blockHash}` as `0x${string}`);
  }
  
  if (typeof blockHash === 'object' && blockHash !== null) {
    if ('hash' in blockHash) return toHexString(blockHash.hash);
    if (typeof blockHash.toHex === 'function') {
      const hex = blockHash.toHex();
      return hex.startsWith('0x') ? (hex as `0x${string}`) : (`0x${hex}` as `0x${string}`);
    }
    if (blockHash instanceof Uint8Array) {
      const hex = Array.from(blockHash)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      return `0x${hex}` as `0x${string}`;
    }
  }
  
  throw new Error(`Cannot convert block hash to hex: ${typeof blockHash}`);
}

function parseOutcome(api: ApiPromise, outcome: any): { succeeded: boolean; error: string | null } {
  if (!outcome || !outcome.isOk) {
    const errType = outcome?.asErr?.type || 'Unknown';
    return { succeeded: false, error: `InvalidTransaction: ${errType}` };
  }
  
  const result = outcome.asOk;
  if (result.isOk) return { succeeded: true, error: null };
  
  const err = result.asErr;
  if (err.isModule) {
    const meta = api.registry.findMetaError(err.asModule);
    return { succeeded: false, error: `${meta.section}.${meta.name}` };
  }
  
  return { succeeded: false, error: `DispatchError: ${err.type}` };
}

function extractBlockOutcome(api: ApiPromise, block: any): { succeeded: boolean; error: string | null } {
  try {
    if (block?.extrinsics?.[0]?.result) return parseOutcome(api, block.extrinsics[0].result);
    if (block?.result) return parseOutcome(api, block.result);
    return { succeeded: true, error: null };
  } catch (error) {
    simulationLogger.warn({ 
      error: error instanceof Error ? error.message : String(error)
    }, 'Could not parse block outcome, assuming success');
    // TODO: is it good that we are ussuming success here?
    return { succeeded: true, error: null };
  }
}

function encodeSenderAddress(api: ApiPromise, address: string): string {
  const ss58Format = api.registry.chainSS58 || 0;
  const publicKey = decodeAddress(address);
  return encodeAddress(publicKey, ss58Format);
}

function calculateBalanceDelta(oldState: any, newState: any): { value: BN; change: 'send' | 'receive' } | null {
  if (!oldState || !newState) return null;
  
  const oldTotal = oldState.data.free.add(oldState.data.reserved);
  const newTotal = newState.data.free.add(newState.data.reserved);
  const diff = newTotal.sub(oldTotal);
  
  if (diff.gt(new BN(0))) return { change: 'receive', value: diff };
  if (diff.lt(new BN(0))) return { change: 'send', value: diff.abs() };
  return null;
}

async function queryAccountState(api: ApiPromise, chain: any, accountKey: string, blockHash: string): Promise<any> {
  try {
    const stateRaw = await chain.query(accountKey, blockHash);
    return stateRaw ? api.createType('FrameSystemAccountInfo', stateRaw) : null;
  } catch (err) {
    simulationLogger.warn({ 
      error: err instanceof Error ? err.message : String(err)
    }, 'Could not query account state');
    return null;
  }
}

function getBalanceFromStorageDiff(
  api: ApiPromise,
  storageDiff: Map<string, any>,
  accountKey: string,
  oldState: any
): { value: BN; change: 'send' | 'receive' } | null {
  for (const [key, newVal] of storageDiff) {
    if (key === accountKey && newVal !== null) {
      const newState = api.createType('FrameSystemAccountInfo', newVal);
      return calculateBalanceDelta(oldState, newState);
    }
  }
  return null;
}

async function calculateBalanceChanges(
  api: ApiPromise,
  chain: any,
  encodedSender: string,
  storageDiff: Map<string, any>,
  blockHashBefore: string,
  blockHashAfter: string
): Promise<Array<{ value: BN; change: 'send' | 'receive' }>> {
  const accountKey = api.query.system.account.key(encodedSender);
  const oldState = await queryAccountState(api, chain, accountKey, blockHashBefore);
  
  if (!oldState) return [];
  
  // Try storage diff first
  if (storageDiff.size > 0) {
    const delta = getBalanceFromStorageDiff(api, storageDiff, accountKey, oldState);
    if (delta) return [delta];
  }
  
  // Fallback: query new state from chain
  const newState = await queryAccountState(api, chain, accountKey, blockHashAfter);
  if (!newState) return [];
  
  const delta = calculateBalanceDelta(oldState, newState);
  return delta ? [delta] : [];
}

async function setupChainFork(
  api: ApiPromise,
  endpoints: string[],
  storage: Database,
  updateStatus: (phase: string, message: string, progress?: number) => void
): Promise<any> {
  const { BuildBlockMode, setup } = await import('@acala-network/chopsticks-core');
  
  updateStatus('forking', 'Creating chain fork at latest block...', 10);
  
  return await setup({
    endpoint: endpoints,
    block: undefined,
    buildBlockMode: BuildBlockMode.Instant,
    mockSignatureHost: true,
    db: storage,
  });
}

async function calculateFee(
  extrinsic: SubmittableExtrinsic<'promise'>,
  encodedSender: string
): Promise<string> {
  try {
    const feeInfo = await extrinsic.paymentInfo(encodedSender);
    return feeInfo.partialFee.toString();
  } catch {
    return '0';
  }
}

function createSimulationResult(
  success: boolean,
  error: string | null,
  fee: string,
  balanceChanges: Array<{ value: BN; change: 'send' | 'receive' }>
): SimulationResult {
  return {
    success,
    error,
    estimatedFee: fee,
    balanceChanges,
    events: [],
  };
}

function validateRegistryMatch(extrinsic: SubmittableExtrinsic<'promise'>, api: ApiPromise): void {
  if (extrinsic.registry !== api.registry) {
    const errorMsg = `Registry mismatch: extrinsic registry (${extrinsic.registry.constructor.name}) does not match API registry (${api.registry.constructor.name}). This will cause metadata mismatch errors.`;
    throw new Error(errorMsg);
  }
}

function validateChainMethods(chain: any): void {
  if (typeof chain.newBlock !== 'function') {
    throw new Error('chain.newBlock is not available - sequential simulation requires this method');
  }
}

async function buildBlock(chain: any, extrinsic: SubmittableExtrinsic<'promise'>, index: number): Promise<any> {
  try {
    return await chain.newBlock({
      extrinsics: [extrinsic.toHex()],
    });
  } catch (blockError) {
    const errorMsg = blockError instanceof Error ? blockError.message : String(blockError);
    simulationLogger.error({ 
      blockIndex: index + 1,
      error: errorMsg
    }, `Block ${index + 1} build failed`);
    throw new Error(errorMsg);
  }
}

function createFailureResult(currentBlockHash: string, error: string): TransactionResult {
  return {
    success: false,
    error,
    newBlockHash: currentBlockHash,
    storageDiff: new Map(),
    fee: '0',
  };
}

async function simulateAndBuildTransaction(
  api: ApiPromise,
  chain: any,
  item: SequentialSimulationItem,
  currentBlockHash: string,
  index: number
): Promise<TransactionResult> {
  validateRegistryMatch(item.extrinsic, api);
  validateChainMethods(chain);
  
  const encodedSender = encodeSenderAddress(api, item.senderAddress);
  simulationLogger.debug({ blockIndex: index + 1 }, `Building block ${index + 1}...`);
  
  let block: any;
  try {
    block = await buildBlock(chain, item.extrinsic, index);
  } catch (error) {
    return createFailureResult(currentBlockHash, error instanceof Error ? error.message : String(error));
  }
  
  const newHead = await chain.head;
  const newBlockHash = toHexString(newHead);
  simulationLogger.info({ 
    blockIndex: index + 1,
    blockHash: newBlockHash.slice(0, 12) + '...'
  }, `Block ${index + 1} built`);
  
  const { succeeded, error } = extractBlockOutcome(api, block);
  if (!succeeded) {
    return createFailureResult(newBlockHash, error || 'Transaction failed');
  }
  
  const fee = await calculateFee(item.extrinsic, encodedSender);
  
  return {
    success: true,
    error: null,
    newBlockHash,
    storageDiff: new Map(),
    fee,
  };
}

function aggregateBalanceChanges(
  results: Array<{ result: SimulationResult }>
): Array<{ value: BN; change: 'send' | 'receive' }> {
  const balanceMap = new Map<string, BN>();
  
  for (const { result } of results) {
    for (const delta of result.balanceChanges) {
      const current = balanceMap.get(delta.change) || new BN(0);
      balanceMap.set(delta.change, current.add(delta.value));
    }
  }
  
  const finalBalanceChanges: Array<{ value: BN; change: 'send' | 'receive' }> = [];
  for (const [change, value] of balanceMap.entries()) {
    if (!value.isZero()) {
      finalBalanceChanges.push({ change: change as 'send' | 'receive', value });
    }
  }
  
  return finalBalanceChanges;
}

function validateEndpoints(rpcEndpoints: string | string[]): string[] {
  const allEndpoints = Array.isArray(rpcEndpoints) ? rpcEndpoints : [rpcEndpoints];
  const endpoints = allEndpoints.filter(e => 
    typeof e === 'string' && (e.startsWith('wss://') || e.startsWith('ws://'))
  );
  
  if (endpoints.length === 0) {
    throw new Error('No valid WebSocket endpoints provided');
  }
  
  return endpoints;
}

function createFailureResponse(
  index: number,
  description: string,
  error: string,
  results: Array<{ index: number; description: string; result: SimulationResult }>,
  totalFee: BN
): SequentialSimulationResult {
  return {
    success: false,
    error: `Transaction ${index + 1} (${description}) failed: ${error}`,
    results,
    totalEstimatedFee: totalFee.toString(),
    finalBalanceChanges: [],
  };
}

async function processTransaction(
  api: ApiPromise,
  chain: any,
  item: SequentialSimulationItem,
  currentBlockHash: string,
  index: number
): Promise<{ result: SimulationResult; newBlockHash: string; fee: string }> {
  const simResult = await simulateAndBuildTransaction(api, chain, item, currentBlockHash, index);
  
  if (!simResult.success) {
    const result = createSimulationResult(false, simResult.error, simResult.fee, []);
    return { result, newBlockHash: currentBlockHash, fee: simResult.fee };
  }
  
  const encodedSender = encodeSenderAddress(api, item.senderAddress);
  const balanceChanges = await calculateBalanceChanges(
    api,
    chain,
    encodedSender,
    simResult.storageDiff,
    currentBlockHash,
    simResult.newBlockHash
  );
  
  const result = createSimulationResult(true, null, simResult.fee, balanceChanges);
  return { result, newBlockHash: simResult.newBlockHash, fee: simResult.fee };
}

async function initializeChainFork(
  api: ApiPromise,
  endpoints: string[],
  updateStatus: (phase: string, message: string, progress?: number) => void
): Promise<{ chain: any; storage: Database; startBlockHash: string }> {
  const dbName = `dotbot-sequential-sim:${api.genesisHash.toHex()}`;
  const storage = createChopsticksDatabase(dbName);
  const chain = await setupChainFork(api, endpoints, storage, updateStatus);
  
  const chainHead = await chain.head;
  const startBlockHash = toHexString(chainHead);
  updateStatus('forking', `Fork created at block ${startBlockHash.slice(0, 12)}...`, 15);
  
  return { chain, storage, startBlockHash };
}

async function cleanupResources(
  startBlockHash: string | null,
  storage: Database | null,
  chain: any
): Promise<void> {
  try {
    if (startBlockHash && storage) {
      await storage.deleteBlock(startBlockHash as `0x${string}`);
    }
    if (storage) await storage.close();
    if (chain) await chain.close();
  } catch (cleanupError) {
    simulationLogger.warn({ 
      error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
    }, 'Cleanup warning');
  }
}

// =============================================================================
// Main Function
// =============================================================================

export async function simulateSequentialTransactions(
  api: ApiPromise,
  rpcEndpoints: string | string[],
  items: SequentialSimulationItem[],
  onStatusUpdate?: SimulationStatusCallback
): Promise<SequentialSimulationResult> {
  let chain: any = null;
  let storage: Database | null = null;
  let startBlockHash: string | null = null;
  
  const updateStatus = (phase: string, message: string, progress?: number) => {
    if (onStatusUpdate) {
      onStatusUpdate({ 
        phase: phase as any, 
        message, 
        progress,
        details: `Simulating ${items.length} transactions sequentially`
      });
    }
    simulationLogger.debug({ 
    progress: progress !== undefined ? progress : undefined
  }, message);
  };
  
  try {
    const endpoints = validateEndpoints(rpcEndpoints);
    updateStatus('initializing', `Preparing sequential simulation for ${items.length} transactions...`, 5);
    
    const fork = await initializeChainFork(api, endpoints, updateStatus);
    chain = fork.chain;
    storage = fork.storage;
    startBlockHash = fork.startBlockHash;
    
    const results: Array<{ index: number; description: string; result: SimulationResult }> = [];
    let currentBlockHash = startBlockHash;
    let totalFee = new BN(0);
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const progress = 15 + Math.floor((i / items.length) * 75);
      updateStatus('executing', `Simulating transaction ${i + 1}/${items.length}: ${item.description}`, progress);
      
      try {
        const { result, newBlockHash, fee } = await processTransaction(
          api,
          chain,
          item,
          currentBlockHash,
          i
        );
        
        if (!result.success) {
          results.push({ index: i, description: item.description, result });
          updateStatus('error', `Transaction ${i + 1} failed: ${result.error}`, 100);
          return createFailureResponse(i, item.description, result.error || 'Unknown error', results, totalFee);
        }
        
        currentBlockHash = newBlockHash;
        totalFee = totalFee.add(new BN(fee));
        results.push({ index: i, description: item.description, result });
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        simulationLogger.error({ 
          transactionIndex: i + 1,
          error: error instanceof Error ? error.message : String(error)
        }, `Transaction ${i + 1} error`);
        
        const result = createSimulationResult(false, errorMsg, '0', []);
        results.push({ index: i, description: item.description, result });
        updateStatus('error', `Transaction ${i + 1} failed: ${errorMsg}`, 100);
        
        return createFailureResponse(i, item.description, errorMsg, results, totalFee);
      }
    }
    
    updateStatus('complete', `✓ All ${items.length} transactions simulated successfully!`, 100);
    
    return {
      success: true,
      error: null,
      results,
      totalEstimatedFee: totalFee.toString(),
      finalBalanceChanges: aggregateBalanceChanges(results),
    };
    
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    simulationLogger.error({ 
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    }, 'Fatal error');
    updateStatus('error', `✗ Sequential simulation error: ${errorMessage}`, 100);
    
    return {
      success: false,
      error: `Sequential simulation failed: ${errorMessage}`,
      results: [],
      totalEstimatedFee: '0',
      finalBalanceChanges: [],
    };
  } finally {
    await cleanupResources(startBlockHash, storage, chain);
  }
}
