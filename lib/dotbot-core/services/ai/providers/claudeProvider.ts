// Claude Provider - Anthropic Claude API integration

import { AIProvider, AIMessage as _AIMessage } from '../types';
import { getEnv } from '../../../env';

export interface ClaudeConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeRequest {
  model: string;
  max_tokens: number;
  temperature?: number;
  messages: ClaudeMessage[];
  system?: string;
}

export interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class ClaudeProvider implements AIProvider {
  private config: Required<ClaudeConfig>;

  constructor(config: ClaudeConfig) {
    const apiKey = config.apiKey || getEnv('CLAUDE_API_KEY');

    if (!apiKey) {
      console.warn('⚠️ Claude API key not provided. Please set CLAUDE_API_KEY environment variable. API calls will fail without a valid key.');
    }

    this.config = {
      apiKey: apiKey || '',
      baseUrl: config.baseUrl || getEnv('CLAUDE_BASE_URL') || 'https://api.anthropic.com/v1',
      model: config.model || getEnv('CLAUDE_MODEL') || 'claude-sonnet-4-20250514',
      maxTokens: config.maxTokens || parseInt(getEnv('CLAUDE_MAX_TOKENS') || '4096'),
      temperature: config.temperature || 0.3, // Lower temperature for accuracy in blockchain operations (0.0-1.0, lower = more deterministic)
    };
  }

  async sendMessage(userMessage: string, context?: any): Promise<string> {
    try {
      const messages = this.buildMessages(userMessage, context);
      const systemPrompt = this.getSystemPrompt(context);

      const request: ClaudeRequest = {
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages,
        system: systemPrompt
      };

      const response = await this.callClaudeAPI(request);
      
      const content = response.content[0]?.text || 'Sorry, I could not generate a response.';
      
      return content;

    } catch (error) {
      console.error('❌ Claude API Error:', error);
      console.error('❌ Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        error: error
      });

      // Return a fallback response
      const fallback = this.getFallbackResponse(userMessage, error);
      console.log('⚠️ Returning fallback response:', fallback.substring(0, 100));
      return fallback;
    }
  }

  private buildMessages(userMessage: string, context?: any): ClaudeMessage[] {
    const messages: ClaudeMessage[] = [];

    // Get conversation history from context (provided by frontend)
    const conversationHistory = context?.conversationHistory || [];

    // Add conversation history (from context/frontend). Already limited by core (CHAT_HISTORY_MESSAGE_LIMIT).
    if (conversationHistory.length > 0) {
      for (const msg of conversationHistory) {
        // Claude doesn't support system messages in the messages array, skip them
        if (msg.role !== 'system') {
          messages.push({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content
          });
        }
      }
    }

    // ALWAYS add the current user message
    messages.push({
      role: 'user',
      content: userMessage
    });

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

  private getSystemPrompt(context?: any): string {
    // Use provided systemPrompt from context if available (from DotBot)
    // Otherwise fall back to default
    if (context?.systemPrompt) {
      return context.systemPrompt;
    }

    // Default system prompt
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

  private async callClaudeAPI(request: ClaudeRequest): Promise<ClaudeResponse> {
    const url = `${this.config.baseUrl}/messages`;

    console.info('Fetching from Claude, model:', request.model);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
        'User-Agent': 'DotBot/1.0.0'
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Claude API error response:', errorText);
      throw new Error(`Claude API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data as ClaudeResponse;
  }

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

  async testConnection(): Promise<boolean> {
    try {
      const testRequest: ClaudeRequest = {
        model: this.config.model,
        max_tokens: 50,
        temperature: this.config.temperature,
        messages: [{ role: 'user', content: 'Hello, this is a connection test.' }],
        system: 'You are a helpful assistant.'
      };
      await this.callClaudeAPI(testRequest);
      return true;
    } catch (error) {
      console.error('❌ Claude connection test failed:', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  updateConfig(newConfig: Partial<ClaudeConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}
