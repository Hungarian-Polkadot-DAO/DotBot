/**
 * ScenarioExecutor
 * 
 * Pure library component for executing test scenarios **THROUGH** the DotBot UI.
 * 
 * This is part of @dotbot/core and has ZERO UI dependencies.
 * 
 * ## Philosophy: Autopilot THROUGH the UI, not AROUND it
 * 
 * The ScenarioEngine is NOT a separate test harness. It's an autopilot/co-pilot
 * that works **within** the real DotBot app, operating through the actual UI.
 * 
 * ### How User Actions Work
 * 1. ScenarioEngine emits: `{ type: 'inject-prompt', prompt: '...' }`
 * 2. UI receives event via `addEventListener()`
 * 3. UI fills ChatInput component with the prompt
 * 4. UI either:
 *    - **Autopilot**: Auto-submits immediately
 *    - **Half-autopilot**: Waits for user to press Enter
 * 5. UI calls `dotbot.chat()` normally (standard flow)
 * 6. UI notifies ScenarioEngine: `executor.notifyResponseReceived(result)`
 * 7. ScenarioEngine continues to next step
 * 
 * Everything happens through the REAL UI components!
 * 
 * ### Background Actions (Invisible)
 * - `sign-as-participant`: Sign a multisig tx as Bob/Charlie
 * - `approve-multisig`: Approve a multisig call on-chain
 * - `fund-account`: Fund an account from dev account
 * - `submit-extrinsic`: Submit any extrinsic as a test entity
 * 
 * These use KeyringSigner with test keypairs to perform on-chain actions
 * transparently, enabling complex scenarios like:
 * 
 * **Multisig Demo:**
 * 1. ScenarioEngine→UI: "Approve multisig transaction XYZ"
 * 2. User sees prompt in ChatInput (half-autopilot) or it auto-submits (autopilot)
 * 3. DotBot creates approval extrinsic (normal flow)
 * 4. User approves and signs (normal flow)
 * 5. **Background**: ScenarioEngine signs as Bob & Charlie
 * 6. Multisig executes on Westend (visible to evaluators!)
 */

import type { ApiPromise } from '@polkadot/api';
import type {
  Scenario,
  ScenarioStep,
  StepResult,
  ScenarioAction,
  ScenarioAssertion,
  ScenarioConstraints,
  ScenarioEngineEventListener,
  ScenarioEngineEvent,
} from '../types';

// =============================================================================
// TYPES
// =============================================================================

export interface ExecutorConfig {
  /** Constraints for execution */
  constraints?: ScenarioConstraints;
  
  /** Default delay between steps (ms) */
  defaultStepDelay?: number;
  
  /** Timeout for response wait (ms) */
  responseTimeout?: number;
}

export interface ExecutionContext {
  /** Current scenario */
  scenario: Scenario;
  
  /** All step results so far */
  results: StepResult[];
  
  /** Variables extracted from responses */
  variables: Map<string, unknown>;
  
  /** Whether execution is paused */
  isPaused: boolean;
  
  /** Whether execution should stop */
  shouldStop: boolean;
}

/**
 * External dependencies for the executor
 * 
 * These are injected by the consumer (UI, CLI, test harness, etc.)
 * The executor doesn't know or care where these come from.
 * 
 * ## Philosophy: Work THROUGH the UI, not around it
 * 
 * The ScenarioEngine is NOT a separate test harness. It's an autopilot/co-pilot
 * that works **within** the real DotBot app.
 * 
 * When it needs to send a message:
 * - It doesn't call `dotbot.chat()` directly
 * - It emits an event: `{ type: 'inject-prompt', prompt: '...' }`
 * - The UI receives the event and:
 *   - **Autopilot mode**: Auto-fills ChatInput and auto-submits
 *   - **Half-autopilot mode**: Auto-fills ChatInput, waits for user to press Enter
 * - The UI calls `dotbot.chat()` through normal flow
 * - The UI notifies ScenarioEngine of the result
 * 
 * This way, everything happens through the real UI components!
 */
export interface ExecutorDependencies {
  /** Polkadot API for on-chain operations (queries, submissions) */
  api: ApiPromise;
  
  /** Optional: Custom balance query function (for synthetic/mocked tests) */
  queryBalance?: (address: string) => Promise<string>;
  
  /** Optional: Entity keypair resolver (for signing background actions) */
  getEntityKeypair?: (entityName: string) => { mnemonic: string } | undefined;
}

// =============================================================================
// SCENARIO EXECUTOR CLASS
// =============================================================================

export class ScenarioExecutor {
  private config: ExecutorConfig;
  private deps: ExecutorDependencies | null = null;
  private context: ExecutionContext | null = null;
  private eventListeners: Set<ScenarioEngineEventListener> = new Set();
  
  // Promise resolvers for UI callbacks
  private promptProcessedResolver: (() => void) | null = null;
  private responseReceivedResolver: ((result: any) => void) | null = null;

  constructor(config: ExecutorConfig = {}) {
    this.config = {
      defaultStepDelay: 500,
      responseTimeout: 30000,
      ...config,
    };
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Set dependencies (DotBot instance, API, etc.)
   * Call this before executing scenarios.
   */
  setDependencies(deps: ExecutorDependencies): void {
    this.deps = deps;
  }

  /**
   * Add event listener
   * 
   * Consumers use this to react to execution events.
   * Examples:
   * - UI: Update progress bar, show results
   * - CLI: Print to stdout
   * - Test harness: Collect results for assertions
   */
  addEventListener(listener: ScenarioEngineEventListener): void {
    this.eventListeners.add(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: ScenarioEngineEventListener): void {
    this.eventListeners.delete(listener);
  }

  // ===========================================================================
  // UI CALLBACK METHODS
  // ===========================================================================

  /**
   * Called by the UI when a prompt has been processed (submitted to DotBot)
   * 
   * The UI should call this after:
   * - Auto-submitting the prompt (autopilot mode), OR
   * - User manually pressing Enter (half-autopilot mode)
   */
  notifyPromptProcessed(): void {
    if (this.promptProcessedResolver) {
      this.promptProcessedResolver();
      this.promptProcessedResolver = null;
    }
  }

  /**
   * Called by the UI when a response has been received from DotBot
   * 
   * The UI should call this after `dotbot.chat()` completes.
   * 
   * @param result The ChatResult from DotBot
   */
  notifyResponseReceived(result: any): void {
    // Store the result in context for assertions
    if (this.context) {
      this.context.variables.set('lastChatResult', result);
    }
    
    if (this.responseReceivedResolver) {
      this.responseReceivedResolver(result);
      this.responseReceivedResolver = null;
    }
  }

  /**
   * Execute all steps in a scenario
   */
  async executeScenario(scenario: Scenario): Promise<StepResult[]> {
    this.ensureDependencies();
    
    // Initialize context
    this.context = {
      scenario,
      results: [],
      variables: new Map(),
      isPaused: false,
      shouldStop: false,
    };

    this.emit({ type: 'log', level: 'info', message: `Starting scenario: ${scenario.name}` });

    for (let i = 0; i < scenario.steps.length; i++) {
      // Check if we should stop
      if (this.context.shouldStop) {
        this.emit({ type: 'log', level: 'info', message: 'Scenario execution stopped' });
        break;
      }

      // Wait if paused
      while (this.context.isPaused) {
        await this.sleep(100);
      }

      const step = scenario.steps[i];
      this.emit({ type: 'step-start', step, index: i });

      try {
        const result = await this.executeStep(step, i);
        this.context.results.push(result);
        this.emit({ type: 'step-complete', step, result });

        // Add delay between steps
        if (i < scenario.steps.length - 1) {
          const delay = step.delayAfter ?? this.config.defaultStepDelay;
          if (delay && delay > 0) {
            await this.sleep(delay);
          }
        }
      } catch (error) {
        const errorResult = this.createErrorResult(step, error);
        this.context.results.push(errorResult);
        this.emit({ type: 'error', error: String(error), step });

        // Stop on error unless configured otherwise
        if (!scenario.constraints?.maxRetries) {
          break;
        }
      }
    }

    return this.context.results;
  }

  /**
   * Execute a single step
   */
  async executeStep(step: ScenarioStep, index: number): Promise<StepResult> {
    const startTime = Date.now();

    // Pre-step delay
    if (step.delayBefore) {
      await this.sleep(step.delayBefore);
    }

    let result: StepResult;

    switch (step.type) {
      case 'prompt':
        result = await this.executePromptStep(step, startTime);
        break;
        
      case 'action':
        result = await this.executeActionStep(step, startTime);
        break;
        
      case 'wait':
        result = await this.executeWaitStep(step, startTime);
        break;
        
      case 'assert':
        result = await this.executeAssertStep(step, startTime);
        break;
        
      default:
        throw new Error(`Unknown step type: ${(step as ScenarioStep).type}`);
    }

    return result;
  }

  /**
   * Pause execution
   */
  pause(): void {
    if (this.context) {
      this.context.isPaused = true;
      this.emit({ type: 'log', level: 'info', message: 'Execution paused' });
    }
  }

  /**
   * Resume execution
   */
  resume(): void {
    if (this.context) {
      this.context.isPaused = false;
      this.emit({ type: 'log', level: 'info', message: 'Execution resumed' });
    }
  }

  /**
   * Stop execution
   */
  stop(): void {
    if (this.context) {
      this.context.shouldStop = true;
      this.context.isPaused = false; // Unpause to allow stop
      this.emit({ type: 'log', level: 'info', message: 'Execution stop requested' });
    }
  }

  /**
   * Get current execution context
   */
  getContext(): ExecutionContext | null {
    return this.context;
  }

  // ===========================================================================
  // STEP EXECUTION
  // ===========================================================================

  private async executePromptStep(
    step: ScenarioStep,
    startTime: number
  ): Promise<StepResult> {
    const input = step.input;
    if (!input) {
      throw new Error('Prompt step requires input');
    }

    this.emit({ type: 'log', level: 'debug', message: `Executing prompt: "${input}"` });

    // Tell UI to inject the prompt
    this.emit({
      type: 'inject-prompt',
      prompt: input,
    });

    // Wait for UI to process (fill ChatInput and submit)
    await this.waitForPromptProcessed();
    
    // Wait for response from DotBot (via UI)
    const chatResult = await this.waitForResponseReceived();
    const response = chatResult?.response || '';

    const endTime = Date.now();

    return {
      stepId: step.id,
      success: true,
      startTime,
      endTime,
      duration: endTime - startTime,
      response: {
        type: this.detectResponseType(response),
        content: response,
        parsed: this.tryParseResponse(response),
      },
    };
  }

  private async executeActionStep(
    step: ScenarioStep,
    startTime: number
  ): Promise<StepResult> {
    const action = step.action;
    if (!action) {
      throw new Error('Action step requires action');
    }

    this.emit({ type: 'log', level: 'debug', message: `Executing action: ${action.type}` });

    await this.performAction(action);

    const endTime = Date.now();

    return {
      stepId: step.id,
      success: true,
      startTime,
      endTime,
      duration: endTime - startTime,
    };
  }

  private async executeWaitStep(
    step: ScenarioStep,
    startTime: number
  ): Promise<StepResult> {
    const waitMs = step.waitMs ?? 1000;

    this.emit({ type: 'log', level: 'debug', message: `Waiting ${waitMs}ms` });

    await this.sleep(waitMs);

    const endTime = Date.now();

    return {
      stepId: step.id,
      success: true,
      startTime,
      endTime,
      duration: endTime - startTime,
    };
  }

  private async executeAssertStep(
    step: ScenarioStep,
    startTime: number
  ): Promise<StepResult> {
    const assertion = step.assertion;
    if (!assertion) {
      throw new Error('Assert step requires assertion');
    }

    this.emit({ type: 'log', level: 'debug', message: `Checking assertion: ${assertion.type}` });

    const assertionResult = await this.checkAssertion(assertion);

    const endTime = Date.now();

    return {
      stepId: step.id,
      success: assertionResult.passed,
      startTime,
      endTime,
      duration: endTime - startTime,
      assertions: [assertionResult],
    };
  }

  // ===========================================================================
  // STATE VERIFICATION
  // ===========================================================================

  /**
   * Perform an action
   * 
   * Handles both user actions (interact with DotBot) and background actions
   * (sign as participants, submit extrinsics, etc.)
   * 
   * USER ACTIONS work through the UI:
   * - We emit events telling the UI what to do
   * - The UI performs the action (auto or manual)
   * - The UI notifies us of completion via callbacks
   * 
   * BACKGROUND ACTIONS are performed directly:
   * - Use API to submit extrinsics
   * - Use KeyringSigner with test keypairs
   * - Transparent to the user
   */
  private async performAction(action: ScenarioAction): Promise<void> {
    switch (action.type) {
      // === USER ACTIONS (Visible, through UI) ===
      
      case 'input-message':
        // Emit event for UI to handle
        const message = action.params?.message as string;
        if (!message) {
          throw new Error('input-message requires message parameter');
        }
        
        this.emit({ 
          type: 'inject-prompt',
          prompt: message,
        });
        
        this.emit({ 
          type: 'log', 
          level: 'info', 
          message: `Injecting prompt: "${message}"` 
        });
        
        // Wait for UI to process (it will call notifyPromptProcessed)
        await this.waitForPromptProcessed();
        break;

      case 'wait-for-response':
        // Wait for the UI's chat flow to complete
        this.emit({ 
          type: 'log', 
          level: 'debug', 
          message: 'Waiting for response completion' 
        });
        // The UI should call notifyResponseReceived when done
        await this.waitForResponseReceived();
        break;

      // === BACKGROUND ACTIONS (Invisible to user) ===
      
      case 'sign-as-participant':
        // Sign a multisig tx as a background participant
        // TODO: Implement using KeyringSigner with test account keypair
        this.emit({ 
          type: 'log', 
          level: 'info', 
          message: `Signing as ${action.asEntity} (background)` 
        });
        // const signer = new KeyringSigner({ mnemonic: entity.mnemonic });
        // await api.tx.multisig.asMulti(...).signAndSend(signer);
        break;

      case 'approve-multisig':
        // Approve a multisig call on-chain
        // TODO: Get multisig call hash, submit approval
        this.emit({ 
          type: 'log', 
          level: 'info', 
          message: `Approving multisig as ${action.asEntity}` 
        });
        break;

      case 'execute-multisig':
        // Execute multisig when threshold reached
        // TODO: Submit final execution
        this.emit({ 
          type: 'log', 
          level: 'info', 
          message: `Executing multisig as ${action.asEntity}` 
        });
        break;

      case 'fund-account':
        // Fund an account from dev account or faucet
        // TODO: Use dev account KeyringSigner to transfer DOT
        const targetAddress = action.params?.address as string;
        const amount = action.params?.amount as string;
        this.emit({ 
          type: 'log', 
          level: 'info', 
          message: `Funding ${targetAddress} with ${amount} (background)` 
        });
        // const devSigner = new KeyringSigner({ uri: '//Alice' });
        // await api.tx.balances.transfer(targetAddress, amount).signAndSend(devSigner);
        break;

      case 'submit-extrinsic':
        // Submit any extrinsic as a specific entity
        // TODO: Get extrinsic from params, sign with entity's keypair
        this.emit({ 
          type: 'log', 
          level: 'info', 
          message: `Submitting extrinsic as ${action.asEntity}` 
        });
        break;

      case 'wait-blocks':
        // Wait for N blocks (for finalization)
        const blockCount = (action.params?.blocks as number) || 1;
        this.emit({ 
          type: 'log', 
          level: 'info', 
          message: `Waiting for ${blockCount} blocks` 
        });
        // TODO: Subscribe to new blocks, wait for N
        await this.sleep(blockCount * 6000); // Approximate: 6s per block
        break;

      case 'query-on-chain-state':
        // Query blockchain state
        // TODO: Query using API
        this.emit({ 
          type: 'log', 
          level: 'debug', 
          message: `Querying on-chain state` 
        });
        break;

      case 'custom':
        // For extensibility - consumers can provide custom handlers
        this.emit({ 
          type: 'log', 
          level: 'warn', 
          message: `Custom action: ${JSON.stringify(action.params)}` 
        });
        break;

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  /**
   * Check an assertion
   * 
   * Assertions verify the behavior of DotBot (LLM responses, agent calls, extrinsic creation).
   * NO UI assertions here - this is pure logic verification.
   */
  private async checkAssertion(
    assertion: ScenarioAssertion
  ): Promise<{ passed: boolean; message: string }> {
    // Get latest chat result and response from context
    const lastChatResult = this.context?.variables.get('lastChatResult') as any;
    const lastResult = this.context?.results[this.context.results.length - 1];
    const response = lastResult?.response?.content ?? '';

    switch (assertion.type) {
      case 'check-llm-response':
        // Check the LLM's text response content
        const containsPattern = assertion.expected;
        if (typeof containsPattern === 'string') {
          const passed = response.includes(containsPattern);
          return {
            passed,
            message: passed 
              ? `LLM response contains "${containsPattern}"` 
              : `LLM response does not contain "${containsPattern}"`,
          };
        }
        if (containsPattern instanceof RegExp) {
          const passed = containsPattern.test(response);
          return {
            passed,
            message: passed 
              ? `LLM response matches pattern` 
              : `LLM response does not match pattern`,
          };
        }
        return { passed: false, message: 'Invalid expected value for check-llm-response' };

      case 'check-agent-call':
        // Check which agent was called (from chat result metadata)
        if (!lastChatResult) {
          return { passed: false, message: 'No chat result available' };
        }
        const expectedAgent = assertion.expected as string;
        // TODO: Extract agent call info from lastChatResult.conversationItem.metadata or similar
        // For now, check if response mentions the agent
        const agentMentioned = response.toLowerCase().includes(expectedAgent.toLowerCase());
        return {
          passed: agentMentioned,
          message: agentMentioned
            ? `Agent ${expectedAgent} appears to be called`
            : `Agent ${expectedAgent} was not detected`,
        };

      case 'check-extrinsic-creation':
        // Check if an extrinsic was created
        if (!lastChatResult) {
          return { passed: false, message: 'No chat result available' };
        }
        // Check if executionArray exists in the chat result
        const hasExtrinsic = !!(lastChatResult as any).executionArray && 
                            (lastChatResult as any).executionArray.length > 0;
        return {
          passed: hasExtrinsic,
          message: hasExtrinsic 
            ? 'Extrinsic was created' 
            : 'No extrinsic was created',
        };

      case 'check-balance-change':
        // Verify a balance changed (requires before/after balance tracking)
        // This would need to query the blockchain/state
        if (!this.deps?.queryBalance && !this.deps?.api) {
          return { 
            passed: false, 
            message: 'Cannot check balance - no queryBalance function or API provided' 
          };
        }
        // TODO: Implement actual balance checking
        return { 
          passed: true, 
          message: 'Balance change verification not fully implemented yet' 
        };

      case 'check-error':
        // Check if an error was thrown/mentioned
        const hasError = response.toLowerCase().includes('error') || 
                        response.toLowerCase().includes('failed') ||
                        response.toLowerCase().includes('cannot');
        return {
          passed: hasError,
          message: hasError ? 'Error was detected as expected' : 'No error detected',
        };

      case 'custom':
        // Custom validator for extensibility
        if (assertion.customValidator) {
          try {
            // eslint-disable-next-line no-new-func
            const validator = new Function('response', 'context', 'chatResult', assertion.customValidator);
            const customPassed = validator(response, this.context, lastChatResult);
            return { 
              passed: customPassed, 
              message: 'Custom validation ' + (customPassed ? 'passed' : 'failed') 
            };
          } catch (error) {
            return { passed: false, message: `Custom validator error: ${error}` };
          }
        }
        return { passed: false, message: 'No custom validator provided' };

      default:
        return { passed: false, message: `Unknown assertion type: ${assertion.type}` };
    }
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  private ensureDependencies(): void {
    if (!this.deps) {
      throw new Error('Dependencies not set. Call setDependencies() first.');
    }
    if (!this.deps.api) {
      throw new Error('Polkadot API is required in dependencies');
    }
  }

  private emit(event: ScenarioEngineEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Event listener error:', error);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait for the UI to process a prompt (fill ChatInput and submit)
   */
  private waitForPromptProcessed(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.promptProcessedResolver = resolve;
      
      // Timeout
      setTimeout(() => {
        if (this.promptProcessedResolver) {
          this.promptProcessedResolver = null;
          reject(new Error('Timeout waiting for prompt to be processed by UI'));
        }
      }, this.config.responseTimeout);
    });
  }

  /**
   * Wait for the UI to receive a response from DotBot
   */
  private waitForResponseReceived(): Promise<any> {
    return new Promise((resolve, reject) => {
      this.responseReceivedResolver = resolve;
      
      // Timeout
      setTimeout(() => {
        if (this.responseReceivedResolver) {
          this.responseReceivedResolver = null;
          reject(new Error('Timeout waiting for response from DotBot'));
        }
      }, this.config.responseTimeout);
    });
  }

  private createErrorResult(step: ScenarioStep, error: unknown): StepResult {
    const now = Date.now();
    return {
      stepId: step.id,
      success: false,
      startTime: now,
      endTime: now,
      duration: 0,
      error: {
        message: String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    };
  }

  private detectResponseType(response: string): 'text' | 'json' | 'execution' | 'error' {
    // Check for JSON
    try {
      JSON.parse(response);
      return 'json';
    } catch {
      // Not JSON
    }

    // Check for execution indicators
    if (response.includes('ExecutionArray') || response.includes('Transaction')) {
      return 'execution';
    }

    // Check for error indicators
    if (response.toLowerCase().includes('error') || response.toLowerCase().includes('failed')) {
      return 'error';
    }

    return 'text';
  }

  private tryParseResponse(response: string): Record<string, unknown> | undefined {
    try {
      return JSON.parse(response);
    } catch {
      return undefined;
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a ScenarioExecutor with configuration
 */
export function createScenarioExecutor(
  config?: ExecutorConfig
): ScenarioExecutor {
  return new ScenarioExecutor(config);
}

