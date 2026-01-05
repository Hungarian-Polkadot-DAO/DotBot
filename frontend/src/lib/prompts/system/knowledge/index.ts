/**
 * Knowledge Base Module
 * 
 * Central export point for all knowledge base functionality
 */

import type { Network, PolkadotKnowledge } from './types';
import { STATIC_KNOWLEDGE_BASE, formatPolkadotKnowledgeBase } from './dotKnowledge';
import { WESTEND_KNOWLEDGE_BASE, formatWestendKnowledgeBase } from './westendKnowledge';

// Types
export type {
  Network,
  NetworkMetadata,
  TokenInfo,
  ParachainInfo,
  DEXInfo,
  FeeStructure,
  AssetClassification,
  EcosystemChange,
  SafetyGuidelines,
  XCMPattern,
  OperationPattern,
  PolkadotKnowledge,
  NetworkKnowledge,
  KnowledgeGetter,
} from './types';

export { NETWORK_CONFIG } from './types';

// Polkadot Knowledge Base
export {
  STATIC_KNOWLEDGE_BASE as POLKADOT_KNOWLEDGE_BASE,
  XCM_TRANSFER_PATTERNS as POLKADOT_XCM_PATTERNS,
  COMMON_PATTERNS as POLKADOT_PATTERNS,
  ECOSYSTEM_CHANGES as POLKADOT_ECOSYSTEM_CHANGES,
  SAFETY_GUIDELINES as POLKADOT_SAFETY_GUIDELINES,
  fetchLiveParachainData as fetchLivePolkadotParachainData,
  buildKnowledgeBase as buildPolkadotKnowledgeBase,
  formatPolkadotKnowledgeBase,
} from './dotKnowledge';

// Westend Knowledge Base
export {
  WESTEND_KNOWLEDGE_BASE,
  WESTEND_XCM_PATTERNS,
  WESTEND_COMMON_PATTERNS,
  WESTEND_ECOSYSTEM_CHANGES,
  WESTEND_SAFETY_GUIDELINES,
  fetchLiveWestendParachainData,
  buildWestendKnowledgeBase,
  formatWestendKnowledgeBase,
} from './westendKnowledge';

// Network Utilities
export {
  getNetworkMetadata,
  detectNetworkFromChainName,
  getNetworkTokenSymbol,
  getNetworkDecimals,
  getNetworkSS58Format,
  isTestnet,
  getRelayChainEndpoints,
  getAssetHubEndpoints,
  getSupportedNetworks,
  getProductionNetworks,
  getTestnets,
  isValidNetwork,
  parseNetwork,
  isSameNetwork,
  getNetworkDisplayName,
  getNetworkDescription,
} from './networkUtils';

/**
 * Get knowledge base for a specific network
 */
export function getKnowledgeBaseForNetwork(network: Network): PolkadotKnowledge {
  switch (network) {
    case 'polkadot':
      return STATIC_KNOWLEDGE_BASE;
    case 'westend':
      return WESTEND_KNOWLEDGE_BASE;
    case 'kusama':
      // TODO: Implement Kusama knowledge base
      // For now, use Polkadot as template
      return STATIC_KNOWLEDGE_BASE;
  }
}

/**
 * Format knowledge base for system prompt (network-aware)
 */
export function formatKnowledgeBaseForNetwork(network: Network): string {
  switch (network) {
    case 'polkadot':
      return formatPolkadotKnowledgeBase();
    case 'westend':
      return formatWestendKnowledgeBase();
    case 'kusama':
      // TODO: Implement Kusama formatter
      return formatPolkadotKnowledgeBase(); // Fallback
  }
}

