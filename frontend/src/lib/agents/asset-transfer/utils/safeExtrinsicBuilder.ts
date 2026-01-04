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
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import {
  TransferCapabilities,
  getBestTransferMethod,
  validateMinimumCapabilities,
  validateExistentialDeposit,
} from './transferCapabilities';

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
  const warnings: string[] = [];
  
  // Step 1: Validate minimum capabilities
  validateMinimumCapabilities(capabilities);
  
  // Step 2: Normalize amount to BN
  const amountBN = normalizeAmount(params.amount, capabilities);
  if (amountBN.lte(new BN(0))) {
    throw new Error('Amount must be greater than zero');
  }
  
  // Step 3: Validate and encode recipient address
  const recipientEncoded = encodeAddressForChain(params.recipient, capabilities);
  
  // Step 4: Check existential deposit
  const edCheck = validateExistentialDeposit(amountBN, capabilities);
  if (!edCheck.valid && edCheck.warning) {
    warnings.push(edCheck.warning);
  }
  
  // Step 5: Select best transfer method
  const method = getBestTransferMethod(capabilities, params.keepAlive);
  
  // Step 6: Construct extrinsic with selected method
  let extrinsic: SubmittableExtrinsic<'promise'>;
  
  try {
    switch (method) {
      case 'transferAllowDeath':
        extrinsic = api.tx.balances.transferAllowDeath(recipientEncoded, amountBN);
        break;
        
      case 'transfer':
        extrinsic = api.tx.balances.transfer(recipientEncoded, amountBN);
        warnings.push('Using legacy balances.transfer method');
        break;
        
      case 'transferKeepAlive':
        extrinsic = api.tx.balances.transferKeepAlive(recipientEncoded, amountBN);
        warnings.push('Using transferKeepAlive - sender account will remain alive');
        break;
        
      default:
        throw new Error(`Unknown transfer method: ${method}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to construct ${method} extrinsic on ${capabilities.chainName}: ${errorMessage}. ` +
      `API ready: ${api.isReady}, Runtime: ${capabilities.specName} v${capabilities.specVersion}`
    );
  }
  
  // Step 7: Validate extrinsic was created
  if (!extrinsic || !extrinsic.method) {
    throw new Error(
      `Extrinsic construction succeeded but result is invalid. ` +
      `Method: ${method}, Chain: ${capabilities.chainName}`
    );
  }
  
  return {
    extrinsic,
    method,
    recipientEncoded,
    amountBN,
    warnings,
  };
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
  useAtomicBatch: boolean = true
): SafeExtrinsicResult {
  const warnings: string[] = [];
  
  // Validate capabilities
  validateMinimumCapabilities(capabilities);
  
  if (!capabilities.hasUtility) {
    throw new Error(`Chain ${capabilities.chainName} does not have utility pallet for batch operations`);
  }
  
  const batchMethod = useAtomicBatch ? 'batchAll' : 'batch';
  if (useAtomicBatch && !capabilities.hasBatchAll) {
    throw new Error(`Chain ${capabilities.chainName} does not support utility.batchAll`);
  }
  if (!useAtomicBatch && !capabilities.hasBatch) {
    throw new Error(`Chain ${capabilities.chainName} does not support utility.batch`);
  }
  
  // Validate transfers array
  if (!transfers || transfers.length === 0) {
    throw new Error('At least one transfer is required for batch');
  }
  if (transfers.length > 100) {
    throw new Error('Batch transfer cannot exceed 100 transfers');
  }
  
  // Select best transfer method (same for all)
  const method = getBestTransferMethod(capabilities, false);
  
  // Build individual transfer extrinsics
  const transferExtrinsics: SubmittableExtrinsic<'promise'>[] = [];
  let totalAmount = new BN(0);
  
  for (let i = 0; i < transfers.length; i++) {
    const transfer = transfers[i];
    
    // Normalize amount
    const amountBN = normalizeAmount(transfer.amount, capabilities);
    if (amountBN.lte(new BN(0))) {
      throw new Error(`Transfer ${i + 1}: Amount must be greater than zero`);
    }
    totalAmount = totalAmount.add(amountBN);
    
    // Encode address
    const recipientEncoded = encodeAddressForChain(transfer.recipient, capabilities);
    
    // Check ED
    const edCheck = validateExistentialDeposit(amountBN, capabilities);
    if (!edCheck.valid && edCheck.warning) {
      warnings.push(`Transfer ${i + 1}: ${edCheck.warning}`);
    }
    
    // Construct individual transfer
    try {
      let txExtrinsic: SubmittableExtrinsic<'promise'>;
      
      switch (method) {
        case 'transferAllowDeath':
          txExtrinsic = api.tx.balances.transferAllowDeath(recipientEncoded, amountBN);
          break;
        case 'transfer':
          txExtrinsic = api.tx.balances.transfer(recipientEncoded, amountBN);
          break;
        case 'transferKeepAlive':
          txExtrinsic = api.tx.balances.transferKeepAlive(recipientEncoded, amountBN);
          break;
      }
      
      transferExtrinsics.push(txExtrinsic);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Transfer ${i + 1}: Failed to construct: ${errorMessage}`);
    }
  }
  
  // Construct batch extrinsic
  let batchExtrinsic: SubmittableExtrinsic<'promise'>;
  
  try {
    if (useAtomicBatch) {
      batchExtrinsic = api.tx.utility.batchAll(transferExtrinsics);
      warnings.push('Using batchAll - all transfers must succeed or entire batch fails');
    } else {
      batchExtrinsic = api.tx.utility.batch(transferExtrinsics);
      warnings.push('Using batch - individual transfers can fail independently');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to construct batch extrinsic: ${errorMessage}`);
  }
  
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

/**
 * Normalize amount to BN, handling different input formats
 * 
 * Accepts:
 * - BN object (passthrough)
 * - Number (converted to BN)
 * - String integer: "15000000000" (converted to BN)
 * - String decimal: "1.5" (converted to Planck using chain decimals)
 * 
 * @param amount Amount in various formats
 * @param capabilities Chain capabilities for decimal conversion
 * @returns Amount as BN in smallest unit (Planck)
 */
function normalizeAmount(
  amount: string | number | BN,
  capabilities: TransferCapabilities
): BN {
  // Already a BN
  if (BN.isBN(amount)) {
    return amount;
  }
  
  // Number - convert to BN
  if (typeof amount === 'number') {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new Error(`Invalid amount: ${amount}. Must be a positive integer in Planck.`);
    }
    return new BN(amount);
  }
  
  // String - handle decimal and integer formats
  if (typeof amount === 'string') {
    // Decimal format: "1.5" → convert to Planck
    if (amount.includes('.')) {
      const [whole, decimal] = amount.split('.');
      const decimalPlaces = decimal.length;
      
      if (decimalPlaces > capabilities.nativeDecimals) {
        throw new Error(
          `Too many decimal places in amount: ${amount}. ` +
          `Maximum for ${capabilities.nativeTokenSymbol}: ${capabilities.nativeDecimals}`
        );
      }
      
      // Convert: 1.5 with 10 decimals = 1 * 10^10 + 5 * 10^9 = 15000000000
      const multiplier = new BN(10).pow(new BN(capabilities.nativeDecimals));
      const wholeBN = new BN(whole || '0').mul(multiplier);
      const decimalBN = new BN(decimal).mul(
        new BN(10).pow(new BN(capabilities.nativeDecimals - decimalPlaces))
      );
      
      return wholeBN.add(decimalBN);
    }
    
    // Integer string: "15000000000" → convert to BN
    if (!/^\d+$/.test(amount)) {
      throw new Error(`Invalid amount format: ${amount}. Must be integer or decimal string.`);
    }
    
    return new BN(amount);
  }
  
  throw new Error(`Unsupported amount type: ${typeof amount}`);
}

/**
 * Encode address for chain's SS58 format
 * 
 * CRITICAL: Addresses must be in the correct SS58 format for the target chain.
 * Using wrong format causes runtime panics (wasm unreachable errors).
 * 
 * @param address Address in any valid SS58 format
 * @param capabilities Chain capabilities
 * @returns Address encoded for chain's SS58 prefix
 */
function encodeAddressForChain(
  address: string,
  capabilities: TransferCapabilities
): string {
  try {
    // Decode to raw public key (works with any SS58 format)
    const publicKey = decodeAddress(address);
    
    // Re-encode with chain's SS58 prefix
    const encoded = encodeAddress(publicKey, capabilities.ss58Prefix);
    
    if (encoded !== address) {
      console.log(
        `[SafeExtrinsicBuilder] Re-encoded address for ${capabilities.chainName} (SS58: ${capabilities.ss58Prefix}):`,
        { original: address, encoded }
      );
    }
    
    return encoded;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid address: ${address}. Error: ${errorMessage}`);
  }
}

