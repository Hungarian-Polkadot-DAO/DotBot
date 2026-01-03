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

import { ApiPromise, WsProvider } from '@polkadot/api';
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

export interface DotBotConfig {
  /** Wallet account */
  wallet: WalletAccount;
  
  /** Polkadot endpoint (default: wss://rpc.polkadot.io) */
  endpoint?: string;
  
  /** LLM API endpoint (for custom LLM) */
  llmEndpoint?: string;
  
  /** LLM API key */
  llmApiKey?: string;
  
  /** Signing request handler (REQUIRED for transactions) */
  onSigningRequest?: (request: SigningRequest) => void;
  
  /** Batch signing request handler */
  onBatchSigningRequest?: (request: BatchSigningRequest) => void;
  
  /** Auto-approve transactions (NOT recommended for production!) */
  autoApprove?: boolean;
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
    // Create RPC managers for automatic failover
    const relayChainManager = createRelayChainManager();
    const assetHubManager = createAssetHubManager();
    
    // Connect to Polkadot Relay Chain with automatic failover
    console.log('🔗 Connecting to Polkadot Relay Chain...');
    const api = await relayChainManager.connect();
    console.log(`✅ Connected to Relay Chain via: ${relayChainManager.getCurrentEndpoint()}`);
    
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
    
    // Create and initialize execution system
    const executionSystem = new ExecutionSystem();
    executionSystem.initialize(api, config.wallet, signer);
    
    const dotbot = new DotBot(api, executionSystem, config, relayChainManager, assetHubManager);
    
    // Initialize Asset Hub connection (blocking - wait for it)
    try {
      await dotbot.initializeAssetHub();
      console.log('✅ DotBot ready with Asset Hub connection');
    } catch (err) {
      console.warn('⚠️ Asset Hub connection failed, continuing without it:', err instanceof Error ? err.message : err);
    }
    
    return dotbot;
  }
  
  /**
   * Initialize Asset Hub connection with automatic failover
   */
  private async initializeAssetHub(): Promise<void> {
    console.log('🔗 Connecting to Asset Hub with automatic failover...');
    
    try {
      this.assetHubApi = await this.assetHubManager.connect();
      console.log(`✅ Asset Hub connected via: ${this.assetHubManager.getCurrentEndpoint()}`);
    } catch (error) {
      console.error('❌ Asset Hub connection failed on all endpoints:', error);
      this.assetHubApi = null;
      throw error; // Re-throw so caller knows it failed
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
   * console.log(result1.response); // Explanation text
   * 
   * // Command - gets ExecutionPlan + execution
   * const result2 = await dotbot.chat("Send 2 DOT to Bob");
   * console.log(result2.executed); // true
   * console.log(result2.plan); // ExecutionPlan object
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
    
    // SCENARIO 1: No ExecutionPlan found - LLM responded with text
    // This means the user asked a question, needs clarification, or made an error
    if (!plan || plan.steps.length === 0) {
      console.log('💬 Text-only response (Question/Clarification/Error scenario)');
      this.currentExecutionArray = null;
      
      // Clean up the response - remove any code block markers that might remain
      let cleanedResponse = llmResponse
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
    
    // SCENARIO 2: ExecutionPlan found - LLM generated a command
    console.log('🔧 ExecutionPlan detected (Command scenario):', {
      id: plan.id,
      steps: plan.steps.length,
      stepsDetails: plan.steps.map(s => ({
        agent: s.agentClassName,
        function: s.functionName,
        type: s.executionType
      }))
    });
    
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
      console.error('❌ Execution preparation failed:', error);
      
      // Return a friendly error message
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        response: `❌ Unable to prepare your transaction:\n\n${errorMsg}\n\nPlease check the parameters and try again.`,
        plan,
        executed: false,
        success: false,
        completed: 0,
        failed: 1
      };
    }
    
    // Generate friendly confirmation message
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
  
  /**
   * Execute plan with ExecutionArray tracking
   */
  private async executeWithArrayTracking(
    plan: ExecutionPlan,
    options?: ExecutionOptions,
    callbacks?: {
      onComplete?: (success: boolean, completed: number, failed: number) => void;
    }
  ): Promise<void> {
    // Use orchestrator directly to get the ExecutionArray
    const orchestrator = (this.executionSystem as any).orchestrator;
    console.log('🎯 Orchestrating plan:', {
      planId: plan.id,
      steps: plan.steps.length,
      stepDetails: plan.steps.map(s => ({
        id: s.id,
        agent: s.agentClassName,
        function: s.functionName
      }))
    });
    
    let orchestrationResult;
    try {
      orchestrationResult = await orchestrator.orchestrate(plan);
      console.log('✅ Orchestration completed');
    } catch (error) {
      console.error('❌ Orchestration failed:', error);
      throw error;
    }
    
    const { executionArray } = orchestrationResult;
    
    console.log('📋 Orchestration result:', {
      hasExecutionArray: !!executionArray,
      success: orchestrationResult.success,
      errors: orchestrationResult.errors,
      arrayItemCount: executionArray?.getItems?.()?.length || 0,
      arrayState: executionArray?.getState?.(),
      metadata: orchestrationResult.metadata
    });
    
    // If orchestration failed with errors, show them to the user
    if (!orchestrationResult.success && orchestrationResult.errors.length > 0) {
      const errorMessages = orchestrationResult.errors.map((e: { error: string }) => `• ${e.error}`).join('\n');
      throw new Error(`Failed to prepare transaction:\n\n${errorMessages}`);
    }
    
    // Store current execution array
    this.currentExecutionArray = executionArray;
    
    // Log execution array for debugging
    const items = executionArray.getItems();
    console.log('📋 ExecutionArray created:', {
      itemCount: items.length,
      items: items.map((item: ExecutionItem) => ({
        id: item.id,
        description: item.description,
        status: item.status,
        type: item.executionType
      })),
      state: executionArray.getState()
    });
    
    // Subscribe to updates and notify callbacks
    const unsubscribe = executionArray.onStatusUpdate((item: ExecutionItem) => {
      const state = executionArray.getState();
      console.log('🔄 ExecutionArray update:', {
        item: {
          id: item.id,
          description: item.description,
          status: item.status
        },
        state: {
          total: state.totalItems,
          completed: state.completedItems,
          failed: state.failedItems,
          executing: state.isExecuting
        }
      });
      
      // Notify all subscribers
      this.executionArrayCallbacks.forEach(cb => cb(state));
    });
    
    // Notify initial state
    const initialState = executionArray.getState();
    console.log('🔔 Notifying initial ExecutionArray state:', {
      itemCount: initialState.items.length,
      totalItems: initialState.totalItems,
      callbackCount: this.executionArrayCallbacks.size
    });
    this.executionArrayCallbacks.forEach(cb => {
      console.log('📞 Calling callback with state');
      cb(initialState);
    });
    
    try {
      // Execute
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
    console.log('💰 DotBot.getBalance() - Querying address:', this.wallet.address);
    
    // Get Relay Chain balance
    const relayAccountInfo = await this.api.query.system.account(this.wallet.address);
    const relayData = relayAccountInfo.toJSON() as any;
    
    const relayBalance = {
      free: relayData.data?.free || '0',
      reserved: relayData.data?.reserved || '0',
      frozen: relayData.data?.frozen || relayData.data?.miscFrozen || '0'
    };
    
    console.log('💰 Relay Chain balance:', relayBalance);
    
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
    
        console.log('💰 Asset Hub balance:', assetHubBalance);
      } catch (error) {
        console.warn('⚠️ Failed to fetch Asset Hub balance:', error);
      }
    } else {
      console.log('ℹ️ Asset Hub not connected, skipping Asset Hub balance');
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
      return `✅ Transaction ready:\n\n**${step.description}**\n\nReview the details below and approve when ready.`;
    }
    
    // Multiple transactions - show them as a list
    const stepsList = plan.steps
      .map((s, i) => `${i + 1}. ${s.description}`)
      .join('\n');
    
    return `✅ ${totalSteps} transactions ready:\n\n${stepsList}\n\nReview the details below and approve when ready.`;
  }

  /**
   * Build system prompt with current context
   */
  private async buildContextualSystemPrompt(): Promise<string> {
    try {
      const balance = await this.getBalance();
      const chainInfo = await this.getChainInfo();
      
      // Use original address - Polkadot API handles all SS58 formats automatically
      // Converting would point to a different account on different networks
      console.log('🔄 Using wallet address for system prompt:', {
        address: this.wallet.address,
        prefix: this.wallet.address[0],
        note: 'Polkadot API handles all SS58 formats'
      });
      
      return buildSystemPrompt({
        wallet: {
          isConnected: true,
          address: this.wallet.address, // Use original - don't convert!
          provider: this.wallet.source
        },
        network: {
          network: chainInfo.chain.toLowerCase().includes('kusama') ? 'kusama' : 'polkadot',
          rpcEndpoint: this.config.endpoint || 'wss://rpc.polkadot.io'
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
  
  /**
   * Extract execution plan from LLM response
   */
  private extractExecutionPlan(llmResponse: string): ExecutionPlan | null {
    console.log('🔍 Extracting ExecutionPlan from LLM response:', {
      responseLength: llmResponse.length,
      responsePreview: llmResponse.substring(0, 200)
    });

    try {
      // Look for JSON code block (most common format)
      const jsonMatch = llmResponse.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        console.log('📦 Found JSON code block');
        const plan = JSON.parse(jsonMatch[1]);
        if (this.isValidExecutionPlan(plan)) {
          console.log('✅ Valid ExecutionPlan extracted from JSON code block');
          return plan;
        } else {
          console.warn('⚠️ JSON found but invalid ExecutionPlan structure:', plan);
        }
      }
      
      // Look for JSON code block without language tag
      const jsonBlockMatch = llmResponse.match(/```\s*([\s\S]*?)\s*```/);
      if (jsonBlockMatch) {
        try {
          const plan = JSON.parse(jsonBlockMatch[1]);
          if (this.isValidExecutionPlan(plan)) {
            console.log('✅ Valid ExecutionPlan extracted from code block');
            return plan;
          }
        } catch {
          // Not JSON
        }
      }
      
      // Try to find JSON object in the response (might be embedded in text)
      const jsonObjectMatch = llmResponse.match(/\{[\s\S]*"steps"[\s\S]*\}/);
      if (jsonObjectMatch) {
        try {
          const plan = JSON.parse(jsonObjectMatch[0]);
          if (this.isValidExecutionPlan(plan)) {
            console.log('✅ Valid ExecutionPlan extracted from embedded JSON');
            return plan;
          }
        } catch {
          // Not valid JSON
        }
      }
      
      // Try to parse entire response as JSON
      try {
        const plan = JSON.parse(llmResponse);
        if (this.isValidExecutionPlan(plan)) {
          console.log('✅ Valid ExecutionPlan extracted from full response');
          return plan;
        }
      } catch {
        // Not JSON, that's fine
      }
      
      console.warn('⚠️ No valid ExecutionPlan found in LLM response');
      console.log('Full response:', llmResponse);
      return null;
    } catch (error) {
      console.error('❌ Error extracting ExecutionPlan:', error);
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

