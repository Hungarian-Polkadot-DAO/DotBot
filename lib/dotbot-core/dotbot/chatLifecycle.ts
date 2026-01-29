/**
 * Chat lifecycle: init/load/clear chat, switch environment, load by id.
 */

import { createRpcManagersForNetwork } from '../rpcManager';
import type { Network } from '../rpcManager';
import { ChatInstance } from '../chat/chatInstance';
import type { Environment } from '../chat/types';
import { DotBotEventType } from './types';

type DotBotInstance = any;

/** Load or create chat for current env/wallet; init execution sessions. */
export async function initializeChatInstance(dotbot: DotBotInstance): Promise<void> {
  try {
    const instances = await dotbot.chatManager.queryInstances({
      environment: dotbot.environment,
      walletAddress: dotbot.wallet.address,
      archived: false,
    });
    if (instances.length > 0) {
      dotbot.currentChat = new ChatInstance(instances[0], dotbot.chatManager, dotbot.chatPersistenceEnabled);
      dotbot.chatLogger.info({ chatId: dotbot.currentChat.id, action: 'loaded' }, 'Loaded chat');
    } else {
      dotbot.currentChat = await ChatInstance.create(
        {
          environment: dotbot.environment,
          network: dotbot.network,
          walletAddress: dotbot.wallet.address,
          title: `Chat - ${dotbot.network}`,
        },
        dotbot.chatManager,
        dotbot.chatPersistenceEnabled
      );
      dotbot.chatLogger.info({ chatId: dotbot.currentChat.id, action: 'created' }, `Created new chat: ${dotbot.currentChat.id}`);
    }
    if (dotbot.currentChat) {
      try {
        await dotbot.currentChat.initializeExecutionSessions(dotbot.relayChainManager, dotbot.assetHubManager);
        dotbot.chatLogger.debug({ chatId: dotbot.currentChat.id }, 'Execution sessions initialized for chat');
      } catch (error) {
        dotbot.chatLogger.warn(
          { chatId: dotbot.currentChat.id, error: error instanceof Error ? error.message : String(error) },
          'Failed to init execution sessions (will retry during execution)'
        );
      }
    }
  } catch (error) {
    dotbot.chatLogger.error(
      { error: error instanceof Error ? error.message : String(error), environment: dotbot.environment, network: dotbot.network, walletAddress: dotbot.wallet.address },
      'Failed to initialize chat instance'
    );
    dotbot.currentChat = null;
  }
}

async function initSessionsForCurrentChat(dotbot: DotBotInstance): Promise<void> {
  if (!dotbot.currentChat) return;
  try {
    await dotbot.currentChat.initializeExecutionSessions(dotbot.relayChainManager, dotbot.assetHubManager);
    dotbot.chatLogger.debug({ chatId: dotbot.currentChat.id }, 'Execution sessions initialized');
  } catch (error) {
    dotbot.chatLogger.warn(
      { chatId: dotbot.currentChat.id, error: error instanceof Error ? error.message : String(error) },
      'Failed to init execution sessions (will retry during execution)'
    );
  }
}

/** Start new chat (new ChatInstance, init sessions). */
export async function clearHistory(dotbot: DotBotInstance): Promise<void> {
  if (!dotbot.chatPersistenceEnabled) return;
  dotbot.currentChat = await ChatInstance.create(
    {
      environment: dotbot.environment,
      network: dotbot.network,
      walletAddress: dotbot.wallet.address,
      title: `Chat - ${dotbot.network}`,
    },
    dotbot.chatManager,
    dotbot.chatPersistenceEnabled
  );
  await initSessionsForCurrentChat(dotbot);
  dotbot.chatLogger.info({ chatId: dotbot.currentChat!.id }, 'Started new chat');
}

export async function switchEnvironment(dotbot: DotBotInstance, environment: Environment, network?: Network): Promise<void> {
  const targetNetwork = network || (environment === 'mainnet' ? 'polkadot' : 'westend');
  const validation = dotbot.chatManager.validateNetworkForEnvironment(targetNetwork, environment);
  if (!validation.valid) throw new Error(validation.error || 'Invalid network for environment');
  if (dotbot.currentChat) dotbot.currentChat.cleanupExecutionSessions();
  dotbot.environment = environment;
  dotbot.network = targetNetwork;
  const managers = createRpcManagersForNetwork(targetNetwork);
  dotbot.relayChainManager = managers.relayChainManager;
  dotbot.assetHubManager = managers.assetHubManager;
  dotbot.api = null;
  dotbot.assetHubApi = null;
  dotbot.executionSystemInitialized = false;
  dotbot.rpcLogger.debug({ network: targetNetwork }, 'switchEnvironment: RPC managers created, lazy load when needed');
  if (dotbot.chatPersistenceEnabled) {
    dotbot.currentChat = await ChatInstance.create(
      { environment: dotbot.environment, network: dotbot.network, walletAddress: dotbot.wallet.address, title: `Chat - ${dotbot.network}` },
      dotbot.chatManager,
      dotbot.chatPersistenceEnabled
    );
    dotbot.chatLogger.info({ environment, network: targetNetwork, chatId: dotbot.currentChat.id }, `Switched to ${environment} (${targetNetwork}), new chat`);
  }
}

/** Load chat by id; switch env/network if needed, init sessions, emit CHAT_LOADED. */
export async function loadChatInstance(dotbot: DotBotInstance, chatId: string): Promise<void> {
  const chatData = await dotbot.chatManager.loadInstance(chatId);
  if (!chatData) throw new Error(`Chat instance ${chatId} not found`);
  if (dotbot.currentChat) dotbot.currentChat.cleanupExecutionSessions();
  const needsEnvironmentSwitch = chatData.environment !== dotbot.environment;
  const needsNetworkSwitch = chatData.network !== dotbot.network;
  if (needsEnvironmentSwitch || needsNetworkSwitch) {
    dotbot.environment = chatData.environment;
    dotbot.network = chatData.network;
    const managers = createRpcManagersForNetwork(chatData.network);
    dotbot.relayChainManager = managers.relayChainManager;
    dotbot.assetHubManager = managers.assetHubManager;
    dotbot.api = null;
    dotbot.assetHubApi = null;
    dotbot.executionSystemInitialized = false;
    dotbot.rpcLogger.debug({ network: chatData.network }, 'loadChatInstance: RPC managers for network switch, lazy load when needed');
  }
  dotbot.currentChat = new ChatInstance(chatData, dotbot.chatManager, dotbot.chatPersistenceEnabled);
  await initSessionsForCurrentChat(dotbot);
  dotbot.chatLogger.info(
    { chatId: dotbot.currentChat.id, messageCount: dotbot.currentChat.getDisplayMessages().length, executionCount: dotbot.currentChat.getDisplayMessages().filter((m: { type: string }) => m.type === 'execution').length },
    'Loaded chat instance (RPCs connect lazily when execution starts)'
  );
  dotbot.emit({ type: DotBotEventType.CHAT_LOADED, chatId: dotbot.currentChat.id, messageCount: dotbot.currentChat.getDisplayMessages().length });
}
