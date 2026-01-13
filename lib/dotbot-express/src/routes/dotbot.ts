/**
 * DotBot Chat API Route
 * 
 * Full DotBot chat endpoint that wraps DotBot.chat() on the backend.
 * This is where all AI communication happens - frontend is just a client.
 */

import { Router, Request, Response } from 'express';
import { DotBot, DotBotConfig, ChatOptions, ChatResult, Environment, Network, InMemoryChatStorage } from '@dotbot/core';
import { AIService, AIServiceConfig, AIProviderType } from '@dotbot/core/services/ai';
import { ChatInstanceManager } from '@dotbot/core/chatInstanceManager';
import { ENVIRONMENT_NETWORKS } from '@dotbot/core/types/chatInstance';
import { apiLogger, dotbotLogger, sessionLogger, errorLogger } from '../utils/logger';

const router = Router();

// Store DotBot instances per session (in production, use Redis or similar)
// Key: sessionId (could be wallet address or user ID)
const dotbotInstances: Map<string, DotBot> = new Map();

/**
 * Chat request body structure
 */
interface DotBotChatRequest {
  message: string;
  sessionId?: string; // Optional session identifier
  wallet: {
    address: string;
    name?: string;
    source: string;
  };
  environment?: Environment;
  network?: Network;
  options?: {
    systemPrompt?: string;
    conversationHistory?: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp?: number }>;
    executionOptions?: any;
  };
  provider?: AIProviderType;
}

/**
 * Normalize network and environment - ensure they match
 * If network is provided, derive environment from it
 * If only environment is provided, use default network for that environment
 */
function normalizeNetworkAndEnvironment(
  environment?: Environment,
  network?: Network
): { environment: Environment; network: Network } {
  // If network is provided, derive environment from it
  if (network) {
    for (const [env, networks] of Object.entries(ENVIRONMENT_NETWORKS)) {
      if (networks.includes(network)) {
        return { environment: env as Environment, network };
      }
    }
    // Unknown network, default to mainnet/polkadot
    return { environment: 'mainnet', network: 'polkadot' };
  }

  // If only environment is provided, use default network
  if (environment) {
    const networks = ENVIRONMENT_NETWORKS[environment];
    const defaultNetwork = networks[0]; // First network is default
    return { environment, network: defaultNetwork };
  }

  // Default to mainnet/polkadot
  return { environment: 'mainnet', network: 'polkadot' };
}

/**
 * Create or get DotBot instance for a session
 */
async function getOrCreateDotBot(
  sessionId: string,
  wallet: { address: string; name?: string; source: string },
  environment?: Environment,
  network?: Network
): Promise<DotBot> {
  // Normalize network and environment to ensure they match
  const { environment: normalizedEnv, network: normalizedNetwork } = normalizeNetworkAndEnvironment(environment, network);

  // Check if instance exists
  if (dotbotInstances.has(sessionId)) {
    const existing = dotbotInstances.get(sessionId)!;
    // Verify it's for the same wallet/environment
    if (existing.getWallet().address === wallet.address && 
        existing.getEnvironment() === normalizedEnv &&
        existing.getNetwork() === normalizedNetwork) {
      return existing;
    }
    // Different wallet/environment/network, create new
    dotbotInstances.delete(sessionId);
  }

  // Create new DotBot instance
  // Backend uses in-memory storage (data not persisted on server)
  // Frontend will use localStorage for persistence
  const chatManager = new ChatInstanceManager({
    storage: new InMemoryChatStorage(),
  });

  const config: DotBotConfig = {
    wallet: {
      address: wallet.address,
      name: wallet.name,
      source: wallet.source,
    },
    environment: normalizedEnv,
    network: normalizedNetwork,
    // Backend handles signing requests differently - we'll need to handle this
    // For now, we'll auto-approve (NOT for production!)
    autoApprove: false, // Will need proper signing flow
    chatManager, // Use in-memory storage for backend
  };

  const dotbot = await DotBot.create(config);
  dotbotInstances.set(sessionId, dotbot);
  
  return dotbot;
}

/**
 * Create AI service for backend (uses environment variables)
 */
function createAIService(provider?: AIProviderType): AIService {
  const config: AIServiceConfig = {
    providerType: provider,
  };
  return new AIService(config);
}

/**
 * POST /api/dotbot/chat
 * Full DotBot chat endpoint - handles AI communication on backend
 */
router.post('/chat', async (req: Request, res: Response) => {
  let effectiveSessionId: string | undefined;
  
  try {
    const {
      message,
      sessionId,
      wallet,
      environment = 'mainnet',
      network,
      options = {},
      provider
    }: DotBotChatRequest = req.body;

    // Validate request
    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Message field is required and must be a string'
      });
    }

    if (!wallet || !wallet.address) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Wallet address is required'
      });
    }

    // Generate session ID if not provided (use wallet address)
    effectiveSessionId = sessionId || `wallet:${wallet.address}:${environment}`;

    // Get or create DotBot instance
    dotbotLogger.info({ 
      sessionId: effectiveSessionId,
      wallet: wallet.address,
      environment,
      network 
    }, 'Creating/getting DotBot instance');
    
    const dotbot = await getOrCreateDotBot(effectiveSessionId, wallet, environment, network);

    // Create AI service for this request
    const aiService = createAIService(provider);
    apiLogger.info({ provider: aiService.getProviderType() }, 'AI service created');

    // Prepare chat options with backend AI service
    const chatOptions: ChatOptions = {
      ...options,
      // Override LLM to use backend AI service
      llm: async (msg: string, systemPrompt: string, context?: any) => {
        return await aiService.sendMessage(msg, {
          systemPrompt,
          ...context,
          walletAddress: wallet.address,
          network: dotbot.getNetwork().charAt(0).toUpperCase() + dotbot.getNetwork().slice(1),
          conversationHistory: options.conversationHistory || []
        });
      }
    };

    // Call DotBot.chat() - this handles everything (AI, execution planning, etc.)
    dotbotLogger.info({ 
      sessionId: effectiveSessionId,
      messageLength: message.length 
    }, 'Processing DotBot chat request');
    
    const result: ChatResult = await dotbot.chat(message, chatOptions);

    dotbotLogger.info({ 
      sessionId: effectiveSessionId,
      executed: result.executed,
      success: result.success,
      completed: result.completed,
      failed: result.failed
    }, 'DotBot chat completed');

    // Return result
    res.json({
      success: true,
      result,
      sessionId: effectiveSessionId,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    errorLogger.error({ 
      error: error.message,
      stack: error.stack,
      sessionId: effectiveSessionId 
    }, 'Error processing chat request');
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message || 'Failed to process chat request',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/dotbot/session
 * Create or get a DotBot session
 */
router.post('/session', async (req: Request, res: Response) => {
  let wallet: { address: string; name?: string; source: string } | undefined;
  
  try {
    const {
      sessionId,
      wallet: walletParam,
      environment = 'mainnet',
      network
    } = req.body;

    wallet = walletParam;

    if (!wallet || !wallet.address) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Wallet address is required'
      });
    }

    const effectiveSessionId = sessionId || `wallet:${wallet.address}:${environment}`;
    sessionLogger.info({ 
      sessionId: effectiveSessionId,
      wallet: wallet.address,
      environment,
      network 
    }, 'Creating/getting session');
    
    const dotbot = await getOrCreateDotBot(effectiveSessionId, wallet, environment, network);

    sessionLogger.info({ 
      sessionId: effectiveSessionId,
      environment: dotbot.getEnvironment(),
      network: dotbot.getNetwork()
    }, 'Session created/retrieved');

    res.json({
      success: true,
      sessionId: effectiveSessionId,
      environment: dotbot.getEnvironment(),
      network: dotbot.getNetwork(),
      wallet: dotbot.getWallet(),
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    sessionLogger.error({ 
      error: error.message,
      stack: error.stack,
      wallet: wallet?.address 
    }, 'Error creating session');
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message || 'Failed to create session',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/dotbot/session/:sessionId
 * Get session info
 */
router.get('/session/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  
  try {
    const dotbot = dotbotInstances.get(sessionId);

    if (!dotbot) {
      return res.status(404).json({
        error: 'Session not found',
        message: `No DotBot session found for ID: ${sessionId}`
      });
    }

    res.json({
      success: true,
      sessionId,
      environment: dotbot.getEnvironment(),
      network: dotbot.getNetwork(),
      wallet: dotbot.getWallet(),
      currentChatId: dotbot.currentChat?.id || null,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    sessionLogger.error({ 
      error: error.message,
      stack: error.stack,
      sessionId 
    }, 'Error getting session');
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message || 'Failed to get session',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * DELETE /api/dotbot/session/:sessionId
 * Delete a session
 */
router.delete('/session/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  
  try {
    const deleted = dotbotInstances.delete(sessionId);

    res.json({
      success: deleted,
      message: deleted ? 'Session deleted' : 'Session not found',
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    sessionLogger.error({ 
      error: error.message,
      stack: error.stack,
      sessionId 
    }, 'Error deleting session');
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message || 'Failed to delete session',
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
