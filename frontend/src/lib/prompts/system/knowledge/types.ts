/**
 * Types for Polkadot Knowledge Base
 * 
 * Supports multi-network ecosystem (Polkadot, Kusama, Westend)
 */

/**
 * Network types supported by DotBot
 */
export type Network = 'polkadot' | 'kusama' | 'westend';

/**
 * Network metadata and configuration
 */
export interface NetworkMetadata {
  /** Network identifier */
  network: Network;
  
  /** Native token symbol (DOT, KSM, WND) */
  nativeToken: string;
  
  /** Token decimals (10 for DOT, 12 for KSM/WND) */
  decimals: number;
  
  /** SS58 address format (0 for Polkadot, 2 for Kusama, 42 for Westend) */
  ss58Format: number;
  
  /** Whether this is a testnet */
  isTestnet: boolean;
  
  /** Genesis hash */
  genesisHash?: string;
  
  /** Primary RPC endpoints */
  rpcEndpoints: {
    relay: string[];
    assetHub: string[];
  };
}

/**
 * Token information with network context
 */
export interface TokenInfo {
  /** Token symbol */
  symbol: string;
  
  /** Asset ID (for Asset Hub and other chains using asset IDs) */
  assetId?: number;
  
  /** Token decimals */
  decimals: number;
  
  /** Whether this is the native token */
  isNative: boolean;
  
  /** Issuer/verification info (for verified assets) */
  issuer?: string;
  
  /** Warning or note about this token (e.g., unverified, placeholder ID, etc.) */
  note?: string;
}

export interface ParachainInfo {
  /** Parachain ID */
  id: number;
  
  /** Parachain name */
  name: string;
  
  /** Native token symbol */
  nativeToken: string;
  
  /** Detailed token information */
  tokenDetails: TokenInfo[];
  
  /** XCM support status */
  xcmSupported: boolean;
  
  /** XCM version supported (2, 3, or 4). Note: XCM version is negotiated dynamically via runtime. */
  xcmVersion?: number | null;
  
  /** List of connected parachains via XCM. Note: Channels change frequently and should be queried from chain metadata. */
  xcmChannels?: string[];
  
  /** RPC endpoint (if known) */
  rpcEndpoint?: string;
  
  /** Additional notes */
  notes?: string;
}

export interface DEXInfo {
  /** DEX name */
  name: string;
  
  /** Parachain where DEX is located */
  parachain: string;
  
  /** Available trading pairs */
  pairs: string[];
  
  /** Liquidity pools */
  pools?: string[];
  
  /** DEX type */
  type: 'AMM' | 'OrderBook' | 'Hybrid';
  
  /** Additional notes about the DEX (optional) */
  notes?: string;
}

export interface FeeStructure {
  /** Chain/parachain name */
  chain: string;
  
  /** Base transaction fee */
  baseFee: string;
  
  /** Fee unit (e.g., "DOT", "KSM", "USDT") */
  feeUnit: string;
  
  /** Typical transfer fee */
  transferFee?: string;
  
  /** Existential deposit (minimum balance to keep account alive) */
  existentialDeposit: string;
  
  /** Notes about fees. Fees are weight-based and dynamic. Actual cost depends on on-chain weight formula and congestion. */
  notes?: string;
}

export interface AssetClassification {
  /** Sufficient assets (can be held without native token balance) */
  sufficient: {
    description: string;
    examples: string[];
  };
  
  /** Non-sufficient assets (require ED in native token to hold) */
  nonSufficient: {
    description: string;
    minimumBalance: string;
    examples: string[];
  };
}

export interface EcosystemChange {
  /** Date of the change */
  date: string;
  
  /** Description of the change */
  description: string;
  
  /** Impact of the change */
  impact: string[];
}

export interface SafetyGuidelines {
  /** Balance checking guidelines */
  balanceChecking: {
    warning: string;
    bestPractice: string[];
    locations: Record<string, {
      endpoint: string;
      checked: boolean;
      note: string;
    }>;
  };
  
  /** Asset verification warnings */
  assetVerification: {
    warning: string;
    bestPractice: string;
    verifiedAssets: Record<string, { assetId: number; issuer: string }>;
  };
}

export interface XCMPattern {
  /** Description of the XCM pattern */
  description: string;
  
  /** Example usage */
  example: string;
  
  /** Requirements for using this pattern */
  requirements: string[];
  
  /** Benefits of this approach (optional) */
  benefits?: string[];
  
  /** Typical use cases (optional) */
  useCases?: string[];
}

export interface OperationPattern {
  /** Description of the operation */
  description: string;
  
  /** Step-by-step instructions */
  steps: string[];
  
  /** Estimated complexity (optional) */
  complexity?: 'low' | 'medium' | 'high';
  
  /** Prerequisites (optional) */
  prerequisites?: string[];
}

export interface PolkadotKnowledge {
  /** Parachain topology */
  parachains: ParachainInfo[];
  
  /** DEX locations */
  dexes: DEXInfo[];
  
  /** Fee structures */
  fees: FeeStructure[];
  
  /** XCM transfer patterns */
  xcmPatterns: Record<string, XCMPattern>;
  
  /** Common operation patterns */
  patterns: Record<string, OperationPattern>;
  
  /** Ecosystem changes */
  ecosystemChanges: Record<string, EcosystemChange>;
  
  /** Asset classification */
  assetClassification: AssetClassification;
  
  /** Safety guidelines */
  safetyGuidelines: SafetyGuidelines;
}

/**
 * Network-specific knowledge base
 * Extends base PolkadotKnowledge with network metadata
 */
export interface NetworkKnowledge extends PolkadotKnowledge {
  /** Network metadata */
  network: NetworkMetadata;
}

/**
 * Helper type for network-specific knowledge getters
 */
export type KnowledgeGetter = (network: Network) => PolkadotKnowledge | NetworkKnowledge;

/**
 * Network configuration mapping
 */
export const NETWORK_CONFIG: Record<Network, NetworkMetadata> = {
  polkadot: {
    network: 'polkadot',
    nativeToken: 'DOT',
    decimals: 10,
    ss58Format: 0,
    isTestnet: false,
    rpcEndpoints: {
      relay: [
        'wss://polkadot.api.onfinality.io/public-ws',
        'wss://polkadot-rpc.dwellir.com',
        'wss://rpc.polkadot.io',
      ],
      assetHub: [
        'wss://statemint.api.onfinality.io/public-ws',
        'wss://statemint-rpc.dwellir.com',
        'wss://polkadot-asset-hub-rpc.polkadot.io',
      ],
    },
  },
  kusama: {
    network: 'kusama',
    nativeToken: 'KSM',
    decimals: 12,
    ss58Format: 2,
    isTestnet: false,
    rpcEndpoints: {
      relay: [
        'wss://kusama.api.onfinality.io/public-ws',
        'wss://kusama-rpc.dwellir.com',
        'wss://kusama-rpc.polkadot.io',
      ],
      assetHub: [
        'wss://statemine.api.onfinality.io/public-ws',
        'wss://kusama-asset-hub-rpc.polkadot.io',
      ],
    },
  },
  westend: {
    network: 'westend',
    nativeToken: 'WND',
    decimals: 12,
    ss58Format: 42,
    isTestnet: true,
    rpcEndpoints: {
      relay: [
        'wss://westend-rpc.polkadot.io',
        'wss://westend-rpc.dwellir.com',
        'wss://westend.api.onfinality.io/public-ws',
      ],
      assetHub: [
        'wss://westend-asset-hub-rpc.polkadot.io',
        'wss://westmint-rpc.dwellir.com',
      ],
    },
  },
};

