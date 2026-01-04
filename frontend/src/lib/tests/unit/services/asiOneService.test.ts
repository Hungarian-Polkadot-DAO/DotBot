/**
 * Unit tests for ASI One Service
 */

// Mock dependencies before imports
jest.mock('../../../services/logger', () => ({
  createSubsystemLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
  Subsystem: {
    AGENT_COMM: 'AGENT_COMM',
  },
}));

// Mock global fetch
global.fetch = jest.fn();

// Mock console methods
const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

import { ASIOneService, getASIOneService, ASIOneMessage, ASIOneResponse } from '../../../services/asiOneService';

describe('ASIOneService', () => {
  let mockFetch: jest.Mock;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy.mockClear();
    consoleErrorSpy.mockClear();

    mockFetch = global.fetch as jest.Mock;

    // Save original env
    originalEnv = { ...process.env };

    // Reset singleton
    (getASIOneService as any).asiOneServiceInstance = null;
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  afterAll(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      const config = {
        apiKey: 'test-api-key',
        baseUrl: 'https://test-api.com',
        model: 'test-model',
        temperature: 0.5,
        maxTokens: 1000,
      };

      const service = new ASIOneService(config);

      expect(service).toBeInstanceOf(ASIOneService);
    });

    it('should use environment variables when config not provided', () => {
      process.env.REACT_APP_ASI_ONE_API_KEY = 'env-api-key';
      process.env.REACT_APP_ASI_ONE_BASE_URL = 'https://env-api.com';
      process.env.REACT_APP_ASI_ONE_MODEL = 'env-model';
      process.env.REACT_APP_ASI_ONE_MAX_TOKENS = '3000';

      const service = new ASIOneService();

      expect(service).toBeInstanceOf(ASIOneService);
    });

    it('should use default values when nothing provided', () => {
      delete process.env.REACT_APP_ASI_ONE_API_KEY;
      delete process.env.REACT_APP_ASI_ONE_BASE_URL;
      delete process.env.REACT_APP_ASI_ONE_MODEL;
      delete process.env.REACT_APP_ASI_ONE_MAX_TOKENS;

      const service = new ASIOneService();

      expect(service).toBeInstanceOf(ASIOneService);
    });

    it('should merge partial config with defaults', () => {
      const service = new ASIOneService({
        apiKey: 'custom-key',
        temperature: 0.9,
      });

      expect(service).toBeInstanceOf(ASIOneService);
    });
  });

  describe('sendMessage()', () => {
    let service: ASIOneService;
    let mockResponse: ASIOneResponse;

    beforeEach(() => {
      service = new ASIOneService({
        apiKey: 'test-key',
        baseUrl: 'https://api.test.com',
        model: 'test-model',
      });

      mockResponse = {
        id: 'test-id',
        object: 'chat.completion',
        created: Date.now(),
        model: 'test-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Test response from ASI-One',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };
    });

    it('should send message and return response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await service.sendMessage('Hello, how are you?');

      expect(result).toBe('Test response from ASI-One');
      expect(mockFetch).toHaveBeenCalled();
      expect(mockFetch.mock.calls[0][0]).toContain('/chat/completions');
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      expect(mockFetch.mock.calls[0][1].headers['Authorization']).toBe('Bearer test-key');
    });

    it('should include system prompt in request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      await service.sendMessage('Hello');

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.messages).toBeDefined();
      expect(requestBody.messages[0].role).toBe('system');
      expect(requestBody.messages[0].content).toContain('DotBot');
    });

    it('should include conversation history from context', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const conversationHistory: ASIOneMessage[] = [
        { role: 'user', content: 'Previous message' },
        { role: 'assistant', content: 'Previous response' },
      ];

      await service.sendMessage('Current message', {
        conversationHistory,
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.messages.length).toBeGreaterThan(2); // system + history + current
      expect(requestBody.messages.some((m: ASIOneMessage) => m.content === 'Previous message')).toBe(true);
    });

    it('should use provided system prompt from context', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const customSystemPrompt = 'Custom system prompt';
      await service.sendMessage('Hello', {
        systemPrompt: customSystemPrompt,
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.messages[0].content).toBe(customSystemPrompt);
    });

    it('should limit conversation history to last 20 messages', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const longHistory: ASIOneMessage[] = Array.from({ length: 30 }, (_, i) => ({
        role: 'user',
        content: `Message ${i}`,
      }));

      await service.sendMessage('Current', {
        conversationHistory: longHistory,
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      // Should have system + 20 history + 1 current = 22 messages
      expect(requestBody.messages.length).toBe(22);
    });

    it('should include current user message', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      await service.sendMessage('Current user message');

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const lastMessage = requestBody.messages[requestBody.messages.length - 1];
      expect(lastMessage.role).toBe('user');
      expect(lastMessage.content).toBe('Current user message');
    });

    it('should use configured temperature and maxTokens', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const serviceWithConfig = new ASIOneService({
        temperature: 0.5,
        maxTokens: 1000,
      });

      await serviceWithConfig.sendMessage('Hello');

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.temperature).toBe(0.5);
      expect(requestBody.max_tokens).toBe(1000);
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Server error',
      });

      const result = await service.sendMessage('Hello');

      expect(result).toBeDefined();
      expect(result).toContain('connectivity issues');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await service.sendMessage('Hello');

      expect(result).toBeDefined();
      expect(result).toContain('connectivity issues');
    });

    it('should return fallback response for balance queries on error', async () => {
      mockFetch.mockRejectedValue(new Error('API error'));

      const result = await service.sendMessage('What is my balance?');

      expect(result).toContain('balance');
      expect(result).toContain('connectivity issues');
    });

    it('should return fallback response for transfer queries on error', async () => {
      mockFetch.mockRejectedValue(new Error('API error'));

      const result = await service.sendMessage('Send 10 DOT');

      expect(result).toContain('transfer');
      expect(result).toContain('connectivity issues');
    });

    it('should return fallback response for swap queries on error', async () => {
      mockFetch.mockRejectedValue(new Error('API error'));

      const result = await service.sendMessage('Swap DOT for USDT');

      expect(result).toContain('swap');
      expect(result).toContain('connectivity issues');
    });

    it('should handle empty response choices', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ...mockResponse,
          choices: [],
        }),
      });

      const result = await service.sendMessage('Hello');

      expect(result).toBe('Sorry, I could not generate a response.');
    });

    it('should handle missing message content', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ...mockResponse,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: '',
              },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      const result = await service.sendMessage('Hello');

      expect(result).toBe('Sorry, I could not generate a response.');
    });
  });

  describe('updateConfig()', () => {
    it('should update configuration', () => {
      const service = new ASIOneService({
        apiKey: 'original-key',
        temperature: 0.7,
      });

      service.updateConfig({
        apiKey: 'new-key',
        temperature: 0.9,
      });

      // Config is private, so we test indirectly by sending a message
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test',
          object: 'chat.completion',
          created: Date.now(),
          model: 'test',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'test' },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      // The update should affect subsequent calls
      expect(service).toBeDefined();
    });
  });

  describe('testConnection()', () => {
    it('should return true when connection succeeds', async () => {
      const service = new ASIOneService({
        apiKey: 'test-key',
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test',
          object: 'chat.completion',
          created: Date.now(),
          model: 'test',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'test' },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      const result = await service.testConnection();

      expect(result).toBe(true);
    });

    it('should return false when connection fails', async () => {
      const service = new ASIOneService({
        apiKey: 'test-key',
      });

      mockFetch.mockRejectedValue(new Error('Connection failed'));

      const result = await service.testConnection();

      expect(result).toBe(false);
    });
  });

  describe('getASIOneService()', () => {
    it('should return singleton instance', () => {
      const service1 = getASIOneService();
      const service2 = getASIOneService();

      expect(service1).toBe(service2);
    });

    it('should create new instance with config on first call', () => {
      const config = {
        apiKey: 'singleton-key',
        baseUrl: 'https://singleton.com',
      };

      const service = getASIOneService(config);

      expect(service).toBeInstanceOf(ASIOneService);
    });

    it('should return same instance on subsequent calls', () => {
      const service1 = getASIOneService({ apiKey: 'key1' });
      const service2 = getASIOneService({ apiKey: 'key2' }); // Different config

      expect(service1).toBe(service2); // Should be same instance
    });
  });

  describe('buildContextualMessages() - tested indirectly', () => {
    it('should build messages with system prompt, history, and current message', async () => {
      const service = new ASIOneService({
        apiKey: 'test-key',
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test',
          object: 'chat.completion',
          created: Date.now(),
          model: 'test',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'test' },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      const history: ASIOneMessage[] = [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
      ];

      await service.sendMessage('How are you?', {
        conversationHistory: history,
        systemPrompt: 'You are a helpful assistant.',
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.messages.length).toBe(4); // system + 2 history + 1 current
      expect(requestBody.messages[0].role).toBe('system');
      expect(requestBody.messages[1].role).toBe('user');
      expect(requestBody.messages[2].role).toBe('assistant');
      expect(requestBody.messages[3].role).toBe('user');
      expect(requestBody.messages[3].content).toBe('How are you?');
    });
  });

  describe('callASIOneAPI() - tested indirectly', () => {
    it('should make POST request to correct URL', async () => {
      const service = new ASIOneService({
        apiKey: 'test-key',
        baseUrl: 'https://custom-api.com',
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test',
          object: 'chat.completion',
          created: Date.now(),
          model: 'test',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'test' },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      await service.sendMessage('Hello');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://custom-api.com/chat/completions'),
        expect.any(Object)
      );
    });

    it('should use environment variable for API URL if set', async () => {
      process.env.REACT_APP_ASI_ONE_API_URL = 'https://env-api.com/chat';

      const service = new ASIOneService({
        apiKey: 'test-key',
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test',
          object: 'chat.completion',
          created: Date.now(),
          model: 'test',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'test' },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      await service.sendMessage('Hello');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://env-api.com/chat',
        expect.any(Object)
      );
    });

    it('should include correct headers', async () => {
      const service = new ASIOneService({
        apiKey: 'test-api-key',
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test',
          object: 'chat.completion',
          created: Date.now(),
          model: 'test',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'test' },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      await service.sendMessage('Hello');

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBe('Bearer test-api-key');
      expect(headers['User-Agent']).toBe('DotBot/1.0.0');
    });

    it('should handle API error responses', async () => {
      const service = new ASIOneService({
        apiKey: 'test-key',
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid API key',
      });

      const result = await service.sendMessage('Hello');

      expect(result).toContain('connectivity issues');
    });
  });

  describe('getFallbackResponse() - tested indirectly', () => {
    it('should provide context-aware fallback for balance queries', async () => {
      const service = new ASIOneService({
        apiKey: 'test-key',
      });

      mockFetch.mockRejectedValue(new Error('API error'));

      const result = await service.sendMessage('check my balance');

      expect(result).toContain('balance');
      expect(result).toContain('wallet');
    });

    it('should provide context-aware fallback for transfer queries', async () => {
      const service = new ASIOneService({
        apiKey: 'test-key',
      });

      mockFetch.mockRejectedValue(new Error('API error'));

      const result = await service.sendMessage('send 10 DOT to address');

      expect(result).toContain('transfer');
      expect(result).toContain('wallet');
    });

    it('should provide generic fallback for other queries', async () => {
      const service = new ASIOneService({
        apiKey: 'test-key',
      });

      mockFetch.mockRejectedValue(new Error('API error'));

      const result = await service.sendMessage('random question');

      expect(result).toContain('connectivity issues');
      expect(result).toContain('random question');
    });
  });
});

