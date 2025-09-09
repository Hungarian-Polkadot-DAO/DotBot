// Agent communication service - works independently of backend

import { AgentRequest, AgentResponse, AgentInfo, AgentStatus } from '../types/agents';
import { getASIOneService, ASIOneService } from './asiOneService';
import { createSubsystemLogger } from '../config/logger';
import { Subsystem } from '../types/logging';

export class AgentCommunicationService {
  private agents: Map<string, AgentInfo> = new Map();
  private asiOneEndpoint: string;
  private apiKey: string;
  private asiOneService: ASIOneService;
  private logger = createSubsystemLogger(Subsystem.AGENT_COMM);

  constructor(asiOneEndpoint?: string, apiKey?: string) {
    this.asiOneEndpoint = asiOneEndpoint || process.env.REACT_APP_ASI_ONE_ENDPOINT || 'https://api.asi1.ai/v1';
    this.apiKey = apiKey || process.env.REACT_APP_ASI_ONE_API_KEY || 'sk_55aa3a95dcd341c6a2e13a4244e612f550f0520ca67342d88e0ad81812909ad5';
    
    // Initialize ASI-One service
    this.asiOneService = getASIOneService({
      apiKey: this.apiKey,
      baseUrl: this.asiOneEndpoint
    });
    
    // Initialize available agents
    this.initializeAgents();
  }

  private initializeAgents() {
    // Asset Transfer Agent
    this.agents.set('asset-transfer', {
      id: 'asset-transfer',
      name: 'Asset Transfer Agent',
      description: 'Handles DOT and token transfers across Polkadot ecosystem',
      status: 'online',
      capabilities: [
        'Native token transfers',
        'Cross-chain transfers',
        'Batch transfers',
        'Fee estimation'
      ],
      version: '1.0.0'
    });

    // Asset Swap Agent
    this.agents.set('asset-swap', {
      id: 'asset-swap',
      name: 'Asset Swap Agent',
      description: 'Facilitates token swaps across DEXs in Polkadot',
      status: 'online',
      capabilities: [
        'DEX routing',
        'Optimal price finding',
        'Slippage protection',
        'Multi-hop swaps'
      ],
      version: '1.0.0'
    });

    // Governance Agent
    this.agents.set('governance', {
      id: 'governance',
      name: 'Governance Agent',
      description: 'Manages governance voting and proposals',
      status: 'online',
      capabilities: [
        'Referendum voting',
        'Proposal tracking',
        'Vote delegation',
        'Council elections'
      ],
      version: '1.0.0'
    });

    // Multisig Agent
    this.agents.set('multisig', {
      id: 'multisig',
      name: 'Multisig Agent',
      description: 'Coordinates multisig wallet operations',
      status: 'online',
      capabilities: [
        'Multisig creation',
        'Transaction proposals',
        'Signature collection',
        'Execution coordination'
      ],
      version: '1.0.0'
    });
  }

  // Get available agents
  getAvailableAgents(): AgentInfo[] {
    return Array.from(this.agents.values());
  }

  // Get specific agent info
  getAgent(agentId: string): AgentInfo | null {
    return this.agents.get(agentId) || null;
  }

  // Route message to appropriate agent
  routeMessage(message: string): string {
    const lowercaseMessage = message.toLowerCase();
    
    // Simple routing logic - in production this would be more sophisticated
    if (lowercaseMessage.includes('send') || lowercaseMessage.includes('transfer')) {
      return 'asset-transfer';
    }
    if (lowercaseMessage.includes('swap') || lowercaseMessage.includes('exchange')) {
      return 'asset-swap';
    }
    if (lowercaseMessage.includes('vote') || lowercaseMessage.includes('governance') || lowercaseMessage.includes('referendum')) {
      return 'governance';
    }
    if (lowercaseMessage.includes('multisig') || lowercaseMessage.includes('multi-sig')) {
      return 'multisig';
    }
    
    // Default to transfer agent for simple operations
    return 'asset-transfer';
  }

  // Send message to agent via ASI-One (AgentVerse compatible)
  async sendToAgent(request: AgentRequest): Promise<AgentResponse> {
    try {
      this.logger.info({
        agentId: request.agentId,
        messageLength: request.message.length,
        hasContext: !!request.context
      }, 'Sending message to agent via ASI-One');

      // Use ASI-One service for AI-powered responses
      const aiResponse = await this.asiOneService.sendMessage(request.message, {
        agentId: request.agentId,
        walletAddress: request.context?.userWallet,
        network: request.context?.network || 'Polkadot',
        conversationId: request.context?.conversationId
      });

      // Create agent response
      const response: AgentResponse = {
        agentId: request.agentId,
        messageId: Date.now().toString(),
        content: aiResponse,
        type: 'text',
        timestamp: Date.now(),
        metadata: {
          confidence: 0.9,
          requiresAction: this.requiresUserAction(request.message),
          suggestions: this.generateSuggestions(request.agentId, request.message)
        }
      };

      this.logger.info({
        agentId: request.agentId,
        responseLength: aiResponse.length,
        messageId: response.messageId
      }, 'Received response from ASI-One');

      return response;

    } catch (error) {
      this.logger.error({
        agentId: request.agentId,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Agent communication error');
      
      // Fallback to local processing if ASI-One is unavailable
      return this.fallbackProcessing(request);
    }
  }

  // Call agent via AgentVerse/ASI-One
  private async callAgentVerse(request: AgentRequest): Promise<AgentResponse> {
    const agentEndpoint = `${this.asiOneEndpoint}/agents/${request.agentId}`;
    
    const response = await fetch(agentEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        message: request.message,
        context: request.context,
        timestamp: Date.now()
      })
    });

    if (!response.ok) {
      throw new Error(`Agent communication failed: ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      agentId: request.agentId,
      messageId: Date.now().toString(),
      content: data.response || data.content,
      type: data.type || 'text',
      timestamp: Date.now(),
      metadata: data.metadata
    };
  }

  // Fallback processing when agents are unavailable
  private async fallbackProcessing(request: AgentRequest): Promise<AgentResponse> {
    // Simulate agent thinking time
    await new Promise(resolve => setTimeout(resolve, 1000));

    const agent = this.getAgent(request.agentId);
    const agentName = agent?.name || 'Agent';

    // Simple fallback responses
    let content = `I'm ${agentName} and I understand you want to: "${request.message}". ` +
                 `However, I'm currently running in offline mode. ` +
                 `Please connect to the network for full functionality.`;

    if (request.agentId === 'asset-transfer') {
      content = `I can help you with transfers! To complete this operation, I'll need to connect to the Polkadot network and your wallet.`;
    }

    return {
      agentId: request.agentId,
      messageId: Date.now().toString(),
      content,
      type: 'text',
      timestamp: Date.now(),
      metadata: {
        confidence: 0.5,
        requiresAction: true
      }
    };
  }

  // Check if user message requires action
  private requiresUserAction(message: string): boolean {
    const actionKeywords = ['transfer', 'send', 'swap', 'vote', 'create', 'sign', 'approve'];
    const lowerMessage = message.toLowerCase();
    return actionKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  // Generate contextual suggestions based on agent and message
  private generateSuggestions(agentId: string, message: string): string[] {
    const suggestions: string[] = [];
    const lowerMessage = message.toLowerCase();

    switch (agentId) {
      case 'asset-transfer':
        if (lowerMessage.includes('balance')) {
          suggestions.push('Check my DOT balance', 'Show all token balances', 'Check balance on different networks');
        } else if (lowerMessage.includes('transfer')) {
          suggestions.push('Transfer 1 DOT to Alice', 'Send 5 DOT to AssetHub', 'Batch transfer to multiple addresses');
        }
        break;
      
      case 'asset-swap':
        if (lowerMessage.includes('swap')) {
          suggestions.push('Swap DOT for USDC', 'Find best price for DOT/USDT', 'Show available DEXs');
        }
        break;
      
      case 'governance':
        if (lowerMessage.includes('vote')) {
          suggestions.push('Show active referendums', 'Vote on referendum #123', 'Check my voting power');
        }
        break;
      
      case 'multisig':
        if (lowerMessage.includes('multisig')) {
          suggestions.push('Create 2-of-3 multisig', 'Show pending multisig transactions', 'Add signer to multisig');
        }
        break;
    }

    return suggestions.slice(0, 3); // Limit to 3 suggestions
  }

  // Update agent status
  updateAgentStatus(agentId: string, status: AgentStatus) {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
      this.agents.set(agentId, agent);
    }
  }

  // Check if agents are available
  async checkAgentAvailability(): Promise<Record<string, boolean>> {
    const availability: Record<string, boolean> = {};
    
    // Test ASI-One connectivity
    const asiOneAvailable = await this.asiOneService.testConnection();
    
    for (const agentId of this.agents.keys()) {
      availability[agentId] = asiOneAvailable;
      this.updateAgentStatus(agentId, asiOneAvailable ? 'online' : 'offline');
    }
    
    return availability;
  }

  // Start a new conversation
  startNewConversation(): void {
    this.asiOneService.startNewConversation();
    this.logger.info({}, 'Started new conversation');
  }

  // Get conversation history
  getConversationHistory() {
    return this.asiOneService.getConversationHistory();
  }

  // Clear conversation history
  clearConversationHistory(): void {
    this.asiOneService.clearConversationHistory();
    this.logger.info({}, 'Cleared conversation history');
  }

  // Get ASI-One service instance (for direct access if needed)
  getASIOneService(): ASIOneService {
    return this.asiOneService;
  }
}
