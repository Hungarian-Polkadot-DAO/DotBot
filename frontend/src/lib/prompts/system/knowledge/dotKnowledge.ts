/**
 * Polkadot Knowledge Base
 * 
 * Comprehensive knowledge about the Polkadot ecosystem that gets injected
 * into the system prompt to help the LLM understand:
 * - Parachain topology and token locations
 * - XCM transfer patterns
 * - DEX locations and liquidity pools
 * - Fee structures per chain
 * - Common operation patterns
 * - Asset Hub migration context
 * - Sufficient vs non-sufficient assets
 * - Asset verification warnings
 */

import type {
  ParachainInfo,
  PolkadotKnowledge,
  XCMPattern,
  OperationPattern,
} from './types';

/**
 * Static Knowledge Base
 * This is the fallback data when live data is unavailable
 */
export const STATIC_KNOWLEDGE_BASE: PolkadotKnowledge = {
  parachains: [
    {
      id: 0,
      name: 'Polkadot',
      nativeToken: 'DOT',
      tokenDetails: [
        { symbol: 'DOT', decimals: 10, isNative: true },
      ],
      xcmSupported: true,
      xcmVersion: null, // XCM version negotiated dynamically via runtime
      notes: 'Relay Chain - primarily used by validators and parachain operators after runtime 2.0.0 migration. Existential deposit: 0.1 DOT (post-migration, reduced from 1 DOT).',
    },
    {
      id: 1000,
      name: 'AssetHub',
      nativeToken: 'DOT',
      tokenDetails: [
        { symbol: 'DOT', decimals: 10, isNative: false, note: 'Mirror asset from Relay Chain' },
        {
          symbol: 'USDT',
          assetId: 1984,
          decimals: 6,
          isNative: false,
          issuer: 'Registered on Asset Hub via on-chain governance (community-issued, not issued by Tether)',
          note: 'Symbol USDT is NOT unique on Asset Hub; only assetId=1984 refers to this specific governance-registered asset.',
        },
        {
          symbol: 'USDC',
          assetId: 1337,
          decimals: 6,
          isNative: false,
          issuer: 'Registered on Asset Hub via on-chain governance (community-issued, not issued by Circle)',
          note: 'Symbol USDC is NOT unique on Asset Hub; only assetId=1337 refers to this specific governance-registered asset.',
        },
      ],
      xcmSupported: true,
      xcmVersion: null, // XCM version negotiated dynamically via runtime
      xcmChannels: ['HydraDX', 'Acala', 'Moonbeam', 'Astar', 'Parallel'], // Note: Channels change frequently, query from chain metadata
      notes: 'Main network for everyday activity after runtime 2.0.0 migration. Existential deposit: 0.01 DOT. Token lists are representative; live token registry should be queried.',
    },
    {
      id: 2034,
      name: 'HydraDX',
      nativeToken: 'HDX',
      tokenDetails: [
        { symbol: 'HDX', decimals: 12, isNative: true },
        { symbol: 'DOT', decimals: 10, isNative: false },
        { symbol: 'USDT', decimals: 6, isNative: false },
        { symbol: 'USDC', decimals: 6, isNative: false },
        {
          symbol: 'WETH',
          decimals: 18,
          isNative: false,
          note: 'Wrapped/bridged ERC-20 asset, not native WETH. Token lists are representative; query live registry for current availability.',
        },
      ],
      xcmSupported: true,
      xcmVersion: null, // XCM version negotiated dynamically via runtime
      notes: 'Token lists are representative; live token registry should be queried for current availability.',
    },
    {
      id: 2000,
      name: 'Acala',
      nativeToken: 'ACA',
      tokenDetails: [
        { symbol: 'ACA', decimals: 12, isNative: true },
        { symbol: 'DOT', decimals: 10, isNative: false },
        { symbol: 'USDT', decimals: 6, isNative: false },
        { symbol: 'USDC', decimals: 6, isNative: false },
        { symbol: 'LDOT', decimals: 10, isNative: false },
      ],
      xcmSupported: true,
      xcmVersion: null, // XCM version negotiated dynamically via runtime
      notes: 'Token lists are representative; live token registry should be queried for current availability.',
    },
    {
      id: 2011,
      name: 'Parallel',
      nativeToken: 'PARA',
      tokenDetails: [
        { symbol: 'PARA', decimals: 12, isNative: true },
        { symbol: 'DOT', decimals: 10, isNative: false },
        { symbol: 'USDT', decimals: 6, isNative: false },
      ],
      xcmSupported: true,
      xcmVersion: null, // XCM version negotiated dynamically via runtime
      notes: 'Token lists are representative; live token registry should be queried for current availability.',
    },
    {
      id: 2004,
      name: 'Moonbeam',
      nativeToken: 'GLMR',
      tokenDetails: [
        { symbol: 'GLMR', decimals: 18, isNative: true },
        { symbol: 'DOT', decimals: 10, isNative: false },
        { symbol: 'USDT', decimals: 6, isNative: false },
        { symbol: 'USDC', decimals: 6, isNative: false },
        { symbol: 'WETH', decimals: 18, isNative: false },
      ],
      xcmSupported: true,
      xcmVersion: null, // XCM version negotiated dynamically via runtime
      notes: 'Uses dynamic EIP-1559-style gas fees, not fixed fees. Token lists are representative; live token registry should be queried for current availability.',
    },
    {
      id: 2006,
      name: 'Astar',
      nativeToken: 'ASTR',
      tokenDetails: [
        { symbol: 'ASTR', decimals: 18, isNative: true },
        { symbol: 'DOT', decimals: 10, isNative: false },
        { symbol: 'USDT', decimals: 6, isNative: false },
      ],
      xcmSupported: true,
      xcmVersion: null, // XCM version negotiated dynamically via runtime
      notes: 'Token lists are representative; live token registry should be queried for current availability.',
    },
  ],
  
  dexes: [
    {
      name: 'HydraDX Omnipool',
      parachain: 'HydraDX',
      pairs: ['DOT/USDT', 'DOT/USDC', 'HDX/DOT', 'WETH/DOT'],
      type: 'AMM',
      pools: ['Omnipool'],
    },
    {
      name: 'Acala DEX',
      parachain: 'Acala',
      pairs: ['ACA/DOT', 'DOT/USDT', 'DOT/USDC', 'LDOT/DOT'],
      type: 'AMM',
    },
    {
      name: 'Parallel DEX',
      parachain: 'Parallel',
      pairs: ['PARA/DOT', 'DOT/USDT'],
      type: 'AMM',
    },
    {
      name: 'StellaSwap',
      parachain: 'Moonbeam',
      pairs: ['GLMR/DOT', 'DOT/USDT', 'DOT/USDC', 'WETH/DOT'],
      type: 'AMM',
    },
    {
      name: 'ArthSwap',
      parachain: 'Astar',
      pairs: ['ASTR/DOT', 'DOT/USDT'],
      type: 'AMM',
    },
  ],
  
  fees: [
    {
      chain: 'Polkadot',
      baseFee: '0.01',
      feeUnit: 'DOT',
      transferFee: '~0.01 DOT',
      existentialDeposit: '0.1',
      notes: 'Fees are weight-based and dynamic. Actual cost depends on on-chain weight formula and congestion. Existential deposit: 0.1 DOT (post-migration, reduced from 1 DOT). After runtime 2.0.0, most operations moved to Asset Hub.',
    },
    {
      chain: 'AssetHub',
      baseFee: '0.001',
      feeUnit: 'DOT',
      transferFee: '~0.001 DOT',
      existentialDeposit: '0.01',
      notes: 'Fees are weight-based and dynamic. Actual cost depends on on-chain weight formula and congestion. Lower existential deposit than Relay Chain. Main network for balances and regular usage after runtime 2.0.0 migration.',
    },
    {
      chain: 'HydraDX',
      baseFee: '0.1',
      feeUnit: 'HDX',
      transferFee: '~0.1 HDX',
      existentialDeposit: '1', // Approximate
      notes: 'Fees are weight-based and dynamic. Actual cost depends on on-chain weight formula and congestion. Values shown are approximate.',
    },
    {
      chain: 'Acala',
      baseFee: '0.01',
      feeUnit: 'ACA',
      transferFee: '~0.01 ACA',
      existentialDeposit: '0.1', // Approximate
      notes: 'Fees are weight-based and dynamic. Actual cost depends on on-chain weight formula and congestion. Values shown are approximate.',
    },
    {
      chain: 'Moonbeam',
      baseFee: '0.01',
      feeUnit: 'GLMR',
      transferFee: '~0.01 GLMR',
      existentialDeposit: '1', // Approximate
      notes: 'Uses dynamic EIP-1559-style gas fees. Fees are weight-based and dynamic. Actual cost depends on on-chain weight formula and congestion. Values shown are approximate.',
    },
    {
      chain: 'Astar',
      baseFee: '0.01',
      feeUnit: 'ASTR',
      transferFee: '~0.01 ASTR',
      existentialDeposit: '1', // Approximate
      notes: 'Fees are weight-based and dynamic. Actual cost depends on on-chain weight formula and congestion. Values shown are approximate.',
    },
  ],
  
  xcmPatterns: {
    direct: {
      description: 'Direct XCM transfer from one parachain to another',
      example: 'Polkadot → AssetHub, AssetHub → HydraDX',
      requirements: ['Both chains support XCM', 'Sufficient balance for fees', 'Compatible XCM versions'],
    },
    viaRelay: {
      description: 'Transfer via relay chain (Polkadot/Kusama)',
      example: 'Parachain A → Polkadot → Parachain B',
      requirements: ['XCM support on all chains', 'Compatible XCM versions'],
    },
    viaAssetHub: {
      description: 'Use AssetHub as a hub for token transfers',
      example: 'Any chain → AssetHub → Any chain',
      requirements: ['AssetHub XCM support', 'Token available on AssetHub'],
      benefits: ['Lower fees', 'Better liquidity', 'Lower existential deposits'],
    },
  },
  
  patterns: {
    simpleTransfer: {
      description: 'Transfer DOT from one account to another on the same chain',
      steps: [
        'Validate addresses',
        'Check balance (ensure > existential deposit after transfer)',
        'Create transfer extrinsic',
        'Sign and submit',
      ],
    },
    crossChainTransfer: {
      description: 'Transfer tokens across parachains using XCM',
      steps: [
        'Verify source chain has token',
        'Verify destination chain supports token',
        'Check XCM route availability and version compatibility',
        'Verify sufficient balance for fees and existential deposit',
        'Create XCM transfer extrinsic',
        'Sign and submit',
      ],
    },
    tokenSwap: {
      description: 'Swap tokens using a DEX',
      steps: [
        'Identify DEX with desired pair',
        'Check liquidity',
        'Calculate expected output',
        'Verify sufficient balance for fees',
        'Create swap extrinsic',
        'Sign and submit',
      ],
    },
    staking: {
      description: 'Stake DOT on the Staking System Parachain (not on Asset Hub)',
      steps: [
        'Check minimum bond amount',
        'Select validators',
        'Verify sufficient balance for existential deposit',
        'Create bond extrinsic (on Staking System Parachain)',
        'Create nominate extrinsic (on Staking System Parachain)',
        'Sign and submit',
      ],
    },
  },
  
  ecosystemChanges: {
    assetHubMigration: {
      date: 'November 4, 2025 (Polkadot), October 7, 2025 (Kusama)',
      description: 'Account balances moved from Relay Chain to Asset Hub after runtime version 2.0.0. Staking was migrated to a dedicated Staking System Parachain (not Asset Hub).',
      impact: [
        'Asset Hub is now the main network for everyday activity and balances',
        'Relay Chain primarily used by validators and parachain operators',
        'Lower existential deposits on Asset Hub (0.01 DOT vs 0.1 DOT on Relay Chain)',
        'Staking was migrated off the relay chain to a dedicated system parachain (Staking Chain), not Asset Hub',
        'Governance operations moved to Asset Hub',
      ],
    },
  },
  
  assetClassification: {
    sufficient: {
      description: 'Can be held without native token balance. Account can exist with only these assets.',
      examples: ['USDT (Asset Hub)', 'USDC (Asset Hub)', 'Some verified stablecoins'],
    },
    nonSufficient: {
      description: 'Requires existential deposit (ED) in native token to hold. Account must maintain minimum native token balance.',
      minimumBalance: '0.01 DOT on Asset Hub, 0.1 DOT on Relay Chain',
      examples: ['DOT', 'Most parachain native tokens', 'Most non-verified assets'],
    },
  },
  
  safetyGuidelines: {
    assetVerification: {
      warning: 'Asset Hub allows multiple user-created assets with identical symbols (e.g., "USDT"). Always verify the assetId, not the symbol.',
      bestPractice: 'Always rely on canonical governance-registered asset IDs. Confirm assetId via on-chain metadata or a trusted registry.',
      verifiedAssets: {
        USDT: { assetId: 1984, issuer: 'Registered on Asset Hub via on-chain governance (community-issued, not issued by Tether)' },
        USDC: { assetId: 1337, issuer: 'Registered on Asset Hub via on-chain governance (community-issued, not issued by Circle)' },
      },
    },
  },
};

/**
 * XCM Transfer Patterns (exported for reference)
 */
export const XCM_TRANSFER_PATTERNS: Record<string, XCMPattern> = STATIC_KNOWLEDGE_BASE.xcmPatterns;

/**
 * Common Operation Patterns (exported for reference)
 */
export const COMMON_PATTERNS: Record<string, OperationPattern> = STATIC_KNOWLEDGE_BASE.patterns;

/**
 * Ecosystem Changes (exported for reference)
 */
export const ECOSYSTEM_CHANGES = STATIC_KNOWLEDGE_BASE.ecosystemChanges;

/**
 * Safety Guidelines (exported for reference)
 */
export const SAFETY_GUIDELINES = STATIC_KNOWLEDGE_BASE.safetyGuidelines;

/**
 * Fetch live parachain data from on-chain or maintained registry
 * Falls back to static data if fetch fails
 */
export async function fetchLiveParachainData(): Promise<ParachainInfo[]> {
  try {
    // TODO: Implement live data fetching
    // This could fetch from:
    // - Polkadot.js API queries
    // - Maintained registry API
    // - On-chain metadata
    
    // For now, return static data
    return STATIC_KNOWLEDGE_BASE.parachains;
  } catch (error) {
    console.warn('Failed to fetch live parachain data, using static data', error);
    return STATIC_KNOWLEDGE_BASE.parachains;
  }
}

/**
 * Build knowledge base with optional live data
 * 
 * @param useLiveData Whether to attempt fetching live data
 * @returns Polkadot knowledge base
 */
export async function buildKnowledgeBase(useLiveData = false): Promise<PolkadotKnowledge> {
  if (useLiveData) {
    const liveParachains = await fetchLiveParachainData();
    return {
      ...STATIC_KNOWLEDGE_BASE,
      parachains: liveParachains,
    };
  }
  return STATIC_KNOWLEDGE_BASE;
}

/**
 * Format Polkadot Knowledge Base for system prompt
 */
export function formatPolkadotKnowledgeBase(): string {
  const kb = STATIC_KNOWLEDGE_BASE;
  let output = '\n## Polkadot Ecosystem Knowledge Base\n\n';
  
  // Ecosystem Changes (Important context first)
  output += '### ⚠️ Important Ecosystem Changes\n\n';
  Object.entries(kb.ecosystemChanges).forEach(([key, change]) => {
    output += `**${key}** (${change.date})\n`;
    output += `${change.description}\n\n`;
    output += 'Impact:\n';
    change.impact.forEach(impact => {
      output += `- ${impact}\n`;
    });
    output += '\n';
  });
  
  // Safety Guidelines
  output += '### ⚠️ Safety Guidelines\n\n';
  output += `**Asset Verification**: ${kb.safetyGuidelines.assetVerification.warning}\n\n`;
  output += `**Best Practice**: ${kb.safetyGuidelines.assetVerification.bestPractice}\n\n`;
  output += '**Canonical Governance-Registered Assets**:\n';
  Object.entries(kb.safetyGuidelines.assetVerification.verifiedAssets).forEach(([symbol, info]) => {
    output += `- ${symbol}: Asset ID ${info.assetId} (${info.issuer})\n`;
  });
  output += '\n⚠️ **IMPORTANT**: Asset Hub allows unlimited community-issued assets with identical symbols. Always verify that the asset ID matches the canonical governance-registered asset ID (USDT = 1984, USDC = 1337), even though these are the officially registered assets.\n\n';
  
  // Asset Classification
  output += '### Asset Classification\n\n';
  output += `**Sufficient Assets**: ${kb.assetClassification.sufficient.description}\n`;
  output += `Examples: ${kb.assetClassification.sufficient.examples.join(', ')}\n\n`;
  output += `**Non-Sufficient Assets**: ${kb.assetClassification.nonSufficient.description}\n`;
  output += `Minimum Balance: ${kb.assetClassification.nonSufficient.minimumBalance}\n`;
  output += `Examples: ${kb.assetClassification.nonSufficient.examples.join(', ')}\n\n`;
  
  // Parachain Topology
  output += '### Parachain Topology\n\n';
  output += 'Available parachains and their tokens:\n\n';
  kb.parachains.forEach(chain => {
    output += `**${chain.name}** (ID: ${chain.id})\n`;
    output += `- Native Token: ${chain.nativeToken}\n`;
    output += `- XCM Supported: ${chain.xcmSupported ? 'Yes' : 'No'}\n`;
    if (chain.xcmVersion !== null && chain.xcmVersion !== undefined) {
      output += `- XCM Version: ${chain.xcmVersion} (negotiated dynamically)\n`;
    } else {
      output += `- XCM Version: Negotiated dynamically via runtime\n`;
    }
    if (chain.xcmChannels && chain.xcmChannels.length > 0) {
      output += `- XCM Channels: ${chain.xcmChannels.join(', ')} (Note: Channels change frequently, query from chain metadata)\n`;
    }
    output += `- Tokens:\n`;
    chain.tokenDetails.forEach(token => {
      output += `  - ${token.symbol} (decimals: ${token.decimals}, native: ${token.isNative ? 'yes' : 'no'}`;
      if (token.assetId) {
        output += `, assetId: ${token.assetId}`;
      }
      if (token.issuer) {
        output += `, issuer: ${token.issuer}`;
      }
      output += ')\n';
      if (token.note) {
        output += `    ⚠️ ${token.note}\n`;
      }
    });
    if (chain.notes) {
      output += `- Note: ${chain.notes}\n`;
    }
    output += '\n';
  });
  
  // DEX Locations
  output += '### DEX Locations and Liquidity Pools\n\n';
  kb.dexes.forEach(dex => {
    output += `**${dex.name}** (on ${dex.parachain})\n`;
    output += `- Type: ${dex.type}\n`;
    output += `- Trading Pairs: ${dex.pairs.join(', ')}\n`;
    if (dex.pools) {
      output += `- Pools: ${dex.pools.join(', ')}\n`;
    }
    output += '\n';
  });
  
  // Fee Structures
  output += '### Fee Structures\n\n';
  kb.fees.forEach(fee => {
    output += `**${fee.chain}**:\n`;
    output += `- Base Fee: ${fee.baseFee} ${fee.feeUnit}\n`;
    if (fee.transferFee) {
      output += `- Transfer Fee: ${fee.transferFee}\n`;
    }
    output += `- Existential Deposit: ${fee.existentialDeposit} ${fee.feeUnit}\n`;
    if (fee.notes) {
      output += `- Note: ${fee.notes}\n`;
    }
    output += '\n';
  });
  
  // XCM Transfer Patterns
  output += '### XCM Transfer Patterns\n\n';
  Object.entries(kb.xcmPatterns).forEach(([key, pattern]) => {
    output += `**${key}**: ${pattern.description}\n`;
    output += `- Example: ${pattern.example}\n`;
    output += `- Requirements: ${pattern.requirements.join(', ')}\n`;
    if (pattern.benefits && pattern.benefits.length > 0) {
      output += `- Benefits: ${pattern.benefits.join(', ')}\n`;
    }
    output += '\n';
  });
  
  // Common Operation Patterns
  output += '### Common Operation Patterns\n\n';
  Object.entries(kb.patterns).forEach(([key, pattern]) => {
    output += `**${key}**: ${pattern.description}\n`;
    output += 'Steps:\n';
    pattern.steps.forEach((step, index) => {
      output += `${index + 1}. ${step}\n`;
    });
    output += '\n';
  });
  
  return output;
}


