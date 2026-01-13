/**
 * Chat API Route
 * Handles chat interactions with DotBot
 */

import { Router, Request, Response } from 'express';
import { AIService, AIServiceConfig, AIProviderType } from '@dotbot/core/services/ai/aiService';

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

    const aiService = createAIService(provider);
    const response = await aiService.sendMessage(message, context);

    res.json({
      success: true,
      response,
      provider: aiService.getProviderType(),
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('[Chat API] Error processing chat request:', error);
    
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
