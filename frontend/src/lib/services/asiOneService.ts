// ASI-One Service - Modular service for Fetch.ai ASI-One integration
// Designed to work in frontend with localStorage, easily movable to backend

import { createSubsystemLogger, Subsystem } from './logger';

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
    this.config = {
      apiKey: config?.apiKey || process.env.REACT_APP_ASI_ONE_API_KEY || 'sk_55aa3a95dcd341c6a2e13a4244e612f550f0520ca67342d88e0ad81812909ad5',
      baseUrl: config?.baseUrl || process.env.REACT_APP_ASI_ONE_BASE_URL || 'https://api.asi1.ai/v1',
      model: config?.model || process.env.REACT_APP_ASI_ONE_MODEL || 'asi1-mini',
      temperature: config?.temperature || 0.7,
      maxTokens: config?.maxTokens || parseInt(process.env.REACT_APP_ASI_ONE_MAX_TOKENS || '2048'),
      ...config
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
      
      console.log('📤 Request to ASI-One:', {
        model: request.model,
        messageCount: request.messages.length,
        temperature: request.temperature,
        max_tokens: request.max_tokens
      });

      // Make the API call
      console.log('🌐 Calling ASI-One API...');
      const response = await this.callASIOneAPI(request);
      console.log('✅ ASI-One API response received:', {
        choices: response.choices?.length,
        firstChoice: response.choices?.[0]?.message?.content?.substring(0, 100)
      });
      
      // Extract and return the assistant's response
      const assistantMessage = response.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
      
      // NOTE: We don't save history here - that's the frontend's job now
      console.log('📝 Response ready - frontend will manage history');

      logger.info({
        responseLength: assistantMessage.length,
        usage: response.usage
      }, 'Received response from ASI-One');

      return assistantMessage;

    } catch (error) {
      console.error('❌ ASI-One API Error:', error);
      console.error('❌ Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        error: error
      });
      
      logger.error({ 
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Error sending message to ASI-One');
      
      // Return a fallback response
      const fallback = this.getFallbackResponse(userMessage, error);
      console.log('⚠️ Returning fallback response:', fallback.substring(0, 100));
      return fallback;
    }
  }

  /**
   * Build contextual messages for the API request
   * 
   * This is now STATELESS - history comes from context (managed by frontend)
   * 
   * @param context - Context object with conversationHistory from DotBot/frontend
   * @param currentUserMessage - The current user message to include
   */
  private buildContextualMessages(context?: any, currentUserMessage?: string): ASIOneMessage[] {
    const messages: ASIOneMessage[] = [];

    // Use provided systemPrompt from context if available (from DotBot)
    // Otherwise fall back to default
    const systemPrompt = context?.systemPrompt || this.getSystemPrompt(context);
    
    // Get conversation history from context (provided by frontend)
    const conversationHistory = context?.conversationHistory || [];
    
    console.log('🔍 ASIOneService - Building messages:', {
      hasSystemPrompt: !!context?.systemPrompt,
      promptLength: systemPrompt.length,
      historyLength: conversationHistory.length,
      hasCurrentMessage: !!currentUserMessage
    });
    
    if (context?.systemPrompt) {
      logger.info({ 
        promptLength: systemPrompt.length,
        preview: systemPrompt.substring(0, 200),
        historyLength: conversationHistory.length
      }, 'Using provided systemPrompt from DotBot');
    } else {
      logger.info({ 
        historyLength: conversationHistory.length
      }, 'Using default systemPrompt');
    }
    
    // Add system message
    messages.push({
      role: 'system',
      content: systemPrompt
    });

    // Add conversation history (from context/frontend)
    if (conversationHistory.length > 0) {
      // Limit to last 20 messages to avoid token limits
      const recentHistory = conversationHistory.slice(-20);
      messages.push(...recentHistory);
      console.log('📜 Including conversation history from frontend:', recentHistory.length, 'messages');
    } else {
      console.log('📜 No conversation history provided');
    }

    // ALWAYS add the current user message
    if (currentUserMessage) {
      messages.push({
        role: 'user',
        content: currentUserMessage
      });
      console.log('✅ Added current user message to request');
    }

    console.log('📤 Final message array to LLM:', {
      totalMessages: messages.length,
      systemPromptLength: messages[0]?.content.length,
      historyMessages: conversationHistory.length,
      currentMessage: currentUserMessage?.substring(0, 50)
    });

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
    const url = process.env.REACT_APP_ASI_ONE_API_URL || `${this.config.baseUrl}/chat/completions`;
    
    console.log('📡 Fetching from ASI-One:', {
      url,
      method: 'POST',
      messageCount: request.messages.length,
      model: request.model
    });
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        'User-Agent': 'DotBot/1.0.0'
      },
      body: JSON.stringify(request)
    });

    console.log('📡 ASI-One HTTP response:', {
      status: response.status,
      ok: response.ok,
      statusText: response.statusText
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ ASI-One API error response:', errorText);
      throw new Error(`ASI-One API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('📦 ASI-One API data:', {
      hasChoices: !!data.choices,
      choicesLength: data.choices?.length,
      firstMessageLength: data.choices?.[0]?.message?.content?.length
    });
    return data as ASIOneResponse;
  }

  /**
   * Get fallback response when API fails
   */
  private getFallbackResponse(userMessage: string, error: any): string {
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
      const testMessage = "Hello, this is a connection test.";
      await this.sendMessage(testMessage);
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
