// ASI-One Service - Modular service for Fetch.ai ASI-One integration
// Designed to work in frontend with localStorage, easily movable to backend

import { createSubsystemLogger, Subsystem } from './logger';
import { getEnv } from '../env';

// Initialize logger for ASI-One service
const logger = createSubsystemLogger(Subsystem.AGENT_COMM);

export interface ASIOneMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

export interface ASIOneRequest {
  model: string;
  messages: ASIOneMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ASIOneResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ASIOneMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ASIOneConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export class ASIOneService {
  private config: ASIOneConfig;

  constructor(config?: Partial<ASIOneConfig>) {
    const apiKey = config?.apiKey || getEnv('ASI_ONE_API_KEY');
    
    if (!apiKey) {
      // Use error level to ensure visibility - this is a critical configuration issue
      logger.error({}, 'ASI-One API key not provided. Please set ASI_ONE_API_KEY environment variable. API calls will fail without a valid key.');
    }
    
    // Merge config carefully - don't let undefined values override defaults
    this.config = {
      apiKey: apiKey || '',
      baseUrl: 'https://api.asi1.ai/v1', // Default
      model: 'asi1-mini', // Default
      temperature: 0.0,
      maxTokens: parseInt(getEnv('ASI_ONE_MAX_TOKENS') || '2048'), // Default
      // Override with env vars if set
      ...(getEnv('ASI_ONE_BASE_URL') && { baseUrl: getEnv('ASI_ONE_BASE_URL') }),
      ...(getEnv('ASI_ONE_MODEL') && { model: getEnv('ASI_ONE_MODEL') }),
      // Override with provided config (only if values are defined)
      ...(config?.baseUrl && { baseUrl: config.baseUrl }),
      ...(config?.model && { model: config.model }),
      ...(config?.temperature !== undefined && { temperature: config.temperature }),
      ...(config?.maxTokens !== undefined && { maxTokens: config.maxTokens }),
      ...(config?.apiKey && { apiKey: config.apiKey }),
    };
    
    logger.info({
      baseUrl: this.config.baseUrl,
      model: this.config.model
    }, 'ASI-One service initialized');
  }

  /**
   * Send a message to ASI-One and get a response
   * 
   * This is now a STATELESS service - conversation history is managed by the caller (frontend)
   */
  async sendMessage(userMessage: string, context?: any): Promise<string> {
    try {
      logger.info({ 
        message: userMessage.substring(0, 100) + '...',
        hasConversationHistory: !!context?.conversationHistory
      }, 'Sending message to ASI-One');

      // Prepare the request with current user message
      const request: ASIOneRequest = {
        model: this.config.model,
        messages: this.buildContextualMessages(context, userMessage),
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        stream: false
      };

      // Make the API call
      const response = await this.callASIOneAPI(request);
      const responsePreview = response.choices?.[0]?.message?.content?.substring(0, 100);
      logger.debug({ responsePreview }, 'Response received from ASI-One');
      
      // Extract and return the assistant's response
      const assistantMessage = response.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
      
      logger.info({
        responseLength: assistantMessage.length,
        usage: response.usage
      }, 'Received response from ASI-One');

      return assistantMessage;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      logger.error({ 
        error: errorMsg,
        stack: errorStack
      }, 'ASI-One API Error');
      
      // Return a fallback response
      const fallback = this.getFallbackResponse(userMessage, error);
      logger.warn({ 
        fallbackPreview: fallback.substring(0, 100)
      }, 'Returning fallback response');
      return fallback;
    }
  }

  /**
   * Build contextual messages for the API request
   * 
   * Stateless service - conversation history is managed by the caller (frontend).
   * Filters out system messages from history to ensure the system prompt is first.
   * 
   * @param context - Context object with conversationHistory and optional systemPrompt
   * @param currentUserMessage - The current user message to include
   */
  private buildContextualMessages(context?: any, currentUserMessage?: string): ASIOneMessage[] {
    const messages: ASIOneMessage[] = [];
    const systemPrompt = context?.systemPrompt || this.getSystemPrompt(context);
    const conversationHistory = context?.conversationHistory || [];
    
    if (context?.systemPrompt) {
      logger.info({ 
        promptLength: systemPrompt.length,
        preview: systemPrompt.substring(0, 200),
        historyLength: conversationHistory.length,
        hasDotBotPrompt: systemPrompt.includes('DOTBOT') || systemPrompt.includes('Polkadot blockchain')
      }, 'Using provided systemPrompt from DotBot');
    } else {
      logger.warn({ 
        historyLength: conversationHistory.length
      }, 'WARNING: No systemPrompt provided - using default (DotBot capabilities may be limited)');
    }
    
    // ASI-One API requires system message to be first (and only system message)
    messages.push({
      role: 'system',
      content: systemPrompt
    });

    // Add conversation history (from context/frontend). Already limited by core (CHAT_HISTORY_MESSAGE_LIMIT).
    // Filter out system messages to ensure our system prompt is the first (and only) system message
    if (conversationHistory.length > 0) {
      const conversationMessages = conversationHistory.filter((msg: ASIOneMessage) => msg.role !== 'system');
      messages.push(...conversationMessages);
    }

    // ALWAYS add the current user message
    if (currentUserMessage) {
      messages.push({
        role: 'user',
        content: currentUserMessage
      });
    }

    // Append current-turn balance so the model uses it for balance questions (avoids stale balance from history)
    const turnContext = context?.turnContext;
    if (turnContext && turnContext.trim().length > 0) {
      messages.push({
        role: 'user',
        content: turnContext
      });
    }

    return messages;
  }

  /**
   * Get system prompt for DotBot context (fallback if not provided)
   */
  private getSystemPrompt(context?: any): string {
    return `You are DotBot, a specialized AI assistant for the Polkadot ecosystem. You help users interact with Polkadot through natural language commands.

Your capabilities include:
- Asset transfers (DOT, tokens across parachains)
- Asset swaps (finding optimal DEX routes)
- Governance participation (voting, proposals)
- Multisig operations
- Balance checking and portfolio management
- General Polkadot ecosystem guidance

Current context:
- User wallet: ${context?.walletAddress || 'Not connected'}
- Network: ${context?.network || 'Polkadot'}
- Available agents: Asset Transfer, Asset Swap, Governance, Multisig

Always be helpful, accurate, and guide users through Polkadot operations step by step. If you need specific information (like wallet connection or transaction details), ask the user to provide it.

Keep responses concise but informative. Use bullet points for multiple options and be clear about any requirements or next steps.`;
  }

  /**
   * Make the actual API call to ASI-One
   */
  private async callASIOneAPI(request: ASIOneRequest): Promise<ASIOneResponse> {
    // Construct URL - prefer ASI_ONE_API_URL, fallback to baseUrl + /chat/completions
    const apiUrl = getEnv('ASI_ONE_API_URL');
    const url = apiUrl || `${this.config.baseUrl}/chat/completions`;
    
    if (!url || url === 'undefined/chat/completions') {
      const errorMsg = `ASI-One API URL is not configured. Set ASI_ONE_API_URL or ASI_ONE_BASE_URL environment variable. Current baseUrl: ${this.config.baseUrl}`;
      logger.error({ baseUrl: this.config.baseUrl, apiUrl }, errorMsg);
      throw new Error(errorMsg);
    }
    
    if (!this.config.apiKey) {
      const errorMsg = 'ASI-One API key is not configured. Set ASI_ONE_API_KEY environment variable.';
      logger.error({}, errorMsg);
      throw new Error(errorMsg);
    }
    
    logger.info({ 
      url: url.replace(/\/\/[^/]+@/, '//***@'), // Mask credentials in URL
      model: request.model 
    }, 'Fetching from ASI-One');
    
    // Add timeout to prevent hanging (60 seconds for LLM API calls)
    const ASI_ONE_TIMEOUT_MS = parseInt(getEnv('ASI_ONE_TIMEOUT_MS') || '60000');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ASI_ONE_TIMEOUT_MS);
    
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'User-Agent': 'DotBot/1.0.0'
        },
        body: JSON.stringify(request),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        logger.error({ 
          url: url.replace(/\/\/[^/]+@/, '//***@'),
          timeout: ASI_ONE_TIMEOUT_MS 
        }, 'ASI-One API request timed out');
        throw new Error(`ASI-One API request timed out after ${ASI_ONE_TIMEOUT_MS}ms. The API may be slow or unavailable.`);
      }
      
      // Network errors (DNS, connection refused, etc.)
      logger.error({ 
        url: url.replace(/\/\/[^/]+@/, '//***@'),
        error: fetchError.message,
        errorName: fetchError.name
      }, 'ASI-One API network error');
      throw new Error(`ASI-One API network error: ${fetchError.message}. Please check your network connection and API endpoint.`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ 
        status: response.status, 
        statusText: response.statusText,
        error: errorText 
      }, 'ASI-One API error response');
      throw new Error(`ASI-One API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    logger.info({ 
      model: data.model,
      tokens: data.usage?.total_tokens 
    }, 'Response received from ASI-One');

    return data as ASIOneResponse;
  }

  /**
   * Get fallback response when API fails
   */
  private getFallbackResponse(userMessage: string, _error: any): string {
    const message = userMessage.toLowerCase();
    
    if (message.includes('balance')) {
      return "I'd be happy to help you check your DOT balance! However, I'm currently experiencing connectivity issues with the AI service. Please try connecting your wallet first, and I'll help you check your balance once the connection is restored.";
    }
    
    if (message.includes('transfer') || message.includes('send')) {
      return "I can help you with transfers! I'm currently experiencing some connectivity issues, but I can still guide you through the transfer process. Please make sure your wallet is connected and let me know the recipient address and amount.";
    }
    
    if (message.includes('swap') || message.includes('exchange')) {
      return "I can help you find the best swap routes! While I'm experiencing some connectivity issues, I can still provide guidance on DEX options like HydraDX, Acala, and others. What tokens would you like to swap?";
    }
    
    return `I understand you want help with: "${userMessage}". I'm currently experiencing some connectivity issues with the AI service, but I'm still here to help! Please try again in a moment, or let me know if you need assistance with a specific Polkadot operation.`;
  }

  /**
   * NOTE: History management has been removed from this service.
   * 
   * The frontend (App.tsx) now manages conversation history as React state.
   * This service is now STATELESS - it just makes API calls.
   * 
   * History is passed via context.conversationHistory from the frontend.
   */

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<ASIOneConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info({ newConfig }, 'Updated ASI-One configuration');
  }

  /**
   * Test API connectivity
   */
  async testConnection(): Promise<boolean> {
    try {
      const testRequest: ASIOneRequest = {
        model: this.config.model,
        messages: [{ role: 'user', content: 'Hello, this is a connection test.' }],
        temperature: this.config.temperature,
        max_tokens: 50,
        stream: false
      };
      await this.callASIOneAPI(testRequest);
      return true;
    } catch (error) {
      logger.error({ error }, 'ASI-One connection test failed');
      return false;
    }
  }
}

// Create singleton instance
let asiOneServiceInstance: ASIOneService | null = null;

export const getASIOneService = (config?: Partial<ASIOneConfig>): ASIOneService => {
  if (!asiOneServiceInstance) {
    asiOneServiceInstance = new ASIOneService(config);
  }
  return asiOneServiceInstance;
};

export default ASIOneService;
