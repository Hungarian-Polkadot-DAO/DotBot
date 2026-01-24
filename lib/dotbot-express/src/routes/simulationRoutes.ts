/**
 * Simulation Routes
 * 
 * Express routes for Chopsticks transaction simulation.
 * This handles simulation requests from clients (frontend or backend).
 * 
 * NOTE: This module only runs in Node.js/backend environment.
 * Frontend should use the client (chopsticksClient.ts) to connect to these routes.
 */

import type { ApiPromise } from '@polkadot/api';
import type { HexString } from '@polkadot/util/types';
import { BN } from '@polkadot/util';
import { ApiPromise as ApiPromiseClass, WsProvider } from '@polkadot/api';
import { createChopsticksDatabase, type Database } from '@dotbot/core/services/simulation/database';
import { classifyChopsticksError } from '@dotbot/core/services/simulation/chopsticksIgnorePolicy';
import { createSubsystemLogger, Subsystem } from '@dotbot/core/services/logger';
import { setup, BuildBlockMode } from '@acala-network/chopsticks-core';
import { Router, Request, Response } from 'express';

const simulationLogger = createSubsystemLogger(Subsystem.SIMULATION);
const router = Router();

export interface SimulationRequest {
  rpcEndpoints: string[];
  extrinsicHex: string;
  senderAddress: string;
  blockHash?: string; // Optional: fork at specific block
  buildBlockMode?: 'Batch' | 'Instant'; // Default: 'Batch'
}

export interface SimulationResponse {
  success: boolean;
  error: string | null;
  estimatedFee: string;
  balanceChanges: Array<{
    value: string; // BN as string
    change: 'send' | 'receive';
  }>;
  events: any[];
}

export interface SequentialSimulationRequest {
  rpcEndpoints: string[];
  items: Array<{
    extrinsicHex: string;
    senderAddress: string;
    description: string;
  }>;
  buildBlockMode?: 'Batch' | 'Instant'; // Default: 'Instant' for sequential
}

export interface SequentialSimulationResponse {
  success: boolean;
  error: string | null;
  results: Array<{
    index: number;
    description: string;
    result: SimulationResponse;
  }>;
  totalEstimatedFee: string;
  finalBalanceChanges: Array<{
    value: string;
    change: 'send' | 'receive';
  }>;
}

/**
 * Simulate a single transaction
 */
async function simulateTransactionInternal(
  api: ApiPromise,
  request: SimulationRequest
): Promise<SimulationResponse> {
  let chain: any = null;
  let storage: Database | null = null;

  try {
    // Validate endpoints
    const endpoints = request.rpcEndpoints.filter(e => 
      typeof e === 'string' && (e.startsWith('wss://') || e.startsWith('ws://'))
    );
    
    if (endpoints.length === 0) {
      throw new Error('No valid WebSocket endpoints provided');
    }

    // Create database
    const dbName = `dotbot-sim-cache:${api.genesisHash.toHex()}`;
    storage = createChopsticksDatabase(dbName);

    // Setup chain fork
    const buildBlockMode = request.buildBlockMode === 'Instant' 
      ? BuildBlockMode.Instant 
      : BuildBlockMode.Batch;

    chain = await setup({
      endpoint: endpoints,
      block: request.blockHash,
      buildBlockMode,
      mockSignatureHost: true,
      db: storage,
    });

    // Get block hash from chain
    const chainHead = await chain.head;
    const blockHashHex = toHexString(chainHead);

    // Decode extrinsic from hex
    // NOTE: The extrinsic hex should be the method call hex, not the full extrinsic
    // If it's a full extrinsic, we need to extract the method
    let callHex: string;
    let extrinsicForFee: any = null;
    try {
      // Try to decode as full extrinsic first
      const extrinsic = api.createType('Extrinsic', request.extrinsicHex);
      callHex = extrinsic.method.toHex();
      extrinsicForFee = extrinsic; // Save for fee calculation
    } catch {
      // If that fails, assume it's already the method call hex
      callHex = request.extrinsicHex;
      
      // Reconstruct extrinsic from method call hex for fee calculation
      try {
        // Decode the call hex as a Call type
        const call = api.createType('Call', callHex);
        // Extract method details from the call
        const callMethod = call as any;
        if (callMethod.section && callMethod.method) {
          // Reconstruct using api.tx[section][method](...args)
          const txMethod = (api.tx as any)[callMethod.section]?.[callMethod.method];
          if (txMethod) {
            // Get the args from the call - decode them properly
            const args: any[] = [];
            if (callMethod.args && callMethod.args.length > 0) {
              for (let i = 0; i < callMethod.args.length; i++) {
                const arg = callMethod.args[i];
                // Convert the arg to its native type (not hex)
                args.push(arg);
              }
            }
            extrinsicForFee = txMethod(...args);
          }
        }
      } catch (reconstructError) {
        // If reconstruction fails, we'll skip fee calculation
        simulationLogger.debug({ 
          error: reconstructError instanceof Error ? reconstructError.message : String(reconstructError)
        }, 'Could not reconstruct extrinsic for fee calculation, will skip');
      }
    }

    // Execute simulation
    const { outcome, storageDiff } = await chain.dryRunExtrinsic(
      {
        call: callHex,
        address: request.senderAddress,
      },
      blockHashHex
    );

    // Parse outcome
    const chainName = (await api.rpc.system.chain()).toString();
    const { succeeded, failureReason } = parseOutcome(api, outcome, chainName);

    // Calculate balance changes
    const balanceDeltas = await computeBalanceDeltas(
      api,
      request.senderAddress,
      storageDiff
    );

    // Calculate fee (try, but don't fail if it doesn't work)
    let fee = '0';
    if (extrinsicForFee) {
      try {
        const { encodeAddress, decodeAddress } = await import('@polkadot/util-crypto');
        const publicKey = decodeAddress(request.senderAddress);
        const ss58Format = api.registry.chainSS58 || 0;
        const encodedSenderAddress = encodeAddress(publicKey, ss58Format);
        
        const feeInfo = await extrinsicForFee.paymentInfo(encodedSenderAddress);
        fee = feeInfo.partialFee.toString();
      } catch (feeError) {
        // Fee calculation can fail, but simulation already succeeded
        const errorMessage = feeError instanceof Error ? feeError.message : String(feeError);
        const errorClassification = classifyChopsticksError(errorMessage, 'paymentInfo', chainName);
        
        if (!errorClassification.ignore) {
          return {
            success: false,
            error: `${errorClassification.classification}: ${errorMessage}`,
            estimatedFee: '0',
            balanceChanges: [],
            events: [],
          };
        }
      }
    }

    // Cleanup
    await storage.deleteBlock(blockHashHex);
    await storage.close();
    await chain.close();

    return {
      success: succeeded,
      error: failureReason,
      estimatedFee: fee,
      balanceChanges: balanceDeltas.map(d => ({
        value: d.value.toString(),
        change: d.change,
      })),
      events: [],
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    simulationLogger.error({ error: errorMessage }, 'Simulation failed');
    
    // Cleanup on error
    try {
      if (storage) await storage.close();
      if (chain) await chain.close();
    } catch (cleanupError) {
      simulationLogger.warn({ error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) }, 'Cleanup error');
    }

    return {
      success: false,
      error: `Chopsticks simulation failed: ${errorMessage}`,
      estimatedFee: '0',
      balanceChanges: [],
      events: [],
    };
  }
}

/**
 * Simulate sequential transactions
 */
async function simulateSequentialTransactionsInternal(
  api: ApiPromise,
  request: SequentialSimulationRequest
): Promise<SequentialSimulationResponse> {
  let chain: any = null;
  let storage: Database | null = null;
  let startBlockHash: string | null = null;

  try {
    // Validate endpoints
    const endpoints = request.rpcEndpoints.filter(e => 
      typeof e === 'string' && (e.startsWith('wss://') || e.startsWith('ws://'))
    );
    
    if (endpoints.length === 0) {
      throw new Error('No valid WebSocket endpoints provided');
    }

    // Create database
    const dbName = `dotbot-sequential-sim:${api.genesisHash.toHex()}`;
    storage = createChopsticksDatabase(dbName);

    // Setup chain fork (use Instant mode for sequential)
    const buildBlockMode = request.buildBlockMode === 'Batch' 
      ? BuildBlockMode.Batch 
      : BuildBlockMode.Instant;

    chain = await setup({
      endpoint: endpoints,
      block: undefined,
      buildBlockMode,
      mockSignatureHost: true,
      db: storage,
    });

    const chainHead = await chain.head;
    startBlockHash = toHexString(chainHead);

    const results: Array<{ index: number; description: string; result: SimulationResponse }> = [];
    const currentBlockHash = startBlockHash;
    let totalFee = new BN(0);

    for (let i = 0; i < request.items.length; i++) {
      const item = request.items[i];
      
      // Decode extrinsic and get full extrinsic hex for chain.newBlock
      // NOTE: The client sends method call hex, but chain.newBlock needs full extrinsic
      let extrinsicHex: string;
      let extrinsicForFee: any = null;
      try {
        // Try to decode as full extrinsic first
        const extrinsic = api.createType('Extrinsic', item.extrinsicHex);
        extrinsicHex = extrinsic.toHex();
        extrinsicForFee = extrinsic; // Save for fee calculation
      } catch {
        // If that fails, assume it's a method call hex
        // Reconstruct full extrinsic from method call hex
        try {
          const call = api.createType('Call', item.extrinsicHex);
          const callMethod = call as any;
          if (callMethod.section && callMethod.method) {
            const txMethod = (api.tx as any)[callMethod.section]?.[callMethod.method];
            if (txMethod) {
              const args: any[] = [];
              if (callMethod.args && callMethod.args.length > 0) {
                for (let j = 0; j < callMethod.args.length; j++) {
                  args.push(callMethod.args[j]);
                }
              }
              extrinsicForFee = txMethod(...args);
              extrinsicHex = extrinsicForFee.toHex();
            } else {
              // If we can't reconstruct, use the call hex directly (may fail)
              extrinsicHex = item.extrinsicHex;
            }
          } else {
            extrinsicHex = item.extrinsicHex;
          }
        } catch (reconstructError) {
          // If reconstruction fails, use the hex as-is (may cause errors)
          simulationLogger.warn({ 
            error: reconstructError instanceof Error ? reconstructError.message : String(reconstructError)
          }, 'Could not reconstruct extrinsic from method call hex, using as-is');
          extrinsicHex = item.extrinsicHex;
        }
      }

      // Build block with this extrinsic
      const block = await chain.newBlock({
        extrinsics: [extrinsicHex],
      });

      const newHead = await chain.head;
      const newBlockHash = toHexString(newHead);

      // Parse outcome
      const { succeeded, error } = extractBlockOutcome(api, block);

      // Calculate fee
      let fee = '0';
      if (extrinsicForFee) {
        try {
          const { encodeAddress, decodeAddress } = await import('@polkadot/util-crypto');
          const publicKey = decodeAddress(item.senderAddress);
          const ss58Format = api.registry.chainSS58 || 0;
          const encodedSender = encodeAddress(publicKey, ss58Format);
          
          const feeInfo = await extrinsicForFee.paymentInfo(encodedSender);
          fee = feeInfo.partialFee.toString();
        } catch {
          // Fee calculation can fail
        }
      }

      if (!succeeded) {
        results.push({
          index: i,
          description: item.description,
          result: {
            success: false,
            error,
            estimatedFee: fee,
            balanceChanges: [],
            events: [],
          },
        });
        
        // Cleanup
        if (startBlockHash && storage) {
          await storage.deleteBlock(startBlockHash as `0x${string}`);
        }
        if (storage) await storage.close();
        if (chain) await chain.close();

        return {
          success: false,
          error: `Transaction ${i + 1} (${item.description}) failed: ${error || 'Unknown error'}`,
          results,
          totalEstimatedFee: totalFee.toString(),
          finalBalanceChanges: [],
        };
      }

      const _currentBlockHash = newBlockHash;
      totalFee = totalFee.add(new BN(fee));
      
      // Calculate balance changes (simplified - would need full implementation)
      results.push({
        index: i,
        description: item.description,
        result: {
          success: true,
          error: null,
          estimatedFee: fee,
          balanceChanges: [],
          events: [],
        },
      });
    }

    // Cleanup
    if (startBlockHash && storage) {
      await storage.deleteBlock(startBlockHash as `0x${string}`);
    }
    if (storage) await storage.close();
    if (chain) await chain.close();

    return {
      success: true,
      error: null,
      results,
      totalEstimatedFee: totalFee.toString(),
      finalBalanceChanges: [],
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    simulationLogger.error({ error: errorMessage }, 'Sequential simulation failed');

    // Cleanup on error
    try {
      if (startBlockHash && storage) {
        await storage.deleteBlock(startBlockHash as `0x${string}`);
      }
      if (storage) await storage.close();
      if (chain) await chain.close();
    } catch (cleanupError) {
      simulationLogger.warn({ error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) }, 'Cleanup error');
    }

    return {
      success: false,
      error: `Sequential simulation failed: ${errorMessage}`,
      results: [],
      totalEstimatedFee: '0',
      finalBalanceChanges: [],
    };
  }
}

// Helper functions (similar to chopsticks.ts)
function toHexString(blockHash: any): `0x${string}` {
  if (!blockHash) {
    throw new Error('Block hash is null or undefined');
  }
  
  if (typeof blockHash === 'string') {
    return blockHash.startsWith('0x') ? blockHash as `0x${string}` : `0x${blockHash}` as `0x${string}`;
  }
  
  if (typeof blockHash === 'object' && blockHash !== null) {
    if ('hash' in blockHash) return toHexString(blockHash.hash);
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
  }
  
  throw new Error(`Cannot convert block hash to hex string. Type: ${typeof blockHash}`);
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

function extractBlockOutcome(api: ApiPromise, block: any): { succeeded: boolean; error: string | null } {
  try {
    if (block?.extrinsics?.[0]?.result) {
      const chainName = 'unknown'; // Would need to get from API
      const result = parseOutcome(api, block.extrinsics[0].result, chainName);
      return { succeeded: result.succeeded, error: result.failureReason };
    }
    if (block?.result) {
      const chainName = 'unknown';
      const result = parseOutcome(api, block.result, chainName);
      return { succeeded: result.succeeded, error: result.failureReason };
    }
    return { succeeded: true, error: null };
  } catch (error) {
    simulationLogger.warn({ 
      error: error instanceof Error ? error.message : String(error)
    }, 'Could not parse block outcome, assuming success');
    return { succeeded: true, error: null };
  }
}

// Health check
router.get('/health', (_req: Request, res: Response) => {
  console.log('[SimulationRoutes] Health check endpoint called');
  res.json({ status: 'ok', service: 'simulation-server' });
});

// Single transaction simulation
router.post('/simulate', async (req: Request, res: Response) => {
    let api: ApiPromise | null = null;
    
    try {
      const request: SimulationRequest = req.body;
      
      // Validate request
      if (!request.rpcEndpoints || !Array.isArray(request.rpcEndpoints)) {
        return res.status(400).json({ error: 'rpcEndpoints must be an array' });
      }
      if (!request.extrinsicHex || typeof request.extrinsicHex !== 'string') {
        return res.status(400).json({ error: 'extrinsicHex is required' });
      }
      if (!request.senderAddress || typeof request.senderAddress !== 'string') {
        return res.status(400).json({ error: 'senderAddress is required' });
      }

      // Filter to WebSocket endpoints
      const endpoints = request.rpcEndpoints.filter(e => 
        typeof e === 'string' && (e.startsWith('wss://') || e.startsWith('ws://'))
      );
      
      if (endpoints.length === 0) {
        return res.status(400).json({ error: 'No valid WebSocket endpoints provided' });
      }

      // Create API instance from first endpoint
      // NOTE: This creates a new API instance which may have different metadata
      // than the client's API instance. This is a known limitation.
      const provider = new WsProvider(endpoints[0]);
      api = await ApiPromiseClass.create({ provider });
      await api.isReady;

      // Simulate transaction
      const result = await simulateTransactionInternal(api, request);
      
      // Cleanup API
      await api.disconnect();
      
      return res.json(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      simulationLogger.error({ error: errorMessage }, 'Simulation request failed');
      
      // Cleanup API on error
      if (api) {
        try {
          await api.disconnect();
        } catch (disconnectError) {
          // Ignore disconnect errors
        }
      }
      
      return res.status(500).json({ error: errorMessage });
    }
  });

// Sequential transaction simulation
router.post('/simulate-sequential', async (req: Request, res: Response) => {
    let api: ApiPromise | null = null;
    
    try {
      const request: SequentialSimulationRequest = req.body;
      
      // Validate request
      if (!request.rpcEndpoints || !Array.isArray(request.rpcEndpoints)) {
        return res.status(400).json({ error: 'rpcEndpoints must be an array' });
      }
      if (!request.items || !Array.isArray(request.items)) {
        return res.status(400).json({ error: 'items must be an array' });
      }

      // Filter to WebSocket endpoints
      const endpoints = request.rpcEndpoints.filter(e => 
        typeof e === 'string' && (e.startsWith('wss://') || e.startsWith('ws://'))
      );
      
      if (endpoints.length === 0) {
        return res.status(400).json({ error: 'No valid WebSocket endpoints provided' });
      }

      // Create API instance from first endpoint
      const provider = new WsProvider(endpoints[0]);
      api = await ApiPromiseClass.create({ provider });
      await api.isReady;

      // Simulate sequential transactions
      const result = await simulateSequentialTransactionsInternal(api, request);
      
      // Cleanup API
      await api.disconnect();
      
      return res.json(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      simulationLogger.error({ error: errorMessage }, 'Sequential simulation request failed');
      
      // Cleanup API on error
      if (api) {
        try {
          await api.disconnect();
        } catch (disconnectError) {
          // Ignore disconnect errors
        }
      }
      
      return res.status(500).json({ error: errorMessage });
    }
  });

export default router;
