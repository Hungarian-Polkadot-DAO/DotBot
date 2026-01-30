/**
 * LLM: get response, build contextual prompt, call custom or AI-service LLM.
 */

import { buildSystemPrompt } from '../prompts/system/loader';
import { processSystemQueries, areSystemQueriesEnabled } from '../prompts/system/systemQuery';
import type { ChatOptions, ConversationMessage } from './types';

type DotBotInstance = any;

/** System prompt (or override), history, then call LLM; optional system-query post-process. */
export async function getLLMResponse(dotbot: DotBotInstance, message: string, options?: ChatOptions): Promise<string> {
  const systemPrompt = options?.systemPrompt || (await buildContextualSystemPrompt(dotbot));
  const conversationHistory = options?.conversationHistory || dotbot.getHistory();
  let llmResponse = await callLLM(dotbot, message, systemPrompt, options?.llm, conversationHistory);
  // Optional: post-process LLM output for system queries (e.g. balance lookup) when custom LLM is used
  if (areSystemQueriesEnabled() && options?.llm) {
    llmResponse = await processSystemQueries(
      llmResponse,
      systemPrompt,
      message,
      async (msg, prompt) => callLLM(dotbot, msg, prompt, options!.llm, conversationHistory)
    );
  }
  // Log raw LLM response so it can be found easily (e.g. to debug plan extraction or wrong replies)
  const previewLen = 300;
  dotbot.dotbotLogger.info(
    {
      responseLength: llmResponse.length,
      responsePreview: llmResponse.length <= previewLen ? llmResponse : llmResponse.slice(0, previewLen) + '...',
            hasJsonBlock: /\s*```json\s*[\s\S]*?```/.test(llmResponse),
    },
    'LLM raw response'
  );
  return llmResponse;
}

/** Build system prompt with wallet, network, balance (or fallback to basic). */
export async function buildContextualSystemPrompt(dotbot: DotBotInstance): Promise<string> {
  await dotbot.ensureRpcConnectionsReady();
  try {
    const balance = await dotbot.getBalance();
    await dotbot.getChainInfo(); // ensure chain info available for prompt
    const tokenSymbol = dotbot.network === 'westend' ? 'WND' : dotbot.network === 'kusama' ? 'KSM' : 'DOT';
    const relayChainDecimals = dotbot.api!.registry.chainDecimals?.[0];
    const assetHubDecimals = dotbot.assetHubApi?.registry.chainDecimals?.[0];
    return await buildSystemPrompt({
      wallet: { isConnected: true, address: dotbot.wallet.address, provider: dotbot.wallet.source },
      network: {
        network: dotbot.network,
        rpcEndpoint: dotbot.relayChainManager.getCurrentEndpoint() || '',
        isTestnet: dotbot.network === 'westend',
        relayChainDecimals,
        assetHubDecimals,
      },
      balance: {
        relayChain: { free: balance.relayChain.free, reserved: balance.relayChain.reserved, frozen: balance.relayChain.frozen },
        assetHub: balance.assetHub ? { free: balance.assetHub.free, reserved: balance.assetHub.reserved, frozen: balance.assetHub.frozen } : null,
        total: balance.total,
        symbol: tokenSymbol,
      },
    });
  } catch {
    // Fallback to basic prompt if balance/chain fetch fails
    return await buildSystemPrompt();
  }
}

/** Call custom LLM or config.aiService; throw if neither set. */
export async function callLLM(
  dotbot: DotBotInstance,
  message: string,
  systemPrompt: string,
  customLLM?: (message: string, systemPrompt: string, context?: unknown) => Promise<string>,
  conversationHistory?: ConversationMessage[]
): Promise<string> {
  if (customLLM) {
    return await customLLM(message, systemPrompt, { conversationHistory: conversationHistory || [] });
  }
  if (dotbot.aiService) {
    return await dotbot.aiService.sendMessage(message, {
      systemPrompt,
      conversationHistory: conversationHistory || [],
      walletAddress: dotbot.wallet.address,
      network: dotbot.network.charAt(0).toUpperCase() + dotbot.network.slice(1),
    });
  }
  // No LLM configured
  throw new Error(
    'No LLM configured. Either pass an AI service in DotBot config or a custom llm in chat options: dotbot.chat(message, { llm: async (msg, prompt, context) => { ... } })'
  );
}
