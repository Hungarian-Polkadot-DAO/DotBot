/**
 * Agent Registry
 * 
 * Central registry of all available agents.
 * This is used by the system prompt generator to inform the LLM
 * about available agents and their capabilities.
 */

// Import agents as they are created
import { AssetTransferAgent } from './asset-transfer';
// import { StakingAgent } from './staking';
// import { GovernanceAgent } from './governance';

/**
 * Agent class type
 */
export type AgentClass = new () => any;

/**
 * Agent registry entry
 */
export interface AgentRegistryEntry {
  /** Agent class */
  agentClass: AgentClass;
  
  /** Agent class name (e.g., "AssetTransferAgent") */
  className: string;
  
  /** Display name for the agent */
  displayName: string;
}

/**
 * All registered agents
 */
export const AGENT_REGISTRY: AgentRegistryEntry[] = [
  {
    agentClass: AssetTransferAgent,
    className: 'AssetTransferAgent',
    displayName: 'Asset Transfer Agent',
  },
];

/**
 * Get agent by class name
 */
export function getAgentByClassName(className: string): AgentRegistryEntry | undefined {
  return AGENT_REGISTRY.find(entry => entry.className === className);
}

/**
 * Get all agent class names
 */
export function getAllAgentClassNames(): string[] {
  return AGENT_REGISTRY.map(entry => entry.className);
}

/**
 * Create an instance of an agent by class name
 */
export function createAgent(className: string): any | null {
  const entry = getAgentByClassName(className);
  if (!entry) {
    return null;
  }
  return new entry.agentClass();
}

