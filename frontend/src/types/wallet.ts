// Wallet-related types for DotBot frontend

// Import and re-export core wallet types from lib
import type { WalletAccount } from '../lib/types/wallet';
export type { WalletAccount };

export interface WalletInfo {
  name: string;
  version: string;
  accounts: WalletAccount[];
  icon?: string;
  installed: boolean;
  connected: boolean;
}

export interface WalletState {
  isConnected: boolean;
  selectedWallet: string | null;
  selectedAccount: WalletAccount | null;
  availableWallets: WalletInfo[];
  isConnecting: boolean;
  error: string | null;
}

export interface SigningRequest {
  id: string;
  type: 'transaction' | 'message';
  payload: any;
  metadata: {
    description: string;
    network: string;
    fee?: string;
    method?: string;
  };
  status: 'pending' | 'approved' | 'rejected' | 'signed';
}

// Balance information
export interface Balance {
  asset: string;
  symbol: string;
  decimals: number;
  free: string;
  reserved: string;
  frozen: string;
  total: string;
  network: string;
}

export interface BalanceState {
  balances: Balance[];
  isLoading: boolean;
  lastUpdated: number | null;
  error: string | null;
}

// Transaction types
export interface Transaction {
  hash?: string;
  blockHash?: string;
  blockNumber?: string;
  index?: number;
  method: string;
  section: string;
  args: any[];
  status: TransactionStatus;
  timestamp?: number;
  fee?: string;
  success?: boolean;
  error?: string;
}

export type TransactionStatus = 
  | 'preparing'
  | 'ready' 
  | 'signing'
  | 'broadcast'
  | 'inBlock'
  | 'finalized'
  | 'failed'
  | 'cancelled';

export interface TransactionHistory {
  transactions: Transaction[];
  isLoading: boolean;
  hasMore: boolean;
  error: string | null;
}
