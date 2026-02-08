/**
 * DotBot factory - builds constructor args for DotBot.
 * Used by DotBot.create(): it calls getCreateArgs(config), then `new DotBot(...args)`.
 */

import { createSubsystemLogger, Subsystem } from '../services/logger';
import { createRpcManagersForNetwork } from '../rpcManager';
import { ExecutionSystem } from '../executionEngine/system';
import { ChatInstanceManager } from '../chat/chatInstanceManager';
import type { DotBotConfig, DotBotConstructorArgs } from './types';

/**
 * Builds the arguments needed to construct a DotBot instance.
 * Validates config, resolves network/env, creates or reuses RPC managers and chat manager.
 * RPC connections are lazy-loaded later; signer is set up in ensureRpcConnectionsReady().
 */
export function getCreateArgs(config: DotBotConfig): DotBotConstructorArgs {
  if (!config.wallet) {
    throw new Error('Wallet is required. Please provide a wallet account in the config.');
  }

  const configuredNetwork = config.network || 'polkadot';
  const environment = config.environment || 'mainnet';

  let relayChainManager;
  let assetHubManager;

  if (config.relayChainManager && config.assetHubManager) {
    relayChainManager = config.relayChainManager;
    assetHubManager = config.assetHubManager;
  } else {
    const managers = createRpcManagersForNetwork(configuredNetwork);
    relayChainManager = managers.relayChainManager;
    assetHubManager = managers.assetHubManager;
  }

  const rpcLogger = createSubsystemLogger(Subsystem.RPC);
  rpcLogger.debug({ network: configuredNetwork }, 'DotBot.create: RPC connections will be lazy-loaded when needed');

  const dotbotLogger = createSubsystemLogger(Subsystem.DOTBOT);
  dotbotLogger.info(
    { network: configuredNetwork, environment },
    `Network: ${configuredNetwork}, Environment: ${environment}`
  );

  const executionSystem = new ExecutionSystem();
  const chatManager = config.chatManager || new ChatInstanceManager();

  return {
    api: null,
    executionSystem,
    config,
    network: configuredNetwork,
    environment,
    relayChainManager,
    assetHubManager,
    chatManager,
  };
}
