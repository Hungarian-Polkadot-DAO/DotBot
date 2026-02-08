/**
 * Chat Module
 * 
 * Main exports for chat instance management
 */

export { ChatInstance } from './chatInstance';
export { ChatInstanceManager } from './chatInstanceManager';
export type { ChatInstanceManagerConfig } from './chatInstanceManager';
export { ExecutionStateManager } from './executionState';
export { ExecutionSessionManager } from './sessionManager';

// Re-export types
export type {
  Environment,
  ConversationItem,
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
  ChatInstanceData,
} from './types';
export {
  ENVIRONMENT_NETWORKS,
  toConversationMessage,
  toConversationHistory,
  fromConversationMessage,
  parseKnowledgeQuery,
  validateKnowledgeQuery,
  detectKnowledgeRequest,
} from './types';
