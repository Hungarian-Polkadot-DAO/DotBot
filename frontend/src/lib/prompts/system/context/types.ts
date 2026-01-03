/**
 * Context Types for System Prompt
 * 
 * Types for contextual information that gets injected into the system prompt
 * based on the current state of the application.
 */

export interface WalletContext {
  isConnected: boolean;
  address?: string;
  provider?: string;    // Talisman, SubWallet, etc.
  accounts?: Array<{
    address: string;
    name?: string;
    balance?: string;
  }>;
}

export interface NetworkContext {
  network: 'polkadot' | 'kusama' | string;
  rpcEndpoint?: string;
  chainId?: string;
  availableNetworks?: string[];
}

export interface BalanceContext {
  relayChain: {
    free: string;
    reserved: string;
    frozen: string;
  };
  assetHub: {
    free: string;
    reserved: string;
    frozen: string;
  } | null;
  total: string;  
  symbol: string;
}

export interface SystemContext {
  wallet: WalletContext;
  network: NetworkContext;
  balance?: BalanceContext;
  metadata?: Record<string, any>;
}

