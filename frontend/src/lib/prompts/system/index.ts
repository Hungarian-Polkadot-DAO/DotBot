/**
 * System Prompt Module
 * 
 * Main entry point for the system prompt system.
 * This module provides the interface for loading and using system prompts.
 */

export { buildSystemPrompt, buildSystemPromptSync, getDefaultSystemPrompt, buildVersionedSystemPrompt } from './loader';
export { logSystemPrompt, logSystemPromptAsync, getSystemPromptString, logSystemPromptWithMockContext } from './utils';
export { BASE_SYSTEM_PROMPT } from './base';
export { EXECUTION_ARRAY_INSTRUCTIONS } from './execution/instructions';
export {
  formatPolkadotKnowledgeBase,
  buildKnowledgeBase,
  fetchLiveParachainData,
  STATIC_KNOWLEDGE_BASE,
  XCM_TRANSFER_PATTERNS,
  COMMON_PATTERNS,
  ECOSYSTEM_CHANGES,
  SAFETY_GUIDELINES,
} from './knowledge/dot-knowledge';
export type {
  ParachainInfo,
  TokenInfo,
  DEXInfo,
  FeeStructure,
  AssetClassification,
  EcosystemChange,
  SafetyGuidelines,
  PolkadotKnowledge,
  XCMPattern,
  OperationPattern,
} from './knowledge/types';

// Version control exports
export {
  SYSTEM_PROMPT_VERSION,
  isCompatibleVersion,
  createVersionedPrompt,
} from './version';
export type { VersionedPrompt } from './version';

// Agent registry exports
export {
  AGENTS,
  buildAgentRegistry,
  getAgentByClassName,
  getAgentByDisplayName,
  getAllAgentClassNames,
  getAllFunctionNames,
} from './agents';

// Type exports
export type {
  AgentDefinition,
  AgentFunction,
  FunctionParameter,
  AgentRegistry,
} from './agents/types';

export type {
  ExecutionPlan,
  ExecutionStep,
  ExecutionStatus,
  ExecutionType,
  ExecutionContext,
} from './execution/types';

export type {
  SystemContext,
  WalletContext,
  NetworkContext,
  BalanceContext,
} from './context/types';

