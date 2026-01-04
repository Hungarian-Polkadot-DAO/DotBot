/**
 * Capability Detection Utilities
 * 
 * Individual detection functions for each capability type.
 */

import { ApiPromise } from '@polkadot/api';

/**
 * Detect balances pallet methods
 */
export function detectBalancesMethods(api: ApiPromise) {
  return {
    hasBalances: !!(api.tx.balances),
    hasTransferAllowDeath: !!(api.tx.balances?.transferAllowDeath),
    hasTransfer: !!(api.tx.balances?.transfer),
    hasTransferKeepAlive: !!(api.tx.balances?.transferKeepAlive),
  };
}

/**
 * Detect utility pallet methods
 */
export function detectUtilityMethods(api: ApiPromise) {
  return {
    hasUtility: !!(api.tx.utility),
    hasBatch: !!(api.tx.utility?.batch),
    hasBatchAll: !!(api.tx.utility?.batchAll),
  };
}

/**
 * Detect asset pallet methods
 */
export function detectAssetMethods(api: ApiPromise) {
  return {
    hasAssets: !!(api.tx.assets),
    hasTokens: !!(api.tx.tokens),
  };
}

/**
 * Detect chain metadata (name, symbol, decimals, SS58 prefix)
 */
export function detectChainMetadata(api: ApiPromise) {
  return {
    chainName: api.runtimeChain?.toString() || 'Unknown Chain',
    nativeTokenSymbol: api.registry.chainTokens?.[0] || 'UNIT',
    nativeDecimals: api.registry.chainDecimals?.[0] || 10,
    ss58Prefix: api.registry.chainSS58 || 0,
  };
}

/**
 * Detect chain type (Asset Hub, Relay Chain, or Parachain)
 */
export function detectChainType(chainName: string, specName: string) {
  const isAssetHub =
    chainName.toLowerCase().includes('asset') ||
    chainName.toLowerCase().includes('statemint') ||
    specName.toLowerCase().includes('asset') ||
    specName.toLowerCase().includes('statemint');

  const isRelayChain =
    chainName.toLowerCase().includes('polkadot') &&
    !isAssetHub &&
    specName.toLowerCase().includes('polkadot');

  const isParachain = !isAssetHub && !isRelayChain;

  return { isAssetHub, isRelayChain, isParachain };
}

/**
 * Get existential deposit from chain
 */
export function getExistentialDeposit(api: ApiPromise): string {
  try {
    const ed = api.consts.balances?.existentialDeposit;
    if (ed) {
      return ed.toString();
    }
  } catch {
    // Fallback to 0 if ED cannot be fetched
  }
  return '0';
}

/**
 * Get runtime version information
 */
export async function getRuntimeVersion(api: ApiPromise): Promise<{ specName: string; specVersion: number }> {
  let specName = 'unknown';
  let specVersion = 0;

  try {
    if (api.runtimeVersion) {
      specName = api.runtimeVersion.specName?.toString() || 'unknown';
      specVersion = api.runtimeVersion.specVersion?.toNumber() || 0;
    }

    try {
      const runtimeVersion = await api.rpc.state.getRuntimeVersion();
      specName = runtimeVersion.specName.toString();
      specVersion = runtimeVersion.specVersion.toNumber();
    } catch {
      // Fallback to cached version if RPC call fails
    }
  } catch {
    // Use defaults if all methods fail
  }

  return { specName, specVersion };
}

