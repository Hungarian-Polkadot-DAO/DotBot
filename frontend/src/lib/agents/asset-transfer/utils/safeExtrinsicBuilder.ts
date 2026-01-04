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
  
  // Step 0: CRITICAL - Ensure API is ready and validate runtime
  if (!api || !api.isReady) {
    throw new Error(
      `API not ready for ${capabilities.chainName}. ` +
      `API ready: ${api?.isReady}, Runtime: ${capabilities.specName} v${capabilities.specVersion}`
    );
  }
  
  // Validate runtime chain matches expected
  const runtimeChain = api.runtimeChain?.toString() || 'unknown';
  if (capabilities.chainName !== 'Unknown Chain' && runtimeChain !== capabilities.chainName) {
    console.warn(
      `[SafeExtrinsicBuilder] Chain name mismatch: ` +
      `Expected: ${capabilities.chainName}, Runtime: ${runtimeChain}`
    );
  }
  
  // CRITICAL: Validate chain type for migration compliance
  // balances.transferKeepAlive ONLY works for:
  // - Asset Hub DOT (native balances pallet)
  // - Relay Chain DOT (native balances pallet)
  // - Parachain native token (NOT DOT on parachains!)
  const isAssetHub = 
    capabilities.chainName.toLowerCase().includes('asset') ||
    capabilities.chainName.toLowerCase().includes('statemint') ||
    capabilities.specName.toLowerCase().includes('asset') ||
    capabilities.specName.toLowerCase().includes('statemint');
  
  const isRelayChain = 
    capabilities.chainName.toLowerCase().includes('polkadot') && 
    !isAssetHub &&
    capabilities.specName.toLowerCase().includes('polkadot');
  
  const isParachain = !isAssetHub && !isRelayChain;
  
  // Store chain type for later use
  const chainType = { isAssetHub, isRelayChain, isParachain };
  
  // Validate that balances methods are appropriate for this chain
  if (isParachain) {
    console.warn(
      `[SafeExtrinsicBuilder] WARNING: Chain "${capabilities.chainName}" appears to be a parachain. ` +
      `balances pallet methods work ONLY for the parachain's native token, NOT for DOT. ` +
      `If transferring DOT on a parachain, you MUST use XCM (reserve transfer), not balances pallet.`
    );
    // Don't throw here - let it proceed but log the warning
    // The actual validation will happen at runtime
  }
  
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
  
  // Step 5.1: CRITICAL - Validate transferAllowDeath usage
  // transferAllowDeath is DESTRUCTIVE and should only be used for:
  // - Same-chain native token transfers
  // - When account death is acceptable
  // - NOT for cross-chain, NOT for assets pallet, NOT for DOT on parachains
  if (method === 'transferAllowDeath' || method === 'transfer') {
    // Validate it's being used for native token on same chain
    if (chainType.isParachain) {
      warnings.push(
        `WARNING: Using ${method} on parachain "${capabilities.chainName}". ` +
        `This works ONLY for the parachain's native token, NOT for DOT. ` +
        `DOT transfers on parachains require XCM (reserve transfer).`
      );
    }
    
    // Add account reaping warning
    warnings.push(
      `WARNING: ${method} allows sender account to be REAPED if balance drops below ED. ` +
      `Account death occurs if: (free_balance - fees - amount) < ED (${capabilities.existentialDeposit}). ` +
      `Reaped accounts lose all state, nonces reset, and locks/reserves are removed. ` +
      `Consider using keepAlive=true to prevent account reaping.`
    );
  }
  
  // Step 5.5: CRITICAL - Verify method exists and is callable BEFORE construction
  let methodExists = false;
  let methodCallable = false;
  
  try {
    switch (method) {
      case 'transferAllowDeath':
        methodExists = !!(api.tx.balances?.transferAllowDeath);
        if (methodExists) {
          // Test that it's actually callable (not just defined)
          const testCall = api.tx.balances.transferAllowDeath;
          methodCallable = typeof testCall === 'function';
        }
        break;
      case 'transfer':
        methodExists = !!(api.tx.balances?.transfer);
        if (methodExists) {
          const testCall = api.tx.balances.transfer;
          methodCallable = typeof testCall === 'function';
        }
        break;
      case 'transferKeepAlive':
        methodExists = !!(api.tx.balances?.transferKeepAlive);
        if (methodExists) {
          const testCall = api.tx.balances.transferKeepAlive;
          methodCallable = typeof testCall === 'function';
        }
        break;
    }
  } catch (err) {
    console.error(`[SafeExtrinsicBuilder] Error checking method ${method}:`, err);
  }
  
  if (!methodExists || !methodCallable) {
    throw new Error(
      `Method ${method} is not available or not callable on ${capabilities.chainName}. ` +
      `Runtime: ${capabilities.specName} v${capabilities.specVersion}, ` +
      `Method exists: ${methodExists}, Callable: ${methodCallable}, ` +
      `Available methods: transferAllowDeath=${!!api.tx.balances?.transferAllowDeath}, ` +
      `transfer=${!!api.tx.balances?.transfer}, ` +
      `transferKeepAlive=${!!api.tx.balances?.transferKeepAlive}`
    );
  }
  
  // Step 6: Construct extrinsic with selected method
  let extrinsic: SubmittableExtrinsic<'promise'>;
  
  // Log construction details for debugging
  const amountFormatted = `${amountBN.div(new BN(10).pow(new BN(capabilities.nativeDecimals))).toString()}.${amountBN.mod(new BN(10).pow(new BN(capabilities.nativeDecimals))).toString().padStart(capabilities.nativeDecimals, '0')} ${capabilities.nativeTokenSymbol}`;
  
  console.log(`[SafeExtrinsicBuilder] Constructing ${method} extrinsic:`, {
    chain: capabilities.chainName,
    runtime: `${capabilities.specName} v${capabilities.specVersion}`,
    recipient: recipientEncoded,
    amount: amountBN.toString(),
    amountFormatted,
    ss58Prefix: capabilities.ss58Prefix,
    ed: capabilities.existentialDeposit,
    methodType: method === 'transferAllowDeath' || method === 'transfer' 
      ? 'DESTRUCTIVE (allows account reaping)' 
      : 'SAFE (prevents account reaping)',
    accountReapingRisk: method === 'transferAllowDeath' || method === 'transfer' 
      ? 'YES - Account may be reaped if balance < ED after transfer' 
      : 'NO - Account protected from reaping',
  });
  
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
    const errorDetails = {
      method,
      chain: capabilities.chainName,
      runtime: `${capabilities.specName} v${capabilities.specVersion}`,
      recipient: recipientEncoded,
      amount: amountBN.toString(),
      apiReady: api.isReady,
      hasBalances: !!(api.tx.balances),
      error: errorMessage,
    };
    
    console.error('[SafeExtrinsicBuilder] Extrinsic construction failed:', errorDetails);
    
    throw new Error(
      `Failed to construct ${method} extrinsic on ${capabilities.chainName}: ${errorMessage}. ` +
      `Details: ${JSON.stringify(errorDetails, null, 2)}`
    );
  }
  
  // Step 7: Validate extrinsic was created
  if (!extrinsic || !extrinsic.method) {
    throw new Error(
      `Extrinsic construction succeeded but result is invalid. ` +
      `Method: ${method}, Chain: ${capabilities.chainName}, ` +
      `Runtime: ${capabilities.specName} v${capabilities.specVersion}`
    );
  }
  
  // Step 8: Validate extrinsic structure
  if (!extrinsic.method.section || !extrinsic.method.method) {
    throw new Error(
      `Extrinsic method structure is invalid. ` +
      `Section: ${extrinsic.method.section}, Method: ${extrinsic.method.method}, ` +
      `Chain: ${capabilities.chainName}`
    );
  }
  
  // Step 9: CRITICAL - Final validation for transferAllowDeath
  // Ensure it's only used for same-chain native token (NOT cross-chain, NOT assets pallet)
  if (method === 'transferAllowDeath' || method === 'transfer') {
    // Validate section is 'balances' (not 'assets', 'xcm', etc.)
    if (extrinsic.method.section !== 'balances') {
      throw new Error(
        `Invalid extrinsic section for ${method}: ${extrinsic.method.section}. ` +
        `${method} MUST use balances pallet for native token transfers only. ` +
        `Cannot be used for assets pallet, XCM transfers, or cross-chain operations.`
      );
    }
    
    // Validate method name matches
    const expectedMethod = method === 'transferAllowDeath' ? 'transferAllowDeath' : 'transfer';
    if (extrinsic.method.method !== expectedMethod) {
      throw new Error(
        `Method name mismatch: Expected ${expectedMethod}, got ${extrinsic.method.method}. ` +
        `This indicates a metadata/runtime mismatch.`
      );
    }
  }
  
  // Log successful construction with migration compliance info
  console.log(`[SafeExtrinsicBuilder] ✓ Extrinsic constructed successfully:`, {
    section: extrinsic.method.section,
    method: extrinsic.method.method,
    callIndex: extrinsic.method.callIndex?.toString() || 'N/A',
    chain: capabilities.chainName,
    chainType: chainType.isAssetHub ? 'Asset Hub' : chainType.isRelayChain ? 'Relay Chain' : 'Parachain',
    runtime: `${capabilities.specName} v${capabilities.specVersion}`,
    nativeToken: capabilities.nativeTokenSymbol,
    migrationCompliance: {
      balancesForNativeToken: chainType.isAssetHub || chainType.isRelayChain ? 'VALID' : 'PARACHAIN_NATIVE_ONLY',
      balancesForDOT: chainType.isAssetHub || chainType.isRelayChain ? 'VALID' : 'REQUIRES_XCM',
      sameChainTransfer: 'VALID',
      crossChainTransfer: 'NOT_APPLICABLE',
      accountReapingRisk: method === 'transferAllowDeath' || method === 'transfer' ? 'YES' : 'NO',
    },
  });
  
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

