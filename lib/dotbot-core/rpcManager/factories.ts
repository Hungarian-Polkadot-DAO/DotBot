/**
 * RPC Manager Factory Functions
 * 
 * Convenience functions for creating RPC managers for specific networks
 */

import { RpcManager } from './RpcManager';
import { RpcEndpoints } from './endpoints';
import type { Network } from './types';

/**
 * Get RPC endpoints for a specific network
 */
export function getEndpointsForNetwork(network: Network): {
  relayChain: string[];
  assetHub: string[];
} {
  switch (network) {
    case 'polkadot':
      return {
        relayChain: RpcEndpoints.POLKADOT_RELAY_CHAIN,
        assetHub: RpcEndpoints.POLKADOT_ASSET_HUB,
      };
    case 'kusama':
      return {
        relayChain: RpcEndpoints.KUSAMA_RELAY_CHAIN,
        assetHub: RpcEndpoints.KUSAMA_ASSET_HUB,
      };
    case 'westend':
      return {
        relayChain: RpcEndpoints.WESTEND_RELAY_CHAIN,
        assetHub: RpcEndpoints.WESTEND_ASSET_HUB,
      };
    default:
      throw new Error(`Unknown network: ${network}`);
  }
}

/**
 * Create RPC managers for a specific network
 */
export function createRpcManagersForNetwork(network: Network): {
  relayChainManager: RpcManager;
  assetHubManager: RpcManager;
} {
  const endpoints = getEndpointsForNetwork(network);
  
  // Westend testnet endpoints are often slower, use shorter timeout to fail faster
  const connectionTimeout = network === 'westend' ? 5000 : 10000;
  
  return {
    relayChainManager: new RpcManager({
      endpoints: endpoints.relayChain,
      failoverTimeout: 5 * 60 * 1000,
      connectionTimeout,
      storageKey: `dotbot_rpc_health_${network}_relay`,
      healthDataMaxAge: 24 * 60 * 60 * 1000,
    }),
    assetHubManager: new RpcManager({
      endpoints: endpoints.assetHub,
      failoverTimeout: 5 * 60 * 1000,
      connectionTimeout,
      storageKey: `dotbot_rpc_health_${network}_asset_hub`,
      healthDataMaxAge: 24 * 60 * 60 * 1000,
    }),
  };
}

// ============================================================================
// Polkadot Factory Functions
// ============================================================================

/**
 * Create a RPC manager for Polkadot Relay Chain
 */
export function createPolkadotRelayChainManager(): RpcManager {
  return new RpcManager({
    endpoints: RpcEndpoints.POLKADOT_RELAY_CHAIN,
    failoverTimeout: 5 * 60 * 1000,
    connectionTimeout: 10000,
    storageKey: 'dotbot_rpc_health_polkadot_relay',
    healthDataMaxAge: 24 * 60 * 60 * 1000,
  });
}

/**
 * Create a RPC manager for Polkadot Asset Hub
 */
export function createPolkadotAssetHubManager(): RpcManager {
  return new RpcManager({
    endpoints: RpcEndpoints.POLKADOT_ASSET_HUB,
    failoverTimeout: 5 * 60 * 1000,
    connectionTimeout: 10000,
    storageKey: 'dotbot_rpc_health_polkadot_asset_hub',
    healthDataMaxAge: 24 * 60 * 60 * 1000,
  });
}

// ============================================================================
// Kusama Factory Functions
// ============================================================================

/**
 * Create a RPC manager for Kusama Relay Chain
 */
export function createKusamaRelayChainManager(): RpcManager {
  return new RpcManager({
    endpoints: RpcEndpoints.KUSAMA_RELAY_CHAIN,
    failoverTimeout: 5 * 60 * 1000,
    connectionTimeout: 10000,
    storageKey: 'dotbot_rpc_health_kusama_relay',
    healthDataMaxAge: 24 * 60 * 60 * 1000,
  });
}

/**
 * Create a RPC manager for Kusama Asset Hub
 */
export function createKusamaAssetHubManager(): RpcManager {
  return new RpcManager({
    endpoints: RpcEndpoints.KUSAMA_ASSET_HUB,
    failoverTimeout: 5 * 60 * 1000,
    connectionTimeout: 10000,
    storageKey: 'dotbot_rpc_health_kusama_asset_hub',
    healthDataMaxAge: 24 * 60 * 60 * 1000,
  });
}

// ============================================================================
// Westend Factory Functions
// ============================================================================

/**
 * Create a RPC manager for Westend Relay Chain
 */
export function createWestendRelayChainManager(): RpcManager {
  return new RpcManager({
    endpoints: RpcEndpoints.WESTEND_RELAY_CHAIN,
    failoverTimeout: 5 * 60 * 1000,
    connectionTimeout: 10000,
    storageKey: 'dotbot_rpc_health_westend_relay',
    healthDataMaxAge: 24 * 60 * 60 * 1000,
  });
}

/**
 * Create a RPC manager for Westend Asset Hub
 */
export function createWestendAssetHubManager(): RpcManager {
  return new RpcManager({
    endpoints: RpcEndpoints.WESTEND_ASSET_HUB,
    failoverTimeout: 5 * 60 * 1000,
    connectionTimeout: 10000,
    storageKey: 'dotbot_rpc_health_westend_asset_hub',
    healthDataMaxAge: 24 * 60 * 60 * 1000,
  });
}

// ============================================================================
// Legacy Factory Functions (backward compatibility)
// ============================================================================

/**
 * Create a RPC manager for Relay Chain (defaults to Polkadot)
 * @deprecated Use createPolkadotRelayChainManager() or createRpcManagersForNetwork()
 */
export function createRelayChainManager(): RpcManager {
  return createPolkadotRelayChainManager();
}

/**
 * Create a RPC manager for Asset Hub (defaults to Polkadot)
 * @deprecated Use createPolkadotAssetHubManager() or createRpcManagersForNetwork()
 */
export function createAssetHubManager(): RpcManager {
  return createPolkadotAssetHubManager();
}
