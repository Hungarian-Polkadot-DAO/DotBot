/**
 * Agent Definition Types
 * 
 * Types for defining agents (classes) and their functions (methods)
 * This structure allows the LLM to understand what operations are available
 */

export interface AgentFunction {
  /** Function name (e.g., "transfer", "swap", "vote") */
  name: string;
  
  /** Human-readable description of what this function does */
  description: string;
  
  /** Detailed explanation of the function's purpose and behavior */
  detailedDescription?: string;
  
  /** Parameters this function accepts */
  parameters: FunctionParameter[];
  
  /** What this function returns (extrinsic, data, etc.) */
  returns: {
    type: 'extrinsic' | 'data' | 'confirmation' | 'mixed';
    description: string;
  };
  
  /** Example usage scenarios */
  examples?: string[];
  
  /** Whether this function requires user confirmation */
  requiresConfirmation: boolean;
  
  /** Related functions that might be used together */
  relatedFunctions?: string[];
}

export interface FunctionParameter {
  /** Parameter name */
  name: string;
  
  /** Parameter type (string, number, Address, etc.) */
  type: string;
  
  /** Whether this parameter is required */
  required: boolean;
  
  /** Description of the parameter */
  description: string;
  
  /** Example values */
  examples?: (string | number)[];
  
  /** Validation rules or constraints */
  constraints?: string;
  
  /** Default value if optional */
  default?: any;
}

export interface AgentDefinition {
  /** Agent class name (e.g., "AssetTransferAgent") */
  className: string;
  
  /** Human-readable agent name */
  displayName: string;
  
  /** What this agent is responsible for */
  purpose: string;
  
  /** Detailed description of agent capabilities */
  description: string;
  
  /** Functions (methods) available in this agent */
  functions: AgentFunction[];
  
  /** When to use this agent */
  useCases: string[];
  
  /** Prerequisites or requirements */
  prerequisites?: string[];
  
  /** Network compatibility */
  networks: ('polkadot' | 'kusama' | 'westend' | 'all')[];
  
  /** What this agent explicitly cannot do */
  limitations: string[];
  
  /** Other agents this one depends on (classNames) */
  dependencies?: string[];
  
  /** Agents that work well together with this one (classNames) */
  compatibleAgents?: string[];
  
  /** Categories/tags for organizing agents */
  categories?: string[];
}

export interface AgentRegistry {
  /** All available agents */
  agents: AgentDefinition[];
  
  /** Quick reference map by class name */
  byClassName: Map<string, AgentDefinition>;
  
  /** Quick reference map by display name */
  byDisplayName: Map<string, AgentDefinition>;
}

