/**
 * DotBot Chat API Route
 * 
 * Full DotBot chat endpoint that wraps DotBot.chat() on the backend.
 * This is where all AI communication happens - frontend is just a client.
 * TODO: Probably this file should be renamed
 */

import { Router, Request, Response } from 'express';
import { Environment as _Environment, Network as _Network, ExecutionArrayState } from '@dotbot/core';
import { createSessionManager } from '../sessionManager';
import { sessionLogger } from '../utils/logger';
import {
  validateChatRequest,
  handleChatRequest,
  handleError,
  generateSessionId,
  DotBotChatRequest
} from '../utils/dotbotRouteUtils';
import { handleRouteError, getSessionOr404 } from '../utils/routeUtils';
import { handleGetSession, handleDeleteSession } from '../utils/sessionRouteUtils';
import { handleGetChatInstance, handleListChatInstances, handleLoadChatInstance } from '../utils/chatRouteUtils';
import { handleGetExecutionState, handleApproveExecutionStep, handleRejectExecutionStep } from '../utils/executionRouteUtils';

const router = Router();

// Create session manager (handles DotBot instances, AI services, multi-user support)
const sessionManager = createSessionManager();

/**
 * POST /api/dotbot/chat
 * Full DotBot chat endpoint - handles AI communication on backend
 */
router.post('/chat', async (req: Request, res: Response) => {
  let effectiveSessionId: string | undefined;

  // Validate request
  const validation = validateChatRequest(req);
  if (!validation.valid) {
    return res.status(400).json({
      error: 'Invalid request',
      message: validation.error
    });
  }

  const {
    message: _message,
    sessionId,
    wallet,
    environment = 'mainnet',
    network,
    provider
  }: DotBotChatRequest = req.body;

  try {
    effectiveSessionId = generateSessionId(sessionId, wallet.address, environment);

    // Get or create session
    const session = await sessionManager.getOrCreateSession({
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

    // Handle chat request
    await handleChatRequest(req, res, session);

  } catch (error: any) {
    handleError(res, error, effectiveSessionId);
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
    await handleGetSession(res, session, sessionId);
  } catch (error: any) {
    handleRouteError(res, error, 'getting session', sessionId);
  }
});

/**
 * DELETE /api/dotbot/session/:sessionId
 * Delete a session
 */
router.delete('/session/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  await handleDeleteSession(res, sessionManager, sessionId);
});

/**
 * GET /api/dotbot/session/:sessionId/chats
 * List all chat instances for a session
 */
router.get('/session/:sessionId/chats', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  
  try {
    const session = await getSessionOr404(sessionManager, sessionId, res);
    if (!session) return;
    
    await handleListChatInstances(res, session);
  } catch (error: any) {
    handleRouteError(res, error, 'listing chat instances', sessionId);
  }
});

/**
 * GET /api/dotbot/session/:sessionId/chats/:chatId
 * Get a specific chat instance
 */
router.get('/session/:sessionId/chats/:chatId', async (req: Request, res: Response) => {
  const { sessionId, chatId } = req.params;
  
  try {
    const session = await getSessionOr404(sessionManager, sessionId, res);
    if (!session) return;
    
    await handleGetChatInstance(res, session, chatId);
  } catch (error: any) {
    handleRouteError(res, error, 'getting chat instance', sessionId, { chatId });
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
    const session = await getSessionOr404(sessionManager, sessionId, res);
    if (!session) return;
    
    await handleLoadChatInstance(res, session, chatId);
  } catch (error: any) {
    handleRouteError(res, error, 'loading chat instance', sessionId, { chatId });
  }
});

/**
 * POST /api/dotbot/session/:sessionId/execution/:executionId/start
 * Get execution state for frontend execution (does NOT execute on backend)
 * 
 * NOTE: Execution must happen on the frontend where signing handlers are available.
 * The backend cannot sign transactions. This endpoint simply returns ExecutionArrayState
 * (a lightweight serializable state object). The frontend will rebuild ExecutionArray
 * from executionPlan when executing.
 */
router.post('/session/:sessionId/execution/:executionId/start', async (req: Request, res: Response) => {
  const { sessionId, executionId } = req.params;
  const { autoApprove: _autoApprove } = req.body || {} as { autoApprove?: boolean };
  
  try {
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      return res.status(404).json({
        error: 'Session not found',
        message: `No DotBot session found for ID: ${sessionId}`,
        timestamp: new Date().toISOString()
      });
    }

    // Simply return ExecutionArrayState - it's lightweight and serializable
    // Frontend will rebuild ExecutionArray from executionPlan when executing
    let state: ExecutionArrayState | null = null;
    
    if (session.dotbot.currentChat) {
      // Stateful mode: get from chat
      const executionArray = session.dotbot.currentChat.getExecutionArray(executionId);
      if (executionArray) {
        state = executionArray.getState();
      }
    }
    
    // If not found, try to get from stored execution state (stateless mode)
    if (!state) {
      state = session.dotbot.getExecutionState(executionId);
    }
    
    if (!state) {
      return res.status(404).json({
        error: 'Execution not found',
        message: `Execution ${executionId} not found. It may not have been prepared yet.`,
        timestamp: new Date().toISOString()
      });
    }

    // Return ExecutionArrayState to frontend (lightweight, serializable state object)
    // Frontend will use this for display and rebuild ExecutionArray from executionPlan when executing
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
    }, 'Error preparing execution');
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message || 'Failed to prepare execution',
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
    const session = await getSessionOr404(sessionManager, sessionId, res);
    if (!session) return;
    
    handleGetExecutionState(res, session, executionId);
  } catch (error: any) {
    handleRouteError(res, error, 'getting execution state', sessionId, { executionId });
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
    const session = await getSessionOr404(sessionManager, sessionId, res);
    if (!session) return;
    
    handleApproveExecutionStep(res, session, executionId, stepIndex);
  } catch (error: any) {
    handleRouteError(res, error, 'approving execution step', sessionId, { executionId });
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
    const session = await getSessionOr404(sessionManager, sessionId, res);
    if (!session) return;
    
    handleRejectExecutionStep(res, session, executionId, stepIndex, reason);
  } catch (error: any) {
    handleRouteError(res, error, 'rejecting execution step', sessionId, { executionId });
  }
});

export default router;
