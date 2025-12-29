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
import { ExecutionSystem } from './execution-array/system';
import { ExecutionArray } from './execution-array/executionArray';
import { ExecutionArrayState, ExecutionItem } from './execution-array/types';
import { BrowserWalletSigner } from './execution-array/signers/browserSigner';
import { buildSystemPrompt } from './prompts/system/loader';
import { ExecutionPlan } from './prompts/system/execution/types';
import { SigningRequest, BatchSigningRequest, ExecutionOptions } from './execution-array/types';
import { WalletAccount } from '../types/wallet';

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

export interface ChatOptions {
  /** Custom system prompt override */
  systemPrompt?: string;
  
  /** Execution options */
  executionOptions?: ExecutionOptions;
  
  /** Custom LLM function (bypass default) */
  llm?: (message: string, systemPrompt: string, context?: any) => Promise<string>;
}

/**
 * DotBot - Out of the Box Interface
 * 
 * Everything you need in one simple class.
 */
export class DotBot {
  private api: ApiPromise;
  private executionSystem: ExecutionSystem;
  private wallet: WalletAccount;
  private config: DotBotConfig;
  private currentExecutionArray: ExecutionArray | null = null;
  private executionArrayCallbacks: Set<(state: ExecutionArrayState) => void> = new Set();
  
  private constructor(api: ApiPromise, executionSystem: ExecutionSystem, config: DotBotConfig) {
    this.api = api;
    this.executionSystem = executionSystem;
    this.wallet = config.wallet;
    this.config = config;
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
   * Create and initialize DotBot
   * 
   * This is the only setup you need!
   */
  static async create(config: DotBotConfig): Promise<DotBot> {
    // Connect to Polkadot
    const endpoint = config.endpoint || 'wss://rpc.polkadot.io';
    const provider = new WsProvider(endpoint);
    const api = await ApiPromise.create({ provider });
    await api.isReady;
    
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
    
    return new DotBot(api, executionSystem, config);
  }
  
  /**
   * Chat with DotBot - Natural language to blockchain operations
   * 
   * This is the main method. Pass a message, get results.
   * 
   * @example
   * ```typescript
   * const result = await dotbot.chat("Send 2 DOT to Bob");
   * console.log(result.response);
   * console.log(result.executed); // true if transaction was executed
   * ```
   */
  async chat(message: string, options?: ChatOptions): Promise<ChatResult> {
    // Build system prompt with current context
    const systemPrompt = options?.systemPrompt || await this.buildContextualSystemPrompt();
    
    // Send to LLM
    const llmResponse = await this.callLLM(message, systemPrompt, options?.llm);
    
    // Extract execution plan
    const plan = this.extractExecutionPlan(llmResponse);
    
    // If no plan, just return the response
    if (!plan || plan.steps.length === 0) {
      console.log('ℹ️ No ExecutionPlan found - returning text response only');
      this.currentExecutionArray = null;
      return {
        response: llmResponse,
        executed: false,
        success: true,
        completed: 0,
        failed: 0
      };
    }
    
    console.log('✅ ExecutionPlan extracted:', {
      id: plan.id,
      steps: plan.steps.length,
      stepsDetails: plan.steps.map(s => ({
        agent: s.agentClassName,
        function: s.functionName,
        type: s.executionType
      }))
    });
    
    // Execute the plan with array tracking
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
      console.error('❌ Execution tracking failed:', error);
      
      // Return the error message to be shown in chat
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        response: `❌ Unable to prepare your transaction:\n\n${errorMsg}`,
        plan,
        executed: false,
        success: false,
        completed: 0,
        failed: 1
      };
    }
    
    // Generate friendly message instead of showing raw JSON
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
   * Get account balance
   */
  async getBalance(): Promise<{
    free: string;
    reserved: string;
    frozen: string;
  }> {
    console.log('💰 DotBot.getBalance() - Querying address:', this.wallet.address);
    const accountInfo = await this.api.query.system.account(this.wallet.address);
    const data = accountInfo.toJSON() as any;
    console.log('💰 DotBot.getBalance() - Raw account data:', JSON.stringify(data, null, 2));
    
    const balance = {
      free: data.data?.free || '0',
      reserved: data.data?.reserved || '0',
      frozen: data.data?.frozen || data.data?.miscFrozen || '0'
    };
    
    console.log('💰 DotBot.getBalance() - Parsed balance:', balance);
    return balance;
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
  }
  

  /**
   * Generate friendly message from execution plan
   */
  private generateFriendlyMessage(plan: ExecutionPlan, completed: number, failed: number): string {
    const totalSteps = plan.steps.length;
    
    if (totalSteps === 0) {
      return "I've prepared your request, but there are no operations to execute.";
    }
    
    if (totalSteps === 1) {
      const step = plan.steps[0];
      return `I've prepared your transaction:\n\n${step.description}\n\nPlease review and approve it in the execution panel below.`;
    }
    
    return `I've prepared ${totalSteps} operations:\n\n${plan.steps.map((s, i) => `${i + 1}. ${s.description}`).join('\n')}\n\nPlease review and approve them in the execution panel below.`;
  }

  /**
   * Build system prompt with current context
   */
  private async buildContextualSystemPrompt(): Promise<string> {
    try {
      const balance = await this.getBalance();
      const chainInfo = await this.getChainInfo();
      
      // Calculate total balance
      const freeBN = BigInt(balance.free || '0');
      const reservedBN = BigInt(balance.reserved || '0');
      const frozenBN = BigInt(balance.frozen || '0');
      const totalBN = freeBN + reservedBN + frozenBN;
      
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
          free: balance.free,
          reserved: balance.reserved,
          frozen: balance.frozen,
          total: totalBN.toString(),
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
    customLLM?: (message: string, systemPrompt: string, context?: any) => Promise<string>
  ): Promise<string> {
    if (customLLM) {
      // Pass noHistory flag to get fresh JSON response without chat history
      return await customLLM(message, systemPrompt, { noHistory: true });
    }
    
    // Default: Use ASI-One (if available in frontend)
    // For now, throw error if no custom LLM provided
    throw new Error(
      'No LLM configured. Pass a custom LLM function in chat options:\n' +
      'dotbot.chat(message, { llm: async (msg, prompt) => { /* your LLM call */ } })'
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

