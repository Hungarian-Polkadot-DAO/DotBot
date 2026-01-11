/**
 * Scenario Runner Utilities
 * 
 * Helper functions for running scenarios with proper chain selection.
 * Extracted to follow single responsibility and keep functions under 40 lines.
 */

import type { DotBot, Scenario, ScenarioChain } from '../../../lib';

/**
 * Determine the appropriate chain for a scenario
 */
export function getScenarioChain(
  scenario: Scenario,
  dotbot: DotBot
): ScenarioChain {
  // Use chain from scenario if explicitly set
  if (scenario.environment?.chain) {
    return scenario.environment.chain;
  }
  
  const environment = dotbot.getEnvironment();
  const network = dotbot.getNetwork();
  
  // For mainnet, use relay chain
  if (environment === 'mainnet') {
    return 'polkadot';
  }
  
  // For testnet, default to Asset Hub (where users typically fund accounts)
  return network === 'polkadot' ? 'asset-hub-polkadot' : 'asset-hub-westend';
}

/**
 * Get chain type description
 */
export function getChainTypeDescription(chain: ScenarioChain): string {
  return chain.includes('asset-hub') ? 'Asset Hub' : 'Relay Chain';
}

/**
 * Create modified scenario with environment config
 */
export function createModifiedScenario(
  scenario: Scenario,
  chain: ScenarioChain,
  mode: 'live' | 'synthetic' | 'emulated'
): Scenario {
  return {
    ...scenario,
    environment: {
      chain,
      mode,
      ...scenario.environment?.chopsticksConfig && {
        chopsticksConfig: scenario.environment.chopsticksConfig
      },
    }
  };
}

