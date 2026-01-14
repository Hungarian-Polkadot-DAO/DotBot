/**
 * Simple Chat API Route
 * 
 * Provides a simple AI chat endpoint without blockchain functionality.
 * This is a lightweight alternative to /api/dotbot/chat for basic AI interactions.
 * 
 * Use /api/dotbot/chat for full DotBot functionality (blockchain operations, execution, etc.)
 * TODO: Probably this file should be renamed
 */

import { Router, Request, Response } from 'express';
import { AIService, AIServiceConfig, AIProviderType } from '@dotbot/core/services/ai';
import { apiLogger, errorLogger } from '../utils/logger';

const router = Router();

/**
 * Chat request body structure
 */
interface ChatRequest {
  message: string;
  context?: any;
  provider?: AIProviderType;
}

/**
 * Initialize AI service with server-side configuration
 * API keys are managed securely on the backend
 */
function createAIService(provider?: AIProviderType): AIService {
  const config: AIServiceConfig = {
    providerType: provider,
  };
  
  return new AIService(config);
}

/**
 * POST /api/chat
 * Main chat endpoint for AI interactions
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { message, context, provider }: ChatRequest = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Message field is required and must be a string'
      });
    }

    apiLogger.info({ 
      messageLength: message.length,
      hasContext: !!context,
      provider 
    }, 'Processing simple chat request');

    const aiService = createAIService(provider);
    const response = await aiService.sendMessage(message, context);

    apiLogger.info({ 
      provider: aiService.getProviderType(),
      responseLength: response.length 
    }, 'Chat response generated');

    res.json({
      success: true,
      response,
      provider: aiService.getProviderType(),
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    errorLogger.error({ 
      error: error.message,
      stack: error.stack 
    }, 'Error processing chat request');
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message || 'Failed to process chat request',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/chat/providers
 * Returns available AI providers
 */
router.get('/providers', (req: Request, res: Response) => {
  res.json({
    providers: Object.values(AIProviderType),
    default: AIProviderType.ASI_ONE
  });
});

export default router;
