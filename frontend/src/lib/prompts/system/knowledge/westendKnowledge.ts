/**
 * Westend Knowledge Base
 *
 * Comprehensive knowledge about the Westend testnet ecosystem.
 *
 * IMPORTANT:
 * - Westend is a TESTNET - tokens have NO real-world value
 * - Economics, fees, and EDs may change frequently
 * - Governance and runtime upgrades happen earlier than on Polkadot
 * - This is a completely isolated environment from Polkadot/Kusama
 */

import type {
    ParachainInfo,
    PolkadotKnowledge,
    XCMPattern,
    OperationPattern,
  } from './types';
  
  /**
   * Westend Static Knowledge Base
   * Testnet-specific data for the Westend ecosystem
   */
  export const WESTEND_KNOWLEDGE_BASE: PolkadotKnowledge = {
    parachains: [
      {
        id: 0,
        name: 'Westend Relay Chain',
        nativeToken: 'WND',
        tokenDetails: [
          { symbol: 'WND', decimals: 12, isNative: true },
        ],
        xcmSupported: true,
        xcmVersion: 3,
        rpcEndpoint: 'wss://westend-rpc.polkadot.io',
        notes:
          'Westend Relay Chain. Used for testing staking, governance, and system-level changes before Polkadot deployment. Supports balances, staking, nominationPools, and XCM pallets.',
      },
      {
        id: 1000,
        name: 'Westend Asset Hub',
        nativeToken: 'WND',
        tokenDetails: [
          {
            symbol: 'WND',
            decimals: 12,
            isNative: false,
            note: 'Mirror asset from Westend Relay Chain',
          },
          {
            symbol: 'USDT',
            assetId: 1984,
            decimals: 6,
            isNative: false,
            issuer:
              'Governance-registered synthetic test asset (NOT real USDT, NO backing)',
            note:
              'Test-only asset. Symbol is not unique. Always verify assetId.',
          },
        ],
        xcmSupported: true,
        xcmVersion: 3,
        rpcEndpoint: 'wss://westend-asset-hub-rpc.polkadot.io',
        xcmChannels: [
          'HydraDX (Westend)',
          'Moonbase Alpha',
          'Other Westend parachains',
        ],
        notes:
          'Primary test environment for Asset Hub features. Economics and ED may change frequently. Supports balances, assets, and polkadotXcm pallets.',
      },
      {
        id: 2034,
        name: 'HydraDX (Westend)',
        nativeToken: 'HDX',
        tokenDetails: [
          { symbol: 'HDX', decimals: 12, isNative: true },
          { symbol: 'WND', decimals: 12, isNative: false },
        ],
        xcmSupported: true,
        xcmVersion: 3,
        rpcEndpoint: 'wss://westend-hydradx-rpc.polkadot.io',
        notes:
          'HydraDX test deployment on Westend. Used for validating Omnipool and XCM behavior. Supports balances, omnipool, and polkadotXcm pallets.',
      },
      {
        id: 2004,
        name: 'Moonbase Alpha',
        nativeToken: 'DEV',
        tokenDetails: [
          { symbol: 'DEV', decimals: 18, isNative: true },
          { symbol: 'WND', decimals: 12, isNative: false },
        ],
        xcmSupported: true,
        xcmVersion: 3,
        rpcEndpoint: 'wss://wss.api.moonbase.moonbeam.network',
        notes:
          'Moonbeam test network connected to Westend. EVM-compatible test environment. Supports balances, ethereum, and polkadotXcm pallets.',
      },
    ],
  
    dexes: [
      {
        name: 'HydraDX Omnipool (Westend)',
        parachain: 'HydraDX (Westend)',
        pairs: ['WND/HDX', 'USDT/HDX', 'WND/USDT'],
        type: 'AMM',
        pools: ['Omnipool'],
        notes: 'Single-sided liquidity pool model. All swaps route through HDX. Test environment for Omnipool features.',
      },
    ],
  
    fees: [
      {
        chain: 'Westend Relay Chain',
        baseFee: '0.001-0.01 WND',
        feeUnit: 'WND',
        existentialDeposit: '0.01 WND',
        notes:
          'Approximate values. Query chain state for exact ED. Fees vary by extrinsic weight.',
      },
      {
        chain: 'Westend Asset Hub',
        baseFee: '0.001-0.01 WND',
        feeUnit: 'WND',
        existentialDeposit: '0.1 WND',
        notes:
          'Asset Hub ED is typically higher than relay chain. Some assets may have their own ED.',
      },
      {
        chain: 'HydraDX (Westend)',
        baseFee: '0.001-0.01 HDX',
        feeUnit: 'HDX',
        existentialDeposit: '1 HDX',
        notes:
          'Fees can be paid in multiple currencies via MultiTransactionPayment pallet.',
      },
    ],
  
    xcmPatterns: {
      direct: {
        description:
          'Direct XCM transfer between Westend parachains',
        example:
          'Westend Asset Hub → HydraDX (Westend)',
        requirements: [
          'Both chains support XCM',
          'Asset exists on destination chain',
          'Compatible XCM versions',
        ],
      },
      viaRelay: {
        description:
          'Transfer routed via Westend Relay Chain',
        example:
          'Parachain A → Westend Relay → Parachain B',
        requirements: [
          'XCM enabled on all involved chains',
          'Reserve location compatible',
        ],
      },
      viaAssetHub: {
        description:
          'Use Westend Asset Hub as an intermediate hub',
        example:
          'Any Westend parachain → Asset Hub → Any Westend parachain',
        requirements: [
          'Asset registered on Asset Hub',
          'Destination chain supports the asset',
        ],
        benefits: [
          'Simpler routing',
          'Lower test friction',
        ],
      },
    },
  
    patterns: {
      simpleTransfer: {
        description:
          'Transfer WND between accounts on the same Westend chain',
        steps: [
          'Validate SS58 address',
          'Check balance (ensure > amount + fees + ED)',
          'Create transfer extrinsic (use transferKeepAlive to prevent account reaping)',
          'Sign and submit',
        ],
      },
      crossChainTransfer: {
        description:
          'Transfer assets across Westend parachains using XCM',
        steps: [
          'Verify asset exists on source chain',
          'Verify asset exists on destination chain',
          'Check XCM route availability',
          'Verify sufficient balance for fees and existential deposit',
          'Create XCM extrinsic (use limited versions to prevent fund loss)',
          'Sign and submit',
        ],
      },
      stakingNomination: {
        description:
          'Nominate validators on Westend Relay Chain',
        steps: [
          'Check bonded balance',
          'Select validators (up to 16)',
          'Verify validators are active',
          'Create nominate extrinsic',
          'Sign and submit',
        ],
      },
      poolStaking: {
        description:
          'Join a nomination pool (lower barrier to entry)',
        steps: [
          'Select pool by ID',
          'Check pool state (open/blocked/destroying)',
          'Verify minimum join amount',
          'Ensure balance covers join + ED',
          'Create join extrinsic',
          'Sign and submit',
        ],
      },
      assetSwap: {
        description:
          'Swap assets on HydraDX Omnipool',
        steps: [
          'Verify both assets exist in Omnipool',
          'Check liquidity availability',
          'Set reasonable slippage limits',
          'Create swap extrinsic',
          'Sign and submit',
        ],
      },
      governanceTesting: {
        description:
          'Test governance proposals and voting flows',
        steps: [
          'Create proposal (note: this is a test network)',
          'Submit to governance pallet',
          'Vote and observe enactment',
          'Understand voting tracks and origins',
        ],
      },
    },
  
    ecosystemChanges: {
      testnetNature: {
        date: 'Ongoing',
        description:
          'Westend is a continuously evolving test network for Polkadot.',
        impact: [
          'Breaking changes may occur without notice',
          'Balances and assets may be reset',
          'Features appear on Westend before Polkadot',
        ],
      },
    },
  
    assetClassification: {
      sufficient: {
        description:
          'Some assets may be marked sufficient for testing purposes.',
        examples: [
          'Certain governance-registered test assets (verify on-chain)',
        ],
      },
      nonSufficient: {
        description:
          'Most assets require a native token balance to keep the account alive.',
        minimumBalance:
          'Chain-dependent, often close to zero on Westend',
        examples: ['WND', 'Most parachain native tokens'],
      },
    },
  
    safetyGuidelines: {
      balanceChecking: {
        warning:
          'Balances on Westend are NOT persistent and may be reset.',
        bestPractice: [
          'Always query live chain state',
          'Never assume balances persist across sessions',
          'Warn users before large test transactions',
        ],
        locations: {
          relayChain: {
            endpoint: 'wss://westend-rpc.polkadot.io',
            checked: true,
            note: 'Primary Westend relay endpoint',
          },
          assetHub: {
            endpoint: 'wss://westend-asset-hub-rpc.polkadot.io',
            checked: true,
            note: 'Asset Hub test environment',
          },
        },
      },
      assetVerification: {
        warning:
          'All Westend assets are test-only. Symbols have no real-world meaning.',
        bestPractice:
          'Always verify assetId and chain context. Never assume value.',
        verifiedAssets: {
          USDT: {
            assetId: 1984,
            issuer:
              'Synthetic governance-registered test asset (NO backing)',
          },
        },
      },
    },
  };
  
  /**
   * Export helpers
   */
  export const WESTEND_XCM_PATTERNS: Record<string, XCMPattern> =
    WESTEND_KNOWLEDGE_BASE.xcmPatterns;
  
  export const WESTEND_COMMON_PATTERNS: Record<string, OperationPattern> =
    WESTEND_KNOWLEDGE_BASE.patterns;
  
  export const WESTEND_ECOSYSTEM_CHANGES = WESTEND_KNOWLEDGE_BASE.ecosystemChanges;
  
  export const WESTEND_SAFETY_GUIDELINES = WESTEND_KNOWLEDGE_BASE.safetyGuidelines;
  
  /**
   * Fetch live parachain data from on-chain or maintained registry
   * Falls back to static data if fetch fails
   */
  export async function fetchLiveWestendParachainData(): Promise<ParachainInfo[]> {
    try {
      // TODO: Implement live data fetching from Westend
      // For now, return static data
      return WESTEND_KNOWLEDGE_BASE.parachains;
    } catch (error) {
      console.warn('Failed to fetch live Westend parachain data, using static data', error);
      return WESTEND_KNOWLEDGE_BASE.parachains;
    }
  }
  
  /**
   * Build Westend knowledge base with optional live data
   * 
   * @param useLiveData Whether to attempt fetching live data
   * @returns Westend knowledge base
   */
  export async function buildWestendKnowledgeBase(useLiveData = false): Promise<PolkadotKnowledge> {
    if (useLiveData) {
      const liveParachains = await fetchLiveWestendParachainData();
      return {
        ...WESTEND_KNOWLEDGE_BASE,
        parachains: liveParachains,
      };
    }
    return WESTEND_KNOWLEDGE_BASE;
  }
  
  /**
   * Format Westend Knowledge Base for system prompt
   */
  export function formatWestendKnowledgeBase(): string {
    const kb = WESTEND_KNOWLEDGE_BASE;
    let output = '\n## Westend Testnet Knowledge Base\n\n';
    output += '⚠️ **IMPORTANT**: Westend is a TESTNET. All tokens have NO real-world value.\n\n';
    
    // Ecosystem Changes (Important context first)
    output += '### ⚠️ Important Testnet Information\n\n';
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
    
    // Balance Checking
    output += `**Balance Checking**: ${kb.safetyGuidelines.balanceChecking.warning}\n\n`;
    output += '**Best Practices**:\n';
    kb.safetyGuidelines.balanceChecking.bestPractice.forEach(practice => {
      output += `- ${practice}\n`;
    });
    output += '\n**RPC Endpoints**:\n';
    Object.entries(kb.safetyGuidelines.balanceChecking.locations).forEach(([location, info]) => {
      output += `- ${location}: ${info.endpoint}\n`;
      output += `  - Currently checked: ${info.checked ? '✅ YES' : '❌ NO'}\n`;
      output += `  - Note: ${info.note}\n`;
    });
    output += '\n';
    
    // Asset Verification
    output += `**Asset Verification**: ${kb.safetyGuidelines.assetVerification.warning}\n\n`;
    output += `**Best Practice**: ${kb.safetyGuidelines.assetVerification.bestPractice}\n\n`;
    if (kb.safetyGuidelines.assetVerification.verifiedAssets) {
      output += '**Test Assets**:\n';
      Object.entries(kb.safetyGuidelines.assetVerification.verifiedAssets).forEach(([symbol, info]) => {
        output += `- ${symbol}: Asset ID ${info.assetId} (${info.issuer})\n`;
      });
      output += '\n';
    }
    
    // Asset Classification
    output += '### Asset Classification\n\n';
    output += `**Sufficient Assets**: ${kb.assetClassification.sufficient.description}\n`;
    output += `Examples: ${kb.assetClassification.sufficient.examples.join(', ')}\n\n`;
    output += `**Non-Sufficient Assets**: ${kb.assetClassification.nonSufficient.description}\n`;
    output += `Minimum Balance: ${kb.assetClassification.nonSufficient.minimumBalance}\n`;
    output += `Examples: ${kb.assetClassification.nonSufficient.examples.join(', ')}\n\n`;
    
    // Parachain Topology
    output += '### Parachain Topology\n\n';
    output += 'Available parachains on Westend testnet:\n\n';
    kb.parachains.forEach(chain => {
      output += `**${chain.name}** (ID: ${chain.id})\n`;
      output += `- Native Token: ${chain.nativeToken}\n`;
      output += `- XCM Supported: ${chain.xcmSupported ? 'Yes' : 'No'}\n`;
      if (chain.xcmVersion !== null && chain.xcmVersion !== undefined) {
        output += `- XCM Version: ${chain.xcmVersion}\n`;
      }
      if (chain.rpcEndpoint) {
        output += `- RPC Endpoint: ${chain.rpcEndpoint}\n`;
      }
      if (chain.xcmChannels && chain.xcmChannels.length > 0) {
        output += `- XCM Channels: ${chain.xcmChannels.join(', ')}\n`;
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
    output += '### DEX Locations and Test Liquidity\n\n';
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
      output += `- Base Fee: ${fee.baseFee}\n`;
      output += `- Existential Deposit: ${fee.existentialDeposit}\n`;
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