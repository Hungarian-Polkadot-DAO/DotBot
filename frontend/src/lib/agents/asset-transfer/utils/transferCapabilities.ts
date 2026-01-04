/**
 * Transfer Capabilities Detection
 * 
 * Production-safe utility to detect available transfer methods, pallets,
 * and chain metadata across different Substrate networks.
 * 
 * CRITICAL PRINCIPLE: Never assume a method exists. Always detect.
 */

import { ApiPromise } from '@polkadot/api';
import { BN } from '@polkadot/util';
import {
  detectBalancesMethods,
  detectUtilityMethods,
  detectAssetMethods,
  detectChainMetadata,
  detectChainType,
  getExistentialDeposit,
  getRuntimeVersion,
} from './capabilityDetectors';

/**
 * Transfer capabilities for a specific chain
 */
export interface TransferCapabilities {
  // Native token transfers (balances pallet)
  hasBalances: boolean;
  hasTransferAllowDeath: boolean; // Newer method (Polkadot.js v10+)
  hasTransfer: boolean;           // Legacy method (pre-v10)
  hasTransferKeepAlive: boolean;
  
  // Multi-asset support
  hasAssets: boolean;              // Statemint/AssetHub pattern
  hasTokens: boolean;              // Acala/Karura pattern
  
  // Batch operations
  hasUtility: boolean;
  hasBatch: boolean;
  hasBatchAll: boolean;
  
  // Chain metadata
  chainName: string;
  nativeTokenSymbol: string;
  nativeDecimals: number;
  existentialDeposit: string;      // In Planck (smallest unit)
  ss58Prefix: number;
  
  // Chain type classification
  isAssetHub: boolean;
  isRelayChain: boolean;
  isParachain: boolean;
  
  // Runtime version
  specName: string;
  specVersion: number;
}

/**
 * Detect transfer capabilities for the connected chain
 * 
 * This is the FIRST thing you should do before attempting any transfer.
 * Construction of extrinsics is cheap, but using wrong methods causes runtime errors.
 * 
 * @param api Polkadot API instance
 * @returns Transfer capabilities object
 */
export async function detectTransferCapabilities(api: ApiPromise): Promise<TransferCapabilities> {
  await api.isReady;

  if (!api || !api.isReady) {
    throw new Error('API is not ready. Cannot detect transfer capabilities.');
  }

  const balancesMethods = detectBalancesMethods(api);
  const utilityMethods = detectUtilityMethods(api);
  const assetMethods = detectAssetMethods(api);
  const metadata = detectChainMetadata(api);
  const existentialDeposit = getExistentialDeposit(api);
  const { specName, specVersion } = await getRuntimeVersion(api);
  const chainType = detectChainType(metadata.chainName, specName);

  return {
    ...balancesMethods,
    ...utilityMethods,
    ...assetMethods,
    ...metadata,
    existentialDeposit,
    ...chainType,
    specName,
    specVersion,
  };
}

/**
 * Validate that minimum required capabilities exist
 * 
 * @param capabilities Detected capabilities
 * @throws Error if minimum requirements not met
 */
export function validateMinimumCapabilities(capabilities: TransferCapabilities): void {
  // Must have balances pallet
  if (!capabilities.hasBalances) {
    throw new Error(
      `Chain "${capabilities.chainName}" does not have balances pallet. ` +
      `Cannot perform native token transfers.`
    );
  }
  
  // Must have at least one transfer method
  if (!capabilities.hasTransferAllowDeath && !capabilities.hasTransfer) {
    throw new Error(
      `Chain "${capabilities.chainName}" has balances pallet but no transfer methods. ` +
      `Available methods: ${JSON.stringify({
        transferAllowDeath: capabilities.hasTransferAllowDeath,
        transfer: capabilities.hasTransfer,
        transferKeepAlive: capabilities.hasTransferKeepAlive,
      })}`
    );
  }
}

/**
 * Get the best available transfer method for this chain
 * 
 * CRITICAL: transferAllowDeath is DESTRUCTIVE - can kill sender account!
 * 
 * Priority: transferKeepAlive (safest) → transferAllowDeath (destructive) → transfer (legacy)
 * 
 * @param capabilities Detected capabilities
 * @param keepAlive If true, use transferKeepAlive
 * @returns Method name to use
 */
export function getBestTransferMethod(
  capabilities: TransferCapabilities,
  keepAlive: boolean = false
): 'transferAllowDeath' | 'transfer' | 'transferKeepAlive' {
  if (shouldUseKeepAlive(capabilities, keepAlive)) {
    return 'transferKeepAlive';
  }

  if (shouldUseAllowDeath(capabilities)) {
    return 'transferAllowDeath';
  }

  return selectFallbackMethod(capabilities);
}

function shouldUseKeepAlive(
  capabilities: TransferCapabilities,
  keepAlive: boolean
): boolean {
  if (keepAlive) {
    if (!capabilities.hasTransferKeepAlive) {
      throw new Error(
        `transferKeepAlive not available on ${capabilities.chainName}. ` +
        `Available: ${JSON.stringify({
          transferAllowDeath: capabilities.hasTransferAllowDeath,
          transfer: capabilities.hasTransfer,
        })}`
      );
    }
    return true;
  }

  if (capabilities.isAssetHub && capabilities.nativeTokenSymbol === 'DOT') {
    return capabilities.hasTransferKeepAlive;
  }

  return false;
}

function shouldUseAllowDeath(capabilities: TransferCapabilities): boolean {
  return capabilities.hasTransferAllowDeath;
}

function selectFallbackMethod(
  capabilities: TransferCapabilities
): 'transfer' | 'transferKeepAlive' {
  if (capabilities.hasTransfer) {
    return 'transfer';
  }

  throw new Error(
    `No transfer method available on ${capabilities.chainName}. ` +
    `This should not happen if validateMinimumCapabilities passed.`
  );
}

/**
 * Format amount with decimals for display
 * 
 * @param amount Amount in smallest unit (Planck)
 * @param decimals Number of decimals for the token
 * @returns Formatted amount string
 */
function formatAmount(amount: BN, decimals: number): string {
  const divisor = new BN(10).pow(new BN(decimals));
  const whole = amount.div(divisor);
  const remainder = amount.mod(divisor);
  
  if (remainder.isZero()) {
    return whole.toString();
  }
  
  const remainderStr = remainder.toString().padStart(decimals, '0');
  return `${whole}.${remainderStr}`.replace(/\.?0+$/, '');
}

/**
 * Get transfer method summary for user display
 * 
 * @param capabilities Detected capabilities
 * @returns Human-readable summary
 */
export function getTransferMethodSummary(capabilities: TransferCapabilities): string {
  const methods: string[] = [];
  
  if (capabilities.hasTransferAllowDeath) {
    methods.push('transferAllowDeath');
  }
  if (capabilities.hasTransfer) {
    methods.push('transfer (legacy)');
  }
  if (capabilities.hasTransferKeepAlive) {
    methods.push('transferKeepAlive');
  }
  
  return `${capabilities.chainName} supports: ${methods.join(', ')}`;
}

/**
 * Check if amount meets existential deposit requirement
 * 
 * @param amount Amount in smallest unit
 * @param capabilities Chain capabilities
 * @returns Object with validation result and message
 */
export function validateExistentialDeposit(
  amount: BN,
  capabilities: TransferCapabilities
): { valid: boolean; warning?: string; ed: BN } {
  const ed = new BN(capabilities.existentialDeposit);
  
  if (amount.lt(ed)) {
    return {
      valid: false,
      warning: `Amount (${formatAmount(amount, capabilities.nativeDecimals)} ${capabilities.nativeTokenSymbol}) ` +
               `is below existential deposit (${formatAmount(ed, capabilities.nativeDecimals)} ${capabilities.nativeTokenSymbol}). ` +
               `Recipient account must already exist, or this transfer will fail.`,
      ed,
    };
  }
  
  return { valid: true, ed };
}

