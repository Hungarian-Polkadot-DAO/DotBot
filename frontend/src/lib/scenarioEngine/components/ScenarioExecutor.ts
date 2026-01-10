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
import type { SubmittableExtrinsic } from '@polkadot/api/types';
import { BN } from '@polkadot/util';
import { KeyringSigner } from '../../executionEngine/signers/keyringSigner';
import type { ExecutionPlan } from '../../prompts/system/execution/types';
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
  getEntityKeypair?: (entityName: string) => { uri: string } | undefined;
  
  /** Optional: Entity address resolver (for getting entity addresses) */
  getEntityAddress?: (entityName: string) => string | undefined;
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

        // Don't stop on error - continue to next step
        // User can manually end scenario if needed via "End Scenario" button
        // Scenarios don't auto-quit - they wait for user interaction
      }
    }

    // All steps completed
    this.emit({ type: 'log', level: 'info', message: `All ${scenario.steps.length} step(s) completed` });
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
    let input = step.input;
    if (!input) {
      throw new Error('Prompt step requires input');
    }

    // Replace entity names with addresses in the prompt
    // Example: "Send 5 WND to Alice" -> "Send 5 WND to 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
    if (this.deps?.getEntityAddress) {
      // Find entity names in the prompt (simple pattern matching for common names)
      const entityNamePattern = /\b(Alice|Bob|Charlie|Dave|Eve|Ferdie|Grace|Heinz|Ida|Judith|Ken|Larry|Mary|Nina|Oscar|Peggy|Quinn|Rita|Steve|Trent|Ursula|Victor|Wendy|Xavier|Yvonne|Zoe)\b/gi;
      input = input.replace(entityNamePattern, (match) => {
        const address = this.deps?.getEntityAddress?.(match);
        if (address) {
          this.emit({ type: 'log', level: 'debug', message: `Replaced entity "${match}" with address ${address}` });
          return address;
        }
        return match; // Keep original if address not found
      });
    }

    this.emit({ type: 'log', level: 'debug', message: `Executing prompt: "${input}"` });

    // Tell UI to inject the prompt (fills ChatInput, doesn't send - user submits manually)
    this.emit({
      type: 'inject-prompt',
      prompt: input,
    });

    // Wait for UI to process (fill ChatInput)
    await this.waitForPromptProcessed();
    
    // Wait for user to submit and get response from DotBot (via UI)
    this.emit({ 
      type: 'dotbot-activity', 
      activity: 'Processing user prompt...',
      details: `Prompt: "${input.substring(0, 80)}${input.length > 80 ? '...' : ''}"`
    });
    
    const chatResult = await this.waitForResponseReceived();
    const response = chatResult?.response || '';
    
    // Track DotBot's response with more detail
    const responseType = this.detectResponseType(response);
    const responsePreview = response.substring(0, 100);
    
    // Log detailed response information
    if (responseType === 'execution') {
      this.emit({ 
        type: 'dotbot-activity', 
        activity: 'Generated execution plan',
        details: chatResult?.plan ? `Plan has ${chatResult.plan.steps?.length || 0} step(s)` : 'Execution plan created'
      });
    } else if (responseType === 'error') {
      this.emit({ 
        type: 'dotbot-activity', 
        activity: 'Responded with error',
        details: `${responsePreview}${response.length > 100 ? '...' : ''}`
      });
    } else {
      this.emit({ 
        type: 'dotbot-activity', 
        activity: `Responded with ${responseType}`,
        details: `${responsePreview}${response.length > 100 ? '...' : ''}`
      });
    }

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

    this.emit({ type: 'log', level: 'info', message: `Executing action: ${action.type}${action.asEntity ? ` (as ${action.asEntity})` : ''}` });

    await this.performAction(action);

    const endTime = Date.now();
    
    this.emit({ type: 'log', level: 'info', message: `Action completed: ${action.type} (${endTime - startTime}ms)` });

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

    this.emit({ type: 'log', level: 'info', message: `Checking assertion: ${assertion.type}` });

    const assertionResult = await this.checkAssertion(assertion);

    const endTime = Date.now();
    
    // Log assertion result
    const icon = assertionResult.passed ? '✓' : '✗';
    this.emit({ 
      type: 'log', 
      level: assertionResult.passed ? 'info' : 'warn', 
      message: `${icon} Assertion: ${assertionResult.message}` 
    });

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
        await this.signAsParticipant(action);
        break;

      case 'approve-multisig':
        // Approve a multisig call on-chain
        await this.approveMultisig(action);
        break;

      case 'execute-multisig':
        // Execute multisig when threshold reached
        await this.executeMultisig(action);
        break;

      case 'fund-account':
        // Fund an account from dev account or faucet
        await this.fundAccount(action);
        break;

      case 'submit-extrinsic':
        // Submit any extrinsic as a specific entity
        // Log multisig address if creating a multisig
        const extrinsicParams = action.params?.extrinsic as any;
        if (extrinsicParams?.pallet === 'multisig' && extrinsicParams?.method === 'asMultiThreshold1') {
          const multisigEntity = this.deps?.getEntityAddress?.('MultisigAccount');
          if (multisigEntity) {
            this.emit({ 
              type: 'log', 
              level: 'info', 
              message: `📋 Creating multisig on-chain: ${multisigEntity}` 
            });
          }
        }
        await this.submitExtrinsic(action);
        break;

      case 'wait-blocks':
        // Wait for N blocks (for finalization)
        await this.waitForBlocks(action);
        break;

      case 'query-on-chain-state':
        // Query blockchain state
        await this.queryOnChainState(action);
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
        // Check which agent was called (from ExecutionPlan in ChatResult)
        if (!lastChatResult) {
          return { passed: false, message: 'No chat result available' };
        }
        const expectedAgent = assertion.expected as string;
        
        // Check ExecutionPlan steps for agent class name
        const agentPlan = lastChatResult.plan as ExecutionPlan | undefined;
        if (agentPlan?.steps) {
          const agentCalled = agentPlan.steps.some((step: any) => 
            step.agentClassName?.toLowerCase().includes(expectedAgent.toLowerCase())
          );
          return {
            passed: agentCalled,
            message: agentCalled
              ? `Agent ${expectedAgent} was called in ExecutionPlan`
              : `Agent ${expectedAgent} was not found in ExecutionPlan`,
          };
        }
        
        // Fallback: check if response mentions the agent
        const agentMentioned = response.toLowerCase().includes(expectedAgent.toLowerCase());
        return {
          passed: agentMentioned,
          message: agentMentioned
            ? `Agent ${expectedAgent} appears to be mentioned in response`
            : `Agent ${expectedAgent} was not detected`,
        };

      case 'check-extrinsic-creation':
        // Check if an extrinsic was created (ExecutionPlan with steps)
        if (!lastChatResult) {
          return { passed: false, message: 'No chat result available' };
        }
        
        // Check if ExecutionPlan exists and has steps
        const extrinsicPlan = lastChatResult.plan as ExecutionPlan | undefined;
        const hasPlan = !!extrinsicPlan && extrinsicPlan.steps && extrinsicPlan.steps.length > 0;
        
        // Also check if executionArray exists (from ExecutionMessage)
        const hasExecutionArray = !!(lastChatResult as any).executionArray && 
                                 (lastChatResult as any).executionArray.length > 0;
        
        const hasExtrinsic = hasPlan || hasExecutionArray;
        
        return {
          passed: hasExtrinsic,
          message: hasExtrinsic 
            ? 'Extrinsic was created (ExecutionPlan or ExecutionArray found)' 
            : 'No extrinsic was created (no ExecutionPlan or ExecutionArray)',
        };

      case 'check-balance-change':
        // Verify a balance changed (requires before/after balance tracking)
        if (!this.deps?.queryBalance && !this.deps?.api) {
          return { 
            passed: false, 
            message: 'Cannot check balance - no queryBalance function or API provided' 
          };
        }

        const entityName = assertion.entityName;
        if (!entityName) {
          return { 
            passed: false, 
            message: 'check-balance-change requires entityName in assertion' 
          };
        }

        const entityAddress = this.deps?.getEntityAddress?.(entityName);
        if (!entityAddress) {
          return { 
            passed: false, 
            message: `Entity address not found for ${entityName}` 
          };
        }

        try {
          // Get current balance
          let currentBalance: string;
          if (this.deps.queryBalance) {
            currentBalance = await this.deps.queryBalance(entityAddress);
          } else {
            const accountInfo = await this.deps.api.query.system.account(entityAddress);
            const data = accountInfo.toJSON() as any;
            currentBalance = data.data?.free || '0';
          }

          // Get expected balance from assertion
          const expectedBalance = assertion.expected as string | { free: string };
          const expectedFree = typeof expectedBalance === 'string' 
            ? expectedBalance 
            : expectedBalance?.free;

          if (!expectedFree) {
            return { 
              passed: false, 
              message: 'check-balance-change requires expected balance in assertion.expected' 
            };
          }

          // Compare balances (allow small difference for fees)
          const currentBN = new BN(currentBalance);
          const expectedBN = new BN(expectedFree);
          const difference = currentBN.sub(expectedBN).abs();
          const tolerance = new BN('1000000000'); // 0.001 DOT/WND tolerance

          const passed = difference.lte(tolerance);
          return {
            passed,
            message: passed
              ? `Balance matches expected (current: ${currentBalance}, expected: ${expectedFree})`
              : `Balance mismatch (current: ${currentBalance}, expected: ${expectedFree})`,
          };
        } catch (error) {
          return { 
            passed: false, 
            message: `Balance check failed: ${error}` 
          };
        }

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
  // BACKGROUND ACTION IMPLEMENTATIONS
  // ===========================================================================

  /**
   * Sign as a participant in a multisig transaction
   */
  private async signAsParticipant(action: ScenarioAction): Promise<void> {
    if (!action.asEntity) {
      throw new Error('sign-as-participant requires asEntity parameter');
    }

    const entityKeypair = this.deps?.getEntityKeypair?.(action.asEntity);
    if (!entityKeypair?.uri) {
      throw new Error(`Entity keypair not found for ${action.asEntity}`);
    }

    const signatories = action.params?.signatories as string[];
    const threshold = action.params?.threshold as number;
    const callHash = action.params?.callHash as string;
    const maxWeight = action.params?.maxWeight as number;

    if (!signatories || !threshold || !callHash) {
      throw new Error('sign-as-participant requires signatories, threshold, and callHash parameters');
    }

    this.emit({ 
      type: 'log', 
      level: 'info', 
      message: `Signing multisig as ${action.asEntity} (background)` 
    });

    // Create signer from entity URI (ensures address matches)
    // Use API's registry SS58 format to ensure correct address encoding
    const ss58Format = this.deps!.api.registry.chainSS58 ?? 42;
    const signer = KeyringSigner.fromUri(entityKeypair.uri, 'sr25519', {}, ss58Format);
    const entityAddress = this.deps?.getEntityAddress?.(action.asEntity);
    if (!entityAddress) {
      throw new Error(`Entity address not found for ${action.asEntity}`);
    }

    // Create approval extrinsic
    const approvalExtrinsic = this.deps!.api.tx.multisig.approveAsMulti(
      threshold,
      signatories,
      null, // timepoint (null for new approval)
      callHash,
      maxWeight || new BN(1000000000) // Default max weight
    );

    // Sign and send
    const signedExtrinsic = await signer.signExtrinsic(approvalExtrinsic, entityAddress);
    await new Promise<void>((resolve, reject) => {
      signedExtrinsic.send((result: any) => {
        if (result.status.isInBlock || result.status.isFinalized) {
          this.emit({ 
            type: 'log', 
            level: 'info', 
            message: `Multisig approval submitted by ${action.asEntity} (tx: ${result.txHash.toString()})` 
          });
          resolve();
        } else if (result.isError) {
          reject(new Error(`Multisig approval failed: ${result.status.toString()}`));
        }
      });
    });
  }

  /**
   * Approve a multisig call
   */
  private async approveMultisig(action: ScenarioAction): Promise<void> {
    // Similar to sign-as-participant, but specifically for approvals
    await this.signAsParticipant(action);
  }

  /**
   * Execute a multisig when threshold is reached
   */
  private async executeMultisig(action: ScenarioAction): Promise<void> {
    if (!action.asEntity) {
      throw new Error('execute-multisig requires asEntity parameter');
    }

    const entityKeypair = this.deps?.getEntityKeypair?.(action.asEntity);
    if (!entityKeypair?.uri) {
      throw new Error(`Entity keypair not found for ${action.asEntity}`);
    }

    const signatories = action.params?.signatories as string[];
    const threshold = action.params?.threshold as number;
    const call = action.params?.call as string | Uint8Array;
    const maxWeight = action.params?.maxWeight as number;
    const timepoint = action.params?.timepoint as { height: number; index: number } | null;

    if (!signatories || !threshold || !call) {
      throw new Error('execute-multisig requires signatories, threshold, and call parameters');
    }

    this.emit({ 
      type: 'log', 
      level: 'info', 
      message: `Executing multisig as ${action.asEntity}` 
    });

    // Use API's registry SS58 format to ensure correct address encoding
    const ss58Format = this.deps!.api.registry.chainSS58 ?? 42;
    const signer = KeyringSigner.fromUri(entityKeypair.uri, 'sr25519', {}, ss58Format);
    const entityAddress = this.deps?.getEntityAddress?.(action.asEntity);
    if (!entityAddress) {
      throw new Error(`Entity address not found for ${action.asEntity}`);
    }

    // Create execution extrinsic
    const executionExtrinsic = this.deps!.api.tx.multisig.asMulti(
      threshold,
      signatories,
      timepoint || null,
      typeof call === 'string' ? call : this.deps!.api.createType('Call', call),
      maxWeight || new BN(1000000000)
    );

    // Sign and send
    const signedExtrinsic = await signer.signExtrinsic(executionExtrinsic, entityAddress);
    await new Promise<void>((resolve, reject) => {
      signedExtrinsic.send((result: any) => {
        if (result.status.isInBlock || result.status.isFinalized) {
          this.emit({ 
            type: 'log', 
            level: 'info', 
            message: `Multisig executed by ${action.asEntity} (tx: ${result.txHash.toString()})` 
          });
          resolve();
        } else if (result.isError) {
          reject(new Error(`Multisig execution failed: ${result.status.toString()}`));
        }
      });
    });
  }

  /**
   * Fund an account from dev account
   */
  private async fundAccount(action: ScenarioAction): Promise<void> {
    const targetAddress = action.params?.address as string;
    const amount = action.params?.amount as string;
    const fromEntity = action.asEntity || 'Alice'; // Default to Alice as dev account

    if (!targetAddress || !amount) {
      throw new Error('fund-account requires address and amount parameters');
    }

    const entityKeypair = this.deps?.getEntityKeypair?.(fromEntity);
    if (!entityKeypair?.uri) {
      throw new Error(`Entity keypair not found for ${fromEntity}`);
    }

    this.emit({ 
      type: 'log', 
      level: 'info', 
      message: `Funding ${targetAddress} with ${amount} from ${fromEntity} (background)` 
    });

    // Use API's registry SS58 format to ensure correct address encoding
    const ss58Format = this.deps!.api.registry.chainSS58 ?? 42;
    const signer = KeyringSigner.fromUri(entityKeypair.uri, 'sr25519', {}, ss58Format);
    const fromAddress = this.deps?.getEntityAddress?.(fromEntity);
    if (!fromAddress) {
      throw new Error(`Entity address not found for ${fromEntity}`);
    }

    // Parse amount to BN
    const amountBN = new BN(amount);
    
    // Create transfer extrinsic
    const transferExtrinsic = this.deps!.api.tx.balances.transferKeepAlive(
      targetAddress,
      amountBN
    );

    // Sign and send
    const signedExtrinsic = await signer.signExtrinsic(transferExtrinsic, fromAddress);
    await new Promise<void>((resolve, reject) => {
      signedExtrinsic.send((result: any) => {
        if (result.status.isInBlock || result.status.isFinalized) {
          this.emit({ 
            type: 'log', 
            level: 'info', 
            message: `Account funded (tx: ${result.txHash.toString()})` 
          });
          resolve();
        } else if (result.isError) {
          reject(new Error(`Funding failed: ${result.status.toString()}`));
        }
      });
    });
  }

  /**
   * Submit an extrinsic as a specific entity
   */
  private async submitExtrinsic(action: ScenarioAction): Promise<void> {
    if (!action.asEntity) {
      throw new Error('submit-extrinsic requires asEntity parameter');
    }

    const extrinsicHex = action.params?.extrinsic as string;
    const extrinsic = action.params?.extrinsic as SubmittableExtrinsic<'promise'>;

    if (!extrinsicHex && !extrinsic) {
      throw new Error('submit-extrinsic requires extrinsic parameter (hex string or SubmittableExtrinsic)');
    }

    const entityKeypair = this.deps?.getEntityKeypair?.(action.asEntity);
    if (!entityKeypair?.uri) {
      throw new Error(`Entity keypair not found for ${action.asEntity}`);
    }

    this.emit({ 
      type: 'log', 
      level: 'info', 
      message: `Submitting extrinsic as ${action.asEntity}` 
    });

    // Use API's registry SS58 format to ensure correct address encoding
    const ss58Format = this.deps!.api.registry.chainSS58 ?? 42;
    const signer = KeyringSigner.fromUri(entityKeypair.uri, 'sr25519', {}, ss58Format);
    const entityAddress = this.deps?.getEntityAddress?.(action.asEntity);
    if (!entityAddress) {
      throw new Error(`Entity address not found for ${action.asEntity}`);
    }

    // If hex string, decode it
    let extrinsicToSubmit: SubmittableExtrinsic<'promise'>;
    if (typeof extrinsicHex === 'string') {
      extrinsicToSubmit = this.deps!.api.tx(extrinsicHex);
    } else {
      extrinsicToSubmit = extrinsic;
    }

    // Sign and send
    const signedExtrinsic = await signer.signExtrinsic(extrinsicToSubmit, entityAddress);
    await new Promise<void>((resolve, reject) => {
      signedExtrinsic.send((result: any) => {
        if (result.status.isInBlock || result.status.isFinalized) {
          this.emit({ 
            type: 'log', 
            level: 'info', 
            message: `Extrinsic submitted (tx: ${result.txHash.toString()})` 
          });
          resolve();
        } else if (result.isError) {
          reject(new Error(`Extrinsic submission failed: ${result.status.toString()}`));
        }
      });
    });
  }

  /**
   * Wait for N blocks
   */
  private async waitForBlocks(action: ScenarioAction): Promise<void> {
    const blockCount = (action.params?.blocks as number) || 1;

    this.emit({ 
      type: 'log', 
      level: 'info', 
      message: `Waiting for ${blockCount} block(s)` 
    });

    if (!this.deps?.api) {
      // Fallback to approximate timing if no API
      await this.sleep(blockCount * 6000); // ~6s per block
      return;
    }

    // Get current block number
    const currentBlock = await this.deps.api.rpc.chain.getHeader();
    const targetBlock = currentBlock.number.toNumber() + blockCount;

    // Subscribe to new blocks
    return new Promise<void>(async (resolve) => {
      const unsubscribe = await this.deps!.api.rpc.chain.subscribeNewHeads((header) => {
        const blockNumber = header.number.toNumber();
        if (blockNumber >= targetBlock) {
          unsubscribe();
          this.emit({ 
            type: 'log', 
            level: 'info', 
            message: `Reached block ${blockNumber}` 
          });
          resolve();
        }
      });
    });
  }

  /**
   * Query on-chain state
   */
  private async queryOnChainState(action: ScenarioAction): Promise<void> {
    const query = action.params?.query as string;
    const params = action.params?.params as any[];

    if (!query) {
      throw new Error('query-on-chain-state requires query parameter');
    }

    this.emit({ 
      type: 'log', 
      level: 'debug', 
      message: `Querying on-chain state: ${query}` 
    });

    if (!this.deps?.api) {
      throw new Error('API required for on-chain state queries');
    }

    // Parse query format: "System.Account(address)" or "Balances.Account(address)"
    const [pallet, method] = query.split('.');
    if (!pallet || !method) {
      throw new Error(`Invalid query format: ${query}. Expected format: "Pallet.Method"`);
    }

    try {
      const result = await this.deps.api.query[pallet][method](...(params || []));
      
      // Store result in context variables
      if (this.context) {
        this.context.variables.set(`query_${query}`, result.toJSON());
      }

      this.emit({ 
        type: 'log', 
        level: 'debug', 
        message: `Query result: ${JSON.stringify(result.toJSON())}` 
      });
    } catch (error) {
      throw new Error(`Query failed: ${error}`);
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
   * Wait for the UI to process a prompt (fill ChatInput)
   * Note: This only waits for the input to be filled, not for user submission
   * User submission is handled separately via waitForResponseReceived()
   * 
   * NO TIMEOUT - scenarios wait indefinitely for user interaction
   */
  private waitForPromptProcessed(): Promise<void> {
    return new Promise((resolve) => {
      this.promptProcessedResolver = resolve;
      // No timeout - wait indefinitely for user to interact
    });
  }

  /**
   * Wait for the UI to receive a response from DotBot
   * 
   * NO TIMEOUT - scenarios wait indefinitely for DotBot responses
   * User can manually end scenario early if needed
   */
  private waitForResponseReceived(): Promise<any> {
    return new Promise((resolve) => {
      this.responseReceivedResolver = resolve;
      // No timeout - wait indefinitely for DotBot response
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

