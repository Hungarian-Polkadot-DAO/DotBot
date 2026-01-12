// AI Provider Interface - Common interface for all AI providers

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

export interface AIRequest {
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface AIResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AIProvider {
  sendMessage(userMessage: string, context?: any): Promise<string>;
  testConnection(): Promise<boolean>;
}
