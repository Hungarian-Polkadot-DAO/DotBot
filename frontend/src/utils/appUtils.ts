/**
 * App Utilities
 * 
 * Helper functions for App component initialization and setup.
 * Extracted to follow single responsibility and keep functions under 40 lines.
 */

import { DotBot, Environment, Network, createRpcManagersForNetwork, ScenarioEngine } from '@dotbot/core';
import type { RpcManager } from '@dotbot/core/rpcManager';

export interface WalletAccount {
  address: string;
  name?: string;
  source: string;
}

export interface RpcManagers {
  relayChainManager: RpcManager;
  assetHubManager: RpcManager;
}

/**
 * Derive network from environment
 */
export function getNetworkFromEnvironment(environment: Environment): Network {
  return environment === 'mainnet' ? 'polkadot' : 'westend';
}

/**
 * Preload network connections in background (before wallet connects)
 */
export async function preloadNetworkConnections(
  environment: Environment
): Promise<RpcManagers> {
  const network = getNetworkFromEnvironment(environment);
  
  // Create RPC managers (fast, doesn't connect yet)
  const managers = createRpcManagersForNetwork(network);
  
  // Pre-connect to Relay Chain in background
  await managers.relayChainManager.getReadApi();
  
  // Optionally pre-connect to Asset Hub (non-blocking)
  managers.assetHubManager.getReadApi().catch(() => {
    // Silently fail, will retry during full initialization
  });
  
  return managers;
}

/**
 * Create DotBot instance with configuration
 */
export async function createDotBotInstance(
  account: WalletAccount,
  environment: Environment,
  preloadedManagers: RpcManagers | null,
  onSigningRequest: (request: any) => void
): Promise<DotBot> {
  const network = getNetworkFromEnvironment(environment);
  
  const config: any = {
    wallet: account,
    environment,
    network,
    onSigningRequest,
    onBatchSigningRequest: onSigningRequest
  };
  
  // Use preloaded managers if available (saves connection time!)
  if (preloadedManagers) {
    config.relayChainManager = preloadedManagers.relayChainManager;
    config.assetHubManager = preloadedManagers.assetHubManager;
  }
  
  return await DotBot.create(config);
}

/**
 * Get signer from DotBot instance
 */
export function getSignerFromDotBot(dotbot: DotBot): any | null {
  const dotbotAny = dotbot as any;
  const executionSystem = dotbotAny.executionSystem;
  const executioner = executionSystem?.executioner;
  return executioner?.signer || null;
}

/**
 * Setup ScenarioEngine dependencies with DotBot instance
 */
export async function setupScenarioEngineDependencies(
  engine: ScenarioEngine,
  dotbot: DotBot,
  account: WalletAccount | null
): Promise<void> {
  await engine.initialize();
  const api = await dotbot.getApi();
  
  // Set wallet account and signer for live mode transfers
  if (account) {
    const signer = getSignerFromDotBot(dotbot);
    
    if (signer) {
      engine.setWalletForLiveMode(
        {
          address: account.address,
          name: account.name,
          source: account.source
        },
        signer
      );
    }
  }
  
  // Set dependencies for scenario execution
  engine.setDependencies({
    api,
    queryBalance: async (address: string) => {
      const entity = engine.getEntityByAddress(address);
      if (entity) {
        const state = engine.getState();
        const scenario = state.currentScenario;
        if (scenario?.walletState?.accounts) {
          const account = scenario.walletState.accounts.find(
            a => a.entityName === entity.name
          );
          if (account?.balance) {
            return account.balance;
          }
        }
      }
      return '0 DOT';
    },
    getEntityKeypair: (entityName: string) => {
      const entity = engine.getEntity(entityName);
      return entity?.uri ? { uri: entity.uri } : undefined;
    },
    getEntityAddress: (entityName: string) => {
      const entity = engine.getEntity(entityName);
      return entity?.address;
    },
  });
  
  // Subscribe to DotBot events for automatic response capture
  engine.subscribeToDotBot(dotbot);
  
  // Set RPC manager provider for StateAllocator
  engine.setRpcManagerProvider(() => {
    const dotbotAny = dotbot as any;
    return {
      relayChainManager: dotbotAny.relayChainManager,
      assetHubManager: dotbotAny.assetHubManager,
    };
  });
}

