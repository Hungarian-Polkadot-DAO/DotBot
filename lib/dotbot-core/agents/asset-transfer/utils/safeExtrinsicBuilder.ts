/**
 * Production-Safe Extrinsic Builder
 * 
 * Constructs transfer extrinsics with runtime detection, fallbacks,
 * and proper validation for multi-network compatibility.
 * 
 * CRITICAL PRINCIPLES:
 * 1. Construction != Execution (construction is validation, execution depends on runtime state)
 * 2. Never assume methods exist (always detect)
 * 3. Always use BN for amounts
 * 4. Always encode addresses to chain's SS58 format
 */

import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { BN } from '@polkadot/util';
import {
  TransferCapabilities,
  getBestTransferMethod,
  validateMinimumCapabilities,
  validateExistentialDeposit,
} from './transferCapabilities';
import { encodeRecipientAddress } from './addressEncoder';
import { normalizeAmountToBN } from './amountNormalizer';
import { detectChainType } from './capabilityDetectors';

/**
 * Parameters for building a safe transfer extrinsic
 */
export interface SafeTransferParams {
  recipient: string;
  amount: string | number | BN; // Accept multiple formats, normalize internally
  keepAlive?: boolean;
}

/**
 * Result of safe extrinsic construction
 */
export interface SafeExtrinsicResult {
  extrinsic: SubmittableExtrinsic<'promise'>;
  method: 'transferAllowDeath' | 'transfer' | 'transferKeepAlive';
  recipientEncoded: string; // Address encoded for chain's SS58 format
  amountBN: BN;
  warnings: string[];
}

/**
 * Build a production-safe transfer extrinsic
 * 
 * This function:
 * 1. Validates capabilities
 * 2. Selects best available method with fallback
 * 3. Encodes address to chain's SS58 format
 * 4. Converts amount to BN
 * 5. Validates against ED
 * 6. Constructs extrinsic with proper error handling
 * 
 * @param api Polkadot API instance
 * @param params Transfer parameters
 * @param capabilities Pre-detected chain capabilities
 * @returns Safe extrinsic result with warnings
 */
export function buildSafeTransferExtrinsic(
  api: ApiPromise,
  params: SafeTransferParams,
  capabilities: TransferCapabilities
): SafeExtrinsicResult {
  validateBuilderPreconditions(api, capabilities);
  
  const chainType = detectChainType(capabilities.chainName, capabilities.specName);
  validateMinimumCapabilities(capabilities);
  
  const amountBN = normalizeAmountToBN(params.amount, capabilities);
  if (amountBN.lte(new BN(0))) {
    throw new Error('Amount must be greater than zero');
  }

  const recipientEncoded = encodeRecipientAddress(params.recipient, capabilities);
  
  const warnings: string[] = [];
  const edCheck = validateExistentialDeposit(amountBN, capabilities);
  if (!edCheck.valid && edCheck.warning) {
    warnings.push(edCheck.warning);
  }
  
  const method = getBestTransferMethod(capabilities, params.keepAlive);
  addMethodWarnings(method, chainType, capabilities, warnings);
  
  validateMethodExists(api, method, capabilities);
  const extrinsic = constructExtrinsic(api, method, recipientEncoded, amountBN, warnings);
  validateExtrinsicStructure(extrinsic, method, capabilities);
  
  return {
    extrinsic,
    method,
    recipientEncoded,
    amountBN,
    warnings,
  };
}

function validateBuilderPreconditions(api: ApiPromise, capabilities: TransferCapabilities): void {
  if (!api || !api.isReady) {
    throw new Error(
      `API not ready for ${capabilities.chainName}. ` +
      `API ready: ${api?.isReady}, Runtime: ${capabilities.specName} v${capabilities.specVersion}`
    );
  }
}

function addMethodWarnings(
  method: string,
  chainType: ReturnType<typeof detectChainType>,
  capabilities: TransferCapabilities,
  warnings: string[]
): void {
  if (method === 'transferAllowDeath' || method === 'transfer') {
    if (chainType.isParachain) {
      warnings.push(
        `WARNING: Using ${method} on parachain "${capabilities.chainName}". ` +
        `This works ONLY for the parachain's native token, NOT for DOT. ` +
        `DOT transfers on parachains require XCM (reserve transfer).`
      );
    }
    
    warnings.push(
      `WARNING: ${method} allows sender account to be REAPED if balance drops below ED. ` +
      `Account death occurs if: (free_balance - fees - amount) < ED (${capabilities.existentialDeposit}). ` +
      `Reaped accounts lose all state, nonces reset, and locks/reserves are removed. ` +
      `Consider using keepAlive=true to prevent account reaping.`
    );
  }
}

function validateMethodExists(
  api: ApiPromise,
  method: string,
  capabilities: TransferCapabilities
): void {
  let methodExists = false;
  let methodCallable = false;

  try {
    switch (method) {
      case 'transferAllowDeath':
        methodExists = !!(api.tx.balances?.transferAllowDeath);
        methodCallable = methodExists && typeof api.tx.balances.transferAllowDeath === 'function';
        break;
      case 'transfer':
        methodExists = !!(api.tx.balances?.transfer);
        methodCallable = methodExists && typeof api.tx.balances.transfer === 'function';
        break;
      case 'transferKeepAlive':
        methodExists = !!(api.tx.balances?.transferKeepAlive);
        methodCallable = methodExists && typeof api.tx.balances.transferKeepAlive === 'function';
        break;
    }
  } catch {
    // Method check failed
  }

  if (!methodExists || !methodCallable) {
    throw new Error(
      `Method ${method} is not available or not callable on ${capabilities.chainName}. ` +
      `Runtime: ${capabilities.specName} v${capabilities.specVersion}, ` +
      `Available methods: transferAllowDeath=${!!api.tx.balances?.transferAllowDeath}, ` +
      `transfer=${!!api.tx.balances?.transfer}, ` +
      `transferKeepAlive=${!!api.tx.balances?.transferKeepAlive}`
    );
  }
}

function constructExtrinsic(
  api: ApiPromise,
  method: string,
  recipientEncoded: string,
  amountBN: BN,
  warnings: string[]
): SubmittableExtrinsic<'promise'> {
  try {
    switch (method) {
      case 'transferAllowDeath':
        return api.tx.balances.transferAllowDeath(recipientEncoded, amountBN);
      case 'transfer':
        warnings.push('Using legacy balances.transfer method');
        return api.tx.balances.transfer(recipientEncoded, amountBN);
      case 'transferKeepAlive':
        warnings.push('Using transferKeepAlive - sender account will remain alive');
        return api.tx.balances.transferKeepAlive(recipientEncoded, amountBN);
      default:
        throw new Error(`Unknown transfer method: ${method}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to construct ${method} extrinsic: ${errorMessage}`);
  }
}

function validateExtrinsicStructure(
  extrinsic: SubmittableExtrinsic<'promise'>,
  method: string,
  capabilities: TransferCapabilities
): void {
  if (!extrinsic || !extrinsic.method) {
    throw new Error(
      `Extrinsic construction succeeded but result is invalid. ` +
      `Method: ${method}, Chain: ${capabilities.chainName}`
    );
  }

  if (!extrinsic.method.section || !extrinsic.method.method) {
    throw new Error(
      `Extrinsic method structure is invalid. ` +
      `Section: ${extrinsic.method.section}, Method: ${extrinsic.method.method}`
    );
  }

  if (method === 'transferAllowDeath' || method === 'transfer') {
    if (extrinsic.method.section !== 'balances') {
      throw new Error(
        `Invalid extrinsic section for ${method}: ${extrinsic.method.section}. ` +
        `${method} MUST use balances pallet for native token transfers only.`
      );
    }

    const expectedMethod = method === 'transferAllowDeath' ? 'transferAllowDeath' : 'transfer';
    if (extrinsic.method.method !== expectedMethod) {
      throw new Error(
        `Method name mismatch: Expected ${expectedMethod}, got ${extrinsic.method.method}.`
      );
    }
  }
}

/**
 * Build a safe batch transfer extrinsic
 * 
 * @param api Polkadot API instance
 * @param transfers Array of transfers
 * @param capabilities Pre-detected chain capabilities
 * @param useAtomicBatch If true, use batchAll (fails if any tx fails). If false, use batch.
 * @returns Safe extrinsic result
 */
export function buildSafeBatchExtrinsic(
  api: ApiPromise,
  transfers: Array<{ recipient: string; amount: string | number | BN }>,
  capabilities: TransferCapabilities,
  useAtomicBatch = true
): SafeExtrinsicResult {
  validateBatchCapabilities(capabilities, useAtomicBatch);
  validateBatchTransfers(transfers);

  const method = getBestTransferMethod(capabilities, false);
  const { transferExtrinsics, totalAmount, warnings } = buildBatchTransferExtrinsics(
    api,
    transfers,
    method,
    capabilities
  );

  const batchExtrinsic = constructBatchExtrinsic(api, transferExtrinsics, useAtomicBatch, warnings);
  
  if (method === 'transfer') {
    warnings.push('Using legacy balances.transfer method for batch items');
  }

  return {
    extrinsic: batchExtrinsic,
    method,
    recipientEncoded: `${transfers.length} recipients`,
    amountBN: totalAmount,
    warnings,
  };
}

function validateBatchCapabilities(
  capabilities: TransferCapabilities,
  useAtomicBatch: boolean
): void {
  validateMinimumCapabilities(capabilities);

  if (!capabilities.hasUtility) {
    throw new Error(`Chain ${capabilities.chainName} does not have utility pallet for batch operations`);
  }

  if (useAtomicBatch && !capabilities.hasBatchAll) {
    throw new Error(`Chain ${capabilities.chainName} does not support utility.batchAll`);
  }

  if (!useAtomicBatch && !capabilities.hasBatch) {
    throw new Error(`Chain ${capabilities.chainName} does not support utility.batch`);
  }
}

function validateBatchTransfers(transfers: Array<{ recipient: string; amount: string | number | BN }>): void {
  if (!transfers || transfers.length === 0) {
    throw new Error('At least one transfer is required for batch');
  }

  if (transfers.length > 100) {
    throw new Error('Batch transfer cannot exceed 100 transfers');
  }
}

function buildBatchTransferExtrinsics(
  api: ApiPromise,
  transfers: Array<{ recipient: string; amount: string | number | BN }>,
  method: string,
  capabilities: TransferCapabilities
): {
  transferExtrinsics: SubmittableExtrinsic<'promise'>[];
  totalAmount: BN;
  warnings: string[];
} {
  const transferExtrinsics: SubmittableExtrinsic<'promise'>[] = [];
  const warnings: string[] = [];
  let totalAmount = new BN(0);

  for (let i = 0; i < transfers.length; i++) {
    const transfer = transfers[i];
    
    const amountBN = normalizeAmountToBN(transfer.amount, capabilities);
    if (amountBN.lte(new BN(0))) {
      throw new Error(`Transfer ${i + 1}: Amount must be greater than zero`);
    }
    totalAmount = totalAmount.add(amountBN);

    const recipientEncoded = encodeRecipientAddress(transfer.recipient, capabilities);
    
    const edCheck = validateExistentialDeposit(amountBN, capabilities);
    if (!edCheck.valid && edCheck.warning) {
      warnings.push(`Transfer ${i + 1}: ${edCheck.warning}`);
    }
    
    try {
      const txExtrinsic = constructExtrinsic(api, method, recipientEncoded, amountBN, []);
      transferExtrinsics.push(txExtrinsic);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Transfer ${i + 1}: Failed to construct: ${errorMessage}`);
    }
  }

  return { transferExtrinsics, totalAmount, warnings };
}

function constructBatchExtrinsic(
  api: ApiPromise,
  transferExtrinsics: SubmittableExtrinsic<'promise'>[],
  useAtomicBatch: boolean,
  warnings: string[]
): SubmittableExtrinsic<'promise'> {
  try {
    if (useAtomicBatch) {
      warnings.push('Using batchAll - all transfers must succeed or entire batch fails');
      return api.tx.utility.batchAll(transferExtrinsics);
    } else {
      warnings.push('Using batch - individual transfers can fail independently');
      return api.tx.utility.batch(transferExtrinsics);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to construct batch extrinsic: ${errorMessage}`);
  }
}


