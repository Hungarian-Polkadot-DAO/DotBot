/**
 * DotBot Library
 * 
 * Core library for Polkadot operations through natural language.
 * This library provides agents, system prompts, and execution capabilities.
 */

// Run before any code that loads @polkadot/api so API-WS disconnect logs are suppressed
import './polkadotConsolePatch';

// ============================================================================
// OUT OF THE BOX INTERFACE - Start here!
// ============================================================================
export { DotBot, DotBotEventType } from './dotbot';
export type { 
  DotBotConfig, 
  ChatResult, 
  ChatOptions, 
  ConversationMessage,
  DotBotEvent,
  DotBotEventListener,
} from './dotbot';
export { CHAT_HISTORY_MESSAGE_LIMIT } from './dotbot/constants';

// Error hierarchy (for consumers that need to catch specific errors)
export { DotBotError, ExecutionPreparationError } from './errors';

// RPC Manager - For advanced endpoint management
export { 
  RpcManager, 
  RpcEndpoints,
  // Generic factory
  createRpcManagersForNetwork,
  getEndpointsForNetwork,
  // Polkadot factories
  createPolkadotRelayChainManager,
  createPolkadotAssetHubManager,
  // Kusama factories
  createKusamaRelayChainManager,
  createKusamaAssetHubManager,
  // Westend factories
  createWestendRelayChainManager,
  createWestendAssetHubManager,
  // Legacy factories (backward compatibility)
  createRelayChainManager, 
  createAssetHubManager,
} from './rpcManager';
export type { Network } from './rpcManager';

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

// Export execution engine (runtime execution system)
export {
  ExecutionArray,
  Executioner,
  ExecutionOrchestrator,
  ExecutionSystem, // Advanced: For executing ExecutionPlans directly (use DotBot for turnkey)
  BrowserWalletSigner, // For browser environments
  KeyringSigner, // For terminal/backend/tests
} from './executionEngine';
export {
  mapPromptStatusToRuntimeStatus,
  mapRuntimeStatusToPromptStatus,
  createExecutionItemFromAgentResult,
  isStepFinalized,
  isExecutionArrayStateTerminal,
} from './executionEngine/utils';
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
} from './executionEngine';

// ============================================================================
// Chat Instance System (Environment-bound conversations)
// ============================================================================
export { ChatInstance } from './chat';
export { ChatInstanceManager } from './chat';
export type { ChatInstanceManagerConfig } from './chat';

export type {
  Environment,
  ConversationItem,      // Primary: Mixed array of text messages + execution flows
  ChatMessageType,
  TextMessage,
  ExecutionMessage,
  SystemMessage,
  KnowledgeRequestMessage,
  KnowledgeResponseMessage,
  SearchRequestMessage,
  SearchResponseMessage,
  CreateChatInstanceParams,
  UpdateChatInstanceParams,
  ChatInstanceFilter,
  ValidationResult,
  ParsedKnowledgeQuery,
  ChatInstanceData,      // Chat instance data structure
} from './chat/types';
export {
  ENVIRONMENT_NETWORKS,
  toConversationMessage,
  toConversationHistory,
  fromConversationMessage,
  parseKnowledgeQuery,
  validateKnowledgeQuery,
  detectKnowledgeRequest,
} from './chat/types';

// Chat Storage Abstraction (for backend integration)
export type { IChatStorage } from './storage/chatStorage';
export {
  LocalStorageChatStorage,
  InMemoryChatStorage,
  ApiChatStorage,
  HybridChatStorage,
  StorageError,
  createChatStorage,
} from './storage/chatStorage';

// Data Manager
export { DataManager, STORAGE_KEYS } from './dataManager';
export type { DataExport, DeletionReport } from './dataManager';
export {
  getDataManager,
  exportAllData,
  exportAndDownload,
  nukeAllData,
  getStorageInfo,
  verifyDataCleared,
} from './dataManager';

// Knowledge Schema (AI Ask Pattern support)
export type {
  KnowledgeDomainSchema,
  KnowledgeFieldSchema,
} from './types/knowledgeSchema';
export {
  generatePolkadotKnowledgeSchema,
  generateWestendKnowledgeSchema,
  formatKnowledgeSchemaForPrompt,
  getKnowledgeStats,
  queryKnowledge,
} from './types/knowledgeSchema';

// ============================================================================
// Scenario Engine (Testing/Evaluation Framework)
// ============================================================================
export { ScenarioEngine, createScenarioEngine } from './scenarioEngine';
export type {
  // Scenario definition
  Scenario,
  ScenarioCategory,
  ScenarioStep,
  ScenarioExpectation,
  ScenarioChain,
  ScenarioMode,
  ScenarioAction,
  ScenarioAssertion,
  // Results
  ScenarioResult,
  EvaluationResult,
  StepResult,
  // Engine types
  ScenarioEngineConfig,
  ScenarioEngineState,
  ExecutorDependencies,
  // Entity types
  TestEntity,
  EntityConfig,
} from './scenarioEngine';
export {
  // Test prompt collections
  ALL_TESTS,
  HAPPY_PATH_TESTS,
  ADVERSARIAL_TESTS,
  JAILBREAK_TESTS,
  AMBIGUITY_TESTS,
  EDGE_CASE_TESTS,
  STRESS_TESTS,
  CONTEXT_AWARENESS_TESTS,
  KNOWLEDGE_TESTS,
  getSmokeTests,
  getSecurityTests,
  getTestsByType,
} from './scenarioEngine';

// ============================================================================
// AI Service (for backend integration)
// ============================================================================
export { AIService, getAIService } from './services/ai/aiService';
export type { AIServiceConfig } from './services/ai/aiService';
export { AIProviderType } from './services/ai/aiService';

// ============================================================================
// Environment and Storage Utilities
// ============================================================================
export { 
  getEnv, 
  isBrowser, 
  isNode, 
  getStorage, 
  setStorage, 
  initFileStorage 
} from './env';
export type { Storage } from './env';

// ============================================================================
// Configuration Validation
// ============================================================================
export { 
  validateEnvironment, 
  validateAndReport 
} from './utils/validateEnv';
export type { 
  ValidationError
} from './utils/validateEnv';

// ============================================================================
// WebSocket Types (shared between frontend and backend)
// ============================================================================
export type {
  ClientToServerEvents,
  ServerToClientEvents,
} from './types/websocket';
export { WebSocketEvents } from './types/websocket';

