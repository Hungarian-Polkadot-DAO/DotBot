/**
 * DotBot Library
 * 
 * Core library for Polkadot operations through natural language.
 * This library provides agents, system prompts, and execution capabilities.
 */

// ============================================================================
// OUT OF THE BOX INTERFACE - Start here!
// ============================================================================
export { DotBot } from './dotbot';
export type { DotBotConfig, ChatResult, ChatOptions } from './dotbot';

// ============================================================================
// Advanced/Modular Exports (for custom implementations)
// ============================================================================

// Export agents (runtime agent classes and registry)
export * from './agents';
export type { AgentClass, AgentRegistryEntry } from './agents';
export { 
  AGENT_REGISTRY, 
  getAgentByClassName, 
  getAllAgentClassNames, 
  createAgent 
} from './agents';

// Export prompts system (but exclude conflicting agent functions)
export { 
  buildSystemPrompt, 
  buildSystemPromptSync, 
  getDefaultSystemPrompt, 
  buildVersionedSystemPrompt 
} from './prompts/system/loader';
export { 
  logSystemPrompt, 
  logSystemPromptAsync, 
  getSystemPromptString, 
  logSystemPromptWithMockContext 
} from './prompts/system/utils';
export { BASE_SYSTEM_PROMPT } from './prompts/system/base';
export { EXECUTION_ARRAY_INSTRUCTIONS } from './prompts/system/execution/instructions';
export {
  formatPolkadotKnowledgeBase,
  buildKnowledgeBase,
  fetchLiveParachainData,
  STATIC_KNOWLEDGE_BASE,
  XCM_TRANSFER_PATTERNS,
  COMMON_PATTERNS,
  ECOSYSTEM_CHANGES,
  SAFETY_GUIDELINES,
} from './prompts/system/knowledge/dotKnowledge';
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
} from './prompts/system/knowledge/types';
export {
  SYSTEM_PROMPT_VERSION,
  isCompatibleVersion,
  createVersionedPrompt,
} from './prompts/system/version';
export type { VersionedPrompt } from './prompts/system/version';
// Export prompt agent registry functions with different names to avoid conflicts
export {
  AGENTS,
  buildAgentRegistry,
  getAgentByClassName as getPromptAgentByClassName,
  getAgentByDisplayName,
  getAllAgentClassNames as getAllPromptAgentClassNames,
  getAllFunctionNames,
} from './prompts/system/agents';
export type {
  AgentDefinition,
  AgentFunction,
  FunctionParameter,
  AgentRegistry,
} from './prompts/system/agents/types';
// Export prompt system execution types (for LLM planning)
export type {
  ExecutionPlan, // LLM's JSON plan (this is what LLM outputs)
  ExecutionStep,
  ExecutionStatus as ExecutionStatusPlan, // Renamed to avoid conflict with runtime type
  ExecutionType as ExecutionTypePlan, // Same values but different namespace
  ExecutionContext,
} from './prompts/system/execution/types';
export type {
  SystemContext,
  WalletContext,
  NetworkContext,
  BalanceContext,
} from './prompts/system/context/types';

// Export execution array (runtime execution system)
export {
  ExecutionArray,
  Executioner,
  ExecutionOrchestrator,
  ExecutionSystem, // Recommended: Turnkey solution
  BrowserWalletSigner, // For browser environments
  KeyringSigner, // For terminal/backend/tests
} from './execution-array';
export {
  mapPromptStatusToRuntimeStatus,
  mapRuntimeStatusToPromptStatus,
  createExecutionItemFromAgentResult,
} from './execution-array/utils';
export type {
  ExecutionItem,
  ExecutionArrayState,
  ExecutionOptions,
  ExecutionResult,
  SigningRequest,
  BatchSigningRequest,
  StatusCallback,
  ProgressCallback,
  ErrorCallback,
  CompletionCallback,
  ExecutionStatus, // Runtime execution status (extends prompt status with granular transaction states)
  ExecutionType,   // Same as prompt ExecutionType, but exported from runtime for clarity
  OrchestrationResult,
  OrchestrationOptions,
  Signer, // Pluggable signer interface
  SignerOptions,
} from './execution-array';

