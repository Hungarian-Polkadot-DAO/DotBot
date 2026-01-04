export enum Subsystem {
  // Core application
  APP = 'app',
  CHAT = 'chat',
  
  // Components
  SIDEBAR = 'sidebar',
  INPUT = 'input',
  MESSAGES = 'messages',
  
  // Services  
  AGENT_COMM = 'agent-comm',
  STORAGE = 'storage',
  WALLET = 'wallet',
  
  // External integrations
  POLKADOT_API = 'polkadot-api',
  SOCKET_IO = 'socket-io',
  
  // Infrastructure
  UTILS = 'utils',

  // TODO: Rethink subsystems
}

export enum ErrorType {
  // Agent communication errors
  AGENT_TIMEOUT = 'agentTimeout',
  AGENT_UNAVAILABLE = 'agentUnavailable',
  INVALID_AGENT_RESPONSE = 'invalidAgentResponse',
  
  // Wallet errors
  WALLET_NOT_CONNECTED = 'walletNotConnected',
  WALLET_REJECTED = 'walletRejected',
  INSUFFICIENT_BALANCE = 'insufficientBalance',
  
  // Network errors  
  NETWORK_ERROR = 'networkError',
  RPC_ERROR = 'rpcError',
  CONNECTION_FAILED = 'connectionFailed',
  
  // Storage errors
  STORAGE_FAILED = 'storageFailed',
  
  // UI/UX errors
  INVALID_INPUT = 'invalidInput',
  COMPONENT_ERROR = 'componentError',

  // TODO: Rethink error types
}

