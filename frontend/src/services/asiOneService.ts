// ASI-One Service - Modular service for Fetch.ai ASI-One integration
// Designed to work in frontend with localStorage, easily movable to backend

import { createSubsystemLogger } from '../config/logger';
import { Subsystem } from '../types/logging';

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
  conversationId?: string;
}

export class ASIOneService {
  private config: ASIOneConfig;
  private conversationHistory: ASIOneMessage[] = [];
  private conversationId: string;

  constructor(config?: Partial<ASIOneConfig>) {
    this.conversationId = this.generateConversationId();
    
    this.config = {
      apiKey: config?.apiKey || process.env.REACT_APP_ASI_ONE_API_KEY || 'sk_55aa3a95dcd341c6a2e13a4244e612f550f0520ca67342d88e0ad81812909ad5',
      baseUrl: config?.baseUrl || process.env.REACT_APP_ASI_ONE_BASE_URL || 'https://api.asi1.ai/v1',
      model: config?.model || process.env.REACT_APP_ASI_ONE_MODEL || 'asi1-mini',
      temperature: config?.temperature || 0.7,
      maxTokens: config?.maxTokens || parseInt(process.env.REACT_APP_ASI_ONE_MAX_TOKENS || '2048'),
      conversationId: this.conversationId,
      ...config
    };

    // Load conversation history from localStorage
    this.loadConversationHistory();
    
    logger.info({
      baseUrl: this.config.baseUrl,
      model: this.config.model,
      conversationId: this.conversationId
    }, 'ASI-One service initialized');
  }

  /**
   * Send a message to ASI-One and get a response
   */
  async sendMessage(userMessage: string, context?: any): Promise<string> {
    try {
      logger.info({ 
        message: userMessage.substring(0, 100) + '...',
        conversationId: this.conversationId 
      }, 'Sending message to ASI-One');

      // Add user message to conversation history
      const userMsg: ASIOneMessage = {
        role: 'user',
        content: userMessage,
        timestamp: Date.now()
      };
      this.conversationHistory.push(userMsg);

      // Prepare the request
      const request: ASIOneRequest = {
        model: this.config.model,
        messages: this.buildContextualMessages(context),
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        stream: false
      };

      // Make the API call
      const response = await this.callASIOneAPI(request);
      
      // Extract the assistant's response
      const assistantMessage = response.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
      
      // Add assistant response to conversation history
      const assistantMsg: ASIOneMessage = {
        role: 'assistant',
        content: assistantMessage,
        timestamp: Date.now()
      };
      this.conversationHistory.push(assistantMsg);

      // Save updated conversation history
      this.saveConversationHistory();

      logger.info({
        responseLength: assistantMessage.length,
        conversationId: this.conversationId,
        usage: response.usage
      }, 'Received response from ASI-One');

      return assistantMessage;

    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        conversationId: this.conversationId 
      }, 'Error sending message to ASI-One');
      
      // Return a fallback response
      return this.getFallbackResponse(userMessage, error);
    }
  }

  /**
   * Build contextual messages for the API request
   */
  private buildContextualMessages(context?: any): ASIOneMessage[] {
    const messages: ASIOneMessage[] = [];

    // Add system message with DotBot context
    messages.push({
      role: 'system',
      content: this.getSystemPrompt(context)
    });

    // Add conversation history (limit to last 10 messages to avoid token limits)
    const recentHistory = this.conversationHistory.slice(-10);
    messages.push(...recentHistory);

    return messages;
  }

  /**
   * Get system prompt for DotBot context
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
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        'User-Agent': 'DotBot/1.0.0'
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ASI-One API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
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
   * Load conversation history from localStorage
   */
  private loadConversationHistory(): void {
    try {
      const stored = localStorage.getItem(`dotbot_conversation_${this.conversationId}`);
      if (stored) {
        this.conversationHistory = JSON.parse(stored);
        logger.info({ 
          messageCount: this.conversationHistory.length,
          conversationId: this.conversationId 
        }, 'Loaded conversation history');
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to load conversation history');
      this.conversationHistory = [];
    }
  }

  /**
   * Save conversation history to localStorage
   */
  private saveConversationHistory(): void {
    try {
      localStorage.setItem(
        `dotbot_conversation_${this.conversationId}`, 
        JSON.stringify(this.conversationHistory)
      );
    } catch (error) {
      logger.warn({ error }, 'Failed to save conversation history');
    }
  }

  /**
   * Generate a unique conversation ID
   */
  private generateConversationId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Start a new conversation
   */
  startNewConversation(): void {
    this.conversationId = this.generateConversationId();
    this.conversationHistory = [];
    logger.info({ conversationId: this.conversationId }, 'Started new conversation');
  }

  /**
   * Get current conversation history
   */
  getConversationHistory(): ASIOneMessage[] {
    return [...this.conversationHistory];
  }

  /**
   * Get current conversation ID
   */
  getConversationId(): string {
    return this.conversationId;
  }

  /**
   * Clear conversation history
   */
  clearConversationHistory(): void {
    this.conversationHistory = [];
    localStorage.removeItem(`dotbot_conversation_${this.conversationId}`);
    logger.info({ conversationId: this.conversationId }, 'Cleared conversation history');
  }

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
