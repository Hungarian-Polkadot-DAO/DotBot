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
import { BrowserWalletSigner } from './executionEngine/signers/browserSigner';
import { buildSystemPrompt } from './prompts/system/loader';
import { ExecutionPlan } from './prompts/system/execution/types';
import { SigningRequest, BatchSigningRequest, ExecutionOptions } from './executionEngine/types';
import { WalletAccount } from '../types/wallet';
import { processSystemQueries, areSystemQueriesEnabled } from './prompts/system/systemQuery';
import { RpcManager, createRpcManagersForNetwork, Network } from './rpcManager';
import { SimulationStatusCallback } from './agents/types';
import { detectNetworkFromChainName } from './prompts/system/knowledge';
import { ChatInstanceManager } from './chatInstanceManager';
import { ChatInstance } from './chatInstance';
import type { Environment, ConversationItem } from './types/chatInstance';

export interface DotBotConfig {
  /** Wallet account */
  wallet: WalletAccount;
  
  /** Network to connect to (defaults to 'polkadot') */
  network?: Network;
  
  /** Environment (defaults to 'mainnet') */
  environment?: Environment;
  
  /** LLM API endpoint (for custom LLM) */
  llmEndpoint?: string;
  
  /** LLM API key */
  llmApiKey?: string;
  
  /** Signing request handler (REQUIRED for transactions) */
  onSigningRequest?: (request: SigningRequest) => void;
  
  /** Batch signing request handler */
  onBatchSigningRequest?: (request: BatchSigningRequest) => void;
  
  /** Simulation status callback for UI feedback */
  onSimulationStatus?: SimulationStatusCallback;
  
  /** Auto-approve transactions (NOT recommended for production!) */
  autoApprove?: boolean;
  
  /** Pre-initialized RPC managers (optional - for faster connection) */
  relayChainManager?: RpcManager;
  assetHubManager?: RpcManager;
  
  /** Custom chat instance manager (optional - for advanced usage) */
  chatManager?: ChatInstanceManager;
  
  /** Disable automatic chat persistence (defaults to false) */
  disableChatPersistence?: boolean;
}

export interface ChatResult {
  /** LLM response text */
  response: string;
  
  /** Execution plan (if any) */
  plan?: ExecutionPlan;
  
  /** Whether operations were executed */
  executed: boolean;
  
  /** Execution success status */
  success: boolean;
  
  /** Number of operations completed */
  completed: number;
  
  /** Number of operations failed */
  failed: number;
}

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
  private api: ApiPromise;
  private assetHubApi: ApiPromise | null = null;
  private executionSystem: ExecutionSystem;
  private wallet: WalletAccount;
  private config: DotBotConfig;
  private network: Network;
  private environment: Environment;
  
  private relayChainManager: RpcManager;
  private assetHubManager: RpcManager;
  
  // Chat instance management (built-in) - execution lives here!
  private chatManager: ChatInstanceManager;
  public currentChat: ChatInstance | null = null;
  private chatPersistenceEnabled: boolean;
  
  private constructor(
    api: ApiPromise, 
    executionSystem: ExecutionSystem, 
    config: DotBotConfig,
    network: Network,
    environment: Environment,
    relayChainManager: RpcManager,
    assetHubManager: RpcManager,
    chatManager: ChatInstanceManager
  ) {
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
    
    const api = await relayChainManager.getReadApi();
    console.info(`Connected to Relay Chain via: ${relayChainManager.getCurrentEndpoint()}`);
    
    // Detect actual network from chain name (in case pre-initialized managers are for a different network)
    const chainInfo = await api.rpc.system.chain();
    const detectedNetwork = detectNetworkFromChainName(chainInfo.toString());
    const actualNetwork = detectedNetwork;
    
    console.info(`Network: ${actualNetwork} (configured: ${configuredNetwork}), Environment: ${environment}`);
    
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
    
    const dotbot = new DotBot(
      api, 
      executionSystem, 
      config, 
      actualNetwork, 
      environment,
      relayChainManager, 
      assetHubManager,
      chatManager
    );
    
    // Initialize chat instance (load or create)
    if (!config.disableChatPersistence) {
      await dotbot.initializeChatInstance();
    }
    
    try {
      await dotbot.initializeAssetHub();
    } catch (err) {
      console.warn('Asset Hub connection failed, continuing without it:', err instanceof Error ? err.message : err);
    }
    
    // Initialize execution system with both APIs and RPC managers (after Asset Hub is connected)
    executionSystem.initialize(api, config.wallet, signer, dotbot.getAssetHubApi(), relayChainManager, assetHubManager, config.onSimulationStatus);
    
    return dotbot;
  }
  
  private async initializeAssetHub(): Promise<void> {
    try {
      this.assetHubApi = await this.assetHubManager.getReadApi();
      console.info(`Asset Hub connected via: ${this.assetHubManager.getCurrentEndpoint()}`);
    } catch (error) {
      console.error('Asset Hub connection failed on all endpoints:', error);
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
        console.info(`Loaded chat: ${this.currentChat.id}`);
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
        console.info(`Created new chat: ${this.currentChat.id}`);
      }
    } catch (error) {
      console.error('Failed to initialize chat instance:', error);
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
    
    console.info(`Started new chat: ${this.currentChat.id}`);
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
    
    // Update internal state
    this.environment = environment;
    this.network = targetNetwork;
    
    // Create RPC managers for new network
    const managers = createRpcManagersForNetwork(targetNetwork);
    this.relayChainManager = managers.relayChainManager;
    this.assetHubManager = managers.assetHubManager;
    
    // Reconnect APIs
    this.api = await this.relayChainManager.getReadApi();
    await this.initializeAssetHub().catch(() => {
      console.warn('Asset Hub connection failed after environment switch');
    });
    
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
      console.info(`Switched to ${environment} (${targetNetwork}), new chat: ${this.currentChat.id}`);
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
   * Start execution of a specific execution array
   * 
   * This is called when user clicks "Accept & Start" in the UI.
   * Requires that prepareExecution() was already called (happens automatically after LLM response).
   * 
   * @param executionId The unique ID of the execution to start (from ExecutionMessage.executionId)
   * @param options Execution options (autoApprove, etc.)
   */
  async startExecution(executionId: string, options?: ExecutionOptions): Promise<void> {
    if (!this.currentChat) {
      throw new Error('No active chat. Cannot start execution.');
    }
    
    const executionArray = this.currentChat.getExecutionArray(executionId);
    if (!executionArray) {
      throw new Error(`Execution ${executionId} not found. It may not have been prepared yet.`);
    }
    
    const executioner = this.executionSystem.getExecutioner();
    await executioner.execute(executionArray, options);
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
    // Save user message
    if (this.currentChat) {
      await this.currentChat.addUserMessage(message);
    }
    
    // Get LLM response
    const llmResponse = await this.getLLMResponse(message, options);
    
    // Extract execution plan
    const plan = this.extractExecutionPlan(llmResponse);
    
    // No execution needed - just a conversation
    if (!plan || plan.steps.length === 0) {
      return await this.handleConversationResponse(llmResponse);
    }
    
    // Execute blockchain operations
    return await this.handleExecutionResponse(llmResponse, plan, options);
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
    // Prepare execution (orchestrate + add to chat)
    // Do NOT auto-execute - wait for user approval in UI!
    try {
      await this.prepareExecution(plan);
    } catch (error) {
      console.error('Execution preparation failed:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      return {
        response: `Unable to prepare your transaction:\n\n${errorMsg}\n\nPlease check the parameters and try again.`,
        plan,
        executed: false,
        success: false,
        completed: 0,
        failed: 1
      };
    }
    
    // Generate friendly message (pre-execution)
    const friendlyMessage = `I've prepared a transaction flow with ${plan.steps.length} step${plan.steps.length !== 1 ? 's' : ''}. Review the details below and click "Accept and Start" when ready.`;
    
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
      executed: false,  // Not executed yet!
      success: true,
      completed: 0,
      failed: 0
    };
  }
  
  /**
   * Prepare execution (orchestrate + add to chat)
   * Does NOT auto-execute - waits for user approval
   */
  private async prepareExecution(plan: ExecutionPlan): Promise<void> {
    const orchestrator = this.executionSystem.getOrchestrator();
    
    let orchestrationResult;
    try {
      orchestrationResult = await orchestrator.orchestrate(plan);
    } catch (error) {
      console.error('Orchestration failed:', error);
      throw error;
    }
    
    const { executionArray } = orchestrationResult;
    
    if (!orchestrationResult.success && orchestrationResult.errors.length > 0) {
      const errorMessages = orchestrationResult.errors.map((e: { error: string }) => `• ${e.error}`).join('\n');
      throw new Error(`Failed to prepare transaction:\n\n${errorMessages}`);
    }
    
    // Add ExecutionMessage to conversation timeline (so UI can render it!)
    if (this.currentChat) {
      const state = executionArray.getState();
      const execMessage = await this.currentChat.addExecutionMessage(state);
      this.currentChat.setExecutionArray(state.id, executionArray);
      
      // Subscribe to updates to keep ExecutionMessage in sync
      executionArray.onStatusUpdate(() => {
        if (this.currentChat) {
          this.currentChat.updateExecutionMessage(execMessage.id, {
            executionArray: executionArray.getState(),
          }).catch(err => console.error('Failed to update execution message:', err));
        }
      });
    }
    
    // DO NOT EXECUTE HERE - wait for user to click "Accept & Start" in UI!
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
    
    // Get Relay Chain balance
    const relayAccountInfo = await this.api.query.system.account(this.wallet.address);
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
    const [chain, version] = await Promise.all([
      this.api.rpc.system.chain(),
      this.api.rpc.system.version()
    ]);
    
    return {
      chain: chain.toString(),
      version: version.toString()
    };
  }
  
  /**
   * Get Polkadot API (for advanced usage)
   */
  getApi(): ApiPromise {
    return this.api;
  }
  
  /**
   * Get Asset Hub API (for advanced usage)
   */
  getAssetHubApi(): ApiPromise | null {
    return this.assetHubApi;
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
    await this.api.disconnect();
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
    try {
      const balance = await this.getBalance();
      const chainInfo = await this.getChainInfo();
      
      // Get network-specific token symbol
      const tokenSymbol = this.network === 'westend' ? 'WND' 
                        : this.network === 'kusama' ? 'KSM' 
                        : 'DOT';
      
      const systemPrompt = buildSystemPrompt({
        wallet: {
          isConnected: true,
          address: this.wallet.address,
          provider: this.wallet.source
        },
        network: {
          network: this.network,
          rpcEndpoint: this.relayChainManager.getCurrentEndpoint() || '',
          isTestnet: this.network === 'westend',
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
      return buildSystemPrompt();
    }
  }
  
  /**
   * Call LLM (can be overridden with custom function)
   */
  private async callLLM(
    message: string, 
    systemPrompt: string,
    customLLM?: (message: string, systemPrompt: string, context?: any) => Promise<string>,
    conversationHistory?: ConversationMessage[]
  ): Promise<string> {
    if (customLLM) {
      // Pass conversation history to LLM for context
      return await customLLM(message, systemPrompt, { 
        conversationHistory: conversationHistory || []
      });
    }
    
    // Default: Use ASI-One (if available in frontend)
    // For now, throw error if no custom LLM provided
    throw new Error(
      'No LLM configured. Pass a custom LLM function in chat options:\n' +
      'dotbot.chat(message, { llm: async (msg, prompt, context) => { /* your LLM call */ } })'
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
      console.error('Error extracting ExecutionPlan:', error);
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

