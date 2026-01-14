/**
 * Unit tests for Chat routes
 */

import { Request, Response } from 'express';
import chatRouter from '../../routes/chat';
import { AIService, AIProviderType } from '@dotbot/core/services/ai';

// Mock AIService
jest.mock('@dotbot/core/services/ai', () => ({
  AIService: jest.fn(),
  AIProviderType: {
    ASI_ONE: 'asi-one',
    OPENAI: 'openai',
    ANTHROPIC: 'anthropic',
  },
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  apiLogger: {
    info: jest.fn(),
    error: jest.fn(),
  },
  errorLogger: {
    error: jest.fn(),
  },
}));

describe('Chat Routes', () => {
  let mockAIService: jest.Mocked<AIService>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock AI Service
    mockAIService = {
      sendMessage: jest.fn(),
      getProviderType: jest.fn().mockReturnValue('asi-one'),
    } as any;

    (AIService as jest.Mock).mockImplementation(() => mockAIService);

    // Create mock Express objects
    mockRequest = {
      body: {},
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();
  });

  describe('POST /api/chat', () => {
    const chatHandler = chatRouter.stack.find(
      (layer: any) => layer.route?.path === '/' && layer.route?.methods?.post
    )?.route?.stack[0]?.handle;

    if (!chatHandler) {
      throw new Error('Chat handler not found');
    }

    it('should return 400 if message is missing', async () => {
      mockRequest.body = {};

      await chatHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid request',
        message: 'Message field is required and must be a string',
      });
    });

    it('should return 400 if message is not a string', async () => {
      mockRequest.body = {
        message: 123,
      };

      await chatHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid request',
        message: 'Message field is required and must be a string',
      });
    });

    it('should create AI service and send message', async () => {
      mockAIService.sendMessage = jest.fn().mockResolvedValue('AI response');
      mockRequest.body = {
        message: 'Hello, AI!',
      };

      await chatHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(AIService).toHaveBeenCalled();
      expect(mockAIService.sendMessage).toHaveBeenCalledWith('Hello, AI!', undefined);
    });

    it('should pass context to AI service if provided', async () => {
      const context = { previousMessages: ['msg1', 'msg2'] };
      mockAIService.sendMessage = jest.fn().mockResolvedValue('AI response');
      mockRequest.body = {
        message: 'Hello',
        context,
      };

      await chatHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockAIService.sendMessage).toHaveBeenCalledWith('Hello', context);
    });

    it('should use provider from request if provided', async () => {
      mockAIService.sendMessage = jest.fn().mockResolvedValue('AI response');
      mockRequest.body = {
        message: 'Hello',
        provider: 'openai' as AIProviderType,
      };

      await chatHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(AIService).toHaveBeenCalledWith(
        expect.objectContaining({
          providerType: 'openai',
        })
      );
    });

    it('should return success response with AI response', async () => {
      mockAIService.sendMessage = jest.fn().mockResolvedValue('AI response text');
      mockRequest.body = {
        message: 'Hello',
      };

      await chatHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        response: 'AI response text',
        provider: 'asi-one',
        timestamp: expect.any(String),
      });
    });

    it('should handle errors and return 500', async () => {
      const error = new Error('AI service error');
      mockAIService.sendMessage = jest.fn().mockRejectedValue(error);
      mockRequest.body = {
        message: 'Hello',
      };

      await chatHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Internal server error',
        message: 'AI service error',
        timestamp: expect.any(String),
      });
    });

    it('should handle errors without message', async () => {
      const error = new Error('');
      mockAIService.sendMessage = jest.fn().mockRejectedValue(error);
      mockRequest.body = {
        message: 'Hello',
      };

      await chatHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Internal server error',
        message: 'Failed to process chat request',
        timestamp: expect.any(String),
      });
    });
  });

  describe('GET /api/chat/providers', () => {
    const providersHandler = chatRouter.stack.find(
      (layer: any) => layer.route?.path === '/providers' && layer.route?.methods?.get
    )?.route?.stack[0]?.handle;

    if (!providersHandler) {
      throw new Error('Providers handler not found');
    }

    it('should return available providers', () => {
      providersHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        providers: expect.any(Array),
        default: 'asi-one',
      });
    });

    it('should include all provider types', () => {
      providersHandler(mockRequest as Request, mockResponse as Response, mockNext);

      const callArgs = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(callArgs.providers).toContain('asi-one');
      expect(callArgs.providers).toContain('openai');
      expect(callArgs.providers).toContain('anthropic');
    });
  });
});
