/**
 * Simulation routes: Chopsticks transaction simulation (Node.js/backend only).
 * Frontend uses chopsticksClient to call these endpoints.
 */

import type { ApiPromise } from '@polkadot/api';
import type { HexString } from '@polkadot/util/types';
import { BN } from '@polkadot/util';
import { hexToU8a } from '@polkadot/util';
import { ApiPromise as ApiPromiseClass, WsProvider } from '@polkadot/api';
import { createChopsticksDatabase, type Database } from '@dotbot/core/services/simulation/database';
import { classifyChopsticksError } from '@dotbot/core/services/simulation/chopsticksIgnorePolicy';
import { createSubsystemLogger, Subsystem } from '@dotbot/core/services/logger';
import { setup, BuildBlockMode } from '@acala-network/chopsticks-core';
import { Router, Request, Response } from 'express';

const simulationLogger = createSubsystemLogger(Subsystem.SIMULATION);
const router = Router();

const TOKEN_DECIMALS = 12;

function formatBalanceForLog(planck: string | undefined): string {
  if (!planck) return 'unknown';
  const n = parseInt(planck, 10);
  return Number.isNaN(n) ? 'unknown' : (n / Math.pow(10, TOKEN_DECIMALS)).toFixed(6);
}

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

    const chainHead = await chain.head;
    const blockHashHex = toHexString(chainHead);

    let callHex: string;
    let extrinsicForFee: any = null;
    try {
      const extrinsic = api.createType('Extrinsic', request.extrinsicHex);
      callHex = extrinsic.method.toHex();
      extrinsicForFee = extrinsic;
    } catch {
      callHex = request.extrinsicHex;
      try {
        const call = api.createType('Call', callHex);
        const callMethod = call as any;
        if (callMethod.section && callMethod.method) {
          const txMethod = (api.tx as any)[callMethod.section]?.[callMethod.method];
          if (txMethod) {
            const args: any[] = callMethod.args?.length ? [...callMethod.args] : [];
            extrinsicForFee = txMethod(...args);
          }
        }
      } catch (reconstructError) {
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

    const chainName = (await api.rpc.system.chain()).toString();
    const { succeeded, failureReason } = parseOutcome(api, outcome, chainName);

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

async function buildMockSignedExtrinsicHex(
  callHex: string,
  senderAddress: string,
  head: { hash: string; meta: Promise<any>; registry: Promise<any>; runtimeVersion: Promise<any>; read: (type: string, query: (...args: any[]) => any, ...args: any[]) => Promise<any> },
  genesisHash: string
): Promise<string> {
  const registry = await head.registry;
  const meta = await head.meta;
  const account = await head.read('AccountInfo', meta.query.system.account, senderAddress);
  if (!account) {
    throw new Error(`Account ${senderAddress} not found on fork`);
  }
  const call = registry.createType('Call', hexToU8a(callHex));
  const generic = registry.createType('GenericExtrinsic', call);
  generic.signFake(senderAddress, {
    blockHash: head.hash,
    genesisHash,
    runtimeVersion: await head.runtimeVersion,
    nonce: account.nonce,
  });
  const mockSig = new Uint8Array(64);
  mockSig.fill(0xcd);
  mockSig.set([0xde, 0xad, 0xbe, 0xef]);
  generic.signature.set(mockSig);
  return generic.toHex();
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
    const endpoints = request.rpcEndpoints.filter(e =>
      typeof e === 'string' && (e.startsWith('wss://') || e.startsWith('ws://'))
    );
    if (endpoints.length === 0) {
      throw new Error('No valid WebSocket endpoints provided');
    }
    const dbName = `dotbot-sequential-sim:${api.genesisHash.toHex()}`;
    storage = createChopsticksDatabase(dbName);

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
    let totalFee = new BN(0);
    const chainName = (await api.rpc.system.chain()).toString();

    for (let i = 0; i < request.items.length; i++) {
      const item = request.items[i];
      const currentHead = await chain.head;

      let extrinsicHex: string;
      let extrinsicForFee: any = null;
      let callHex: string = item.extrinsicHex;
      try {
        const extrinsic = api.createType('Extrinsic', item.extrinsicHex);
        extrinsicHex = extrinsic.toHex();
        callHex = extrinsic.method.toHex();
        extrinsicForFee = extrinsic;
      } catch {
        try {
          const call = api.createType('Call', item.extrinsicHex);
          const callMethod = call as any;
          if (callMethod.section && callMethod.method) {
            const txMethod = (api.tx as any)[callMethod.section]?.[callMethod.method];
            if (txMethod) {
              const args: any[] = callMethod.args?.length ? [...callMethod.args] : [];
              extrinsicForFee = txMethod(...args);
              extrinsicHex = extrinsicForFee.toHex();
            } else {
              extrinsicHex = item.extrinsicHex;
            }
          } else {
            extrinsicHex = item.extrinsicHex;
          }
        } catch (reconstructError) {
          simulationLogger.warn({
            error: reconstructError instanceof Error ? reconstructError.message : String(reconstructError)
          }, 'Could not reconstruct extrinsic from method call hex, using as-is');
          extrinsicHex = item.extrinsicHex;
        }
      }

      try {
        const meta = await currentHead.meta;
        const accountBefore = await currentHead.read('AccountInfo', meta.query.system.account, item.senderAddress);
        const freeBefore = accountBefore?.data?.free?.toString();
        simulationLogger.debug({ itemIndex: i, balanceBefore: freeBefore ?? 'unknown', balanceInTokens: formatBalanceForLog(freeBefore) }, 'Balance before step');
      } catch {
        // ignore
      }

      simulationLogger.debug({ itemIndex: i, callHex, sender: item.senderAddress, headHash: currentHead.hash }, 'Running dryRunExtrinsic');
      const dryRun = await chain.dryRunExtrinsic(
        { call: callHex, address: item.senderAddress },
        currentHead.hash
      );
      simulationLogger.debug({ itemIndex: i, outcome: dryRun.outcome }, 'dryRunExtrinsic completed');
      const { succeeded, failureReason } = parseOutcome(api, dryRun.outcome, chainName);

      if (!succeeded) {
        results.push({
          index: i,
          description: item.description,
          result: {
            success: false,
            error: failureReason,
            estimatedFee: '0',
            balanceChanges: [],
            events: [],
          },
        });
        if (startBlockHash && storage) await storage.deleteBlock(startBlockHash as `0x${string}`);
        if (storage) await storage.close();
        if (chain) await chain.close();
        return {
          success: false,
          error: `Transaction ${i + 1} (${item.description}) failed: ${failureReason || 'Unknown error'}`,
          results,
          totalEstimatedFee: totalFee.toString(),
          finalBalanceChanges: [],
        };
      }

      let extrinsicToApply: string;
      try {
        extrinsicToApply = await buildMockSignedExtrinsicHex(callHex, item.senderAddress, currentHead, api.genesisHash.toHex());
        simulationLogger.debug({ itemIndex: i, hexLength: extrinsicToApply.length }, 'Built mock-signed extrinsic');
      } catch (buildError) {
        const msg = buildError instanceof Error ? buildError.message : String(buildError);
        simulationLogger.error({ itemIndex: i, error: msg }, 'Failed to build mock-signed extrinsic');
        throw new Error(`Failed to build mock-signed extrinsic for item ${i}: ${msg}`);
      }

      await chain.newBlock({ transactions: [extrinsicToApply] });
      const newHead = await chain.head;
      const newHeadExtrinsics = await newHead.extrinsics;
      const includedCount = newHeadExtrinsics?.length ?? 0;

      try {
        const meta = await newHead.meta;
        const accountAfter = await newHead.read('AccountInfo', meta.query.system.account, item.senderAddress);
        const freeAfter = accountAfter?.data?.free?.toString();
        simulationLogger.debug({ itemIndex: i, balanceAfter: freeAfter ?? 'unknown', balanceInTokens: formatBalanceForLog(freeAfter) }, 'Balance after step');
      } catch {
        // ignore
      }

      simulationLogger.debug({ itemIndex: i, newHeadHash: newHead.hash, includedExtrinsicsCount: includedCount }, 'newBlock completed');
      if (includedCount === 0) {
        simulationLogger.error({ itemIndex: i, extrinsicPrefix: extrinsicToApply.substring(0, 40) }, 'Block built with zero extrinsics');
      }

      let fee = '0';
      if (extrinsicForFee) {
        try {
          const { encodeAddress, decodeAddress } = await import('@polkadot/util-crypto');
          const publicKey = decodeAddress(item.senderAddress);
          const ss58Format = api.registry.chainSS58 || 0;
          const encodedSender = encodeAddress(publicKey, ss58Format);
          const feeInfo = await extrinsicForFee.paymentInfo(encodedSender);
          fee = feeInfo.partialFee.toString();
          simulationLogger.debug({ itemIndex: i, fee, cumulativeFee: totalFee.add(new BN(fee)).toString() }, 'Fee for step');
        } catch (feeError) {
          simulationLogger.warn({ itemIndex: i, error: feeError instanceof Error ? feeError.message : String(feeError) }, 'Fee calculation failed');
        }
      }
      totalFee = totalFee.add(new BN(fee));
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

    if (startBlockHash && storage) {
      await storage.deleteBlock(startBlockHash as `0x${string}`);
    }
    if (storage) await storage.close();
    if (chain) await chain.close();

    simulationLogger.info({ totalSteps: results.length, totalFee: totalFee.toString() }, 'Sequential simulation completed');

    return {
      success: true,
      error: null,
      results,
      totalEstimatedFee: totalFee.toString(),
      finalBalanceChanges: [],
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    simulationLogger.error({ error: errorMessage, stack: errorStack }, 'Sequential simulation failed');
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

function formatDispatchError(innerErr: any): string {
  if (innerErr && typeof innerErr === 'object') {
    if (innerErr.token === 'NoFunds') return 'Insufficient balance (NoFunds)';
    if (innerErr.token) return `TokenError: ${innerErr.token}`;
    if (innerErr.module) return `${innerErr.module.section}.${innerErr.module.name}`;
  }
  return typeof innerErr === 'object' ? JSON.stringify(innerErr) : String(innerErr);
}

function parseOutcome(
  api: ApiPromise,
  outcome: any,
  chainName: string
): { succeeded: boolean; failureReason: string | null } {
  const ok = outcome?.Ok ?? outcome?.ok;
  const err = outcome?.Err ?? outcome?.err;
  if (ok !== undefined || err !== undefined) {
    if (err !== undefined) {
      const errStr = typeof err === 'object' ? JSON.stringify(err) : String(err);
      return { succeeded: false, failureReason: errStr };
    }
    const innerErr = ok?.Err ?? ok?.err;
    if (innerErr !== undefined) {
      const errStr = formatDispatchError(innerErr);
      return { succeeded: false, failureReason: errStr };
    }
    return { succeeded: true, failureReason: null };
  }

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
    const invalidType = invalid?.type || 'Unknown';
    const invalidDetails = invalid?.toString ? invalid.toString() : JSON.stringify(invalid);
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

router.get('/health', (_req: Request, res: Response) => {
  console.log('[SimulationRoutes] Health check endpoint called');
  res.json({ status: 'ok', service: 'simulation-server' });
});

router.post('/simulate', async (req: Request, res: Response) => {
    let api: ApiPromise | null = null;
    
    try {
      const request: SimulationRequest = req.body;
      if (!request.rpcEndpoints || !Array.isArray(request.rpcEndpoints)) {
        return res.status(400).json({ error: 'rpcEndpoints must be an array' });
      }
      if (!request.extrinsicHex || typeof request.extrinsicHex !== 'string') {
        return res.status(400).json({ error: 'extrinsicHex is required' });
      }
      if (!request.senderAddress || typeof request.senderAddress !== 'string') {
        return res.status(400).json({ error: 'senderAddress is required' });
      }
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
      const result = await simulateTransactionInternal(api, request);
      await api.disconnect();
      
      return res.json(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      simulationLogger.error({ error: errorMessage }, 'Simulation request failed');
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
      const endpoints = request.rpcEndpoints.filter(e => 
        typeof e === 'string' && (e.startsWith('wss://') || e.startsWith('ws://'))
      );
      
      if (endpoints.length === 0) {
        return res.status(400).json({ error: 'No valid WebSocket endpoints provided' });
      }
      const provider = new WsProvider(endpoints[0]);
      api = await ApiPromiseClass.create({ provider });
      await api.isReady;

      // Simulate sequential transactions
      const result = await simulateSequentialTransactionsInternal(api, request);
      await api.disconnect();
      
      return res.json(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      simulationLogger.error({ error: errorMessage }, 'Sequential simulation request failed');
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
