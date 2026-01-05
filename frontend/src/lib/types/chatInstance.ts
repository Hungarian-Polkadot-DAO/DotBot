/**
 * Chat Instance Types
 * 
 * Chat instances are conversations bound to a specific environment (mainnet/testnet).
 * Each instance stores all messages including execution flows.
 * 
 * This module integrates with:
 * - ConversationMessage (from dotbot.ts) - for LLM context
 * - ExecutionArrayState (from executionEngine) - for execution tracking
 * - ExecutionPlan (from prompts/system) - for LLM plans
 * - Knowledge system (prompts/system/knowledge) - for AI ask pattern
 */

import type { ExecutionArrayState } from '../executionEngine/types';
import type { ExecutionPlan } from '../prompts/system/execution/types';
import type { Network } from '../rpcManager';
import type { ConversationMessage } from '../dotbot';

/**
 * Environment type - extensible for future environments
 * 
 * - mainnet: Production environments (Polkadot, Kusama)
 * - testnet: Test environments (Westend)
 * 
 * Note: Could add 'devnet' or other environments in the future
 */
export type Environment = 'mainnet' | 'testnet';

/**
 * Mapping of environments to their supported networks
 */
export const ENVIRONMENT_NETWORKS: Record<Environment, Network[]> = {
  mainnet: ['polkadot', 'kusama'],
  testnet: ['westend']
};

/**
 * Chat message types
 * 
 * Core types:
 * - user: User input
 * - bot: AI response
 * - execution: Execution flow (contains ExecutionArrayState)
 * - system: System notifications
 * 
 * Future AI Ask Pattern:
 * - knowledge-request: AI requests specific knowledge (e.g., "GET dotKnowledge.dexes")
 * - knowledge-response: System provides requested knowledge
 * - search-request: AI requests external search (future: docs, web)
 * - search-response: Search results
 */
export type ChatMessageType = 
  | 'user' 
  | 'bot' 
  | 'execution' 
  | 'system'
  | 'knowledge-request'  // AI ask pattern (future)
  | 'knowledge-response' // AI ask pattern (future)
  | 'search-request'     // Future: external search
  | 'search-response';   // Future: search results

/**
 * Base message structure
 */
export interface BaseChatMessage {
  id: string;
  type: ChatMessageType;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * Text message from user or bot
 */
export interface TextMessage extends BaseChatMessage {
  type: 'user' | 'bot';
  content: string;
}

/**
 * Execution flow message
 * Contains the execution array state and tracks execution progress
 */
export interface ExecutionMessage extends BaseChatMessage {
  type: 'execution';
  
  /** Unique execution ID (matches ExecutionArrayState.id) */
  executionId: string;
  
  /** Serialized execution state */
  executionArray: ExecutionArrayState;
  
  /** High-level status */
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';
  
  /** Final result (after execution completes) */
  result?: {
    success: boolean;
    blockHash?: string;
    txHash?: string;
    error?: string;
  };
}

/**
 * System message (info, warnings, errors)
 */
export interface SystemMessage extends BaseChatMessage {
  type: 'system';
  content: string;
  variant?: 'info' | 'warning' | 'error' | 'success';
}

// ============================================================================
// AI Ask Pattern (Future Implementation)
// ============================================================================

/**
 * Knowledge request from AI
 * 
 * Allows AI to request specific knowledge from the structured knowledge base.
 * 
 * @example
 * AI response: "GET dotKnowledge.dexes"
 * Parsed to: { type: 'knowledge-request', query: 'dotKnowledge.dexes', path: ['dotKnowledge', 'dexes'] }
 */
export interface KnowledgeRequestMessage extends BaseChatMessage {
  type: 'knowledge-request';
  
  /** Original query string (e.g., "dotKnowledge.dexes") */
  query: string;
  
  /** Parsed path components */
  path: string[];
  
  /** Knowledge domain (e.g., 'dotKnowledge', 'westendKnowledge') */
  domain: string;
  
  /** Optional filter/query parameters */
  filter?: Record<string, any>;
}

/**
 * Knowledge response from system
 * 
 * System provides the requested knowledge chunk to the AI.
 */
export interface KnowledgeResponseMessage extends BaseChatMessage {
  type: 'knowledge-response';
  
  /** Original query that triggered this response */
  query: string;
  
  /** The knowledge data */
  data: any;
  
  /** Whether the query was successful */
  success: boolean;
  
  /** Error message if query failed */
  error?: string;
  
  /** Metadata about the response */
  metadata?: {
    domain: string;
    path: string[];
    size?: number;  // Size of returned data
    cached?: boolean;
  };
}

/**
 * Search request from AI (future)
 * 
 * Allows AI to request external searches (docs, web, etc.)
 */
export interface SearchRequestMessage extends BaseChatMessage {
  type: 'search-request';
  
  /** Search query */
  query: string;
  
  /** Search scope (e.g., 'polkadot-docs', 'web', 'github') */
  scope: string;
  
  /** Optional search parameters */
  params?: Record<string, any>;
}

/**
 * Search response from system (future)
 */
export interface SearchResponseMessage extends BaseChatMessage {
  type: 'search-response';
  
  /** Original query */
  query: string;
  
  /** Search results */
  results: any[];
  
  /** Whether search was successful */
  success: boolean;
  
  /** Error message if search failed */
  error?: string;
}

/**
 * Union of all conversation item types
 * 
 * Represents items in the temporal conversation sequence.
 * Items can be text messages (user/bot), execution flows, system notifications,
 * or future AI-ask-pattern messages (knowledge requests/responses, search, etc.)
 * 
 * This mixed array allows rendering different UI components based on type:
 * - TextMessage → Message bubble
 * - ExecutionMessage → ExecutionFlow component
 * - SystemMessage → System notification
 */
export type ConversationItem = 
  | TextMessage 
  | ExecutionMessage 
  | SystemMessage
  | KnowledgeRequestMessage
  | KnowledgeResponseMessage
  | SearchRequestMessage
  | SearchResponseMessage;

/**
 * @deprecated Use ConversationItem instead
 * Kept for backward compatibility during migration
 */
export type ChatMessage = ConversationItem;

/**
 * Chat instance data - represents a single conversation (serializable)
 * 
 * Key properties:
 * - Bound to an environment (cannot be changed)
 * - Contains network (can be changed within same environment)
 * - Stores all conversation items in temporal order (text messages + execution flows)
 * - Includes wallet address for context
 * 
 * The messages array is a mixed temporal sequence of:
 * - Text messages (user/bot)
 * - Execution flows (interactive transaction UIs)
 * - System notifications
 * - Future: knowledge requests/responses, search, etc.
 * 
 * Note: This is the data structure. The ChatInstance class wraps this with behavior.
 */
export interface ChatInstanceData {
  id: string;
  createdAt: number;
  updatedAt: number;
  
  // Environment binding (immutable)
  environment: Environment;
  
  // Current network (mutable within same environment)
  network: Network;
  
  // Wallet context
  walletAddress?: string;
  
  // Conversation items in temporal order (mixed: text + execution + system)
  messages: ConversationItem[];
  
  // Optional metadata
  title?: string;  // Auto-generated or user-provided
  archived?: boolean;
  tags?: string[];
}

/**
 * Create a new chat instance
 */
export interface CreateChatInstanceParams {
  environment: Environment;
  network: Network;
  walletAddress?: string;
  title?: string;
}

/**
 * Update chat instance (only mutable fields)
 */
export interface UpdateChatInstanceParams {
  network?: Network;  // Can change within same environment
  walletAddress?: string;
  title?: string;
  archived?: boolean;
  tags?: string[];
}

/**
 * Filter options for querying chat instances
 */
export interface ChatInstanceFilter {
  environment?: Environment;
  network?: Network;
  walletAddress?: string;
  archived?: boolean;
  fromDate?: number;
  toDate?: number;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// Integration with existing DotBot types
// ============================================================================

/**
 * Convert ConversationItem to ConversationMessage for LLM context
 * 
 * This bridges our chat instance system with DotBot's conversation history.
 * Filters out execution/knowledge messages and strips unnecessary fields to minimize prompt size.
 */
export function toConversationMessage(message: ConversationItem): ConversationMessage | null {
  switch (message.type) {
    case 'user':
      return {
        role: 'user',
        content: message.content,
        timestamp: message.timestamp,
      };
    
    case 'bot':
      return {
        role: 'assistant',
        content: message.content,
        timestamp: message.timestamp,
      };
    
    case 'system':
      // System messages can be included as system role
      return {
        role: 'system',
        content: message.content,
        timestamp: message.timestamp,
      };
    
    case 'knowledge-response':
      // Knowledge responses go to assistant
      return {
        role: 'assistant',
        content: `[Knowledge Response] ${JSON.stringify(message.data)}`,
        timestamp: message.timestamp,
      };
    
    // Don't include execution, knowledge-request, search messages in LLM context
    // (They're for UI display only)
    default:
      return null;
  }
}

/**
 * Convert an array of ChatMessages to ConversationMessages for LLM
 */
export function toConversationHistory(messages: ChatMessage[]): ConversationMessage[] {
  return messages
    .map(toConversationMessage)
    .filter((msg): msg is ConversationMessage => msg !== null);
}

/**
 * Create a ChatMessage from ConversationMessage
 */
export function fromConversationMessage(
  convMsg: ConversationMessage,
  id?: string
): ChatMessage {
  const baseMsg = {
    id: id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: convMsg.timestamp || Date.now(),
  };

  if (convMsg.role === 'user') {
    return {
      ...baseMsg,
      type: 'user',
      content: convMsg.content,
    };
  } else if (convMsg.role === 'assistant') {
    return {
      ...baseMsg,
      type: 'bot',
      content: convMsg.content,
    };
  } else {
    return {
      ...baseMsg,
      type: 'system',
      content: convMsg.content,
    };
  }
}

// ============================================================================
// Knowledge Query Parsing (for AI Ask Pattern)
// ============================================================================

/**
 * Knowledge query parser result
 */
export interface ParsedKnowledgeQuery {
  domain: string;        // e.g., 'dotKnowledge', 'westendKnowledge'
  path: string[];        // e.g., ['dexes'], ['parachains', 'moonbeam']
  filter?: Record<string, any>;  // Optional filters
}

/**
 * Parse a knowledge query string
 * 
 * @example
 * parseKnowledgeQuery("dotKnowledge.dexes")
 * // Returns: { domain: 'dotKnowledge', path: ['dexes'] }
 * 
 * parseKnowledgeQuery("dotKnowledge.parachains[name=Moonbeam]")
 * // Returns: { domain: 'dotKnowledge', path: ['parachains'], filter: { name: 'Moonbeam' } }
 */
export function parseKnowledgeQuery(query: string): ParsedKnowledgeQuery {
  // Remove whitespace
  query = query.trim();
  
  // Extract filter if present (e.g., "path[key=value]")
  let filter: Record<string, any> | undefined;
  const filterMatch = query.match(/\[([^\]]+)\]/);
  if (filterMatch) {
    const filterStr = filterMatch[1];
    filter = {};
    
    // Parse key=value pairs
    filterStr.split(',').forEach(pair => {
      const [key, value] = pair.split('=').map(s => s.trim());
      if (key && value) {
        filter![key] = value;
      }
    });
    
    // Remove filter from query
    query = query.replace(/\[([^\]]+)\]/, '');
  }
  
  // Split by dot
  const parts = query.split('.');
  const domain = parts[0];
  const path = parts.slice(1);
  
  return { domain, path, filter };
}

/**
 * Validate a knowledge query
 */
export function validateKnowledgeQuery(query: string): ValidationResult {
  try {
    const parsed = parseKnowledgeQuery(query);
    
    if (!parsed.domain) {
      return {
        valid: false,
        error: 'Knowledge query must specify a domain (e.g., dotKnowledge.dexes)',
      };
    }
    
    // Validate domain is known
    const validDomains = ['dotKnowledge', 'westendKnowledge', 'kusamaKnowledge'];
    if (!validDomains.includes(parsed.domain)) {
      return {
        valid: false,
        error: `Unknown knowledge domain: ${parsed.domain}. Valid domains: ${validDomains.join(', ')}`,
      };
    }
    
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid query format',
    };
  }
}

/**
 * Check if a bot message contains a knowledge request
 * 
 * Looks for patterns like "GET dotKnowledge.dexes" or "@query dotKnowledge.dexes"
 */
export function detectKnowledgeRequest(content: string): ParsedKnowledgeQuery | null {
  const patterns = [
    /GET\s+([a-zA-Z0-9_.[\]=,]+)/i,
    /@query\s+([a-zA-Z0-9_.[\]=,]+)/i,
    /\[KNOWLEDGE:\s*([a-zA-Z0-9_.[\]=,]+)\]/i,
  ];
  
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      const query = match[1];
      const validation = validateKnowledgeQuery(query);
      
      if (validation.valid) {
        return parseKnowledgeQuery(query);
      }
    }
  }
  
  return null;
}

