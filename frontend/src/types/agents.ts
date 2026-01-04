// Agent-related types for DotBot frontend

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  status: AgentStatus;
  capabilities: string[];
  avatar?: string;
  version: string;
}

export type AgentStatus = 'online' | 'offline' | 'busy' | 'error';

export interface AgentResponse {
  agentId: string;
  messageId: string;
  content: string;
  type: 'text' | 'transaction' | 'error' | 'thinking';
  timestamp: number;
  metadata?: {
    confidence?: number;
    transactionData?: any;
    suggestions?: string[];
    requiresAction?: boolean;
  };
}

export interface AgentRequest {
  agentId: string;
  message: string;
  context?: {
    conversationHistory?: Array<{
      role: 'user' | 'assistant' | 'system';
      content: string;
      timestamp?: number;
    }>;
    userWallet?: string;
    network?: string;
  };
}

// Specific agent types
export interface AssetTransferAgent extends AgentInfo {
  id: 'asset-transfer';
  supportedNetworks: string[];
  supportedAssets: string[];
}

export interface AssetSwapAgent extends AgentInfo {
  id: 'asset-swap';
  supportedDEXs: string[];
  supportedPairs: string[];
}

export interface GovernanceAgent extends AgentInfo {
  id: 'governance';
  supportedNetworks: string[];
  trackableReferendums: boolean;
}

export interface MultisigAgent extends AgentInfo {
  id: 'multisig';
  supportedThresholds: number[];
  maxSigners: number;
}

// Agent communication protocol
export interface AgentMessage {
  type: 'request' | 'response' | 'status';
  agentId: string;
  conversationId: string;
  payload: any;
  timestamp: number;
}

// Agent registry
export interface AgentRegistry {
  agents: Map<string, AgentInfo>;
  getAgent: (id: string) => AgentInfo | null;
  getAvailableAgents: () => AgentInfo[];
  routeMessage: (message: string) => string; // Returns optimal agent ID
}
