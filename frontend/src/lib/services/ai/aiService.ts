// AI Service - Factory for managing different AI providers

import { AIProvider } from './types';
import { ASIOneProvider } from './providers/asiOneProvider';
import { ClaudeProvider, ClaudeConfig } from './providers/claudeProvider';

export enum AIProviderType {
  ASI_ONE = 'asi-one',
  CLAUDE = 'claude',
  OPENAI = 'openai' // Reserved for future implementation
}

export interface AIServiceConfig {
  providerType?: AIProviderType;
  asiOneConfig?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
  claudeConfig?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
  };
}

export class AIService {
  private provider: AIProvider;
  private providerType: AIProviderType;

  constructor(config?: AIServiceConfig) {
    // Determine provider type from config or environment variable
    const providerType = config?.providerType || 
      (process.env.REACT_APP_AI_PROVIDER as AIProviderType) || 
      AIProviderType.ASI_ONE;

    this.providerType = providerType;
    this.provider = this.createProvider(providerType, config);
  }

  private createProvider(type: AIProviderType, config?: AIServiceConfig): AIProvider {
    switch (type) {
      case AIProviderType.ASI_ONE:
        return new ASIOneProvider({
          apiKey: config?.asiOneConfig?.apiKey || process.env.REACT_APP_ASI_ONE_API_KEY,
          baseUrl: config?.asiOneConfig?.baseUrl || process.env.REACT_APP_ASI_ONE_BASE_URL,
          model: config?.asiOneConfig?.model || process.env.REACT_APP_ASI_ONE_MODEL,
          temperature: config?.asiOneConfig?.temperature,
          maxTokens: config?.asiOneConfig?.maxTokens
        });

      case AIProviderType.CLAUDE:
        const claudeApiKey = config?.claudeConfig?.apiKey || process.env.REACT_APP_CLAUDE_API_KEY;
        if (!claudeApiKey) {
          console.warn('⚠️ Claude API key not found. Please set REACT_APP_CLAUDE_API_KEY environment variable.');
        }
        return new ClaudeProvider({
          apiKey: claudeApiKey || '',
          baseUrl: config?.claudeConfig?.baseUrl || process.env.REACT_APP_CLAUDE_BASE_URL,
          model: config?.claudeConfig?.model || process.env.REACT_APP_CLAUDE_MODEL,
          maxTokens: config?.claudeConfig?.maxTokens,
          temperature: config?.claudeConfig?.temperature
        });

      case AIProviderType.OPENAI:
        // Reserved for future implementation
        throw new Error('OpenAI provider not yet implemented');

      default:
        console.warn(`⚠️ Unknown provider type: ${type}, falling back to ASI-One`);
        return new ASIOneProvider({
          apiKey: config?.asiOneConfig?.apiKey || process.env.REACT_APP_ASI_ONE_API_KEY,
          baseUrl: config?.asiOneConfig?.baseUrl || process.env.REACT_APP_ASI_ONE_BASE_URL,
          model: config?.asiOneConfig?.model || process.env.REACT_APP_ASI_ONE_MODEL,
          temperature: config?.asiOneConfig?.temperature,
          maxTokens: config?.asiOneConfig?.maxTokens
        });
    }
  }

  async sendMessage(userMessage: string, context?: any): Promise<string> {
    return this.provider.sendMessage(userMessage, context);
  }

  async testConnection(): Promise<boolean> {
    return this.provider.testConnection();
  }

  switchProvider(type: AIProviderType, config?: AIServiceConfig): void {
    this.providerType = type;
    this.provider = this.createProvider(type, config);
  }

  getProviderType(): AIProviderType {
    return this.providerType;
  }

  // Get underlying provider for advanced usage if needed
  getProvider(): AIProvider {
    return this.provider;
  }
}

// Create singleton instance
let aiServiceInstance: AIService | null = null;

export const getAIService = (config?: AIServiceConfig): AIService => {
  if (!aiServiceInstance) {
    aiServiceInstance = new AIService(config);
  }
  return aiServiceInstance;
};

export default AIService;
