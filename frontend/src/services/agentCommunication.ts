// Agent communication service - works independently of backend

import { AgentRequest, AgentResponse, AgentInfo, AgentStatus } from '../types/agents';

export class AgentCommunicationService {
  private agents: Map<string, AgentInfo> = new Map();
  private asiOneEndpoint: string;
  private apiKey: string;

  constructor(asiOneEndpoint?: string, apiKey?: string) {
    this.asiOneEndpoint = asiOneEndpoint || process.env.REACT_APP_ASI_ONE_ENDPOINT || '';
    this.apiKey = apiKey || process.env.REACT_APP_ASI_ONE_API_KEY || '';
    
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
      // Direct agent communication via AgentVerse
      const response = await this.callAgentVerse(request);
      return response;
    } catch (error) {
      console.error('Agent communication error:', error);
      
      // Fallback to local processing if AgentVerse is unavailable
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
    
    for (const agentId of this.agents.keys()) {
      try {
        // Ping agent endpoint
        const response = await fetch(`${this.asiOneEndpoint}/agents/${agentId}/health`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        });
        
        availability[agentId] = response.ok;
        this.updateAgentStatus(agentId, response.ok ? 'online' : 'offline');
      } catch (error) {
        availability[agentId] = false;
        this.updateAgentStatus(agentId, 'offline');
      }
    }
    
    return availability;
  }
}
