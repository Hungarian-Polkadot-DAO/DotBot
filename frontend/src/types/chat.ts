// Chat-related types for DotBot frontend

export interface Message {
  id: string;
  type: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
  agentId?: string;
  agentName?: string;
  metadata?: MessageMetadata;
}

export interface MessageMetadata {
  transactionData?: TransactionData;
  agentThinking?: boolean;
  confidence?: number;
  actionRequired?: boolean;
  quickActions?: QuickAction[];
}

export interface TransactionData {
  type: 'transfer' | 'swap' | 'governance' | 'multisig';
  amount?: string;
  recipient?: string;
  asset?: string;
  network?: string;
  fee?: string;
  hash?: string;
  status?: 'preparing' | 'ready' | 'signing' | 'pending' | 'completed' | 'failed';
}

export interface QuickAction {
  id: string;
  label: string;
  icon: string;
  action: () => void;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
}

export interface ChatState {
  currentSession: ChatSession | null;
  sessions: ChatSession[];
  isTyping: boolean;
  isConnected: boolean;
  activeAgent: string | null;
}

// Voice input types
export interface VoiceConfig {
  enabled: boolean;
  language: string;
  continuous: boolean;
  interimResults: boolean;
}

export interface VoiceState {
  isListening: boolean;
  isSupported: boolean;
  transcript: string;
  confidence: number;
  error: string | null;
}
