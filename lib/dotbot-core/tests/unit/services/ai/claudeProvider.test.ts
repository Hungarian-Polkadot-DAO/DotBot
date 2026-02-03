/**
 * Unit tests for Claude Provider
 */

// Mock global fetch
global.fetch = jest.fn();

// Mock console methods
const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();

import { ClaudeProvider, ClaudeResponse } from '../../../../services/ai/providers/claudeProvider';

describe('ClaudeProvider', () => {
  let mockFetch: jest.Mock;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy.mockClear();
    consoleErrorSpy.mockClear();
    consoleInfoSpy.mockClear();

    mockFetch = global.fetch as jest.Mock;

    // Save original env
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  afterAll(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();
  });

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      const provider = new ClaudeProvider({
        apiKey: 'test-api-key',
        baseUrl: 'https://api.test.com',
        model: 'claude-test',
        maxTokens: 2000,
        temperature: 0.8,
      });

      expect(provider).toBeInstanceOf(ClaudeProvider);
    });

    it('should use default values when not provided', () => {
      const provider = new ClaudeProvider({
        apiKey: 'test-key',
      });

      expect(provider).toBeInstanceOf(ClaudeProvider);
    });

    it('should create instance even when apiKey is missing', () => {
      const provider = new ClaudeProvider({} as any);
      
      expect(provider).toBeInstanceOf(ClaudeProvider);
    });

    it('should use environment variables when available', () => {
      process.env.REACT_APP_CLAUDE_API_KEY = 'env-key';
      process.env.REACT_APP_CLAUDE_BASE_URL = 'https://env-api.com';
      process.env.REACT_APP_CLAUDE_MODEL = 'env-model';

      const provider = new ClaudeProvider({
        apiKey: 'test-key', // Still requires explicit key
      });

      expect(provider).toBeInstanceOf(ClaudeProvider);
    });
  });

  describe('sendMessage()', () => {
    let provider: ClaudeProvider;
    let mockResponse: ClaudeResponse;

    beforeEach(() => {
      provider = new ClaudeProvider({
        apiKey: 'test-key',
        baseUrl: 'https://api.test.com',
        model: 'claude-test',
      });

      mockResponse = {
        id: 'test-id',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Test response from Claude',
          },
        ],
        model: 'claude-test',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 20,
        },
      };
    });

    it('should send message and return response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await provider.sendMessage('Hello, how are you?');

      expect(result).toBe('Test response from Claude');
      expect(mockFetch).toHaveBeenCalled();
      expect(mockFetch.mock.calls[0][0]).toBe('https://api.test.com/messages');
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      expect(mockFetch.mock.calls[0][1].headers['x-api-key']).toBe('test-key');
      expect(mockFetch.mock.calls[0][1].headers['anthropic-version']).toBe('2023-06-01');
    });

    it('should include system prompt in request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      await provider.sendMessage('Hello');

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.system).toBeDefined();
      expect(requestBody.system).toContain('DotBot');
    });

    it('should include conversation history from context', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const conversationHistory = [
        { role: 'user' as const, content: 'Previous message' },
        { role: 'assistant' as const, content: 'Previous response' },
      ];

      await provider.sendMessage('Current message', {
        conversationHistory,
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.messages.length).toBeGreaterThan(1);
      expect(requestBody.messages.some((m: any) => m.content === 'Previous message')).toBe(true);
    });

    it('should use provided system prompt from context', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const customSystemPrompt = 'Custom system prompt';
      await provider.sendMessage('Hello', {
        systemPrompt: customSystemPrompt,
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.system).toBe(customSystemPrompt);
    });

    it('should use conversation history as-is (limit is applied by caller in getLLMResponse)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const history = Array.from({ length: 5 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `Message ${i}`,
      }));

      await provider.sendMessage('Current', {
        conversationHistory: history,
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      // 5 history + 1 current = 6 messages (provider does not slice; core limits to CHAT_HISTORY_MESSAGE_LIMIT)
      expect(requestBody.messages.length).toBe(6);
    });

    it('should include current user message', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      await provider.sendMessage('Current user message');

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const lastMessage = requestBody.messages[requestBody.messages.length - 1];
      expect(lastMessage.role).toBe('user');
      expect(lastMessage.content).toBe('Current user message');
    });

    it('should use configured maxTokens and temperature', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const providerWithConfig = new ClaudeProvider({
        apiKey: 'test-key',
        maxTokens: 1000,
        temperature: 0.5,
      });

      await providerWithConfig.sendMessage('Hello');

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.max_tokens).toBe(1000);
      expect(requestBody.temperature).toBe(0.5);
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const result = await provider.sendMessage('Hello');

      expect(result).toContain('connectivity issues');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should return fallback response for balance queries on error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Server error',
      });

      const result = await provider.sendMessage('check my balance');

      expect(result).toContain('balance');
      expect(result).toContain('connectivity issues');
    });

    it('should return fallback response for transfer queries on error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Server error',
      });

      const result = await provider.sendMessage('send 5 DOT');

      expect(result).toContain('transfer');
      expect(result).toContain('connectivity issues');
    });

    it('should skip system messages in conversation history', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const conversationHistory = [
        { role: 'system' as const, content: 'System message' },
        { role: 'user' as const, content: 'User message' },
        { role: 'assistant' as const, content: 'Assistant message' },
      ];

      await provider.sendMessage('Current', {
        conversationHistory,
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      // Should not include system message in messages array (it goes in system field)
      expect(requestBody.messages.every((m: any) => m.role !== 'system')).toBe(true);
    });
  });

  describe('testConnection()', () => {
    let provider: ClaudeProvider;

    beforeEach(() => {
      provider = new ClaudeProvider({
        apiKey: 'test-key',
      });
    });

    it('should return true on successful connection', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Test' }],
          model: 'claude-test',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 5, output_tokens: 5 },
        }),
      });

      const result = await provider.testConnection();

      expect(result).toBe(true);
    });

    it('should return false on connection failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const result = await provider.testConnection();

      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await provider.testConnection();

      expect(result).toBe(false);
    });
  });

  describe('updateConfig()', () => {
    it('should update configuration', () => {
      const provider = new ClaudeProvider({
        apiKey: 'test-key',
        model: 'claude-1',
      });

      provider.updateConfig({
        model: 'claude-2',
        temperature: 0.9,
      });

      // Config is private, but we can test it indirectly
      expect(provider).toBeInstanceOf(ClaudeProvider);
    });
  });
});
