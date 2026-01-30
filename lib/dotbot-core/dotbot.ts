/**
 * DotBot - Out of the Box Interface
 * 
 * This is the turnkey solution. One class, simple API, everything included.
 * Frontend just needs to create this and call chat().
 * 
 * @example
 * ```typescript
 * const dotbot = await DotBot.create({
 *   wallet: selectedAccount,
 *   endpoint: 'wss://rpc.polkadot.io',
 *   onSigningRequest: (request) => showModal(request)
 * });
 * 
 * const result = await dotbot.chat("Send 2 DOT to Bob");
 * ```
 */

import { ApiPromise } from '@polkadot/api';
import { ExecutionSystem } from './executionEngine/system';
import { ExecutionArrayState } from './executionEngine/types';
import { ExecutionArray } from './executionEngine/executionArray';
import { extractExecutionPlan } from './prompts/system/utils';
import { ExecutionPlan } from './prompts/system/execution/types';
import { ExecutionOptions } from './executionEngine/types';
import { WalletAccount } from './types/wallet';
import { RpcManager, Network, ExecutionSession } from './rpcManager';
import { ChatInstanceManager } from './chat/chatInstanceManager';
import { ChatInstance } from './chat/chatInstance';
import type { Environment, ConversationItem } from './chat/types';
import { createSubsystemLogger, Subsystem } from './services/logger';
import {
  getSimulationConfig,
  updateSimulationConfig,
  enableSimulation,
  disableSimulation,
  isSimulationEnabled,
  type SimulationConfig,
} from './executionEngine/simulation/simulationConfig';
import { getCreateArgs } from './dotbot/create';
import {
  handleConversationResponse as handleConversationResponseImpl,
  handleExecutionResponse as handleExecutionResponseImpl,
} from './dotbot/chatHandlers';
import { prepareExecution as prepareExecutionImpl, prepareExecutionStateless as prepareExecutionStatelessImpl } from './dotbot/executionPreparation';
import { startExecution as startExecutionImpl, startExecutionStateless as startExecutionStatelessImpl, cleanupExecutionSessions as cleanupExecutionSessionsImpl, cleanupExpiredExecutions as cleanupExpiredExecutionsImpl } from './dotbot/executionRunner';
import { ensureRpcConnectionsReady as ensureRpcConnectionsReadyImpl } from './dotbot/rpcLifecycle';
import { initializeChatInstance as initializeChatInstanceImpl, clearHistory as clearHistoryImpl, switchEnvironment as switchEnvironmentImpl, loadChatInstance as loadChatInstanceImpl } from './dotbot/chatLifecycle';
import { getLLMResponse as getLLMResponseImpl } from './dotbot/llm';
import { getBalance as getBalanceImpl, getChainInfo as getChainInfoImpl } from './dotbot/balanceChain';
import type { DotBotConfig, ChatResult, ChatOptions, ConversationMessage, DotBotEvent, DotBotEventListener } from './dotbot/types';
import { DotBotEventType } from './dotbot/types';

export type { DotBotConfig, ChatResult, ChatOptions, ConversationMessage, DotBotEvent, DotBotEventListener } from './dotbot/types';
export { DotBotEventType } from './dotbot/types';

// Forward declaration to avoid circular dependency
type AIServiceType = import('./services/ai/aiService').AIService;

export class DotBot {
  private api: ApiPromise | null = null;
  private executionSystemInitialized = false;
  private assetHubApi: ApiPromise | null = null;
  private executionSystem: ExecutionSystem;
  private wallet: WalletAccount;
  private config: DotBotConfig;
  private network: Network;
  private environment: Environment;
  
  private relayChainManager: RpcManager;
  private assetHubManager: RpcManager;
  
  // AI Service for LLM communication (optional). Used by dotbot/llm when no custom llm in chat options.
  private aiService?: AIServiceType;
  
  // Chat instance management (built-in); execution sessions live in ChatInstance. chatPersistenceEnabled used by dotbot/chatLifecycle.
  private chatManager: ChatInstanceManager;
  public currentChat: ChatInstance | null = null;
  private chatPersistenceEnabled: boolean;
  private _stateful: boolean;
  // Used by dotbot/executionPreparation and dotbot/chatHandlers for simulation/options.
  private _backendSimulation: boolean;
  
  /**
   * Get whether DotBot is in stateful mode
   */
  get stateful(): boolean {
    return this._stateful;
  }
  
  // SESSION_SERVER_MODE: Temporary storage for execution sessions, plans, states, and ExecutionArrays (keyed by executionId)
  // These are created during prepareExecution and reused for execution
  // executionStates stores current state during preparation (for polling)
  // executionArrays stores ExecutionArray instances for direct subscription (no ChatInstance needed)
  private executionSessions: Map<string, { 
    relayChain: ExecutionSession; 
    assetHub: ExecutionSession | null;
    createdAt: number; 
  }> = new Map();
  private executionPlans: Map<string, ExecutionPlan> = new Map();
  private executionStates: Map<string, ExecutionArrayState> = new Map();
  private executionArrays: Map<string, ExecutionArray> = new Map();

  private readonly SESSION_TTL_MS = 15 * 60 * 1000;
  
  // Event emitter for external observers (e.g., ScenarioEngine)
  private eventListeners: Set<DotBotEventListener> = new Set();
  
  // Structured logging
  private dotbotLogger: ReturnType<typeof createSubsystemLogger>;
  private rpcLogger: ReturnType<typeof createSubsystemLogger>;
  private chatLogger: ReturnType<typeof createSubsystemLogger>;
  
  private constructor(
    api: ApiPromise | null, 
    executionSystem: ExecutionSystem, 
    config: DotBotConfig,
    network: Network,
    environment: Environment,
    relayChainManager: RpcManager,
    assetHubManager: RpcManager,
    chatManager: ChatInstanceManager
  ) {
    // Initialize loggers
    this.dotbotLogger = createSubsystemLogger(Subsystem.DOTBOT);
    this.rpcLogger = createSubsystemLogger(Subsystem.RPC);
    this.chatLogger = createSubsystemLogger(Subsystem.CHAT);
    
    this.api = api;
    this.executionSystem = executionSystem;
    this.wallet = config.wallet;
    this.config = config;
    this.network = network;
    this.environment = environment;
    this.relayChainManager = relayChainManager;
    this.assetHubManager = assetHubManager;
    this.chatManager = chatManager;
    this.chatPersistenceEnabled = !config.disableChatPersistence;
    this.aiService = config.aiService;
    this._stateful = config.stateful !== false; // Default to true for backward compatibility
    // Default: backend simulation enabled in SESSION_SERVER_MODE, disabled in stateful mode (client does it)
    this._backendSimulation = config.backendSimulation ?? !this._stateful;
  }
  /** Current execution array state from chat (if any). */
  getExecutionArrayState(): ExecutionArrayState | null {
    return this.currentChat?.executionState || null;
  }
  
  /**
   * Get RPC endpoint health status
   */
  getRpcHealth() {
    return {
      relayChain: {
        current: this.relayChainManager.getCurrentEndpoint(),
        endpoints: this.relayChainManager.getHealthStatus()
      },
      assetHub: {
        current: this.assetHubManager.getCurrentEndpoint(),
        endpoints: this.assetHubManager.getHealthStatus()
      }
    };
  }

  /** Current connected relay and asset hub endpoints. */
  getConnectedEndpoints() {
    return {
      relayChain: this.relayChainManager.getCurrentEndpoint(),
      assetHub: this.assetHubManager.getCurrentEndpoint()
    };
  }

  /**
   * Check if simulation is enabled
   */
  isSimulationEnabled(): boolean {
    return isSimulationEnabled();
  }

  /** Enable transaction simulation. */
  enableSimulation(): void {
    enableSimulation();
    this.dotbotLogger.info({}, 'Simulation enabled');
  }

  /** Disable transaction simulation. */
  disableSimulation(): void {
    disableSimulation();
    this.dotbotLogger.info({}, 'Simulation disabled');
  }

  /** Current simulation configuration. */
  getSimulationConfig(): SimulationConfig {
    return getSimulationConfig();
  }

  /** Update simulation configuration. */
  updateSimulationConfig(updates: Partial<SimulationConfig>): void {
    updateSimulationConfig(updates);
  }
  
  /**
   * Create and initialize DotBot. Single entry point for setup.
   */
  static async create(config: DotBotConfig): Promise<DotBot> {
    const args = getCreateArgs(config);
    const dotbot = new DotBot(
      args.api,
      args.executionSystem,
      args.config,
      args.network,
      args.environment,
      args.relayChainManager,
      args.assetHubManager,
      args.chatManager
    );
    if (dotbot._stateful && !config.disableChatPersistence) {
      await dotbot.initializeChatInstance();
    }
    return dotbot;
  }

  private async initializeChatInstance(): Promise<void> {
    return initializeChatInstanceImpl(this);
  }

  /** Get conversation history (for LLM context). */
  getHistory(): ConversationMessage[] {
    return this.currentChat?.getHistory() || [];
  }

  /** All messages (full chat history). */
  getAllMessages(): ConversationItem[] {
    return this.currentChat?.messages || [];
  }
  
  /** Clear conversation history (starts new chat). */
  async clearHistory(): Promise<void> {
    return clearHistoryImpl(this);
  }

  /** Switch environment (creates new chat instance). */
  async switchEnvironment(environment: Environment, network?: Network): Promise<void> {
    return switchEnvironmentImpl(this, environment, network);
  }

  /** Current environment (mainnet/testnet). */
  getEnvironment(): Environment {
    return this.environment;
  }
  
  /**
   * Access chat manager directly (advanced usage)
   */
  getChatManager(): ChatInstanceManager {
    return this.chatManager;
  }
  
  /** Load a specific chat instance by ID; switches environment/network if needed. */
  async loadChatInstance(chatId: string): Promise<void> {
    return loadChatInstanceImpl(this, chatId);
  }

  /** Ensure RPC connections are ready (lazy loading). */
  private async ensureRpcConnectionsReady(): Promise<void> {
    return ensureRpcConnectionsReadyImpl(this);
  }

  /** Start execution (user clicked "Accept & Start"). Requires prepareExecution() already called. */
  async startExecution(executionId: string, options?: ExecutionOptions): Promise<void> {
    return startExecutionImpl(this, executionId, options);
  }

  private async startExecutionStateless(executionId: string, options?: ExecutionOptions): Promise<void> {
    return startExecutionStatelessImpl(this, executionId, options);
  }

  /** Chat: pass message, get text or ExecutionPlan. LLM decides response vs plan. */
  async chat(message: string, options?: ChatOptions): Promise<ChatResult> {
    this.dotbotLogger.info({ 
      messagePreview: message.substring(0, 100),
      hasCurrentChat: !!this.currentChat
    }, 'chat: Starting chat request');
    
    this.emit({ type: DotBotEventType.CHAT_STARTED, message });
    
    try {
      // Add user message to chat
      if (this.currentChat) {
        await this.currentChat.addUserMessage(message);
        this.emit({ type: DotBotEventType.USER_MESSAGE_ADDED, message, timestamp: Date.now() });
      }
      
      // Get LLM response (delegates to AIService via getLLMResponse -> callLLM)
      const llmResponse = await this.getLLMResponse(message, options);
      
      // Extract execution plan (uses extracted function from prompts/system/utils)
      const plan = extractExecutionPlan(llmResponse);
      
      if (plan) {
        this.dotbotLogger.info({ 
          planId: plan.id,
          stepsCount: plan.steps.length
        }, 'chat: ExecutionPlan extracted');
      }
      
      // Route response based on plan presence
      const result = (!plan || plan.steps.length === 0)
        ? await this.handleConversationResponse(llmResponse)
        : await this.handleExecutionResponse(llmResponse, plan, options);
      
      this.emit({ type: DotBotEventType.CHAT_COMPLETE, result });
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorObj = error instanceof Error ? error : new Error(errorMsg);
      
      this.dotbotLogger.error({ 
        error: errorMsg,
        stack: error instanceof Error ? error.stack : undefined
      }, 'chat: Error during chat request');
      
      const errorResult: ChatResult = {
        response: `I encountered an error while processing your request: ${errorMsg}`,
        executed: false,
        success: false,
        completed: 0,
        failed: 1,
      };
      
      // Save error message to chat if possible
      if (this.currentChat) {
        try {
          await this.currentChat.addBotMessage(errorResult.response);
        } catch (saveError) {
          this.dotbotLogger.warn({ 
            error: saveError instanceof Error ? saveError.message : String(saveError)
          }, 'chat: Failed to save error message to chat');
        }
      }
      
      this.emit({ type: DotBotEventType.CHAT_ERROR, error: errorObj });
      this.emit({ type: DotBotEventType.CHAT_COMPLETE, result: errorResult });
      
      return errorResult;
    }
  }
  
  /** Add event listener for DotBot events (e.g. ScenarioEngine). */
  addEventListener(listener: DotBotEventListener): void {
    this.eventListeners.add(listener);
  }

  /** Remove event listener. */
  removeEventListener(listener: DotBotEventListener): void {
    this.eventListeners.delete(listener);
  }

  /** Emit event to all listeners. Public so frontend can emit when managing its own state. */
  emit(event: DotBotEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        this.dotbotLogger.error({ 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        }, 'DotBot event listener error');
      }
    }
  }
  
  private async getLLMResponse(message: string, options?: ChatOptions): Promise<string> {
    return getLLMResponseImpl(this, message, options);
  }

  private async handleConversationResponse(llmResponse: string): Promise<ChatResult> {
    return handleConversationResponseImpl(this, llmResponse);
  }

  private async handleExecutionResponse(
    llmResponse: string,
    plan: ExecutionPlan,
    options?: ChatOptions
  ): Promise<ChatResult> {
    return handleExecutionResponseImpl(this, llmResponse, plan, options);
  }

  /** Prepare execution (orchestrate + add to chat). Does not auto-execute; waits for user approval. */
  private async prepareExecution(plan: ExecutionPlan, executionId?: string, skipSimulation = false): Promise<ExecutionArrayState | void> {
    return prepareExecutionImpl(this, plan, executionId, skipSimulation);
  }

  private async prepareExecutionStateless(
    plan: ExecutionPlan,
    executionId: string,
    skipSimulation: boolean
  ): Promise<ExecutionArrayState> {
    return prepareExecutionStatelessImpl(this, plan, executionId, skipSimulation);
  }

  /** Sessions for executionId (stateless; used when executing a previously prepared execution). */
  getExecutionSessions(executionId: string): { relayChain: ExecutionSession; assetHub: ExecutionSession | null } | null {
    return this.executionSessions.get(executionId) || null;
  }

  /** Execution state for executionId (stateless; for polling during preparation). */
  getExecutionState(executionId: string): ExecutionArrayState | null {
    return this.executionStates.get(executionId) || null;
  }

  /** ExecutionArray for executionId (stateless). Subscribe via ExecutionArray.onProgress(). */
  getExecutionArray(executionId: string): ExecutionArray | null {
    return this.executionArrays.get(executionId) || null;
  }
  
  /** Clean up sessions/plan/state for one executionId (stateless). */
  cleanupExecutionSessions(executionId: string): void {
    cleanupExecutionSessionsImpl(this, executionId);
  }

  /** Clean up expired execution sessions (call periodically). Returns count cleaned. */
  cleanupExpiredExecutions(): number {
    return cleanupExpiredExecutionsImpl(this);
  }

  /** Update execution message in chat and emit event for UI. */
  async updateExecutionMessage(
    messageId: string, 
    executionId: string,
    updates: Partial<any>
  ): Promise<void> {
    if (!this.currentChat) {
      throw new Error('No active chat session');
    }
    
    await this.currentChat.updateExecutionMessage(messageId, updates);
    
    // Emit event to notify UI
    this.emit({
      type: DotBotEventType.EXECUTION_MESSAGE_UPDATED,
      executionId,
      timestamp: Date.now()
    });
  }

  /** REMOVED: executeWithArrayTracking — use prepareExecution(plan) then startExecution(executionId). For CLI, use ExecutionSystem directly. */

  /** Relay + asset hub balance (free/reserved/frozen) and total free. */
  async getBalance(): Promise<{
    relayChain: { free: string; reserved: string; frozen: string };
    assetHub: { free: string; reserved: string; frozen: string } | null;
    total: string;
  }> {
    return getBalanceImpl(this);
  }

  /** Chain name and runtime version from relay. */
  async getChainInfo(): Promise<{ chain: string; version: string }> {
    return getChainInfoImpl(this);
  }

  /** Polkadot relay API (triggers lazy connect if not ready). */
  async getApi(): Promise<ApiPromise> {
    await this.ensureRpcConnectionsReady();
    return this.api!;
  }

  /** Asset Hub API if connected (null if not or failed). */
  getAssetHubApi(): ApiPromise | null {
    return this.assetHubApi;
  }

  /** @internal Set Asset Hub API during init. */
  _setAssetHubApi(api: ApiPromise | null): void {
    this.assetHubApi = api;
  }

  /** Current wallet account. */
  getWallet(): WalletAccount {
    return this.wallet;
  }
  
  /** Disconnect and cleanup. */
  async disconnect(): Promise<void> {
    if (this.api) {
      await this.api.disconnect();
    }
    if (this.assetHubApi) {
      await this.assetHubApi.disconnect();
    }
  }

  /** Current network (polkadot/kusama/westend). */
  getNetwork(): Network {
    return this.network;
  }
}