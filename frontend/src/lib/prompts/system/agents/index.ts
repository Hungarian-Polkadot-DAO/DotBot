/**
 * Agent Registry
 * 
 * Central registry of all available agents and their capabilities.
 * This is what the LLM uses to understand what operations are possible.
 * 
 * When adding a new agent:
 * 1. Create the agent definition file (e.g., asset-transfer.ts)
 * 2. Import it here
 * 3. Add it to the AGENTS array
 * 4. The system will automatically include it in the system prompt
 */

import { AgentDefinition, AgentRegistry } from './types';
// Import agent definitions as they are created
import { ASSET_TRANSFER_AGENT } from './assetTransfer';
// import { ASSET_SWAP_AGENT } from './asset-swap';
// import { GOVERNANCE_AGENT } from './governance';
// import { MULTISIG_AGENT } from './multisig';
// import { STAKING_AGENT } from './staking';

/**
 * All available agents
 * 
 * Add new agents to this array as they are implemented.
 * The order here determines the order in the system prompt.
 */
export const AGENTS: AgentDefinition[] = [
  ASSET_TRANSFER_AGENT,
  // ASSET_SWAP_AGENT,
  // GOVERNANCE_AGENT,
  // MULTISIG_AGENT,
  // STAKING_AGENT,
];

/**
 * Build agent registry with lookup maps
 */
export function buildAgentRegistry(): AgentRegistry {
  const byClassName = new Map<string, AgentDefinition>();
  const byDisplayName = new Map<string, AgentDefinition>();
  
  AGENTS.forEach(agent => {
    byClassName.set(agent.className, agent);
    byDisplayName.set(agent.displayName, agent);
  });
  
  return {
    agents: AGENTS,
    byClassName,
    byDisplayName,
  };
}

/**
 * Get agent by class name
 */
export function getAgentByClassName(className: string): AgentDefinition | undefined {
  const registry = buildAgentRegistry();
  return registry.byClassName.get(className);
}

/**
 * Get agent by display name
 */
export function getAgentByDisplayName(displayName: string): AgentDefinition | undefined {
  const registry = buildAgentRegistry();
  return registry.byDisplayName.get(displayName);
}

/**
 * Get all available agent class names
 */
export function getAllAgentClassNames(): string[] {
  return AGENTS.map(agent => agent.className);
}

/**
 * Get all available function names across all agents
 */
export function getAllFunctionNames(): Array<{ agent: string; function: string }> {
  return AGENTS.flatMap(agent =>
    agent.functions.map(fn => ({
      agent: agent.className,
      function: fn.name,
    }))
  );
}

