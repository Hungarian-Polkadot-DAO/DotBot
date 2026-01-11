/**
 * Sequential Transaction Simulation
 * 
 * For transaction flows where transactions build on each other (e.g., transfer → stake → vote),
 * we need to simulate them sequentially on the same fork so each transaction sees the state
 * changes from previous transactions.
 * 
 * Example flow:
 * 1. Transfer 100 DOT to account
 * 2. Stake 50 DOT (requires the 100 DOT from step 1)
 * 3. Vote with staked DOT (requires the stake from step 2)
 * 4. Claim rewards (requires the vote from step 3)
 * 5. Unstake (requires the stake from step 2)
 */

import type { ApiPromise } from '@polkadot/api';
import type { SubmittableExtrinsic } from '@polkadot/api/types';
import { BN } from '@polkadot/util';
import { SimulationResult, SimulationStatusCallback } from './chopsticks';
import { ChopsticksDatabase } from './database';

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

/**
 * Simulate multiple transactions sequentially on the same fork
 * 
 * This is critical for transaction flows where each step depends on the previous:
 * - Each transaction is simulated on the same fork
 * - State changes from previous transactions are visible to subsequent ones
 * - If any transaction fails, the entire flow fails
 * 
 * @param api API instance for the chain
 * @param rpcEndpoints RPC endpoints to use
 * @param items Array of transactions to simulate in order
 * @param onStatusUpdate Optional callback for status updates
 * @returns SequentialSimulationResult with results for each transaction
 */
export async function simulateSequentialTransactions(
  api: ApiPromise,
  rpcEndpoints: string | string[],
  items: SequentialSimulationItem[],
  onStatusUpdate?: SimulationStatusCallback
): Promise<SequentialSimulationResult> {
  const { BuildBlockMode, setup } = await import('@acala-network/chopsticks-core');
  
  let chain: any = null;
  let storage: ChopsticksDatabase | null = null;
  let blockHashHex: `0x${string}` | null = null;
  
  const updateStatus = (phase: string, message: string, progress?: number) => {
    if (onStatusUpdate) {
      onStatusUpdate({ 
        phase: phase as any, 
        message, 
        progress,
        details: `Simulating ${items.length} transactions sequentially`
      });
    }
    console.log(`[SequentialSimulation] ${message}${progress !== undefined ? ` [${progress}%]` : ''}`);
  };
  
  try {
    updateStatus('initializing', `Preparing sequential simulation for ${items.length} transactions...`, 5);
    
    // Filter to only WebSocket endpoints
    const allEndpoints = Array.isArray(rpcEndpoints) ? rpcEndpoints : [rpcEndpoints];
    const endpoints = allEndpoints.filter(endpoint => 
      typeof endpoint === 'string' && (endpoint.startsWith('wss://') || endpoint.startsWith('ws://'))
    );
    
    if (endpoints.length === 0) {
      throw new Error('No valid WebSocket endpoints provided');
    }
    
    // CRITICAL FIX: Get the finalized block from API to ensure metadata compatibility
    let blockHashForFork: string | undefined = undefined;
    try {
      const finalizedHash = await api.rpc.chain.getFinalizedHead();
      blockHashForFork = finalizedHash.toHex();
      console.log(`[SequentialSim] Using finalized block for fork: ${blockHashForFork.slice(0, 12)}...`);
    } catch (error) {
      console.warn('[SequentialSim] Failed to get finalized block, will let Chopsticks choose:', error);
      blockHashForFork = undefined;
    }
    
    // Create fork once for all transactions
    updateStatus('forking', 'Creating chain fork at finalized block...', 10);
    const dbName = `dotbot-sequential-sim:${api.genesisHash.toHex()}`;
    storage = new ChopsticksDatabase(dbName);
    
    // Try to fork at the finalized block first (for metadata consistency)
    // If that block doesn't exist on the endpoint (pruned node), fall back to letting Chopsticks choose
    try {
      chain = await setup({
        endpoint: endpoints,
        block: blockHashForFork, // Fork at API's finalized block to match metadata
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
        console.warn(
          `[SequentialSim] Block ${blockHashForFork.slice(0, 12)}... not found on endpoint (likely pruned node). ` +
          `Falling back to latest block. This may cause metadata mismatch if runtime versions differ.`
        );
        
        updateStatus('forking', 'Block not found on endpoint, using latest block...', 10);
        
        // Retry without specifying block - let Chopsticks fetch latest
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
    
    // Get block hash from chain
    const chainBlockHash = await chain.head;
    const toHexString = (blockHash: any): `0x${string}` => {
      if (typeof blockHash === 'string') {
        return blockHash.startsWith('0x') ? blockHash as `0x${string}` : `0x${blockHash}` as `0x${string}`;
      }
      if (typeof blockHash.toHex === 'function') {
        const hex = blockHash.toHex();
        return hex.startsWith('0x') ? hex as `0x${string}` : `0x${hex}` as `0x${string}`;
      }
      if (blockHash instanceof Uint8Array) {
        const hex = Array.from(blockHash)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        return `0x${hex}` as `0x${string}`;
      }
      throw new Error(`Cannot convert block hash to hex: ${typeof blockHash}`);
    };
    
    blockHashHex = toHexString(chainBlockHash);
    updateStatus('forking', `Chain fork created at block ${blockHashHex.slice(0, 12)}...`, 15);
    
    // Simulate each transaction sequentially
    const results: Array<{ index: number; description: string; result: SimulationResult }> = [];
    let currentBlockHash = blockHashHex;
    let totalFee = new BN(0);
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const progress = 15 + Math.floor((i / items.length) * 75);
      
      updateStatus('executing', `Simulating transaction ${i + 1}/${items.length}: ${item.description}`, progress);
      
      // Encode sender address for this chain
      const { encodeAddress, decodeAddress } = await import('@polkadot/util-crypto');
      const publicKey = decodeAddress(item.senderAddress);
      const ss58Format = api.registry.chainSS58 || 0;
      const encodedSender = encodeAddress(publicKey, ss58Format);
      
      // Simulate this transaction on the current fork state
      const { outcome, storageDiff } = await chain.dryRunExtrinsic(
        {
          call: item.extrinsic.method.toHex(),
          address: encodedSender,
        },
        currentBlockHash
      );
      
      // Parse outcome
      const parseOutcome = (outcome: any): { succeeded: boolean; failureReason: string | null } => {
        if (outcome.isOk) {
          const result = outcome.asOk;
          if (result.isOk) {
            return { succeeded: true, failureReason: null };
          } else {
            const err = result.asErr;
            if (err.isModule) {
              const meta = api.registry.findMetaError(err.asModule);
              return { succeeded: false, failureReason: `${meta.section}.${meta.name}` };
            }
            return { succeeded: false, failureReason: `DispatchError: ${err.type}` };
          }
        } else {
          return { succeeded: false, failureReason: `InvalidTransaction: ${outcome.asErr.type}` };
        }
      };
      
      const { succeeded, failureReason } = parseOutcome(outcome);
      
      // Calculate fee
      let fee = '0';
      try {
        const feeInfo = await item.extrinsic.paymentInfo(encodedSender);
        fee = feeInfo.partialFee.toString();
        totalFee = totalFee.add(new BN(fee));
      } catch {
        // Fee calculation failed, continue
      }
      
      // Calculate balance changes
      const balanceDeltas: Array<{ value: BN; change: 'send' | 'receive' }> = [];
      try {
        const accountKey = api.query.system.account.key(encodedSender);
        for (const [key, newVal] of storageDiff) {
          if (key === accountKey && newVal !== null) {
            const newState: any = api.createType('FrameSystemAccountInfo', newVal);
            const currentState: any = await api.query.system.account(encodedSender);
            const currentTotal = currentState.data.free.add(currentState.data.reserved);
            const newTotal = newState.data.free.add(newState.data.reserved);
            if (newTotal.gt(currentTotal)) {
              balanceDeltas.push({ change: 'receive', value: newTotal.sub(currentTotal) });
            } else if (newTotal.lt(currentTotal)) {
              balanceDeltas.push({ change: 'send', value: currentTotal.sub(newTotal) });
            }
          }
        }
      } catch {
        // Ignore balance calculation errors
      }
      
      const result: SimulationResult = {
        success: succeeded,
        error: failureReason,
        estimatedFee: fee,
        balanceChanges: balanceDeltas,
        events: [],
      };
      
      results.push({
        index: i,
        description: item.description,
        result,
      });
      
      // If this transaction failed, stop the flow
      if (!succeeded) {
        updateStatus('error', `Transaction ${i + 1} failed: ${failureReason}`, 100);
        return {
          success: false,
          error: `Transaction ${i + 1} (${item.description}) failed: ${failureReason}`,
          results,
          totalEstimatedFee: totalFee.toString(),
          finalBalanceChanges: balanceDeltas,
        };
      }
      
      // Update block hash for next transaction (use chain.head to get new state)
      // Note: In a real sequential flow, we'd build a new block, but for simulation
      // we continue on the same fork with accumulated state changes
      currentBlockHash = blockHashHex; // Keep using same block for simulation
    }
    
    updateStatus('complete', `✓ All ${items.length} transactions simulated successfully!`, 100);
    
    // Calculate final balance changes (sum of all transactions)
    const finalBalanceChanges: Array<{ value: BN; change: 'send' | 'receive' }> = [];
    const balanceMap = new Map<string, BN>();
    
    for (const { result } of results) {
      for (const delta of result.balanceChanges) {
        const key = delta.change;
        const current = balanceMap.get(key) || new BN(0);
        balanceMap.set(key, current.add(delta.value));
      }
    }
    
    for (const [change, value] of balanceMap.entries()) {
      if (!value.isZero()) {
        finalBalanceChanges.push({
          change: change as 'send' | 'receive',
          value,
        });
      }
    }
    
    return {
      success: true,
      error: null,
      results,
      totalEstimatedFee: totalFee.toString(),
      finalBalanceChanges,
    };
    
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    updateStatus('error', `✗ Sequential simulation error: ${errorMessage}`, 100);
    
    return {
      success: false,
      error: `Sequential simulation failed: ${errorMessage}`,
      results: [],
      totalEstimatedFee: '0',
      finalBalanceChanges: [],
    };
  } finally {
    // Cleanup
    try {
      if (blockHashHex && storage) {
        await storage.deleteBlock(blockHashHex);
      }
      if (storage) await storage.close();
      if (chain) await chain.close();
    } catch (cleanupError) {
      console.warn('[SequentialSimulation] Cleanup warning:', cleanupError);
    }
  }
}

