/**
 * DotBot public types and config
 */

import type { ApiPromise } from '@polkadot/api';
import type { ExecutionPlan } from '../prompts/system/execution/types';
import type { ExecutionSystem } from '../executionEngine/system';
import type { ExecutionArrayState } from '../executionEngine/types';
import type { SigningRequest, BatchSigningRequest, ExecutionOptions } from '../executionEngine/types';
import type { WalletAccount } from '../types/wallet';
import type { ChatInstance } from '../chat/chatInstance';
import type { SimulationStatusCallback } from '../agents/types';
import type { RpcManager } from '../rpcManager';
import type { ChatInstanceManager } from '../chat/chatInstanceManager';
import type { Network } from '../rpcManager';
import type { Environment } from '../chat/types';

type AIServiceType = import('../services/ai/aiService').AIService;

export interface DotBotConfig {
  /** Wallet account (required). */
  wallet: WalletAccount;
  /** Network to connect to (default: 'polkadot'). */
  network?: Network;
  /** Environment: 'mainnet' or 'testnet' (default: 'mainnet'). */
  environment?: Environment;
  /** AI service for LLM calls. If omitted, pass a custom `llm` in chat options. */
  aiService?: AIServiceType;
  /** LLM API endpoint (legacy). */
  llmEndpoint?: string;
  /** LLM API key (legacy). */
  llmApiKey?: string;
  /** Handler for signing requests (required for transactions). */
  onSigningRequest?: (request: SigningRequest) => void;
  /** Handler for batch signing. */
  onBatchSigningRequest?: (request: BatchSigningRequest) => void;
  /** Callback for simulation status (e.g. UI progress). */
  onSimulationStatus?: SimulationStatusCallback;
  /** Called when execution is ready (e.g. to set up WebSocket). */
  onExecutionReady?: (executionId: string, chat: ChatInstance) => void;
  /** Auto-approve transactions (not recommended for production). */
  autoApprove?: boolean;
  /** Pre-initialized RPC managers (optional). */
  relayChainManager?: RpcManager;
  assetHubManager?: RpcManager;
  /** Custom chat manager (optional). */
  chatManager?: ChatInstanceManager;
  /** Disable chat persistence. */
  disableChatPersistence?: boolean;
  /** If true (default), DotBot keeps chat/execution state. If false (backend mode), state is returned per request. */
  stateful?: boolean;
  /** If true, backend runs simulation before returning. Default: !stateful. */
  backendSimulation?: boolean;
}

/** Result of a single chat turn: text reply and/or execution plan/state. */
export interface ChatResult {
  response: string;
  /** Present when the LLM returned an execution plan. */
  plan?: ExecutionPlan;
  /** In stateless mode, the prepared execution state returned to the client. */
  executionArrayState?: ExecutionArrayState;
  /** Id to pass to startExecution (and for polling in stateless mode). */
  executionId?: string;
  executed: boolean;
  success: boolean;
  completed: number;
  failed: number;
  /** True when backend ran simulation. */
  backendSimulated?: boolean;
}

/** Event types emitted by DotBot (e.g. for ScenarioEngine or UI). */
export enum DotBotEventType {
  CHAT_STARTED = 'chat-started',
  USER_MESSAGE_ADDED = 'user-message-added',
  BOT_MESSAGE_ADDED = 'bot-message-added',
  EXECUTION_MESSAGE_ADDED = 'execution-message-added',
  EXECUTION_MESSAGE_UPDATED = 'execution-message-updated',
  CHAT_COMPLETE = 'chat-complete',
  CHAT_ERROR = 'chat-error',
  CHAT_LOADED = 'chat-loaded',
}

/** Union of events DotBot can emit. */
export type DotBotEvent =
  | { type: DotBotEventType.CHAT_STARTED; message: string }
  | { type: DotBotEventType.USER_MESSAGE_ADDED; message: string; timestamp: number }
  | { type: DotBotEventType.BOT_MESSAGE_ADDED; message: string; timestamp: number }
  | { type: DotBotEventType.EXECUTION_MESSAGE_ADDED; executionId: string; plan?: ExecutionPlan; timestamp: number }
  | { type: DotBotEventType.EXECUTION_MESSAGE_UPDATED; executionId: string; timestamp: number }
  | { type: DotBotEventType.CHAT_COMPLETE; result: ChatResult }
  | { type: DotBotEventType.CHAT_ERROR; error: Error }
  | { type: DotBotEventType.CHAT_LOADED; chatId: string; messageCount: number };

export type DotBotEventListener = (event: DotBotEvent) => void;

/** Single message in conversation history (for LLM context). */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

/** Options for a single chat() call (override system prompt, LLM, history). */
export interface ChatOptions {
  systemPrompt?: string;
  executionOptions?: ExecutionOptions;
  /** Custom LLM; if not set, DotBot uses config.aiService. */
  llm?: (message: string, systemPrompt: string, context?: unknown) => Promise<string>;
  /** Previous messages for context (e.g. when not using built-in chat persistence). */
  conversationHistory?: ConversationMessage[];
}

/** Internal: args passed to DotBot constructor from getCreateArgs(). */
export interface DotBotConstructorArgs {
  api: ApiPromise | null;
  executionSystem: ExecutionSystem;
  config: DotBotConfig;
  network: Network;
  environment: Environment;
  relayChainManager: RpcManager;
  assetHubManager: RpcManager;
  chatManager: ChatInstanceManager;
}
