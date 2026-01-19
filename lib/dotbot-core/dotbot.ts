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
import { BrowserWalletSigner } from './executionEngine/signers/browserSigner';
import { buildSystemPrompt } from './prompts/system/loader';
import { ExecutionPlan } from './prompts/system/execution/types';
import { SigningRequest, BatchSigningRequest, ExecutionOptions } from './executionEngine/types';
import { WalletAccount } from './types/wallet';
import { processSystemQueries, areSystemQueriesEnabled } from './prompts/system/systemQuery';
import { RpcManager, createRpcManagersForNetwork, Network, ExecutionSession } from './rpcManager';
import { SimulationStatusCallback } from './agents/types';
import { detectNetworkFromChainName } from './prompts/system/knowledge';
import { ChatInstanceManager } from './chatInstanceManager';
import { ChatInstance } from './chatInstance';
import type { Environment, ConversationItem } from './types/chatInstance';
import { createSubsystemLogger, Subsystem } from './services/logger';
import {
  getSimulationConfig,
  updateSimulationConfig,
  enableSimulation,
  disableSimulation,
  isSimulationEnabled,
  type SimulationConfig,
} from './executionEngine/simulation/simulationConfig';

// Forward declaration to avoid circular dependency
type AIServiceType = import('./services/ai/aiService').AIService;

export interface DotBotConfig {
  /** Wallet account */
  wallet: WalletAccount;
  
  /** Network to connect to (defaults to 'polkadot') */
  network?: Network;
  
  /** Environment (defaults to 'mainnet') */
  environment?: Environment;
  
  /** AI Service for LLM communication (optional - if not provided, use custom LLM in chat options) */
  aiService?: AIServiceType;
  
  /** LLM API endpoint (for custom LLM - legacy) */
  llmEndpoint?: string;
  
  /** LLM API key (for custom LLM - legacy) */
  llmApiKey?: string;
  
  /** Signing request handler (REQUIRED for transactions) */
  onSigningRequest?: (request: SigningRequest) => void;
  
  /** Batch signing request handler */
  onBatchSigningRequest?: (request: BatchSigningRequest) => void;
  
  /** Simulation status callback for UI feedback */
  onSimulationStatus?: SimulationStatusCallback;
  
  /** Callback called when execution is ready (after orchestration, before simulation) */
  /** Use this to set up WebSocket broadcasting or other subscriptions before simulation starts */
  onExecutionReady?: (executionId: string, chat: ChatInstance) => void;
  
  /** Auto-approve transactions (NOT recommended for production!) */
  autoApprove?: boolean;
  
  /** Pre-initialized RPC managers (optional - for faster connection) */
  relayChainManager?: RpcManager;
  assetHubManager?: RpcManager;
  
  /** Custom chat instance manager (optional - for advanced usage) */
  chatManager?: ChatInstanceManager;
  
  /** Disable automatic chat persistence (defaults to false) */
  disableChatPersistence?: boolean;
  
  /** 
   * Stateful mode: If true (default), DotBot maintains chat instances and execution state.
   * If false (SESSION_SERVER_MODE), DotBot processes requests and returns state without maintaining it.
   * Use SESSION_SERVER_MODE for backend/API services where the client maintains state.
   * 
   * Default: true
   */
  stateful?: boolean;
  
  /**
   * Backend simulation: If true, backend runs transaction simulation before returning.
   * If false, client is expected to run simulation (only works in stateful mode).
   * 
   * Default: !stateful (backend simulates in SESSION_SERVER_MODE, client in stateful mode)
   * 
   * Performance: Backend simulation is typically 0.5-2s faster due to better RPC connectivity.
   * Client simulation works fine on decent connections.
   * 
   * Valid combinations:
   * - stateful: true, backendSimulation: false (default) → client simulates, has ExecutionArray
   * - stateful: false, backendSimulation: true (default) → SESSION_SERVER_MODE: server simulates, returns state
   * - stateful: true, backendSimulation: true → server simulates even in stateful mode
   * 
   * Invalid:
   * - stateful: false, backendSimulation: false → ERROR (client can't simulate without ExecutionArray)
   */
  backendSimulation?: boolean;
}

export interface ChatResult {
  /** LLM response text */
  response: string;
  
  /** Execution plan (if any) */
  plan?: ExecutionPlan;
  
  /** Execution array state (in SESSION_SERVER_MODE, this is returned instead of being stored) */
  executionArrayState?: ExecutionArrayState;
  
  /** Execution ID (for tracking execution in SESSION_SERVER_MODE) */
  executionId?: string;
  
  /** Whether operations were executed */
  executed: boolean;
  
  /** Execution success status */
  success: boolean;
  
  /** Number of operations completed */
  completed: number;
  
  /** Number of operations failed */
  failed: number;
  
  /** Whether backend simulation was run (if false, client should simulate) */
  backendSimulated?: boolean;
}

/**
 * DotBot event type enum for type safety and DRY principles
 */
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

/**
 * DotBot event types for external observers (e.g., ScenarioEngine)
 */
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

/**
 * Conversation message for maintaining chat history
 */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

export interface ChatOptions {
  /** Custom system prompt override */
  systemPrompt?: string;
  
  /** Execution options */
  executionOptions?: ExecutionOptions;
  
  /** Custom LLM function (bypass default) */
  llm?: (message: string, systemPrompt: string, context?: any) => Promise<string>;
  
  /** 
   * Conversation history for context
   * 
   * Pass previous messages so the LLM remembers the conversation.
   * The frontend should maintain this array and pass it with each message.
   * 
   * @example
   * ```typescript
   * const history: ConversationMessage[] = [];
   * 
   * // First message
   * const result1 = await dotbot.chat("Hello", { llm, conversationHistory: history });
   * history.push({ role: 'user', content: "Hello" });
   * history.push({ role: 'assistant', content: result1.response });
   * 
   * // Second message - LLM will remember the first
   * const result2 = await dotbot.chat("What did we talk about?", { llm, conversationHistory: history });
   * ```
   */
  conversationHistory?: ConversationMessage[];
}

/**
 * DotBot - Out of the Box Interface
 * 
 * Everything you need in one simple class.
 */
export class DotBot {
  private api: ApiPromise | null = null;
  private executionSystemInitialized: boolean = false;
  private assetHubApi: ApiPromise | null = null;
  private executionSystem: ExecutionSystem;
  private wallet: WalletAccount;
  private config: DotBotConfig;
  private network: Network;
  private environment: Environment;
  
  private relayChainManager: RpcManager;
  private assetHubManager: RpcManager;
  
  // AI Service for LLM communication (optional - can be used in any context, current frontend not using it)
  private aiService?: AIServiceType;
  
  // Chat instance management (built-in) - execution lives here!
  // NOTE: Execution sessions are now stored in ChatInstance, not here
  private chatManager: ChatInstanceManager;
  public currentChat: ChatInstance | null = null;
  private chatPersistenceEnabled: boolean;
  private _stateful: boolean;
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
  private executionArrays: Map<string, ExecutionArray> = new Map(); // Store ExecutionArray directly for WebSocket subscriptions
  
  // Session TTL: 15 minutes (900000ms) - after this time, sessions expire
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
  
  /**
   * REMOVED: onExecutionArrayUpdate
   * 
   * Replacement: Use dotbot.currentChat.onExecutionUpdate(executionId, callback)
   * This allows subscribing to specific execution flows by their ID.
   * 
   * Example:
   * ```typescript
   * const executionMessage = dotbot.currentChat.getDisplayMessages()
   *   .find(m => m.type === 'execution');
   * 
   * if (executionMessage?.type === 'execution') {
   *   const unsubscribe = dotbot.currentChat.onExecutionUpdate(
   *     executionMessage.executionId,
   *     (state) => console.log('Execution updated:', state)
   *   );
   * }
   * ```
   */
  
  /**
   * Get current execution array state
   */
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
  
  /**
   * Get current connected endpoints
   */
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

  /**
   * Enable transaction simulation
   */
  enableSimulation(): void {
    enableSimulation();
    this.dotbotLogger.info({}, 'Simulation enabled');
  }

  /**
   * Disable transaction simulation
   */
  disableSimulation(): void {
    disableSimulation();
    this.dotbotLogger.info({}, 'Simulation disabled');
  }

  /**
   * Get current simulation configuration
   */
  getSimulationConfig(): SimulationConfig {
    return getSimulationConfig();
  }

  /**
   * Update simulation configuration
   */
  updateSimulationConfig(updates: Partial<SimulationConfig>): void {
    updateSimulationConfig(updates);
  }
  
  /**
   * Create and initialize DotBot
   * 
   * This is the only setup you need!
   */
  static async create(config: DotBotConfig): Promise<DotBot> {
    // Validate required configuration
    if (!config.wallet) {
      throw new Error('Wallet is required. Please provide a wallet account in the config.');
    }
    
    // Determine network - use config.network or default to 'polkadot'
    const configuredNetwork = config.network || 'polkadot';
    
    // Determine environment - use config.environment or default to 'mainnet'
    const environment = config.environment || 'mainnet';
    
    // Use pre-initialized RPC managers if provided, otherwise create new ones for the specified network
    let relayChainManager: RpcManager;
    let assetHubManager: RpcManager;
    
    if (config.relayChainManager && config.assetHubManager) {
      // Use pre-initialized managers
      relayChainManager = config.relayChainManager;
      assetHubManager = config.assetHubManager;
    } else {
      // Create managers for the specified network
      const managers = createRpcManagersForNetwork(configuredNetwork);
      relayChainManager = managers.relayChainManager;
      assetHubManager = managers.assetHubManager;
    }
    
    const rpcLogger = createSubsystemLogger(Subsystem.RPC);
    // LAZY LOADING: Don't connect to RPC endpoints during initialization
    // Connections will be established when needed (e.g., in startExecution)
    rpcLogger.debug({ network: configuredNetwork }, 'DotBot.create: RPC connections will be lazy-loaded when needed');
    
    // Use configured network (will be validated when connections are established)
    const actualNetwork = configuredNetwork;
    
    const dotbotLogger = createSubsystemLogger(Subsystem.DOTBOT);
    dotbotLogger.info({ 
      network: actualNetwork,
      configuredNetwork: configuredNetwork,
      environment: environment
    }, `Network: ${actualNetwork} (configured: ${configuredNetwork}), Environment: ${environment}`);
    
    // Create signer
    const signer = new BrowserWalletSigner({ 
      autoApprove: config.autoApprove || false 
    });
    
    // Set up signing handlers
    if (config.onSigningRequest) {
      signer.setSigningRequestHandler(config.onSigningRequest);
    }
    if (config.onBatchSigningRequest) {
      signer.setBatchSigningRequestHandler(config.onBatchSigningRequest);
    }
    
    // Create execution system
    const executionSystem = new ExecutionSystem();
    
    // Create or use chat manager
    const chatManager = config.chatManager || new ChatInstanceManager();
    
    // Create DotBot without connecting to RPC - connections will be lazy-loaded when needed
    const dotbot = new DotBot(
      null, // API will be set lazily when RPC connections are established
      executionSystem, 
      config, 
      actualNetwork, 
      environment,
      relayChainManager, 
      assetHubManager,
      chatManager
    );
    
    // Initialize chat instance (load or create) - only in stateful mode
    if (dotbot._stateful && !config.disableChatPersistence) {
      await dotbot.initializeChatInstance();
    }
    
    // LAZY LOADING: Don't initialize execution system yet - will be done when RPC connections are ready
    // executionSystem.initialize() will be called in ensureRpcConnectionsReady()
    
    return dotbot;
  }
  
  private async initializeAssetHub(): Promise<void> {
    try {
      this.assetHubApi = await this.assetHubManager.getReadApi();
      const assetHubEndpoint = this.assetHubManager.getCurrentEndpoint();
      this.rpcLogger.info({ 
        endpoint: assetHubEndpoint,
        chain: 'asset-hub'
      }, `Asset Hub connected via: ${assetHubEndpoint}`);
    } catch (error) {
      this.rpcLogger.error({ 
        error: error instanceof Error ? error.message : String(error),
        endpoints: this.assetHubManager.getHealthStatus()
      }, 'Asset Hub connection failed on all endpoints');
      this.assetHubApi = null;
      throw error;
    }
  }
  
  /**
   * Initialize or load chat instance
   */
  private async initializeChatInstance(): Promise<void> {
    try {
      // Try to load existing instances for this environment and wallet
      const instances = await this.chatManager.queryInstances({
        environment: this.environment,
        walletAddress: this.wallet.address,
        archived: false,
      });

      if (instances.length > 0) {
        // Load the most recent instance as ChatInstance class
        this.currentChat = new ChatInstance(
          instances[0],
          this.chatManager,
          this.chatPersistenceEnabled
        );
        this.chatLogger.info({ 
          chatId: this.currentChat.id,
          action: 'loaded'
        }, 'Loaded chat');
      } else {
        // Create a new ChatInstance
        this.currentChat = await ChatInstance.create(
          {
            environment: this.environment,
            network: this.network,
            walletAddress: this.wallet.address,
            title: `Chat - ${this.network}`,
          },
          this.chatManager,
          this.chatPersistenceEnabled
        );
        this.chatLogger.info({ 
          chatId: this.currentChat.id,
          action: 'created',
          environment: this.environment,
          network: this.network
        }, `Created new chat: ${this.currentChat.id}`);
      }
      
      // Initialize execution sessions immediately when chat is created/loaded
      // This ensures RPC connections are ready before execution starts
      if (this.currentChat) {
        try {
          await this.currentChat.initializeExecutionSessions(
            this.relayChainManager,
            this.assetHubManager
          );
          this.chatLogger.debug({ 
            chatId: this.currentChat.id
          }, 'Execution sessions initialized for chat instance');
        } catch (error) {
          // Log but don't fail - sessions can be created later if needed
          this.chatLogger.warn({ 
            chatId: this.currentChat.id,
            error: error instanceof Error ? error.message : String(error)
          }, 'Failed to initialize execution sessions during chat creation (will retry during execution)');
        }
      }
    } catch (error) {
      this.chatLogger.error({ 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        environment: this.environment,
        network: this.network,
        walletAddress: this.wallet.address
      }, 'Failed to initialize chat instance');
      this.currentChat = null;
    }
  }
  
  /**
   * Get conversation history (for LLM context)
   */
  getHistory(): ConversationMessage[] {
    return this.currentChat?.getHistory() || [];
  }
  
  /**
   * Get all messages (full chat history)
   */
  getAllMessages(): ConversationItem[] {
    return this.currentChat?.messages || [];
  }
  
  /**
   * Clear conversation history (starts new chat)
   */
  async clearHistory(): Promise<void> {
    if (!this.chatPersistenceEnabled) {
      return;
    }
    
    // Create a new ChatInstance
    this.currentChat = await ChatInstance.create(
      {
        environment: this.environment,
        network: this.network,
        walletAddress: this.wallet.address,
        title: `Chat - ${this.network}`,
      },
      this.chatManager,
      this.chatPersistenceEnabled
    );
    
    // Initialize execution sessions immediately when new chat is created
    if (this.currentChat) {
      try {
        await this.currentChat.initializeExecutionSessions(
          this.relayChainManager,
          this.assetHubManager
        );
        this.chatLogger.debug({ 
          chatId: this.currentChat.id
        }, 'Execution sessions initialized for new chat after clearHistory');
      } catch (error) {
        // Log but don't fail - sessions can be created later if needed
        this.chatLogger.warn({ 
          chatId: this.currentChat.id,
          error: error instanceof Error ? error.message : String(error)
        }, 'Failed to initialize execution sessions after clearHistory (will retry during execution)');
      }
    }
    
    this.chatLogger.info({ chatId: this.currentChat.id }, 'Started new chat');
  }
  
  /**
   * Switch environment (creates new chat instance)
   */
  async switchEnvironment(environment: Environment, network?: Network): Promise<void> {
    const targetNetwork = network || (environment === 'mainnet' ? 'polkadot' : 'westend');
    
    // Validate network for environment
    const validation = this.chatManager.validateNetworkForEnvironment(targetNetwork, environment);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid network for environment');
    }
    
    // Clean up sessions from old chat before switching
    if (this.currentChat) {
      this.currentChat.cleanupExecutionSessions();
    }
    
    // Update internal state
    this.environment = environment;
    this.network = targetNetwork;
    
    // Create RPC managers for new network (lazy loading - connections will be established when needed)
    const managers = createRpcManagersForNetwork(targetNetwork);
    this.relayChainManager = managers.relayChainManager;
    this.assetHubManager = managers.assetHubManager;
    
    // LAZY LOADING: Don't connect to RPC endpoints immediately
    // Connections will be established when needed (e.g., in ensureRpcConnectionsReady)
    this.api = null;
    this.assetHubApi = null;
    this.executionSystemInitialized = false;
    this.rpcLogger.debug({ network: targetNetwork }, 'switchEnvironment: RPC managers created, connections will be lazy-loaded when needed');
    
    // Create new chat instance
    if (this.chatPersistenceEnabled) {
      this.currentChat = await ChatInstance.create(
        {
          environment: this.environment,
          network: this.network,
          walletAddress: this.wallet.address,
          title: `Chat - ${this.network}`,
        },
        this.chatManager,
        this.chatPersistenceEnabled
      );
      this.chatLogger.info({ 
        environment,
        network: targetNetwork,
        chatId: this.currentChat.id
      }, `Switched to ${environment} (${targetNetwork}), new chat`);
    }
  }
  
  /**
   * Get current environment
   */
  getEnvironment(): Environment {
    return this.environment;
  }
  
  /**
   * Access chat manager directly (advanced usage)
   */
  getChatManager(): ChatInstanceManager {
    return this.chatManager;
  }
  
  /**
   * Load a specific chat instance by ID
   * Switches environment/network if needed and restores the chat state
   * TODO Probably initializeChatInstance would be enough. Or redesigned.
   */
  async loadChatInstance(chatId: string): Promise<void> {
    const chatData = await this.chatManager.loadInstance(chatId);
    
    if (!chatData) {
      throw new Error(`Chat instance ${chatId} not found`);
    }
    
    // Clean up sessions from old chat before loading new one
    if (this.currentChat) {
      this.currentChat.cleanupExecutionSessions();
    }
    
    // Check if we need to switch environment or network
    const needsEnvironmentSwitch = chatData.environment !== this.environment;
    const needsNetworkSwitch = chatData.network !== this.network;
    
    if (needsEnvironmentSwitch || needsNetworkSwitch) {
      // Update internal state
      this.environment = chatData.environment;
      this.network = chatData.network;
      
      // Create RPC managers for new network (lazy loading - connections will be established when needed)
      const managers = createRpcManagersForNetwork(chatData.network);
      this.relayChainManager = managers.relayChainManager;
      this.assetHubManager = managers.assetHubManager;
      
      // LAZY LOADING: Don't connect to RPC endpoints immediately
      // Connections will be established when needed (e.g., in ensureRpcConnectionsReady)
      this.api = null;
      this.assetHubApi = null;
      this.executionSystemInitialized = false;
      this.rpcLogger.debug({ network: chatData.network }, 'loadChatInstance: RPC managers created for network switch, connections will be lazy-loaded when needed');
    }
    
    // Create ChatInstance from loaded data (same pattern as initializeChatInstance)
    this.currentChat = new ChatInstance(
      chatData,
      this.chatManager,
      this.chatPersistenceEnabled
    );
    
    // Initialize execution sessions immediately when chat is loaded
    // This ensures RPC connections are ready before execution starts
    try {
      await this.currentChat.initializeExecutionSessions(
        this.relayChainManager,
        this.assetHubManager
      );
      this.chatLogger.debug({ 
        chatId: this.currentChat.id
      }, 'Execution sessions initialized for loaded chat instance');
    } catch (error) {
      // Log but don't fail - sessions can be created later if needed
      this.chatLogger.warn({ 
        chatId: this.currentChat.id,
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to initialize execution sessions during chat load (will retry during execution)');
    }
    
    // LAZY LOADING: Don't connect to RPCs or rebuild ExecutionArrays when loading history
    // RPCs will connect when execution actually starts (in startExecution or prepareExecution)
    // ExecutionArrays will be rebuilt lazily when needed (when user interacts with execution)
    this.chatLogger.info({ 
      chatId: this.currentChat.id,
      messageCount: this.currentChat.getDisplayMessages().length,
      executionCount: this.currentChat.getDisplayMessages().filter(m => m.type === 'execution').length
    }, 'Loaded chat instance (RPCs will connect lazily when execution starts)');
    
    // Emit event to notify UI that chat was loaded (triggers refresh)
    this.emit({
      type: DotBotEventType.CHAT_LOADED,
      chatId: this.currentChat.id,
      messageCount: this.currentChat.getDisplayMessages().length
    });
  }
  
  /**
   * Ensure RPC connections are ready (lazy loading)
   * Connects to RPC endpoints if not already connected
   * Initializes execution system if not already initialized
   */
  private async ensureRpcConnectionsReady(): Promise<void> {
    // If already initialized, nothing to do
    if (this.executionSystemInitialized && this.api) {
      return;
    }
    
    this.rpcLogger.debug({ network: this.network }, 'ensureRpcConnectionsReady: Connecting to RPC endpoints (lazy loading)');
    
    // Connect to Relay Chain
    if (!this.api) {
      this.api = await this.relayChainManager.getReadApi();
      const relayChainEndpoint = this.relayChainManager.getCurrentEndpoint();
      this.rpcLogger.info({ 
        endpoint: relayChainEndpoint,
        chain: 'relay'
      }, `Connected to Relay Chain via: ${relayChainEndpoint}`);
      
      // Detect actual network from chain name
      try {
        const chainInfo = await this.api.rpc.system.chain();
        const detectedNetwork = detectNetworkFromChainName(chainInfo.toString());
        if (detectedNetwork !== this.network) {
          this.rpcLogger.warn({ 
            detected: detectedNetwork,
            configured: this.network
          }, 'Network mismatch detected');
        }
      } catch {
        // Skip network detection if it fails
      }
    }
    
    // Connect to Asset Hub (optional)
    let assetHubApi: ApiPromise | null = null;
    if (!this.assetHubApi) {
      try {
        assetHubApi = await this.assetHubManager.getReadApi();
        const assetHubEndpoint = this.assetHubManager.getCurrentEndpoint();
        this.rpcLogger.info({ 
          endpoint: assetHubEndpoint,
          chain: 'asset-hub'
        }, `Connected to Asset Hub via: ${assetHubEndpoint}`);
        this._setAssetHubApi(assetHubApi);
      } catch (error) {
        this.rpcLogger.warn({ 
          error: error instanceof Error ? error.message : String(error)
        }, 'Asset Hub connection failed, will retry when needed');
      }
    } else {
      assetHubApi = this.assetHubApi;
    }
    
    // Initialize execution system if not already initialized
    if (!this.executionSystemInitialized) {
      const signer = new BrowserWalletSigner({ 
        autoApprove: this.config.autoApprove || false 
      });
      
      // Set up signing handlers
      if (this.config.onSigningRequest) {
        signer.setSigningRequestHandler(this.config.onSigningRequest);
      }
      if (this.config.onBatchSigningRequest) {
        signer.setBatchSigningRequestHandler(this.config.onBatchSigningRequest);
      }
      
      this.executionSystem.initialize(
        this.api!,
        this.wallet,
        signer,
        assetHubApi,
        this.relayChainManager,
        this.assetHubManager,
        this.config.onSimulationStatus
      );
      
      this.executionSystemInitialized = true;
      this.rpcLogger.debug({}, 'Execution system initialized (lazy loading)');
    }
  }
  
  /**
   * Start execution of a specific execution array
   * 
   * This is called when user clicks "Accept & Start" in the UI.
   * Requires that prepareExecution() was already called (happens automatically after LLM response).
   * 
   * For interrupted flows (pending, ready, executing, etc.), rebuilds from ExecutionPlan
   * to get fresh extrinsics with working methods, then restores state to resume from where it left off.
   * 
   * @param executionId The unique ID of the execution to start (from ExecutionMessage.executionId)
   * @param options Execution options (autoApprove, etc.)
   */
  async startExecution(executionId: string, options?: ExecutionOptions): Promise<void> {
    // GUARD: Ensure RPC connections are ready before execution (lazy loading)
    await this.ensureRpcConnectionsReady();
    
    // Handle SESSION_SERVER_MODE
    if (!this._stateful) {
      // Handle SESSION_SERVER_MODE
      return this.startExecutionStateless(executionId, options);
    }
    
    // Stateful mode - requires currentChat
    if (!this.currentChat) {
      throw new Error('No active chat. Cannot start execution.');
    }
    
    let executionArray = this.currentChat.getExecutionArray(executionId);
    const needsRebuild = !executionArray || (executionArray.isInterrupted() && this.currentChat);
    
    // If not found or interrupted, try to rebuild from ExecutionPlan
    if (needsRebuild) {
      const executionMessage = this.currentChat.getDisplayMessages()
        .find(m => m.type === 'execution' && (m as any).executionId === executionId) as any;
      
      let plan = executionMessage?.executionPlan;
      
      // Fallback: Try to extract plan from state if missing (e.g., created from WebSocket without plan)
      if (!plan && executionMessage?.executionArray) {
        this.dotbotLogger.debug({ executionId }, 'ExecutionPlan missing, attempting to extract from state');
        // Use internal method via type assertion (extractExecutionPlanFromState is private)
        const extractedPlan = (this.currentChat as any).extractExecutionPlanFromState(executionMessage.executionArray);
        if (extractedPlan) {
          plan = extractedPlan;
          // Save extracted plan to execution message for future use
          await this.currentChat.updateExecutionMessage(executionMessage.id, { executionPlan: plan });
          this.dotbotLogger.info({ executionId }, 'Extracted and saved ExecutionPlan from state');
        }
      }
      
      if (plan) {
        // Rebuild requires new sessions
        // CRITICAL: Pass the original executionId to preserve the ExecutionMessage and prevent duplicates
        // CRITICAL: Skip simulation to prevent double simulation (simulation already ran during initial prepareExecution)
        await this.prepareExecution(plan, executionId, true);
        executionArray = this.currentChat.getExecutionArray(executionId);
        if (!executionArray) {
          throw new Error('Failed to rebuild execution array');
        }
      } else if (!executionArray) {
        throw new Error(`Execution ${executionId} not found. It may not have been prepared yet.`);
      }
      // If executionArray exists but is interrupted and no ExecutionPlan, continue with broken extrinsics
      // (will fail, but that's expected for old flows without ExecutionPlan)
    } else {
      // Only validate sessions if we're NOT rebuilding (using existing executionArray)
      // If we rebuild, prepareExecution will create new sessions
      // Validate sessions are still connected (important with lazy-loaded RPC connections)
      if (!(await this.currentChat.validateExecutionSessions())) {
        this.dotbotLogger.warn({ executionId }, 'Execution sessions expired or disconnected, recreating...');
        // Try to recreate sessions
        try {
          await this.currentChat.initializeExecutionSessions(
            this.relayChainManager,
            this.assetHubManager
          );
          // Validate again after recreation
          if (!(await this.currentChat.validateExecutionSessions())) {
            throw new Error('Failed to recreate execution sessions. Please try again or check your network connection.');
          }
        } catch (recreateError) {
          const errorMsg = recreateError instanceof Error ? recreateError.message : 'Unknown error';
          throw new Error(`Execution session expired and could not be recreated: ${errorMsg}. Please prepare the execution again.`);
        }
      }
    }
    
    // Ensure executionArray is defined before executing
    if (!executionArray) {
      throw new Error(`Execution ${executionId} not found after preparation.`);
    }
    
    const executioner = this.executionSystem.getExecutioner();
    await executioner.execute(executionArray, options);
  }
  
  /**
   * Start execution in SESSION_SERVER_MODE
   * Rebuilds ExecutionArray from stored plan and sessions, then executes
   */
  private async startExecutionStateless(executionId: string, options?: ExecutionOptions): Promise<void> {
    // Get stored sessions and plan
    const sessions = this.executionSessions.get(executionId);
    const plan = this.executionPlans.get(executionId);
    
    if (!sessions || !plan) {
      throw new Error(`Execution ${executionId} not found. It may have expired or not been prepared yet.`);
    }
    
    // Check TTL expiration
    const age = Date.now() - sessions.createdAt;
    if (age > this.SESSION_TTL_MS) {
      this.cleanupExecutionSessions(executionId);
      throw new Error(`Execution ${executionId} has expired (${Math.round(age / 60000)} minutes old). Maximum session lifetime is ${this.SESSION_TTL_MS / 60000} minutes. Please prepare the execution again.`);
    }
    
    // Validate sessions are still active
    const relayChainValid = await this.validateExecutionSession(sessions.relayChain);
    const assetHubValid = !sessions.assetHub || await this.validateExecutionSession(sessions.assetHub);
    
    if (!relayChainValid || !assetHubValid) {
      this.cleanupExecutionSessions(executionId);
      throw new Error(`Execution ${executionId} has expired. Sessions are no longer valid. Please prepare the execution again.`);
    }
    
    this.dotbotLogger.info({ executionId }, 'startExecutionStateless: Rebuilding ExecutionArray from plan');
    
    // Rebuild ExecutionArray from plan using stored sessions
    // Skip simulation since it already ran during prepareExecution
    const executionArray = await this.executionSystem.orchestrateExecutionArray(
      plan,
      sessions.relayChain,
      sessions.assetHub,
      executionId
    );
    
    this.dotbotLogger.info({ 
      executionId,
      itemsCount: executionArray.getItems().length
    }, 'startExecutionStateless: ExecutionArray rebuilt, starting execution');
    
    // Execute using the executioner
    const executioner = this.executionSystem.getExecutioner();
    await executioner.execute(executionArray, options);
    
    // Clean up after execution completes
    this.cleanupExecutionSessions(executionId);
  }
  
  /**
   * Chat with DotBot - Natural language to blockchain operations
   * 
   * This is the main method. Pass a message, get results.
   * 
   * The LLM will intelligently decide whether to:
   * 1. Respond with helpful text (for questions, clarifications, errors)
   * 2. Generate an ExecutionPlan (for clear blockchain commands)
   * 
   * @example
   * ```typescript
   * // Question - gets text response
   * const result1 = await dotbot.chat("What is staking?");
   * 
   * // Command - gets ExecutionPlan + execution
   * const result2 = await dotbot.chat("Send 2 DOT to Bob");
   * ```
   */
  async chat(message: string, options?: ChatOptions): Promise<ChatResult> {
    this.dotbotLogger.info({ 
      messagePreview: message.substring(0, 100),
      messageLength: message.length,
      hasCurrentChat: !!this.currentChat,
      chatId: this.currentChat?.id || null
    }, 'chat: Starting chat request');
    
    // Emit chat started event
    this.emit({ type: DotBotEventType.CHAT_STARTED, message });
    
    try {
      // Save user message
      if (this.currentChat) {
        await this.currentChat.addUserMessage(message);
        this.emit({ type: DotBotEventType.USER_MESSAGE_ADDED, message, timestamp: Date.now() });
      }
      
      // Get LLM response
      this.dotbotLogger.debug({ 
        messagePreview: message.substring(0, 100)
      }, 'chat: Getting LLM response');
      const llmResponse = await this.getLLMResponse(message, options);
      
      this.dotbotLogger.debug({ 
        responseLength: llmResponse.length,
        responsePreview: llmResponse.substring(0, 200)
      }, 'chat: LLM response received');
      
      // Extract execution plan
      const plan = this.extractExecutionPlan(llmResponse);
      
      this.dotbotLogger.info({ 
        hasPlan: !!plan,
        planId: plan?.id || null,
        stepsCount: plan?.steps.length || 0,
        originalRequest: plan?.originalRequest || null
      }, 'chat: Execution plan extraction result');
      
      let result: ChatResult;
      
      // No execution needed - just a conversation
      if (!plan || plan.steps.length === 0) {
        this.dotbotLogger.info({ 
          responseLength: llmResponse.length
        }, 'chat: Handling as conversation (no execution plan)');
        result = await this.handleConversationResponse(llmResponse);
      } else {
        // Execute blockchain operations
        this.dotbotLogger.info({ 
          planId: plan.id,
          stepsCount: plan.steps.length
        }, 'chat: Handling as execution (plan found)');
        result = await this.handleExecutionResponse(llmResponse, plan, options);
      }
      
      this.dotbotLogger.info({ 
        executed: result.executed,
        success: result.success,
        completed: result.completed,
        failed: result.failed,
        hasPlan: !!result.plan,
        responseLength: result.response.length
      }, 'chat: Chat request completed');
      
      // Emit chat complete event
      this.emit({ type: DotBotEventType.CHAT_COMPLETE, result });
      
      return result;
    } catch (error) {
      // Always emit chat-error or chat-complete, even on failures
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorObj = error instanceof Error ? error : new Error(errorMsg);
      
      this.dotbotLogger.error({ 
        error: errorMsg,
        stack: error instanceof Error ? error.stack : undefined
      }, 'chat: Error during chat request');
      
      // Create error result
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
          // If saving fails, log but continue
          this.dotbotLogger.warn({ 
            error: saveError instanceof Error ? saveError.message : String(saveError)
          }, 'chat: Failed to save error message to chat');
        }
      }
      
      // Emit error event
      this.emit({ type: DotBotEventType.CHAT_ERROR, error: errorObj });
      
      // Also emit chat-complete with error result to ensure ScenarioExecutor doesn't hang
      // This is a fallback - chat-error should be sufficient, but this ensures compatibility
      this.emit({ type: DotBotEventType.CHAT_COMPLETE, result: errorResult });
      
      return errorResult;
    }
  }
  
  /**
   * Add event listener for DotBot events
   * Used by ScenarioEngine and other observers to track all DotBot activity
   */
  addEventListener(listener: DotBotEventListener): void {
    this.eventListeners.add(listener);
  }
  
  /**
   * Remove event listener
   */
  removeEventListener(listener: DotBotEventListener): void {
    this.eventListeners.delete(listener);
  }
  
  /**
   * Emit event to all listeners
   * Public so frontend can emit events when managing its own state
   */
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
  
  /**
   * Get LLM response (extracted method)
   */
  private async getLLMResponse(message: string, options?: ChatOptions): Promise<string> {
    const systemPrompt = options?.systemPrompt || await this.buildContextualSystemPrompt();
    const conversationHistory = options?.conversationHistory || this.getHistory();
    
    let llmResponse = await this.callLLM(message, systemPrompt, options?.llm, conversationHistory);
    
    // Process system queries if enabled (future feature)
    if (areSystemQueriesEnabled() && options?.llm) {
      llmResponse = await processSystemQueries(
        llmResponse,
        systemPrompt,
        message,
        async (msg, prompt) => this.callLLM(msg, prompt, options.llm, conversationHistory)
      );
    }
    
    return llmResponse;
  }
  
  /**
   * Handle conversation response (no execution)
   */
  private async handleConversationResponse(llmResponse: string): Promise<ChatResult> {
    // Clear any previous execution
    if (this.currentChat) {
      this.currentChat.setExecution(null);
    }
      
      const cleanedResponse = llmResponse
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      
    // Save bot response
    if (this.currentChat) {
      await this.currentChat.addBotMessage(cleanedResponse);
      this.emit({ type: DotBotEventType.BOT_MESSAGE_ADDED, message: cleanedResponse, timestamp: Date.now() });
      
      // Auto-generate title if needed
      if (!this.currentChat.title || this.currentChat.title.startsWith('Chat -')) {
        await this.currentChat.autoGenerateTitle();
      }
    }
    
      return {
        response: cleanedResponse,
        executed: false,
        success: true,
        completed: 0,
        failed: 0
      };
    }
    
  /**
   * Handle execution response (blockchain operations)
   */
  private async handleExecutionResponse(
    llmResponse: string,
    plan: ExecutionPlan,
    options?: ChatOptions
  ): Promise<ChatResult> {
    this.dotbotLogger.info({ 
      planId: plan.id,
      stepsCount: plan.steps.length,
      originalRequest: plan.originalRequest
    }, 'Handling execution response - preparing execution');
    
    // Prepare execution (orchestrate + add to chat)
    // Do NOT auto-execute - wait for user approval in UI!
    let executionArrayState: ExecutionArrayState | undefined;
    let executionId: string | undefined;
    
    try {
      // If backend simulation is disabled, skip orchestration - frontend will handle it
      if (!this._stateful && !this._backendSimulation) {
        // SESSION_SERVER_MODE with frontend simulation: Just generate executionId and return plan
        executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.dotbotLogger.info({ 
          planId: plan.id,
          executionId,
          stepsCount: plan.steps.length
        }, 'Skipping backend orchestration - frontend will handle orchestration and simulation');
      } else {
        // Normal flow: orchestrate (and optionally simulate) on backend
        const result = await this.prepareExecution(plan);
        if (result) {
          // SESSION_SERVER_MODE - result is ExecutionArrayState
          executionArrayState = result;
          executionId = executionArrayState.id;
          this.dotbotLogger.info({ 
            planId: plan.id,
            stepsCount: plan.steps.length,
            executionId: executionArrayState.id
          }, 'Execution preparation completed successfully (SESSION_SERVER_MODE)');
        } else {
          // Stateful mode - execution was added to chat
          // Extract executionId from the execution message
          if (this.currentChat) {
            const messages = this.currentChat.getDisplayMessages();
            const execMsg = messages.find(
              m => m.type === 'execution' && (m as any).executionPlan?.id === plan.id
            ) as any;
            executionId = execMsg?.executionId;
          }
          this.dotbotLogger.info({ 
            planId: plan.id,
            stepsCount: plan.steps.length,
            executionId
          }, 'Execution preparation completed successfully (stateful mode)');
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.dotbotLogger.error({ 
        error: errorMsg,
        stack: error instanceof Error ? error.stack : undefined,
        planId: plan.id,
        originalRequest: plan.originalRequest,
        stepsCount: plan.steps.length
      }, 'Execution preparation failed');
      
      // Clean up any partial execution message that might have been added
      if (this.currentChat) {
        // Find and remove any execution messages for this plan
        const messages = this.currentChat.getDisplayMessages();
        const executionMessages = messages.filter(
          m => m.type === 'execution' && (m as any).executionPlan?.id === plan.id
        );
        for (const execMsg of executionMessages) {
          // Note: We can't easily remove messages, but we can mark them as failed
          // The UI should handle this gracefully
        }
      }
      
      // Let the LLM generate a helpful error response
      // This ensures context-aware, user-friendly error messages
      const errorContextMessage = `I tried to prepare the transaction you requested ("${plan.originalRequest || 'your request'}"), but it failed with this error:\n\n${errorMsg}\n\nPlease provide a helpful, user-friendly explanation of what went wrong and what the user can do to fix it. Be specific about the issue (e.g., if it's insufficient balance, mention their current balance from context and what's needed). Respond with helpful TEXT only - do NOT generate another ExecutionPlan. IMPORTANT: Do NOT say you prepared anything - the preparation failed.`;
      
      // Get LLM response for the error
      const errorResponse = await this.getLLMResponse(errorContextMessage, options);
      
      // Emit error event
      this.emit({ type: DotBotEventType.CHAT_ERROR, error: error instanceof Error ? error : new Error(errorMsg) });
      
      // Save error message to chat
      if (this.currentChat) {
        await this.currentChat.addBotMessage(errorResponse);
      }
      
      // Return error response - do NOT include the plan to avoid confusion
      return {
        response: errorResponse,
        plan: undefined, // Don't include plan on error - it failed to prepare
        executed: false,
        success: false,
        completed: 0,
        failed: 1,
      };
    }
    
    // Generate friendly message (pre-execution)
    // Include the original request so the LLM can recognize it in conversation history
    const originalRequestText = plan.originalRequest ? ` for: "${plan.originalRequest}"` : '';
    const friendlyMessage = `I've prepared a transaction flow with ${plan.steps.length} step${plan.steps.length !== 1 ? 's' : ''}${originalRequestText}. Review the details below and click "Accept and Start" when ready.`;
    
    this.dotbotLogger.info({ 
      planId: plan.id,
      stepsCount: plan.steps.length,
      message: friendlyMessage
    }, 'Execution prepared - adding friendly message to chat');
    
    // Save bot message
    if (this.currentChat) {
      await this.currentChat.addBotMessage(friendlyMessage);
      
      // Auto-generate title if needed
      if (!this.currentChat.title || this.currentChat.title.startsWith('Chat -')) {
        await this.currentChat.autoGenerateTitle();
      }
    }
    
    // Return immediately - execution happens when user clicks "Accept & Start"
    return {
      response: friendlyMessage,
      plan,
      executionArrayState, // Included in SESSION_SERVER_MODE (when backend orchestrates)
      executionId: executionId || executionArrayState?.id, // Always include executionId
      executed: false,  // Not executed yet!
      success: true,
      completed: 0,
      failed: 0
    };
  }
  
  /**
   * Prepare execution (orchestrate + add to chat)
   * Does NOT auto-execute - waits for user approval
   * 
   * CRITICAL: Creates execution sessions to lock API instances for the transaction lifecycle.
   * This prevents metadata mismatches if RPC endpoints fail during execution.
   * 
   * IMPORTANT: 
   * - In stateful mode: Adds ExecutionMessage to chat IMMEDIATELY (before orchestration) so the UI
   *   can show "Preparing..." state, then orchestrates and updates the message with the executionArray.
   * - In SESSION_SERVER_MODE: Creates sessions, orchestrates, simulates, and returns ExecutionArrayState
   *   (sessions are stored temporarily for later execution)
   * 
   * @param plan ExecutionPlan from LLM
   * @param executionId Optional execution ID to preserve when rebuilding (prevents duplicate ExecutionMessages)
   * @param skipSimulation If true, skip simulation (used when rebuilding to prevent double simulation)
   * @returns ExecutionArrayState in SESSION_SERVER_MODE, void in stateful mode
   */
  private async prepareExecution(plan: ExecutionPlan, executionId?: string, skipSimulation: boolean = false): Promise<ExecutionArrayState | void> {
    // Step 0: Ensure RPC connections are ready (including Asset Hub) before preparing execution
    // LAZY LOADING: Only connect when execution is actually being prepared (not when loading history)
    await this.ensureRpcConnectionsReady();
    
    // Step 1: Generate executionId if not provided
    const finalExecutionId = executionId || `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.dotbotLogger.info({ 
      executionId: finalExecutionId,
      planId: plan.id,
      stepsCount: plan.steps.length,
      originalRequest: plan.originalRequest,
      stateful: this._stateful
    }, 'prepareExecution: Starting execution preparation');
    
    // Handle SESSION_SERVER_MODE
    if (!this._stateful) {
      return this.prepareExecutionStateless(plan, finalExecutionId, skipSimulation);
    }
    
    // Stateful mode - requires currentChat
    if (!this.currentChat) {
      this.dotbotLogger.error({ 
        planId: plan.id 
      }, 'prepareExecution failed: No active chat');
      throw new Error('No active chat. Cannot prepare execution.');
    }
    
    try {
      // GUARD: Ensure RPC connections are ready before preparing execution (lazy loading)
      await this.ensureRpcConnectionsReady();
      
      // Step 1: Initialize execution sessions for this chat (if not already initialized)
      this.dotbotLogger.debug({ 
        executionId: finalExecutionId 
      }, 'prepareExecution: Initializing execution sessions');
      await this.currentChat.initializeExecutionSessions(
        this.relayChainManager,
        this.assetHubManager
      );
      
      // Get sessions from chat
      const sessions = this.currentChat.getExecutionSessions();
      if (!sessions.relayChain) {
        this.dotbotLogger.error({ 
          executionId: finalExecutionId,
          hasRelayChain: !!sessions.relayChain,
          hasAssetHub: !!sessions.assetHub
        }, 'prepareExecution failed: Failed to create execution sessions');
        throw new Error('Failed to create execution sessions');
      }
      
      this.dotbotLogger.debug({ 
        executionId: finalExecutionId,
        relayChainEndpoint: sessions.relayChain?.endpoint,
        assetHubEndpoint: sessions.assetHub?.endpoint
      }, 'prepareExecution: Execution sessions initialized');
      
      // Step 2: Add ExecutionMessage to chat IMMEDIATELY (before orchestration)
      // This allows the UI to show "Preparing transaction flow..." state
      this.dotbotLogger.debug({ 
        executionId: finalExecutionId 
      }, 'prepareExecution: Adding execution message to chat');
      await this.addExecutionMessageEarly(finalExecutionId, plan);
      
      // Step 3: Orchestrate plan (creates ExecutionArray with items)
      this.dotbotLogger.info({ 
        executionId: finalExecutionId,
        stepsCount: plan.steps.length
      }, 'prepareExecution: Orchestrating execution plan');
      const executionArray = await this.executionSystem.orchestrateExecutionArray(
        plan,
        sessions.relayChain,
        sessions.assetHub,
        finalExecutionId
      );
      
      this.dotbotLogger.info({ 
        executionId: finalExecutionId,
        itemsCount: executionArray.getItems().length
      }, 'prepareExecution: Orchestration completed');
      
      // Step 4: Update ExecutionMessage with the executionArray (items visible, no simulation yet)
      // This allows UI to show items in "pending" state before simulation starts
      this.dotbotLogger.debug({ 
        executionId: finalExecutionId 
      }, 'prepareExecution: Updating execution in chat');
      await this.updateExecutionInChat(executionArray, plan);
      
      // Step 5: Run simulation if enabled and not skipped (updates will flow through subscription)
      // Skip simulation when rebuilding (e.g., from startExecution) to prevent double simulation
      if (!skipSimulation) {
        // CRITICAL: Give UI a moment to render items before starting simulation
        // This ensures users see: 1) Items appear, 2) Simulation starts, 3) Simulation completes
        await new Promise(resolve => setTimeout(resolve, 100));
        
        this.dotbotLogger.info({ 
          executionId: finalExecutionId 
        }, 'prepareExecution: Starting simulation');
        await this.executionSystem.runSimulation(
          executionArray,
          this.wallet.address,
          sessions.relayChain,
          sessions.assetHub,
          this.relayChainManager,
          this.assetHubManager,
          this.config?.onSimulationStatus
        );
        this.dotbotLogger.info({ 
          executionId: finalExecutionId 
        }, 'prepareExecution: Simulation completed');
      } else {
        this.dotbotLogger.debug({ 
          executionId: finalExecutionId 
        }, 'prepareExecution: Skipping simulation (rebuild mode)');
      }
      
      this.dotbotLogger.info({ 
        executionId: finalExecutionId,
        planId: plan.id,
        itemsCount: executionArray.getItems().length
      }, 'prepareExecution: Execution preparation completed successfully');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.dotbotLogger.error({ 
        error: errorMsg,
        stack: error instanceof Error ? error.stack : undefined,
        executionId: executionId || 'unknown',
        planId: plan.id,
        originalRequest: plan.originalRequest
      }, 'prepareExecution: Error during preparation');
      
      // Clean up sessions on error
      if (this.currentChat) {
        this.currentChat.cleanupExecutionSessions();
      }
      throw error;
    }
  }
  
  /**
   * Prepare execution in stateless mode (no chat instance)
   * Creates sessions, orchestrates, simulates, and returns state
   */
  private async prepareExecutionStateless(
    plan: ExecutionPlan,
    executionId: string,
    skipSimulation: boolean
  ): Promise<ExecutionArrayState> {
    try {
      // Step 1: Create execution sessions (stored temporarily for later execution)
      this.dotbotLogger.debug({ 
        executionId 
      }, 'prepareExecutionStateless: Creating execution sessions');
      
      const relayChainSession = await this.relayChainManager.createExecutionSession();
      let assetHubSession: ExecutionSession | null = null;
      try {
        assetHubSession = await this.assetHubManager.createExecutionSession();
      } catch (error) {
        // Asset Hub session creation failed - this is expected in some cases
        this.dotbotLogger.debug({ executionId }, 'Asset Hub session creation failed (expected in some cases)');
      }
      
      // Store sessions and plan for later execution (with TTL)
      this.executionSessions.set(executionId, {
        relayChain: relayChainSession,
        assetHub: assetHubSession,
        createdAt: Date.now()
      });
      this.executionPlans.set(executionId, plan);
      
      this.dotbotLogger.debug({ 
        executionId,
        relayChainEndpoint: relayChainSession.endpoint,
        assetHubEndpoint: assetHubSession?.endpoint
      }, 'prepareExecutionStateless: Execution sessions created and stored');
      
      // Step 2: Orchestrate plan (creates ExecutionArray with items)
      this.dotbotLogger.info({ 
        executionId,
        stepsCount: plan.steps.length
      }, 'prepareExecutionStateless: Orchestrating execution plan');
      const executionArray = await this.executionSystem.orchestrateExecutionArray(
        plan,
        relayChainSession,
        assetHubSession,
        executionId
      );
      
      // Store ExecutionArray directly (no ChatInstance needed for SESSION_SERVER_MODE)
      this.executionArrays.set(executionId, executionArray);
      
      // Store initial state (after orchestration, before simulation)
      this.executionStates.set(executionId, executionArray.getState());
      
      this.dotbotLogger.info({ 
        executionId,
        itemsCount: executionArray.getItems().length
      }, 'prepareExecutionStateless: Orchestration completed');
      
      // Call onExecutionReady callback if provided (allows setting up WebSocket broadcasting before simulation)
      // Pass ExecutionArray directly instead of ChatInstance
      if (this.config?.onExecutionReady) {
        try {
          // Create a minimal chat-like object for backward compatibility, or pass ExecutionArray directly
          // For now, we'll call it with currentChat if it exists, otherwise skip
          // TODO: Refactor onExecutionReady to accept ExecutionArray directly
          if (this.currentChat) {
            this.config.onExecutionReady(executionId, this.currentChat);
            this.dotbotLogger.debug({ 
              executionId 
            }, 'prepareExecutionStateless: onExecutionReady callback executed');
          }
        } catch (error) {
          this.dotbotLogger.error({ 
            executionId,
            error: error instanceof Error ? error.message : String(error)
          }, 'prepareExecutionStateless: Error in onExecutionReady callback');
        }
      }
      
      // Subscribe to progress updates to keep state current (for polling and WebSocket)
      const unsubscribeProgress = executionArray.onProgress(() => {
        const currentState = executionArray.getState();
        this.executionStates.set(executionId, currentState);
      });
      
      // Step 3: Run simulation if enabled and not skipped
      if (!skipSimulation && this._backendSimulation) {
        this.dotbotLogger.info({ 
          executionId 
        }, 'prepareExecutionStateless: Starting backend simulation');
        await this.executionSystem.runSimulation(
          executionArray,
          this.wallet.address,
          relayChainSession,
          assetHubSession,
          this.relayChainManager,
          this.assetHubManager,
          this.config?.onSimulationStatus
        );
        this.dotbotLogger.info({ 
          executionId 
        }, 'prepareExecutionStateless: Backend simulation completed');
      } else {
        this.dotbotLogger.debug({ 
          executionId 
        }, 'prepareExecutionStateless: Simulation skipped');
      }
      
      // Unsubscribe from progress updates (preparation complete)
      unsubscribeProgress();
      
      // Step 4: Return the final state (frontend will add it to its chat instance)
      const state = executionArray.getState();
      // Update stored state one final time
      this.executionStates.set(executionId, state);
      this.dotbotLogger.info({ 
        executionId,
        planId: plan.id,
        itemsCount: state.items.length
      }, 'prepareExecutionStateless: Execution preparation completed successfully');
      
      return state;
    } catch (error) {
      // Clean up sessions, plan, state, and ExecutionArray on error
      this.executionSessions.delete(executionId);
      this.executionPlans.delete(executionId);
      this.executionStates.delete(executionId);
      this.executionArrays.delete(executionId);
      
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.dotbotLogger.error({ 
        error: errorMsg,
        stack: error instanceof Error ? error.stack : undefined,
        executionId,
        planId: plan.id,
        originalRequest: plan.originalRequest
      }, 'prepareExecutionStateless: Error during preparation');
      
      throw error;
    }
  }
  
  /**
   * Validate an execution session is still active
   */
  private async validateExecutionSession(session: ExecutionSession): Promise<boolean> {
    if (!session.isActive) {
      return false;
    }
    return await session.isConnected();
  }
  
  /**
   * Get execution sessions for a given executionId (SESSION_SERVER_MODE)
   * Used when executing a previously prepared execution
   */
  getExecutionSessions(executionId: string): { relayChain: ExecutionSession; assetHub: ExecutionSession | null } | null {
    return this.executionSessions.get(executionId) || null;
  }
  
  /**
   * Get execution state for a given executionId (stateless mode)
   * Used for polling during preparation
   */
  getExecutionState(executionId: string): ExecutionArrayState | null {
    return this.executionStates.get(executionId) || null;
  }
  
  /**
   * Clean up execution sessions, plan, and state for a given executionId (SESSION_SERVER_MODE)
   */
  /**
   * Get ExecutionArray instance for a given executionId (SESSION_SERVER_MODE)
   * Used for direct subscription to execution updates (WebSocket broadcasting)
   * No ChatInstance needed - subscribe directly to ExecutionArray.onProgress()
   */
  getExecutionArray(executionId: string): ExecutionArray | null {
    return this.executionArrays.get(executionId) || null;
  }
  
  cleanupExecutionSessions(executionId: string): void {
    const sessions = this.executionSessions.get(executionId);
    if (sessions) {
      // Sessions will be cleaned up by RpcManager when they disconnect
      this.executionSessions.delete(executionId);
      this.executionPlans.delete(executionId);
      this.executionStates.delete(executionId);
      this.executionArrays.delete(executionId);
      this.dotbotLogger.debug({ executionId }, 'Cleaned up execution sessions, plan, state, and ExecutionArray');
    }
  }
  
  /**
   * Clean up expired execution sessions (call periodically to prevent memory leaks)
   * Returns the number of executions cleaned up
   */
  cleanupExpiredExecutions(): number {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [executionId, sessions] of this.executionSessions.entries()) {
      const age = now - sessions.createdAt;
      if (age > this.SESSION_TTL_MS) {
        this.cleanupExecutionSessions(executionId);
        cleaned++;
        this.dotbotLogger.info({ 
          executionId, 
          ageMinutes: Math.round(age / 60000) 
        }, 'Cleaned up expired execution session');
      }
    }
    
    return cleaned;
  }
  
  /**
   * Add execution message to chat early (before orchestration)
   * This shows the "Preparing..." state in the UI immediately
   */
  private async addExecutionMessageEarly(executionId: string, plan: ExecutionPlan): Promise<void> {
    if (!this.currentChat) return;
    
    // Check if execution message already exists for this executionId
    const existingMessage = this.currentChat.getDisplayMessages()
      .find(m => m.type === 'execution' && (m as any).executionId === executionId) as any;
    
    if (!existingMessage) {
      // Create new message with just the plan (no executionArray yet)
      await this.currentChat.addExecutionMessage(executionId, plan);
      this.emit({ 
        type: DotBotEventType.EXECUTION_MESSAGE_ADDED, 
        executionId, 
        plan, 
        timestamp: Date.now() 
      });
    }
  }
  
  /**
   * Update execution message in chat with the orchestrated executionArray
   */
  private async updateExecutionInChat(executionArray: ExecutionArray, plan: ExecutionPlan): Promise<void> {
    if (!this.currentChat) return;
    
    const state = executionArray.getState();
    
    // Find the execution message
    const existingMessage = this.currentChat.getDisplayMessages()
      .find(m => m.type === 'execution' && (m as any).executionId === state.id) as any;
    
    if (!existingMessage) {
      this.dotbotLogger.error({ executionId: state.id }, 'ExecutionMessage not found for update. This should not happen.');
      return;
    }
    
    // Update with the executionArray
    await this.currentChat.updateExecutionMessage(existingMessage.id, {
      executionArray: state,
      executionPlan: plan,
    });
    
    // Set the ExecutionArray instance in chat
    // This automatically sets up subscriptions to notify all onExecutionUpdate callbacks
    // The ExecutionFlow component will receive updates through its subscription
    this.currentChat.setExecutionArray(state.id, executionArray);
    
    // Emit event to notify UI that execution was updated (triggers refresh)
    this.emit({
      type: DotBotEventType.EXECUTION_MESSAGE_UPDATED,
      executionId: state.id,
      timestamp: Date.now()
    });
    
    this.dotbotLogger.debug({ 
      executionId: state.id
    }, 'ExecutionArray set in chat, subscriptions active');
  }
  
  /**
   * Add execution array to chat (chat-specific logic)
   * 
   * DEPRECATED: Use addExecutionMessageEarly + updateExecutionInChat instead
   */
  private async addExecutionToChat(executionArray: ExecutionArray, plan: ExecutionPlan): Promise<void> {
    if (!this.currentChat) return;
    
    const state = executionArray.getState();
    
    // Check if execution message already exists for this executionId
    const existingMessage = this.currentChat.getDisplayMessages()
      .find(m => m.type === 'execution' && (m as any).executionId === state.id) as any;
    
    let execMessage: any;
    if (existingMessage) {
      // Update existing message instead of creating a new one
      await this.currentChat.updateExecutionMessage(existingMessage.id, {
        executionArray: state,
        executionPlan: plan,
      });
      execMessage = existingMessage;
    } else {
      // Create new message only if it doesn't exist
      execMessage = await this.currentChat.addExecutionMessage(state, plan);
      this.emit({ 
        type: DotBotEventType.EXECUTION_MESSAGE_ADDED, 
        executionId: state.id, 
        plan, 
        timestamp: Date.now() 
      });
    }
    
    this.currentChat.setExecutionArray(state.id, executionArray);
    
    executionArray.onStatusUpdate(() => {
      if (this.currentChat) {
        this.currentChat.updateExecutionMessage(execMessage.id, {
          executionArray: executionArray.getState(),
        }).then(() => {
          // Emit event to notify UI of execution message update
          this.emit({
            type: DotBotEventType.EXECUTION_MESSAGE_UPDATED,
            executionId: state.id,
            timestamp: Date.now()
          });
        }).catch(err => {
          this.dotbotLogger.error({ 
            error: err instanceof Error ? err.message : String(err),
            executionId: state.id
          }, 'Failed to update execution message');
        });
      }
    });
  }

  /**
   * Update an execution message and emit event
   * This should be used instead of calling currentChat.updateExecutionMessage directly
   * to ensure events are properly emitted for UI updates
   */
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

  /**
   * REMOVED: executeWithArrayTracking
   * 
   * This method was replaced by a two-step process for better UX:
   * 
   * 1. **prepareExecution(plan)** - Orchestrates the plan, adds ExecutionMessage to chat
   *    (but does NOT execute). This allows the UI to display the flow for user review.
   * 
   * 2. **startExecution(executionId, options)** - Executes when user clicks "Accept & Start".
   * 
   * For programmatic/CLI usage (auto-execute without UI approval), use ExecutionSystem directly:
   * 
   * ```typescript
   * import { ExecutionSystem, KeyringSigner } from '@dotbot/lib';
   * 
   * const system = new ExecutionSystem();
   * const signer = KeyringSigner.fromMnemonic("your seed phrase");
   * await system.initialize(api, account, signer);
   * 
   * const result = await system.execute(executionPlan, { autoApprove: true });
   * console.log('Execution completed:', result);
   * ```
   * 
   * See: frontend/src/lib/executionEngine/index.ts for more CLI/backend examples.
   */
  
  /**
   * Get account balance from both Relay Chain and Asset Hub
   */
  async getBalance(): Promise<{
    relayChain: {
      free: string;
      reserved: string;
      frozen: string;
    };
    assetHub: {
    free: string;
    reserved: string;
    frozen: string;
    } | null;
    total: string;
  }> {
    // Ensure RPC connections are ready (lazy loading)
    await this.ensureRpcConnectionsReady();
    
    // Get Relay Chain balance
    const relayAccountInfo = await this.api!.query.system.account(this.wallet.address);
    const relayData = relayAccountInfo.toJSON() as any;
    
    const relayBalance = {
      free: relayData.data?.free || '0',
      reserved: relayData.data?.reserved || '0',
      frozen: relayData.data?.frozen || relayData.data?.miscFrozen || '0'
    };
    
    
    // Get Asset Hub balance (if connected)
    let assetHubBalance: { free: string; reserved: string; frozen: string } | null = null;
    if (this.assetHubApi) {
      try {
        const assetHubAccountInfo = await this.assetHubApi.query.system.account(this.wallet.address);
        const assetHubData = assetHubAccountInfo.toJSON() as any;
        
        assetHubBalance = {
          free: assetHubData.data?.free || '0',
          reserved: assetHubData.data?.reserved || '0',
          frozen: assetHubData.data?.frozen || assetHubData.data?.miscFrozen || '0'
    };
    
      } catch (error) {
      }
    } else {
    }
    
    // Calculate total free balance
    const relayFree = BigInt(relayBalance.free);
    const assetHubFree = assetHubBalance ? BigInt(assetHubBalance.free) : BigInt(0);
    const totalFree = relayFree + assetHubFree;
    
    return {
      relayChain: relayBalance,
      assetHub: assetHubBalance,
      total: totalFree.toString()
    };
  }
  
  /**
   * Get chain info
   */
  async getChainInfo(): Promise<{
    chain: string;
    version: string;
  }> {
    // Ensure RPC connections are ready (lazy loading)
    await this.ensureRpcConnectionsReady();
    
    const [chain, version] = await Promise.all([
      this.api!.rpc.system.chain(),
      this.api!.rpc.system.version()
    ]);
    
    return {
      chain: chain.toString(),
      version: version.toString()
    };
  }
  
  /**
   * Get Polkadot API (for advanced usage)
   * Note: This will trigger lazy loading if connections are not ready
   */
  async getApi(): Promise<ApiPromise> {
    await this.ensureRpcConnectionsReady();
    return this.api!;
  }
  
  /**
   * Get Asset Hub API (for advanced usage)
   */
  getAssetHubApi(): ApiPromise | null {
    return this.assetHubApi;
  }
  
  /**
   * Set Asset Hub API (internal use - called during initialization)
   */
  _setAssetHubApi(api: ApiPromise | null): void {
    this.assetHubApi = api;
  }
  
  /**
   * Get current wallet
   */
  getWallet(): WalletAccount {
    return this.wallet;
  }
  
  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    if (this.api) {
      await this.api.disconnect();
    }
    if (this.assetHubApi) {
      await this.assetHubApi.disconnect();
    }
  }
  

  /**
   * Generate friendly message from execution plan
   * 
   * This creates a user-friendly message that explains what transaction(s)
   * have been prepared, without being overly chatty or asking for confirmation
   * (since the ExecutionPlan UI serves as the confirmation mechanism).
   */
  private generateFriendlyMessage(plan: ExecutionPlan, completed: number, failed: number): string {
    const totalSteps = plan.steps.length;
    
    if (totalSteps === 0) {
      return "Transaction prepared, but no operations to execute.";
    }
    
    if (totalSteps === 1) {
      const step = plan.steps[0];
      // Single transaction - keep it simple and direct
      return `Transaction ready:\n\n**${step.description}**\n\nReview the details below and approve when ready.`;
    }
    
    // Multiple transactions - show them as a list
    const stepsList = plan.steps
      .map((s, i) => `${i + 1}. ${s.description}`)
      .join('\n');
    
    return `${totalSteps} transactions ready:\n\n${stepsList}\n\nReview the details below and approve when ready.`;
  }

  /**
   * Get the current network
   */
  getNetwork(): Network {
    return this.network;
  }

  /**
   * Build system prompt with current context
   */
  private async buildContextualSystemPrompt(): Promise<string> {
    // Ensure RPC connections are ready (lazy loading)
    await this.ensureRpcConnectionsReady();
    
    try {
      const balance = await this.getBalance();
      const chainInfo = await this.getChainInfo();
      
      // Get network-specific token symbol
      const tokenSymbol = this.network === 'westend' ? 'WND' 
                        : this.network === 'kusama' ? 'KSM' 
                        : 'DOT';
      
      // Get decimals from API registry (environment) - more accurate than hardcoded values
      const relayChainDecimals = this.api!.registry.chainDecimals?.[0];
      const assetHubDecimals = this.assetHubApi?.registry.chainDecimals?.[0];
      
      const systemPrompt = await buildSystemPrompt({
        wallet: {
          isConnected: true,
          address: this.wallet.address,
          provider: this.wallet.source
        },
        network: {
          network: this.network,
          rpcEndpoint: this.relayChainManager.getCurrentEndpoint() || '',
          isTestnet: this.network === 'westend',
          relayChainDecimals,
          assetHubDecimals,
        },
        balance: {
          relayChain: {
            free: balance.relayChain.free,
            reserved: balance.relayChain.reserved,
            frozen: balance.relayChain.frozen
          },
          assetHub: balance.assetHub ? {
            free: balance.assetHub.free,
            reserved: balance.assetHub.reserved,
            frozen: balance.assetHub.frozen
          } : null,
          total: balance.total,
          symbol: tokenSymbol
        },
      });
      
      return systemPrompt;
    } catch (error) {
      // Fallback to basic prompt if context fetch fails
      return await buildSystemPrompt();
    }
  }
  
  /**
   * Call LLM (can be overridden with custom function or AI service)
   */
  private async callLLM(
    message: string, 
    systemPrompt: string,
    customLLM?: (message: string, systemPrompt: string, context?: any) => Promise<string>,
    conversationHistory?: ConversationMessage[]
  ): Promise<string> {
    // Priority 1: Custom LLM function (from chat options)
    if (customLLM) {
      // Pass conversation history to LLM for context
      return await customLLM(message, systemPrompt, { 
        conversationHistory: conversationHistory || []
      });
    }
    
    // Priority 2: AI Service from config (backend use)
    if (this.aiService) {
      // Use the AI service with the system prompt from DotBot
      return await this.aiService.sendMessage(message, {
        systemPrompt, // DotBot's system prompt with blockchain capabilities
        conversationHistory: conversationHistory || [],
        walletAddress: this.wallet.address,
        network: this.network.charAt(0).toUpperCase() + this.network.slice(1),
      });
    }
    
    // No LLM configured
    throw new Error(
      'No LLM configured. Either:\n' +
      '1. Pass an AI service in DotBot config: new DotBot({ ..., aiService: myAIService })\n' +
      '2. Pass a custom LLM function in chat options: dotbot.chat(message, { llm: async (msg, prompt, context) => { ... } })'
    );
  }
  
  private extractExecutionPlan(llmResponse: string): ExecutionPlan | null {
    if (!llmResponse || typeof llmResponse !== 'string') {
      return null;
    }

    const normalized = llmResponse.trim();

    try {
      // Strategy 1: JSON in ```json code block (most common LLM format)
      const jsonMatch = normalized.match(/```json\s*([\s\S]*?)\s*```/i);
      if (jsonMatch) {
        const plan = JSON.parse(jsonMatch[1].trim());
        if (this.isValidExecutionPlan(plan)) {
          return plan;
        }
      }

      // Strategy 2: JSON in generic ``` code block
      const codeBlockMatch = normalized.match(/```\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        try {
          const plan = JSON.parse(codeBlockMatch[1].trim());
          if (this.isValidExecutionPlan(plan)) {
            return plan;
          }
        } catch {
          // Not JSON in code block
        }
      }

      // Strategy 3: Plain JSON string (LLM returns just JSON)
      try {
        const plan = JSON.parse(normalized);
        if (this.isValidExecutionPlan(plan)) {
          return plan;
        }
      } catch {
        // Not plain JSON
      }

      return null;
    } catch (error) {
      this.dotbotLogger.error({ 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      }, 'Error extracting ExecutionPlan');
      return null;
    }
  }
  
  /**
   * Validate execution plan structure
   */
  private isValidExecutionPlan(obj: any): obj is ExecutionPlan {
    return (
      obj &&
      typeof obj === 'object' &&
      'id' in obj &&
      'steps' in obj &&
      Array.isArray(obj.steps)
    );
  }
}

