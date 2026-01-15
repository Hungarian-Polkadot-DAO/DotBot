/**
 * dotbotApi Tests
 * 
 * Tests backend API communication
 */

import {
  sendDotBotMessage,
  createDotBotSession,
  getExecutionState,
  startExecution,
} from '../../services/dotbotApi';
import { createChatResultWithExecution } from '../../test-utils/fixtures';

// Mock fetch globally
global.fetch = jest.fn();

const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

describe('dotbotApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendDotBotMessage', () => {
    it('should call the backend API correctly', async () => {
      const chatResult = createChatResultWithExecution();
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          result: chatResult,
          sessionId: 'test-session-id',
          timestamp: new Date().toISOString(),
        }),
      } as Response);

      const result = await sendDotBotMessage({
        message: 'Transfer 1 DOT',
        sessionId: 'test-session-id',
        wallet: {
          address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
          name: 'Test Account',
          source: 'polkadot-js',
        },
        environment: 'mainnet',
        network: 'polkadot',
        conversationHistory: [],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/dotbot/chat'),
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: expect.stringContaining('Transfer 1 DOT'),
        })
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual(chatResult);
    });

    it('should include conversation history in request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          result: createChatResultWithExecution(),
          sessionId: 'test-session-id',
          timestamp: new Date().toISOString(),
        }),
      } as Response);

      const conversationHistory = [
        { role: 'user' as const, content: 'Hello', timestamp: Date.now() },
        { role: 'assistant' as const, content: 'Hi!', timestamp: Date.now() },
      ];

      await sendDotBotMessage({
        message: 'Transfer 1 DOT',
        sessionId: 'test-session-id',
        wallet: {
          address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
          name: 'Test Account',
          source: 'polkadot-js',
        },
        environment: 'mainnet',
        network: 'polkadot',
        conversationHistory,
      });

      const requestBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(requestBody.options.conversationHistory).toEqual(conversationHistory);
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({
          message: 'Server error',
        }),
      } as Response);

      await expect(
        sendDotBotMessage({
          message: 'Test',
          sessionId: 'test-session-id',
          wallet: {
            address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
            name: 'Test Account',
            source: 'polkadot-js',
          },
        })
      ).rejects.toThrow();
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new TypeError('Network error'));

      await expect(
        sendDotBotMessage({
          message: 'Test',
          sessionId: 'test-session-id',
          wallet: {
            address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
            name: 'Test Account',
            source: 'polkadot-js',
          },
        })
      ).rejects.toThrow('Cannot connect to backend API');
    });
  });

  describe('createDotBotSession', () => {
    it('should create a session with correct parameters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          sessionId: 'new-session-id',
          environment: 'mainnet',
          network: 'polkadot',
          wallet: {
            address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
            name: 'Test Account',
            source: 'polkadot-js',
          },
          timestamp: new Date().toISOString(),
        }),
      } as Response);

      const result = await createDotBotSession(
        {
          address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
          name: 'Test Account',
          source: 'polkadot-js',
        },
        'mainnet',
        'polkadot'
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/dotbot/session'),
        expect.objectContaining({
          method: 'POST',
        })
      );

      expect(result.sessionId).toBe('new-session-id');
    });
  });

  describe('getExecutionState', () => {
    it('should fetch execution state from backend', async () => {
      const executionState = {
        id: 'exec-123',
        items: [],
        isExecuting: false,
        currentIndex: 0,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          executionId: 'exec-123',
          state: executionState,
          timestamp: new Date().toISOString(),
        }),
      } as Response);

      const result = await getExecutionState('test-session-id', 'exec-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/dotbot/session/test-session-id/execution/exec-123'),
        expect.objectContaining({
          method: 'GET',
        })
      );

      expect(result.success).toBe(true);
      expect(result.state).toEqual(executionState);
    });

    it('should handle 404 errors when execution not found', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({
          message: 'Execution not found',
        }),
      } as Response);

      await expect(
        getExecutionState('test-session-id', 'exec-123')
      ).rejects.toThrow();
    });
  });

  describe('startExecution', () => {
    it('should start execution with correct parameters', async () => {
      const executionState = {
        id: 'exec-123',
        items: [],
        isExecuting: true,
        currentIndex: 0,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          executionId: 'exec-123',
          state: executionState,
          timestamp: new Date().toISOString(),
        }),
      } as Response);

      const result = await startExecution('test-session-id', 'exec-123', false);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/dotbot/session/test-session-id/execution/exec-123/start'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"autoApprove":false'),
        })
      );

      expect(result.success).toBe(true);
      expect(result.state).toEqual(executionState);
    });

    it('should include autoApprove parameter', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          executionId: 'exec-123',
          state: {},
          timestamp: new Date().toISOString(),
        }),
      } as Response);

      await startExecution('test-session-id', 'exec-123', true);

      const requestBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(requestBody.autoApprove).toBe(true);
    });
  });
});
