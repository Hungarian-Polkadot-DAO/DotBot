// ASI-One Provider - Wraps existing ASIOneService to implement AIProvider interface

import { AIProvider } from '../types';
import { ASIOneService, ASIOneConfig } from '../../asiOneService';

export class ASIOneProvider implements AIProvider {
  private service: ASIOneService;

  constructor(config?: Partial<ASIOneConfig>) {
    this.service = new ASIOneService(config);
  }

  async sendMessage(userMessage: string, context?: any): Promise<string> {
    return this.service.sendMessage(userMessage, context);
  }

  async testConnection(): Promise<boolean> {
    return this.service.testConnection();
  }

  // Expose underlying service for advanced usage if needed
  getService(): ASIOneService {
    return this.service;
  }
}
