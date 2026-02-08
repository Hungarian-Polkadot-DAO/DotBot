/**
 * DotBot Chat API Route
 * 
 * Full DotBot chat endpoint that wraps DotBot.chat() on the backend.
 * This is where all AI communication happens - frontend is just a client.
 * TODO: Probably this file should be renamed
 */

import { Router, Request, Response } from 'express';
import { ChatOptions, ChatResult, Environment, Network, AIProviderType, ExecutionArrayState, ChatInstance } from '@dotbot/core';
import { createSessionManager } from '../sessionManager';
import { apiLogger as _apiLogger, dotbotLogger, sessionLogger, errorLogger } from '../utils/logger';

const router = Router();

// Create session manager (handles DotBot instances, AI services, multi-user support)
// This is the proper way - implementation is in dotbot-core, not routes
const sessionManager = createSessionManager();

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

// Implementation is in dotbot-express (DotBotSessionManager)
// Routes use the session manager - clean separation of concerns

/**
 * POST /api/dotbot/chat
 * Full DotBot chat endpoint - handles AI communication on backend
 */
router.post('/chat', async (req: Request, res: Response) => {
  let effectiveSessionId: string | undefined;
  
  // Validate request first (before any async operations)
  const {
    message,
    sessionId,
    wallet,
    environment = 'mainnet',
    network,
    options = {},
    provider
  }: DotBotChatRequest = req.body;

  // Validate message
  if (!message || typeof message !== 'string') {
    dotbotLogger.warn({ 
      messageType: typeof message,
      messageLength: message?.length 
    }, 'Invalid chat request: message missing or not a string');
    return res.status(400).json({
      error: 'Invalid request',
      message: 'Message field is required and must be a string'
    });
  }

  // Validate wallet
  if (!wallet || !wallet.address) {
    dotbotLogger.warn({ 
      hasWallet: !!wallet,
      walletAddress: wallet?.address 
    }, 'Invalid chat request: wallet missing or invalid');
    return res.status(400).json({
      error: 'Invalid request',
      message: 'Wallet address is required'
    });
  }

  try {
    // Log incoming request details (after validation)
    dotbotLogger.info({ 
      messagePreview: message.substring(0, 100),
      messageLength: message.length,
      sessionId,
      walletAddress: wallet.address,
      environment,
      network,
      provider,
      hasOptions: !!options && Object.keys(options).length > 0
    }, 'Received DotBot chat request');

    // Generate session ID if not provided (use wallet address)
    effectiveSessionId = sessionId || `wallet:${wallet.address}:${environment}`;

    // Get or create DotBot session (handles AI service, instance management)
    dotbotLogger.info({ 
      sessionId: effectiveSessionId,
      wallet: wallet.address,
      walletName: wallet.name,
      walletSource: wallet.source,
      environment,
      network,
      provider,
      sessionIdProvided: !!sessionId
    }, 'Getting/creating DotBot session');
    
    let session;
    try {
      session = await sessionManager.getOrCreateSession({
        sessionId: effectiveSessionId,
        wallet: {
          address: wallet.address,
          name: wallet.name,
          source: wallet.source,
        },
        environment,
        network,
        aiProvider: provider,
      });
      
      dotbotLogger.info({ 
        sessionId: effectiveSessionId,
        sessionCreated: !!session,
        dotbotEnvironment: session.dotbot.getEnvironment(),
        dotbotNetwork: session.dotbot.getNetwork(),
        currentChatId: session.dotbot.currentChat?.id || null
      }, 'Session retrieved/created successfully');
    } catch (sessionError: any) {
      errorLogger.error({ 
        error: sessionError.message,
        stack: sessionError.stack,
        sessionId: effectiveSessionId,
        wallet: wallet.address,
        environment,
        network
      }, 'Failed to get/create session');
      throw sessionError;
    }
    
    const dotbot = session.dotbot;

    // Chat options - no custom LLM needed, DotBot uses aiService from config
    const chatOptions: ChatOptions = {
      ...options,
      // No llm override - DotBot uses the aiService from config internally
    };

    // Ensure chat instance exists (even in stateless mode, we need it for chatId)
    if (!dotbot.currentChat) {
      // Create a temporary chat instance (won't be persisted in stateless mode)
      const chatManager = dotbot.getChatManager();
      const chatData = await chatManager.createInstance({
        environment: dotbot.getEnvironment(),
        network: dotbot.getNetwork(),
        walletAddress: wallet.address,
        title: `Chat - ${dotbot.getNetwork()}`,
      });
      // Wrap in ChatInstance class
      dotbot.currentChat = new ChatInstance(
        chatData,
        chatManager,
        dotbot.stateful // Only persist if stateful
      );
      dotbotLogger.debug({ 
        chatId: dotbot.currentChat.id,
        stateful: dotbot.stateful
      }, 'Created temporary chat instance for stateless mode');
    }

    // Call DotBot.chat() - this handles everything (AI, execution planning, etc.)
    dotbotLogger.info({ 
      sessionId: effectiveSessionId,
      messageLength: message.length,
      messagePreview: message.substring(0, 100),
      hasConversationHistory: !!options.conversationHistory,
      historyLength: options.conversationHistory?.length || 0,
      hasSystemPrompt: !!options.systemPrompt,
      currentChatId: dotbot.currentChat?.id || null
    }, 'Processing DotBot chat request');
    
    let result: ChatResult;
    try {
      result = await dotbot.chat(message, chatOptions);
      
      dotbotLogger.info({ 
        sessionId: effectiveSessionId,
        executed: result.executed,
        success: result.success,
        completed: result.completed,
        failed: result.failed,
        responseLength: result.response?.length || 0,
        hasPlan: !!result.plan,
        planSteps: result.plan?.steps?.length || 0,
        executionId: result.executionId || null,
        hasExecutionArrayState: !!result.executionArrayState,
        currentChatId: dotbot.currentChat?.id || null
      }, 'DotBot chat completed successfully');
    } catch (chatError: any) {
      errorLogger.error({ 
        error: chatError.message,
        stack: chatError.stack,
        sessionId: effectiveSessionId,
        messagePreview: message.substring(0, 100),
        dotbotEnvironment: dotbot.getEnvironment(),
        dotbotNetwork: dotbot.getNetwork(),
        currentChatId: dotbot.currentChat?.id || null
      }, 'DotBot.chat() failed');
      throw chatError;
    }

    // Return result
    res.json({
      success: true,
      result,
      sessionId: effectiveSessionId,
      chatId: dotbot.currentChat?.id || null,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    errorLogger.error({ 
      error: error.message,
      stack: error.stack,
      sessionId: effectiveSessionId,
      errorName: error.name,
      errorCode: error.code
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
    
    // Get or create session (session manager handles AI service creation)
    const session = await sessionManager.getOrCreateSession({
      sessionId: effectiveSessionId,
      wallet: {
        address: wallet.address,
        name: wallet.name,
        source: wallet.source,
      },
      environment,
      network,
    });
    
    const dotbot = session.dotbot;

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
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      return res.status(404).json({
        error: 'Session not found',
        message: `No DotBot session found for ID: ${sessionId}`
      });
    }

    res.json({
      success: true,
      sessionId,
      environment: session.environment,
      network: session.network,
      wallet: session.wallet,
      currentChatId: session.dotbot.currentChat?.id || null,
      createdAt: session.createdAt.toISOString(),
      lastAccessed: session.lastAccessed.toISOString(),
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
    // Check if session exists before deleting
    const session = await sessionManager.getSession(sessionId);
    const existed = session !== null;
    
    if (existed) {
      await sessionManager.deleteSession(sessionId);
    }

    res.json({
      success: existed,
      message: existed ? 'Session deleted' : 'Session not found',
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

/**
 * GET /api/dotbot/session/:sessionId/chats
 * List all chat instances for a session
 */
router.get('/session/:sessionId/chats', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  
  try {
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      return res.status(404).json({
        error: 'Session not found',
        message: `No DotBot session found for ID: ${sessionId}`,
        timestamp: new Date().toISOString()
      });
    }

    // Get chat manager from DotBot instance
    const chatManager = session.dotbot.getChatManager();
    
    // Query chat instances for this wallet and environment
    const chats = await chatManager.queryInstances({
      walletAddress: session.wallet.address,
      environment: session.environment,
      archived: false, // Only return non-archived chats
    });

    res.json({
      success: true,
      chats,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    sessionLogger.error({ 
      error: error.message,
      stack: error.stack,
      sessionId 
    }, 'Error listing chat instances');
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message || 'Failed to list chat instances',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/dotbot/session/:sessionId/chats/:chatId
 * Get a specific chat instance
 */
router.get('/session/:sessionId/chats/:chatId', async (req: Request, res: Response) => {
  const { sessionId, chatId } = req.params;
  
  try {
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      return res.status(404).json({
        error: 'Session not found',
        message: `No DotBot session found for ID: ${sessionId}`,
        timestamp: new Date().toISOString()
      });
    }

    // Get chat manager from DotBot instance
    const chatManager = session.dotbot.getChatManager();
    
    // Load the specific chat instance
    const chat = await chatManager.loadInstance(chatId);

    if (!chat) {
      return res.status(404).json({
        error: 'Chat instance not found',
        message: `No chat instance found for ID: ${chatId}`,
        timestamp: new Date().toISOString()
      });
    }

    // Verify the chat belongs to this session
    if (chat.walletAddress !== session.wallet.address || chat.environment !== session.environment) {
      return res.status(404).json({
        error: 'Chat instance not found',
        message: `Chat instance ${chatId} does not belong to this session`,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      chat,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    sessionLogger.error({ 
      error: error.message,
      stack: error.stack,
      sessionId,
      chatId 
    }, 'Error getting chat instance');
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message || 'Failed to get chat instance',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * DELETE /api/dotbot/session/:sessionId/chats/:chatId
 * Delete a specific chat instance
 */
router.delete('/session/:sessionId/chats/:chatId', async (req: Request, res: Response) => {
  const { sessionId, chatId } = req.params;
  
  try {
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      return res.status(404).json({
        error: 'Session not found',
        message: `No DotBot session found for ID: ${sessionId}`,
        timestamp: new Date().toISOString()
      });
    }

    // Get chat manager from DotBot instance
    const chatManager = session.dotbot.getChatManager();
    
    // Check if chat exists before deleting
    const chat = await chatManager.loadInstance(chatId);
    const existed = chat !== null;

    if (existed) {
      // Verify the chat belongs to this session
      if (chat!.walletAddress !== session.wallet.address || chat!.environment !== session.environment) {
        return res.status(404).json({
          error: 'Chat instance not found',
          message: `Chat instance ${chatId} does not belong to this session`,
          timestamp: new Date().toISOString()
        });
      }

      // Delete the chat instance
      await chatManager.deleteInstance(chatId);
    }

    res.json({
      success: existed,
      message: existed ? 'Chat instance deleted' : 'Chat instance not found',
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    sessionLogger.error({ 
      error: error.message,
      stack: error.stack,
      sessionId,
      chatId 
    }, 'Error deleting chat instance');
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message || 'Failed to delete chat instance',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/dotbot/session/:sessionId/chats/:chatId/load
 * Load/switch to a specific chat instance
 */
router.post('/session/:sessionId/chats/:chatId/load', async (req: Request, res: Response) => {
  const { sessionId, chatId } = req.params;
  
  try {
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      return res.status(404).json({
        error: 'Session not found',
        message: `No DotBot session found for ID: ${sessionId}`,
        timestamp: new Date().toISOString()
      });
    }

    // Load the chat instance using DotBot's loadChatInstance method
    await session.dotbot.loadChatInstance(chatId);

    // Get the loaded chat data
    const chatManager = session.dotbot.getChatManager();
    const chat = await chatManager.loadInstance(chatId);

    if (!chat) {
      return res.status(404).json({
        error: 'Chat instance not found',
        message: `Chat instance ${chatId} could not be loaded`,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      chat,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    sessionLogger.error({ 
      error: error.message,
      stack: error.stack,
      sessionId,
      chatId 
    }, 'Error loading chat instance');
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message || 'Failed to load chat instance',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/dotbot/session/:sessionId/execution/:executionId/start
 * Start execution of a specific execution plan
 */
router.post('/session/:sessionId/execution/:executionId/start', async (req: Request, res: Response) => {
  const { sessionId, executionId } = req.params;
  const { autoApprove } = req.body || {};
  
  try {
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      return res.status(404).json({
        error: 'Session not found',
        message: `No DotBot session found for ID: ${sessionId}`,
        timestamp: new Date().toISOString()
      });
    }

    // Start execution (works in both stateful and stateless modes)
    await session.dotbot.startExecution(executionId, { autoApprove });

    // Get execution state
    // In stateful mode: get from chat
    // In stateless mode: rebuild from stored plan (already done in startExecutionStateless)
    let state;
    if (session.dotbot.currentChat) {
      // Stateful mode
      const executionArray = session.dotbot.currentChat.getExecutionArray(executionId);
      if (!executionArray) {
        return res.status(404).json({
          error: 'Execution not found',
          message: `Execution ${executionId} not found in current chat`,
          timestamp: new Date().toISOString()
        });
      }
      state = executionArray.getState();
    } else {
      // Stateless mode: ExecutionArray was rebuilt during startExecution
      // We need to get it from the execution system or return a success response
      // For now, return success - the execution is in progress
      // Frontend can poll for status if needed
      state = {
        id: executionId,
        items: [],
        currentIndex: 0,
        isExecuting: true,
        isPaused: false,
        totalItems: 0,
        completedItems: 0,
        failedItems: 0,
        cancelledItems: 0
      };
    }

    res.json({
      success: true,
      executionId,
      state,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    sessionLogger.error({ 
      error: error.message,
      stack: error.stack,
      sessionId,
      executionId 
    }, 'Error starting execution');
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message || 'Failed to start execution',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/dotbot/session/:sessionId/execution/:executionId
 * Get execution state
 */
router.get('/session/:sessionId/execution/:executionId', async (req: Request, res: Response) => {
  const { sessionId, executionId } = req.params;
  
  try {
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      return res.status(404).json({
        error: 'Session not found',
        message: `No DotBot session found for ID: ${sessionId}`,
        timestamp: new Date().toISOString()
      });
    }

    // Get execution state (works in both stateful and stateless modes)
    let state: ExecutionArrayState | null = null;
    
    if (session.dotbot.currentChat) {
      // Stateful mode: get from chat instance
      const executionArray = session.dotbot.currentChat.getExecutionArray(executionId);
      if (executionArray) {
        state = executionArray.getState();
      }
    }
    
    // Stateless mode: get from temporary storage (during preparation)
    if (!state) {
      state = session.dotbot.getExecutionState(executionId);
    }
    
    if (!state) {
      return res.status(404).json({
        error: 'Execution not found',
        message: `Execution ${executionId} not found. It may not have been prepared yet or may have expired.`,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      executionId,
      state,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    sessionLogger.error({ 
      error: error.message,
      stack: error.stack,
      sessionId,
      executionId 
    }, 'Error getting execution state');
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message || 'Failed to get execution state',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/dotbot/session/:sessionId/execution/:executionId/approve
 * Approve an execution step
 */
router.post('/session/:sessionId/execution/:executionId/approve', async (req: Request, res: Response) => {
  const { sessionId, executionId } = req.params;
  const { stepIndex } = req.body || {};
  
  try {
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      return res.status(404).json({
        error: 'Session not found',
        message: `No DotBot session found for ID: ${sessionId}`,
        timestamp: new Date().toISOString()
      });
    }

    if (!session.dotbot.currentChat) {
      return res.status(400).json({
        error: 'No active chat',
        message: 'No active chat instance for this session',
        timestamp: new Date().toISOString()
      });
    }

    // Get execution array
    const executionArray = session.dotbot.currentChat.getExecutionArray(executionId);
    if (!executionArray) {
      return res.status(404).json({
        error: 'Execution not found',
        message: `Execution ${executionId} not found in current chat`,
        timestamp: new Date().toISOString()
      });
    }

    // Approve step - update status from 'ready' to 'executing'
    if (stepIndex !== undefined) {
      const item = executionArray.getItems()[stepIndex];
      if (item && item.status === 'ready') {
        executionArray.updateStatus(item.id, 'executing');
      }
    } else {
      // Approve current step
      const state = executionArray.getState();
      const currentItem = state.items[state.currentIndex];
      if (currentItem && currentItem.status === 'ready') {
        executionArray.updateStatus(currentItem.id, 'executing');
      }
    }

    const state = executionArray.getState();

    res.json({
      success: true,
      state,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    sessionLogger.error({ 
      error: error.message,
      stack: error.stack,
      sessionId,
      executionId 
    }, 'Error approving execution step');
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message || 'Failed to approve execution step',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/dotbot/session/:sessionId/execution/:executionId/reject
 * Reject an execution step
 */
router.post('/session/:sessionId/execution/:executionId/reject', async (req: Request, res: Response) => {
  const { sessionId, executionId } = req.params;
  const { stepIndex, reason } = req.body || {};
  
  try {
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      return res.status(404).json({
        error: 'Session not found',
        message: `No DotBot session found for ID: ${sessionId}`,
        timestamp: new Date().toISOString()
      });
    }

    if (!session.dotbot.currentChat) {
      return res.status(400).json({
        error: 'No active chat',
        message: 'No active chat instance for this session',
        timestamp: new Date().toISOString()
      });
    }

    // Get execution array
    const executionArray = session.dotbot.currentChat.getExecutionArray(executionId);
    if (!executionArray) {
      return res.status(404).json({
        error: 'Execution not found',
        message: `Execution ${executionId} not found in current chat`,
        timestamp: new Date().toISOString()
      });
    }

    // Reject step - update status to 'cancelled'
    if (stepIndex !== undefined) {
      const item = executionArray.getItems()[stepIndex];
      if (item) {
        executionArray.updateStatus(item.id, 'cancelled', reason || 'User rejected');
      }
    } else {
      // Reject current step
      const state = executionArray.getState();
      const currentItem = state.items[state.currentIndex];
      if (currentItem) {
        executionArray.updateStatus(currentItem.id, 'cancelled', reason || 'User rejected');
      }
    }

    const state = executionArray.getState();

    res.json({
      success: true,
      state,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    sessionLogger.error({ 
      error: error.message,
      stack: error.stack,
      sessionId,
      executionId 
    }, 'Error rejecting execution step');
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message || 'Failed to reject execution step',
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
