/**
 * Unit tests for DotBot routes
 */

import { Request, Response } from 'express';
import { DotBot, ChatResult } from '@dotbot/core';
import type { WalletAccount } from '@dotbot/core/types/wallet';

// Mock session manager - must be set up before route module loads
// Initialize with a default mock that will be replaced in beforeEach
const defaultMockSessionManager = {
  getOrCreateSession: jest.fn(),
  getSession: jest.fn(),
  deleteSession: jest.fn(),
};

jest.mock('../../sessionManager', () => ({
  createSessionManager: jest.fn(() => defaultMockSessionManager),
  DotBotSessionManager: jest.fn(),
}));

// Import router after mocks are set up
import dotbotRouter from '../../routes/dotbot';
import { DotBotSessionManager } from '../../sessionManager';

// Mock logger
jest.mock('../../utils/logger', () => ({
  apiLogger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  dotbotLogger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  sessionLogger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  errorLogger: {
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Helper to find route handlers
function findRouteHandler(router: any, path: string, method: string): any {
  for (const layer of router.stack as any[]) {
    if (layer.route?.path === path && (layer.route as any).methods?.[method.toLowerCase()]) {
      return layer.route.stack[0]?.handle;
    }
  }
  return null;
}

describe('DotBot Routes', () => {
  let mockSessionManager: jest.Mocked<DotBotSessionManager>;
  let mockDotBot: jest.Mocked<DotBot>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  const mockWallet: WalletAccount = {
    address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    name: 'Test Account',
    source: 'polkadot-js',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock chat instance
    const mockChatInstance = {
      id: 'test-chat-id',
      getDisplayMessages: jest.fn().mockReturnValue([]),
      getHistory: jest.fn().mockReturnValue([]),
    };

    // Create mock DotBot
    mockDotBot = {
      chat: jest.fn(),
      getEnvironment: jest.fn().mockReturnValue('mainnet'),
      getNetwork: jest.fn().mockReturnValue('polkadot'),
      getWallet: jest.fn().mockReturnValue(mockWallet),
      getChatManager: jest.fn().mockReturnValue({
        queryInstances: jest.fn().mockResolvedValue([]),
        createInstance: jest.fn().mockResolvedValue({
          id: 'test-chat-id',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          environment: 'mainnet',
          network: 'polkadot',
          walletAddress: mockWallet.address,
          messages: [],
          title: 'Test Chat',
        }),
      }),
      currentChat: mockChatInstance as any,
      stateful: false,
    } as any;

    // Create mock session
    const mockSession = {
      sessionId: 'test-session',
      dotbot: mockDotBot,
      wallet: mockWallet,
      environment: 'mainnet' as const,
      network: 'polkadot' as const,
      createdAt: new Date(),
      lastAccessed: new Date(),
    };

    // Create mock session manager and update the default mock
    mockSessionManager = {
      getOrCreateSession: jest.fn().mockResolvedValue(mockSession),
      getSession: jest.fn().mockResolvedValue(mockSession),
      deleteSession: jest.fn().mockResolvedValue(undefined),
    } as any;

    // Update the default mock's methods
    Object.assign(defaultMockSessionManager, mockSessionManager);

    // Create mock Express objects
    mockRequest = {
      body: {},
      params: {},
      app: {
        locals: {
          wsManager: undefined, // WebSocket manager (optional, can be undefined)
        },
      } as any,
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();
  });

  describe('POST /api/dotbot/chat', () => {
    const chatHandler = findRouteHandler(dotbotRouter, '/chat', 'post');

    it('should return 400 if message is missing', async () => {
      mockRequest.body = {
        wallet: mockWallet,
      };

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
        wallet: mockWallet,
      };

      await chatHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid request',
        message: 'Message field is required and must be a string',
      });
    });

    it('should return 400 if wallet is missing', async () => {
      mockRequest.body = {
        message: 'Hello',
      };

      await chatHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid request',
        message: 'Wallet address is required',
      });
    });

    it('should return 400 if wallet address is missing', async () => {
      mockRequest.body = {
        message: 'Hello',
        wallet: {},
      };

      await chatHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid request',
        message: 'Wallet address is required',
      });
    });

    it('should generate session ID from wallet if not provided', async () => {
      const mockChatResult: ChatResult = {
        executed: false,
        success: true,
        completed: 1,
        failed: 0,
        response: 'Test response',
      };

      mockDotBot.chat = jest.fn().mockResolvedValue(mockChatResult);
      mockRequest.body = {
        message: 'Hello',
        wallet: mockWallet,
        environment: 'mainnet',
      };

      await chatHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockSessionManager.getOrCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: `wallet:${mockWallet.address}:mainnet`,
        })
      );
    });

    it('should use provided session ID', async () => {
      const mockChatResult: ChatResult = {
        executed: false,
        success: true,
        completed: 1,
        failed: 0,
        response: 'Test response',
      };

      mockDotBot.chat = jest.fn().mockResolvedValue(mockChatResult);
      mockRequest.body = {
        message: 'Hello',
        sessionId: 'custom-session-id',
        wallet: mockWallet,
      };

      await chatHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockSessionManager.getOrCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'custom-session-id',
        })
      );
    });

    it('should call dotbot.chat() with correct options', async () => {
      const mockChatResult: ChatResult = {
        executed: false,
        success: true,
        completed: 1,
        failed: 0,
        response: 'Test response',
      };

      mockDotBot.chat = jest.fn().mockResolvedValue(mockChatResult);
      mockRequest.body = {
        message: 'Hello',
        wallet: mockWallet,
        options: {
          systemPrompt: 'Custom prompt',
        },
      };

      await chatHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockDotBot.chat).toHaveBeenCalledWith('Hello', {
        systemPrompt: 'Custom prompt',
      });
    });

    it('should return chat result on success', async () => {
      const mockChatResult: ChatResult = {
        executed: false,
        success: true,
        completed: 1,
        failed: 0,
        response: 'Test response',
      };

      mockDotBot.chat = jest.fn().mockResolvedValue(mockChatResult);
      mockRequest.body = {
        message: 'Hello',
        wallet: mockWallet,
      };

      await chatHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        result: mockChatResult,
        sessionId: expect.any(String),
        chatId: expect.any(String),
        timestamp: expect.any(String),
      });
    });

    it('should handle errors and return 500', async () => {
      const error = new Error('Test error');
      // Update the mock that's actually used
      defaultMockSessionManager.getOrCreateSession = jest.fn().mockRejectedValue(error);
      mockRequest.body = {
        message: 'Hello',
        wallet: mockWallet,
      };

      await chatHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Internal server error',
        message: 'Test error',
        timestamp: expect.any(String),
      });
    });
  });

  describe('POST /api/dotbot/session', () => {
    const sessionHandler = findRouteHandler(dotbotRouter, '/session', 'post');

    it('should return 400 if wallet is missing', async () => {
      mockRequest.body = {};

      await sessionHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid request',
        message: 'Wallet address is required',
      });
    });

    it('should create session and return session info', async () => {
      mockRequest.body = {
        wallet: mockWallet,
        environment: 'mainnet',
        network: 'polkadot',
      };

      await sessionHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        sessionId: expect.any(String),
        environment: 'mainnet',
        network: 'polkadot',
        wallet: mockWallet,
        timestamp: expect.any(String),
      });
    });

    it('should use default environment if not provided', async () => {
      mockRequest.body = {
        wallet: mockWallet,
      };

      await sessionHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockSessionManager.getOrCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          environment: 'mainnet',
        })
      );
    });

    it('should handle errors and return 500', async () => {
      const error = new Error('Session creation failed');
      defaultMockSessionManager.getOrCreateSession = jest.fn().mockRejectedValue(error);
      mockRequest.body = {
        wallet: mockWallet,
      };

      await sessionHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Internal server error',
        message: 'Session creation failed',
        timestamp: expect.any(String),
      });
    });
  });

  describe('GET /api/dotbot/session/:sessionId', () => {
    const getSessionHandler = findRouteHandler(dotbotRouter, '/session/:sessionId', 'get');

    it('should return 404 if session not found', async () => {
      defaultMockSessionManager.getSession = jest.fn().mockResolvedValue(null);
      mockRequest.params = { sessionId: 'non-existent' };

      await getSessionHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Session not found',
        message: 'No DotBot session found for ID: non-existent',
      });
    });

    it('should return session info if found', async () => {
      // Create a dotbot mock with no currentChat for this test
      const dotbotWithoutChat = {
        chat: jest.fn(),
        getEnvironment: jest.fn().mockReturnValue('mainnet'),
        getNetwork: jest.fn().mockReturnValue('polkadot'),
        getWallet: jest.fn().mockReturnValue(mockWallet),
        getChatManager: jest.fn().mockReturnValue({
          queryInstances: jest.fn().mockResolvedValue([]),
          createInstance: jest.fn().mockResolvedValue({
            id: 'test-chat-id',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            environment: 'mainnet',
            network: 'polkadot',
            walletAddress: mockWallet.address,
            messages: [],
            title: 'Test Chat',
          }),
        }),
        currentChat: null, // No current chat for this test
        stateful: false,
      } as any;
      
      const mockSession = {
        sessionId: 'test-session',
        dotbot: dotbotWithoutChat,
        wallet: mockWallet,
        environment: 'mainnet' as const,
        network: 'polkadot' as const,
        createdAt: new Date('2024-01-01'),
        lastAccessed: new Date('2024-01-02'),
      };

      // Update both the test mock and the default mock (route handler uses defaultMockSessionManager)
      mockSessionManager.getSession = jest.fn().mockResolvedValue(mockSession);
      defaultMockSessionManager.getSession = jest.fn().mockResolvedValue(mockSession);
      mockRequest.params = { sessionId: 'test-session' };

      await getSessionHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        sessionId: 'test-session',
        environment: 'mainnet',
        network: 'polkadot',
        wallet: mockWallet,
        currentChatId: null,
        createdAt: expect.any(String),
        lastAccessed: expect.any(String),
        timestamp: expect.any(String),
      });
    });

    it('should handle errors and return 500', async () => {
      const error = new Error('Database error');
      defaultMockSessionManager.getSession = jest.fn().mockRejectedValue(error);
      mockRequest.params = { sessionId: 'test-session' };

      await getSessionHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Internal server error',
        message: 'Database error',
        timestamp: expect.any(String),
      });
    });
  });

  describe('DELETE /api/dotbot/session/:sessionId', () => {
    const deleteSessionHandler = findRouteHandler(dotbotRouter, '/session/:sessionId', 'delete');

    it('should return success: false if session does not exist', async () => {
      defaultMockSessionManager.getSession = jest.fn().mockResolvedValue(null);
      mockRequest.params = { sessionId: 'non-existent' };

      await deleteSessionHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'Session not found',
        timestamp: expect.any(String),
      });
      expect(defaultMockSessionManager.deleteSession).not.toHaveBeenCalled();
    });

    it('should delete session if exists', async () => {
      const mockSession = {
        sessionId: 'test-session',
        dotbot: mockDotBot,
        wallet: mockWallet,
        environment: 'mainnet' as const,
        network: 'polkadot' as const,
        createdAt: new Date(),
        lastAccessed: new Date(),
      };

      mockSessionManager.getSession = jest.fn().mockResolvedValue(mockSession);
      mockRequest.params = { sessionId: 'test-session' };

      await deleteSessionHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockSessionManager.deleteSession).toHaveBeenCalledWith('test-session');
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        message: 'Session deleted',
        timestamp: expect.any(String),
      });
    });

    it('should handle errors and return 500', async () => {
      const error = new Error('Delete failed');
      defaultMockSessionManager.getSession = jest.fn().mockRejectedValue(error);
      mockRequest.params = { sessionId: 'test-session' };

      await deleteSessionHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Internal server error',
        message: 'Delete failed',
        timestamp: expect.any(String),
      });
    });
  });

  describe('GET /api/dotbot/session/:sessionId/chats', () => {
    const getChatsHandler = findRouteHandler(dotbotRouter, '/session/:sessionId/chats', 'get');

    it('should return 404 if session not found', async () => {
      defaultMockSessionManager.getSession = jest.fn().mockResolvedValue(null);
      mockRequest.params = { sessionId: 'non-existent' };

      await getChatsHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Session not found',
        message: 'No DotBot session found for ID: non-existent',
        timestamp: expect.any(String),
      });
    });

    it('should return chat instances for session', async () => {
      const mockChats = [
        {
          id: 'chat-1',
          title: 'Chat 1',
          walletAddress: mockWallet.address,
          environment: 'mainnet',
        },
      ];

      // Create a new mock DotBot with the correct chat manager
      const mockDotBotWithChats = {
        ...mockDotBot,
        getChatManager: jest.fn().mockReturnValue({
          queryInstances: jest.fn().mockResolvedValue(mockChats),
        }),
      };

      const mockSession = {
        sessionId: 'test-session',
        dotbot: mockDotBotWithChats,
        wallet: mockWallet,
        environment: 'mainnet' as const,
        network: 'polkadot' as const,
        createdAt: new Date(),
        lastAccessed: new Date(),
      };

      defaultMockSessionManager.getSession = jest.fn().mockResolvedValue(mockSession);
      mockRequest.params = { sessionId: 'test-session' };

      await getChatsHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        chats: mockChats,
        timestamp: expect.any(String),
      });
    });

    it('should handle errors and return 500', async () => {
      const error = new Error('Query failed');
      defaultMockSessionManager.getSession = jest.fn().mockRejectedValue(error);
      mockRequest.params = { sessionId: 'test-session' };

      await getChatsHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Internal server error',
        message: 'Query failed',
        timestamp: expect.any(String),
      });
    });
  });

  describe('GET /api/dotbot/session/:sessionId/execution/:executionId', () => {
    const getExecutionStateHandler = findRouteHandler(dotbotRouter, '/session/:sessionId/execution/:executionId', 'get');

    it('should return 404 if session not found', async () => {
      defaultMockSessionManager.getSession = jest.fn().mockResolvedValue(null);
      mockRequest.params = { sessionId: 'non-existent', executionId: 'exec-123' };

      await getExecutionStateHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Session not found',
        message: 'No DotBot session found for ID: non-existent',
        timestamp: expect.any(String),
      });
    });

    it('should return 404 if execution not found in stateful mode', async () => {
      const mockChatInstance = {
        getExecutionArray: jest.fn().mockReturnValue(null),
      };

      const mockDotBotWithChat = {
        ...mockDotBot,
        currentChat: mockChatInstance,
        getExecutionState: jest.fn().mockReturnValue(null),
      };

      const mockSession = {
        sessionId: 'test-session',
        dotbot: mockDotBotWithChat,
        wallet: mockWallet,
        environment: 'mainnet' as const,
        network: 'polkadot' as const,
        createdAt: new Date(),
        lastAccessed: new Date(),
      };

      defaultMockSessionManager.getSession = jest.fn().mockResolvedValue(mockSession);
      mockRequest.params = { sessionId: 'test-session', executionId: 'exec-123' };

      await getExecutionStateHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Execution not found',
        message: 'Execution exec-123 not found. It may not have been prepared yet or may have expired.',
        timestamp: expect.any(String),
      });
    });

    it('should return execution state from chat instance in stateful mode', async () => {
      const mockExecutionArrayState = {
        id: 'exec-123',
        items: [],
        currentIndex: 0,
        isExecuting: false,
        isPaused: false,
        totalItems: 1,
        completedItems: 0,
        failedItems: 0,
        cancelledItems: 0,
      };

      const mockExecutionArray = {
        getState: jest.fn().mockReturnValue(mockExecutionArrayState),
      };

      const mockChatInstance = {
        getExecutionArray: jest.fn().mockReturnValue(mockExecutionArray),
      };

      const mockDotBotWithChat = {
        ...mockDotBot,
        currentChat: mockChatInstance,
        getExecutionState: jest.fn(),
      };

      const mockSession = {
        sessionId: 'test-session',
        dotbot: mockDotBotWithChat,
        wallet: mockWallet,
        environment: 'mainnet' as const,
        network: 'polkadot' as const,
        createdAt: new Date(),
        lastAccessed: new Date(),
      };

      defaultMockSessionManager.getSession = jest.fn().mockResolvedValue(mockSession);
      mockRequest.params = { sessionId: 'test-session', executionId: 'exec-123' };

      await getExecutionStateHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockChatInstance.getExecutionArray).toHaveBeenCalledWith('exec-123');
      expect(mockExecutionArray.getState).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        executionId: 'exec-123',
        state: mockExecutionArrayState,
        timestamp: expect.any(String),
      });
    });

    it('should return execution state from stateless storage when no chat instance', async () => {
      const mockExecutionArrayState = {
        id: 'exec-123',
        items: [],
        currentIndex: 0,
        isExecuting: false,
        isPaused: false,
        totalItems: 1,
        completedItems: 0,
        failedItems: 0,
        cancelledItems: 0,
      };

      const mockDotBotStateless = {
        ...mockDotBot,
        currentChat: null,
        getExecutionState: jest.fn().mockReturnValue(mockExecutionArrayState),
      };

      const mockSession = {
        sessionId: 'test-session',
        dotbot: mockDotBotStateless,
        wallet: mockWallet,
        environment: 'mainnet' as const,
        network: 'polkadot' as const,
        createdAt: new Date(),
        lastAccessed: new Date(),
      };

      defaultMockSessionManager.getSession = jest.fn().mockResolvedValue(mockSession);
      mockRequest.params = { sessionId: 'test-session', executionId: 'exec-123' };

      await getExecutionStateHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockDotBotStateless.getExecutionState).toHaveBeenCalledWith('exec-123');
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        executionId: 'exec-123',
        state: mockExecutionArrayState,
        timestamp: expect.any(String),
      });
    });

    it('should return execution state from stateless storage when not in chat instance', async () => {
      const mockExecutionArrayState = {
        id: 'exec-123',
        items: [],
        currentIndex: 0,
        isExecuting: false,
        isPaused: false,
        totalItems: 1,
        completedItems: 0,
        failedItems: 0,
        cancelledItems: 0,
      };

      const mockChatInstance = {
        getExecutionArray: jest.fn().mockReturnValue(null),
      };

      const mockDotBotWithChat = {
        ...mockDotBot,
        currentChat: mockChatInstance,
        getExecutionState: jest.fn().mockReturnValue(mockExecutionArrayState),
      };

      const mockSession = {
        sessionId: 'test-session',
        dotbot: mockDotBotWithChat,
        wallet: mockWallet,
        environment: 'mainnet' as const,
        network: 'polkadot' as const,
        createdAt: new Date(),
        lastAccessed: new Date(),
      };

      defaultMockSessionManager.getSession = jest.fn().mockResolvedValue(mockSession);
      mockRequest.params = { sessionId: 'test-session', executionId: 'exec-123' };

      await getExecutionStateHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockChatInstance.getExecutionArray).toHaveBeenCalledWith('exec-123');
      expect(mockDotBotWithChat.getExecutionState).toHaveBeenCalledWith('exec-123');
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        executionId: 'exec-123',
        state: mockExecutionArrayState,
        timestamp: expect.any(String),
      });
    });

    it('should handle errors and return 500', async () => {
      const error = new Error('Database error');
      defaultMockSessionManager.getSession = jest.fn().mockRejectedValue(error);
      mockRequest.params = { sessionId: 'test-session', executionId: 'exec-123' };

      await getExecutionStateHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Internal server error',
        message: 'Database error',
        timestamp: expect.any(String),
      });
    });
  });
});
