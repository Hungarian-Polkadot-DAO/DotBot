// Agent communication types

export interface AgentRequest {
  agent: string;
  message: string;
  params?: any;
  context?: any;
}

export interface AgentResponse {
  success: boolean;
  result?: any;
  error?: string;
  agent?: string;
  agentId?: string;
  messageId?: string;
  content?: string;
  type?: string;
  timestamp?: number;
  metadata?: any;
}

export interface AgentInfo {
  id: string;
  name: string;
  description?: string;
  status: AgentStatus;
  capabilities?: string[];
  version?: string;
}

export type AgentStatus = 'active' | 'inactive' | 'error' | 'online' | 'offline';
