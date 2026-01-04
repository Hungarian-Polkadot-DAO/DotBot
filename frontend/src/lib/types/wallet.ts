/**
 * Core wallet types for DotBot library
 * These types are environment-agnostic and can be used in any context
 */

export interface WalletAccount {
  address: string;
  name?: string;
  source: string;
  type?: string;
  genesisHash?: string | null;
}

