/**
 * Shared utilities for simulation
 * 
 * This module provides reusable functions for simulation-related operations
 * to eliminate code duplication across the codebase.
 */

import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { SimulationContext } from './executionSimulator';
import { RpcManager } from '../../rpcManager';

/**
 * Create simulation context from executioner/orchestrator state
 * 
 * This is the single source of truth for creating SimulationContext objects.
 * Previously duplicated in 3 locations - now centralized here.
 * 
 * @param api API instance to use for simulation
 * @param accountAddress Account address for simulation
 * @param assetHubManager Asset Hub RPC manager (optional)
 * @param relayChainManager Relay Chain RPC manager (optional)
 * @param sessionEndpoint Optional: Endpoint the session API is connected to (for metadata consistency)
 * @param onStatusUpdate Optional status update callback
 * @returns SimulationContext ready for use
 */
export function createSimulationContext(
  api: ApiPromise,
  accountAddress: string,
  assetHubManager: RpcManager | null,
  relayChainManager: RpcManager | null,
  sessionEndpoint?: string,
  onStatusUpdate?: (status: any) => void
): SimulationContext {
  return {
    api,
    accountAddress,
    assetHubManager,
    relayChainManager,
    sessionEndpoint,
    onStatusUpdate,
  };
}

/**
 * Find API instance that matches extrinsic's registry
 * 
 * This is the single source of truth for API matching logic.
 * Previously duplicated in 2 locations - now centralized here.
 * 
 * CRITICAL: Must use the exact same API instance that created the extrinsic.
 * The extrinsic's call indices are tied to the specific API instance's metadata.
 * 
 * @param extrinsic Extrinsic to match
 * @param relayChainApi Relay Chain API instance (optional)
 * @param assetHubApi Asset Hub API instance (optional)
 * @returns Matching API instance, or relayChainApi as fallback
 */
export function findMatchingApi(
  extrinsic: SubmittableExtrinsic<'promise'>,
  relayChainApi: ApiPromise | null,
  assetHubApi: ApiPromise | null
): ApiPromise | null {
  // First, try exact registry match (most reliable)
  if (relayChainApi && relayChainApi.registry === extrinsic.registry) {
    return relayChainApi;
  }
  if (assetHubApi && assetHubApi.registry === extrinsic.registry) {
    return assetHubApi;
  }
  
  // Fallback: Use method section as heuristic
  // Asset Hub methods: 'assets', 'foreignAssets'
  const isAssetHubMethod = extrinsic.method.section === 'assets' || 
                           extrinsic.method.section === 'foreignAssets';
  
  if (isAssetHubMethod && assetHubApi) {
    return assetHubApi;
  }
  
  // Final fallback: return relay chain API (may cause metadata mismatch)
  return relayChainApi;
}

