/**
 * Types for Polkadot Knowledge Base
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
  /** Asset verification warnings */
  assetVerification: {
    warning: string;
    bestPractice: string;
    verifiedAssets: Record<string, { assetId: number; issuer: string }>;
  };
}

export interface XCMPattern {
  description: string;
  example: string;
  requirements: string[];
  benefits?: string[];
}

export interface OperationPattern {
  description: string;
  steps: string[];
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

