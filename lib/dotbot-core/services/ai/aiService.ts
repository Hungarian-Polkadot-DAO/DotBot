// AI Service - Factory for managing different AI providers

import { AIProvider } from './types';
import { ASIOneProvider } from './providers/asiOneProvider';
import { ClaudeProvider, ClaudeConfig } from './providers/claudeProvider';
import { getEnv } from '../../env';

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
      (getEnv('AI_PROVIDER') as AIProviderType) || 
      AIProviderType.ASI_ONE;

    this.providerType = providerType;
    this.provider = this.createProvider(providerType, config);
  }

  private createProvider(type: AIProviderType, config?: AIServiceConfig): AIProvider {
    switch (type) {
      case AIProviderType.ASI_ONE:
        return new ASIOneProvider({
          ...(config?.asiOneConfig?.apiKey && { apiKey: config.asiOneConfig.apiKey }),
          ...(config?.asiOneConfig?.baseUrl && { baseUrl: config.asiOneConfig.baseUrl }),
          ...(config?.asiOneConfig?.model && { model: config.asiOneConfig.model }),
          ...(config?.asiOneConfig?.temperature !== undefined && { temperature: config.asiOneConfig.temperature }),
          ...(config?.asiOneConfig?.maxTokens !== undefined && { maxTokens: config.asiOneConfig.maxTokens }),
          // Env vars are handled by ASIOneService constructor as fallbacks
        });

      case AIProviderType.CLAUDE:
        const claudeApiKey = config?.claudeConfig?.apiKey || getEnv('CLAUDE_API_KEY');
        if (!claudeApiKey) {
          // Note: Logger not available here, but this is a warning that should be visible
          // The provider will handle this when it tries to make API calls
        }
        return new ClaudeProvider({
          apiKey: claudeApiKey || '',
          baseUrl: config?.claudeConfig?.baseUrl || getEnv('CLAUDE_BASE_URL'),
          model: config?.claudeConfig?.model || getEnv('CLAUDE_MODEL'),
          maxTokens: config?.claudeConfig?.maxTokens,
          temperature: config?.claudeConfig?.temperature
        });

      case AIProviderType.OPENAI:
        // Reserved for future implementation
        throw new Error('OpenAI provider not yet implemented');

      default:
        // Note: Logger not available here, but this is a warning that should be visible
        // Falling back to ASI-One is the safe default
        return new ASIOneProvider({
          ...(config?.asiOneConfig?.apiKey && { apiKey: config.asiOneConfig.apiKey }),
          ...(config?.asiOneConfig?.baseUrl && { baseUrl: config.asiOneConfig.baseUrl }),
          ...(config?.asiOneConfig?.model && { model: config.asiOneConfig.model }),
          ...(config?.asiOneConfig?.temperature !== undefined && { temperature: config.asiOneConfig.temperature }),
          ...(config?.asiOneConfig?.maxTokens !== undefined && { maxTokens: config.asiOneConfig.maxTokens }),
          // Env vars are handled by ASIOneService constructor as fallbacks
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
