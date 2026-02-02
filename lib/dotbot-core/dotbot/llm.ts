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
  const trimmed = llmResponse.trim();
  const startsWithJsonBlock = trimmed.startsWith('```json');
  const hasJsonBlock = /\s*```json\s*[\s\S]*?```/.test(llmResponse);
  // Prose phrases ASI-One and similar models use when violating "JSON only" (U+0027 and U+2019 for apostrophe)
  const looksLikeCommandProse = /I[\u0027\u2019']?ve prepared|prepared a transaction|transaction flow|\d+ step for|details below|when ready|Accept and Start|Review the details/i.test(llmResponse);
  const shouldRetryFormat = !startsWithJsonBlock && (hasJsonBlock || looksLikeCommandProse);

  dotbot.dotbotLogger.info(
    {
      responseLength: llmResponse.length,
      responsePreview: llmResponse.length <= previewLen ? llmResponse : llmResponse.slice(0, previewLen) + '...',
      hasJsonBlock,
      startsWithJsonBlock,
      looksLikeCommandProse,
      shouldRetryFormat,
    },
    'LLM raw response'
  );
  dotbot.dotbotLogger.debug(
    { startsWithJsonBlock, hasJsonBlock, looksLikeCommandProse, shouldRetryFormat },
    'Guardrail: format check'
  );

  // RETRY GUARD: Format violation — response should start with ```json for ExecutionPlan
  // Trigger when: (1) prose before JSON, or (2) pure prose that looks like command response ("I've prepared...")
  if (shouldRetryFormat) {
    dotbot.dotbotLogger.warn(
      { responsePreview: llmResponse.substring(0, 200), hasJsonBlock, looksLikeCommandProse },
      'LLM format violation - retrying with format correction'
    );
    
    // Retry once with a strong correction message
    const correctionPrompt = `${systemPrompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ SYSTEM CORRECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You violated the output format in your previous response.
You returned prose (e.g. "I've prepared a transaction flow...") instead of ONLY the JSON ExecutionPlan.

Return ONLY the JSON ExecutionPlan.
NO prose. NO explanation. NO text before or after.
ONLY the \`\`\`json code block.`;
    
    llmResponse = await callLLM(dotbot, message, correctionPrompt, options?.llm, conversationHistory);
    
    dotbot.dotbotLogger.info(
      {
        responseLength: llmResponse.length,
        responsePreview: llmResponse.length <= previewLen ? llmResponse : llmResponse.slice(0, previewLen) + '...',
        hasJsonBlock: /\s*```json\s*[\s\S]*?```/.test(llmResponse),
        isRetry: true,
      },
      'LLM retry response after format correction'
    );
  }
  
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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    dotbot.dotbotLogger.warn(
      {
        error: errorMessage,
        network: dotbot.network,
        walletAddress: dotbot.wallet?.address ?? '(unknown)',
      },
      'Context build failed (RPC/balance/chain). Falling back to prompt WITHOUT wallet/context. ' +
        'Execution plans may lack sender → "Invalid sender address: Address is required" when user prepares execution.'
    );
    // Don't create system prompt if we can't get the context.
    throw new Error(`Failed to build system prompt: ${errorMessage}`);
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
