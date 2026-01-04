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
import { ExecutionArray } from './executionEngine/executionArray';
import { ExecutionArrayState, ExecutionItem } from './executionEngine/types';
import { BrowserWalletSigner } from './executionEngine/signers/browserSigner';
import { buildSystemPrompt } from './prompts/system/loader';
import { ExecutionPlan } from './prompts/system/execution/types';
import { SigningRequest, BatchSigningRequest, ExecutionOptions } from './executionEngine/types';
import { WalletAccount } from '../types/wallet';
import { processSystemQueries, areSystemQueriesEnabled } from './prompts/system/systemQuery';
import { createRelayChainManager, createAssetHubManager, RpcManager } from './rpcManager';
import { SimulationStatusCallback } from './agents/types';

export interface DotBotConfig {
  /** Wallet account */
  wallet: WalletAccount;
  
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
  private currentExecutionArray: ExecutionArray | null = null;
  private executionArrayCallbacks: Set<(state: ExecutionArrayState) => void> = new Set();
  private relayChainManager: RpcManager;
  private assetHubManager: RpcManager;
  
  private constructor(
    api: ApiPromise, 
    executionSystem: ExecutionSystem, 
    config: DotBotConfig,
    relayChainManager: RpcManager,
    assetHubManager: RpcManager
  ) {
    this.api = api;
    this.executionSystem = executionSystem;
    this.wallet = config.wallet;
    this.config = config;
    this.relayChainManager = relayChainManager;
    this.assetHubManager = assetHubManager;
  }
  
  /**
   * Subscribe to execution array state changes
   */
  onExecutionArrayUpdate(callback: (state: ExecutionArrayState) => void): () => void {
    this.executionArrayCallbacks.add(callback);
    
    // If there's a current execution array, subscribe to it
    if (this.currentExecutionArray) {
      const unsubscribe = this.currentExecutionArray.onStatusUpdate(() => {
        const state = this.currentExecutionArray!.getState();
        this.executionArrayCallbacks.forEach(cb => cb(state));
      });
      
      // Also call immediately with current state
      callback(this.currentExecutionArray.getState());
      
      return () => {
        this.executionArrayCallbacks.delete(callback);
        unsubscribe();
      };
    }
    
    return () => {
      this.executionArrayCallbacks.delete(callback);
    };
  }
  
  /**
   * Get current execution array state
   */
  getExecutionArrayState(): ExecutionArrayState | null {
    return this.currentExecutionArray ? this.currentExecutionArray.getState() : null;
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
    // Use pre-initialized RPC managers if provided, otherwise create new ones
    const relayChainManager = config.relayChainManager || createRelayChainManager();
    const assetHubManager = config.assetHubManager || createAssetHubManager();
    
    const isPreConnected = !!config.relayChainManager;
    const api = await relayChainManager.getReadApi();
    console.info(`Connected to Relay Chain via: ${relayChainManager.getCurrentEndpoint()}`);
    
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
    
    const dotbot = new DotBot(api, executionSystem, config, relayChainManager, assetHubManager);
    
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
    // Build system prompt with current context
    const systemPrompt = options?.systemPrompt || await this.buildContextualSystemPrompt();
    
    // Send to LLM (with conversation history if provided)
    let llmResponse = await this.callLLM(message, systemPrompt, options?.llm, options?.conversationHistory);
    
    // Process system queries if enabled (future feature)
    if (areSystemQueriesEnabled() && options?.llm) {
      llmResponse = await processSystemQueries(
        llmResponse,
        systemPrompt,
        message,
        async (msg, prompt) => this.callLLM(msg, prompt, options.llm, options.conversationHistory)
      );
    }
    
    // Try to extract execution plan
    const plan = this.extractExecutionPlan(llmResponse);
    
    if (!plan || plan.steps.length === 0) {
      this.currentExecutionArray = null;
      
      const cleanedResponse = llmResponse
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      
      return {
        response: cleanedResponse,
        executed: false,
        success: true,
        completed: 0,
        failed: 0
      };
    }
    
    // Prepare the plan for execution with array tracking
    let completed = 0;
    let failed = 0;
    let success = true;
    
    try {
      await this.executeWithArrayTracking(
        plan,
        options?.executionOptions,
        {
          onComplete: (s, c, f) => {
            success = s;
            completed = c;
            failed = f;
          }
        }
      );
    } catch (error) {
      success = false;
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
    
    const friendlyMessage = this.generateFriendlyMessage(plan, completed, failed);
    
    return {
      response: friendlyMessage,
      plan,
      executed: true,
      success,
      completed,
      failed
    };
  }
  
  private async executeWithArrayTracking(
    plan: ExecutionPlan,
    options?: ExecutionOptions,
    callbacks?: {
      onComplete?: (success: boolean, completed: number, failed: number) => void;
    }
  ): Promise<void> {
    const orchestrator = (this.executionSystem as any).orchestrator;
    
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
    
    this.currentExecutionArray = executionArray;
    
    const unsubscribe = executionArray.onStatusUpdate((item: ExecutionItem) => {
      const state = executionArray.getState();
      this.executionArrayCallbacks.forEach(cb => cb(state));
    });
    
    try {
      const executioner = (this.executionSystem as any).executioner;
      await executioner.execute(executionArray, options);
      
      const finalState = executionArray.getState();
      if (callbacks?.onComplete) {
        callbacks.onComplete(
          finalState.failedItems === 0,
          finalState.completedItems,
          finalState.failedItems
        );
      }
    } finally {
      unsubscribe();
    }
  }
  
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
   * Build system prompt with current context
   */
  private async buildContextualSystemPrompt(): Promise<string> {
    try {
      const balance = await this.getBalance();
      const chainInfo = await this.getChainInfo();
      
      const systemPrompt = buildSystemPrompt({
        wallet: {
          isConnected: true,
          address: this.wallet.address,
          provider: this.wallet.source
        },
        network: {
          network: chainInfo.chain.toLowerCase().includes('kusama') ? 'kusama' : 'polkadot',
          rpcEndpoint: this.relayChainManager.getCurrentEndpoint() || 'wss://rpc.polkadot.io'
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
          symbol: 'DOT'
        }
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
    try {
      const jsonMatch = llmResponse.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const plan = JSON.parse(jsonMatch[1]);
        if (this.isValidExecutionPlan(plan)) {
          return plan;
        }
      }
      
      const jsonBlockMatch = llmResponse.match(/```\s*([\s\S]*?)\s*```/);
      if (jsonBlockMatch) {
        try {
          const plan = JSON.parse(jsonBlockMatch[1]);
          if (this.isValidExecutionPlan(plan)) {
            return plan;
          }
        } catch {
          // Not JSON
        }
      }
      
      const jsonObjectMatch = llmResponse.match(/\{[\s\S]*"steps"[\s\S]*\}/);
      if (jsonObjectMatch) {
        try {
          const plan = JSON.parse(jsonObjectMatch[0]);
          if (this.isValidExecutionPlan(plan)) {
            return plan;
          }
        } catch {
          // Not valid JSON
        }
      }
      
      try {
        const plan = JSON.parse(llmResponse);
        if (this.isValidExecutionPlan(plan)) {
          return plan;
        }
      } catch {
        // Not JSON
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

