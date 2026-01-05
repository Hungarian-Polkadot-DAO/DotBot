/**
 * Network Utility Functions
 * 
 * Helper functions for working with network types and metadata
 */

import type { Network, NetworkMetadata } from './types';
import { NETWORK_CONFIG } from './types';

/**
 * Get network metadata by network identifier
 */
export function getNetworkMetadata(network: Network): NetworkMetadata {
  return NETWORK_CONFIG[network];
}

/**
 * Detect network from chain name string
 * 
 * @param chainName Chain name from API (e.g., "Polkadot", "Kusama", "Westend")
 * @returns Detected network type
 */
export function detectNetworkFromChainName(chainName: string): Network {
  const name = chainName.toLowerCase();
  
  if (name.includes('westend')) {
    return 'westend';
  }
  
  if (name.includes('kusama') || name.includes('ksm')) {
    return 'kusama';
  }
  
  // Default to polkadot
  return 'polkadot';
}

/**
 * Get native token symbol for a network
 */
export function getNetworkTokenSymbol(network: Network): string {
  return NETWORK_CONFIG[network].nativeToken;
}

/**
 * Get token decimals for a network
 */
export function getNetworkDecimals(network: Network): number {
  return NETWORK_CONFIG[network].decimals;
}

/**
 * Get SS58 format for a network
 */
export function getNetworkSS58Format(network: Network): number {
  return NETWORK_CONFIG[network].ss58Format;
}

/**
 * Check if a network is a testnet
 */
export function isTestnet(network: Network): boolean {
  return NETWORK_CONFIG[network].isTestnet;
}

/**
 * Get relay chain RPC endpoints for a network
 */
export function getRelayChainEndpoints(network: Network): string[] {
  return NETWORK_CONFIG[network].rpcEndpoints.relay;
}

/**
 * Get Asset Hub RPC endpoints for a network
 */
export function getAssetHubEndpoints(network: Network): string[] {
  return NETWORK_CONFIG[network].rpcEndpoints.assetHub;
}

/**
 * Get all supported networks
 */
export function getSupportedNetworks(): Network[] {
  return ['polkadot', 'kusama', 'westend'];
}

/**
 * Get production networks only (exclude testnets)
 */
export function getProductionNetworks(): Network[] {
  return getSupportedNetworks().filter(network => !isTestnet(network));
}

/**
 * Get testnets only
 */
export function getTestnets(): Network[] {
  return getSupportedNetworks().filter(network => isTestnet(network));
}

/**
 * Validate if a string is a valid network identifier
 */
export function isValidNetwork(network: string): network is Network {
  return network === 'polkadot' || network === 'kusama' || network === 'westend';
}

/**
 * Parse network from string with fallback
 */
export function parseNetwork(network: string | undefined, fallback: Network = 'polkadot'): Network {
  if (!network) {
    return fallback;
  }
  
  return isValidNetwork(network) ? network : fallback;
}

/**
 * Compare two networks for equality
 */
export function isSameNetwork(network1: Network, network2: Network): boolean {
  return network1 === network2;
}

/**
 * Get user-friendly network name
 */
export function getNetworkDisplayName(network: Network): string {
  switch (network) {
    case 'polkadot':
      return 'Polkadot';
    case 'kusama':
      return 'Kusama';
    case 'westend':
      return 'Westend Testnet';
  }
}

/**
 * Get network description
 */
export function getNetworkDescription(network: Network): string {
  switch (network) {
    case 'polkadot':
      return 'Polkadot mainnet - production environment with real DOT tokens';
    case 'kusama':
      return 'Kusama canary network - production environment with real KSM tokens and experimental features';
    case 'westend':
      return 'Westend testnet - test environment with free WND tokens (no real value)';
  }
}

