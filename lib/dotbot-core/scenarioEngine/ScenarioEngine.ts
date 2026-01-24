/**
 * ScenarioEngine
 * 
 * **ARCHITECTURE PRINCIPLE**: ScenarioEngine is a CONTROLLER, not a replacement for DotBot.
 * 
 * ## Core Design Principle
 * 
 * ScenarioEngine **CONTROLS** DotBot, it does NOT create duplicate state or replace DotBot.
 * - ✅ ScenarioEngine creates test entities (Alice, Bob, multisigs)
 * - ✅ ScenarioEngine funds accounts on the REAL chain (live mode)
 * - ✅ ScenarioEngine injects prompts to DotBot's UI
 * - ✅ ScenarioEngine evaluates DotBot's responses
 * - ❌ ScenarioEngine does NOT create mock balances that shadow DotBot's view
 * - ❌ ScenarioEngine does NOT create parallel APIs or state
 * 
 * ## Current Implementation Status
 * 
 * **LIVE Mode**: ✅ READY
 * - Creates real test entities with deterministic addresses
 * - Funds accounts on real Westend testnet via batch transfers
 * - DotBot sees the same state (real chain)
 * - Tests work correctly
 * 
 * **SYNTHETIC Mode**: ⚠️ TODO (Disabled)
 * - Future: Mock DotBot's LLM responses entirely
 * - Don't actually query chain or run DotBot
 * - Fast unit testing
 * - Requires: Response mocking system
 * 
 * **EMULATED Mode**: ⚠️ TODO (Disabled)
 * - Future: Create Chopsticks fork AND reconnect DotBot to it
 * - DotBot must use Chopsticks API, not real chain API
 * - Realistic integration testing without testnet costs
 * - Requires: DotBot reconfiguration support
 * 
 * ## Usage (Live Mode)
 * 
 * ```typescript
 * const engine = new ScenarioEngine();
 * await engine.initialize();
 * 
 * // Set wallet for funding (user must approve)
 * engine.setWalletForLiveMode(account, signer);
 * 
 * // Run scenario - will fund accounts on real testnet
 * const result = await engine.runScenario(myScenario);
 * console.log(result.evaluation.summary);
 * ```
 */

import type {
  Scenario,
  ScenarioResult,
  ScenarioEngineConfig,
  ScenarioEngineState,
  ScenarioEngineEvent,
  ScenarioEngineEventListener,
  TestEntity,
  EntityConfig,
  ScenarioChain,
  ScenarioMode,
  EvaluationResult,
} from './types';

import { ScenarioEndReason } from './types';
import { isBrowser } from '../env';

import { DotBot, DotBotEventListener, ChatResult, DotBotEventType } from '../dotbot';

import {
  EntityCreator,
  createEntityCreator,
  StateAllocator,
  createStateAllocator,
  FundingRequiredError,
  ScenarioExecutor,
  createScenarioExecutor,
  Evaluator,
  createEvaluator,
  ExecutorDependencies,
} from './components';

import type { ApiPromise } from '@polkadot/api';

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const DEFAULT_CONFIG: Required<ScenarioEngineConfig> = {
  defaultEnvironment: {
    chain: 'westend',
    mode: 'live', // Only live mode is implemented. Synthetic/emulated are TODO.
  },
  logLevel: 'info',
  autoSaveResults: true,
  resultsStoragePrefix: 'dotbot_scenario_',
};

// =============================================================================
// SCENARIO ENGINE CLASS
// =============================================================================

export class ScenarioEngine {
  private config: Required<ScenarioEngineConfig>;
  private state: ScenarioEngineState;
  private eventListeners: Set<ScenarioEngineEventListener> = new Set();
  
  // Components
  private entityCreator: EntityCreator | null = null;
  private stateAllocator: StateAllocator | null = null;
  private executor: ScenarioExecutor | null = null;
  private evaluator: Evaluator | null = null;
  
  // Dependencies for executor
  private executorDeps: ExecutorDependencies | null = null;
  
  // RPC managers for StateAllocator (optional)
  private rpcManagerProvider: (() => {
    relayChainManager?: any;
    assetHubManager?: any;
  } | null) | null = null;
  
  // Wallet account and signer for live mode transfers
  private walletAccount?: { address: string; name?: string; source: string };
  private walletSigner?: any;
  
  // DotBot instance for event subscription
  private dotbot: DotBot | null = null;
  private dotbotEventListener: DotBotEventListener | null = null;
  
  // Report builder - accumulates all execution data for display
  private reportContent = '';
  private currentStepIndex = -1;
  private currentStepPrompt: string | null = null;
  private lastDotBotResponse: ChatResult | null = null; // Track last response to avoid duplicates
  
  // Track running scenario for early ending
  private runningScenario: Scenario | null = null;
  private scenarioStartTime = 0;
  
  // Track execution subscriptions for report updates
  private executionSubscriptions: Map<string, () => void> = new Map();
  // Track last reported status for each execution item to avoid duplicates
  private lastReportedStatus: Map<string, Map<string, string>> = new Map(); // executionId -> itemId -> status
  // Track which executions have had completion events emitted (to avoid duplicates)
  private lastExecutionCompleteState: Set<string> | null = null;
  
  // Event and error tracking for summary generation
  private capturedEvents: ScenarioEngineEvent[] = [];
  private capturedErrors: Array<{ step?: string; message: string; timestamp: number; stack?: string }> = [];
  private scenarioEndReason: ScenarioEndReason | null = null;

  constructor(config: ScenarioEngineConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      status: 'idle',
      entities: new Map(),
    };
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Initialize the scenario engine
   */
  async initialize(): Promise<void> {
    this.log('info', 'Initializing ScenarioEngine...');
    this.updateState({ status: 'preparing' });

    try {
      // Initialize evaluator with entity resolver
      this.evaluator = createEvaluator({
        entityResolver: (name: string) => this.state.entities.get(name)?.address,
      });

      // Forward evaluator events (LLM-consumable logs)
      this.evaluator.addEventListener((event) => this.emit(event));

      // Initialize executor
      this.executor = createScenarioExecutor();

      // Forward executor events AND build report
      this.executor.addEventListener((event) => {
        // Capture event for summary
        this.captureEvent(event);
        
        // Forward to external listeners
        this.emit(event);
        
        // Build report internally
        this.handleExecutorEventForReport(event);
        
        // Handle errors specifically
        if (event.type === 'error') {
          this.captureError({
            step: event.step?.id,
            message: event.error,
          });
        }
      });

      this.log('info', 'ScenarioEngine initialized');
      this.updateState({ status: 'idle' });
    } catch (error) {
      this.log('error', `Initialization failed: ${error}`);
      this.updateState({ status: 'error', error: String(error) });
      throw error;
    }
  }

  /**
   * Set dependencies for executor (DotBot instance, API, etc.)
   * 
   * This must be called before running scenarios.
   * The consumer (UI, CLI, test harness) provides these dependencies.
   */
  setDependencies(deps: ExecutorDependencies): void {
    this.executorDeps = deps;
    if (this.executor) {
      this.executor.setDependencies(deps);
    }
    this.log('debug', 'Executor dependencies set');
  }
  
  /**
   * Subscribe to DotBot events for automatic response capture
   * 
   * This is the DEEP integration - ScenarioEngine listens to DotBot at the library level,
   * automatically capturing all responses without UI-level hooking.
   * 
   * @param dotbot The DotBot instance to subscribe to
   */
  subscribeToDotBot(dotbot: DotBot): void {
    // Unsubscribe from previous DotBot if any
    if (this.dotbot && this.dotbotEventListener) {
      this.dotbot.removeEventListener(this.dotbotEventListener);
    }
    
    this.dotbot = dotbot;
    
    // Create event listener that automatically notifies executor AND builds report
    // IMPORTANT: Only handle chat-complete - it contains everything we need
    // bot-message-added and execution-message-added fire BEFORE chat-complete and are redundant
    this.dotbotEventListener = (event) => {
      // Log all DotBot events for debugging (use info level so we can see them)
      this.log('info', `[ScenarioEngine] DotBot event received: ${event.type}`);
      
      if (!this.executor) {
        this.log('warn', `[ScenarioEngine] DotBot event ${event.type} received but executor not available`);
        // Still process events even if executor isn't ready (for logging purposes)
        // But don't notify executor
      }
      
      switch (event.type) {
        case DotBotEventType.CHAT_STARTED:
          // Track when chat starts (for report)
          // Use a simple cursor indicator instead of blinking text
          if (this.currentStepPrompt) {
            this.appendToReport(`\n[INFO] DotBot: Processing... █\n`);
            this.log('info', `DotBot started processing: "${this.currentStepPrompt.substring(0, 80)}${this.currentStepPrompt.length > 80 ? '...' : ''}"`);
          } else {
            // Even if we don't have the prompt, log that chat started
            this.appendToReport(`\n[INFO] DotBot: Chat started █\n`);
            this.log('info', 'DotBot chat started');
          }
          break;
          
        case DotBotEventType.CHAT_COMPLETE: {
          // PRIMARY event - contains full ChatResult with response, plan, execution status
          // This fires AFTER bot-message-added and execution-message-added
          // It's the authoritative source - use this and ignore the others
          const chatResult = event.result;
          
          // Log that we received a response
          this.log('info', `[ScenarioEngine] DotBot chat-complete event received`);
          this.log('info', `DotBot response received: ${chatResult.response ? chatResult.response.substring(0, 100) + (chatResult.response.length > 100 ? '...' : '') : 'empty'}`);
          
          // Note: execution-message-added fires BEFORE chat-complete, so ExecutionFlow should already be logged
          // But we log the final response here
          this.appendToReport(`\n[INFO] ✓ DotBot Response Complete\n`);
          
          // Capture event for summary
          this.captureEvent({ 
            type: 'dotbot-activity', 
            activity: 'Response received',
            details: chatResult.response ? chatResult.response.substring(0, 200) : 'Empty response'
          });
          
          this.lastDotBotResponse = chatResult;
          
          // CRITICAL: Notify executor that response was received (this resolves waitForResponseReceived promise)
          if (this.executor) {
            this.log('info', '[ScenarioEngine] Notifying executor of response');
            this.executor.notifyResponseReceived(chatResult);
          } else {
            this.log('warn', '[ScenarioEngine] Executor not available - cannot notify of response');
          }
          
          this.appendDotBotResponseToReport(chatResult);
          break;
        }
          
        case DotBotEventType.BOT_MESSAGE_ADDED:
          // IGNORE - chat-complete will fire after this with the same data
          // Only used for UI display, not for scenario execution
          break;
          
        case DotBotEventType.EXECUTION_MESSAGE_ADDED:
          // Subscribe to execution updates to track progress in report
          this.log('info', `[ScenarioEngine] ✓ EXECUTION FLOW DETECTED: ${event.executionId}`);
          
          // Log execution plan details if available
          if (event.plan) {
            const stepCount = event.plan.steps?.length || 0;
            this.appendToReport(`\n[INFO] ✓ Execution Flow Appeared\n`);
            this.appendToReport(`  Execution ID: ${event.executionId}\n`);
            this.appendToReport(`  Plan: ${stepCount} step(s)\n`);
            
            if (stepCount > 0 && event.plan.steps) {
              this.appendToReport(`  Steps:\n`);
              event.plan.steps.forEach((step, idx) => {
                const stepDesc = step.description || `${step.agentClassName}.${step.functionName}`;
                this.appendToReport(`    ${idx + 1}. ${stepDesc}\n`);
              });
            }
            
            this.log('info', `Execution plan has ${stepCount} step(s)`);
            this.log('info', `Execution plan steps: ${event.plan.steps.map(s => s.description || `${s.agentClassName}.${s.functionName}`).join(', ')}`);
          } else {
            this.appendToReport(`\n[INFO] ✓ Execution Flow Appeared (ID: ${event.executionId})\n`);
            this.log('warn', `Execution flow appeared but no plan in event`);
          }
          
          // Capture event for summary
          this.captureEvent({ 
            type: 'dotbot-activity', 
            activity: 'Execution flow appeared',
            details: event.plan ? `Plan with ${event.plan.steps?.length || 0} step(s)` : `Execution ID: ${event.executionId}`
          });
          
          if (dotbot.currentChat && event.executionId) {
            this.subscribeToExecutionUpdates(dotbot.currentChat, event.executionId);
          }
          break;
          
        case DotBotEventType.CHAT_ERROR: {
          // Capture the error
          this.captureError({
            message: event.error.message,
            stack: event.error.stack,
          });
          
          const errorResult: ChatResult = {
            response: event.error.message,
            executed: false,
            success: false,
            completed: 0,
            failed: 1,
          };
          this.lastDotBotResponse = errorResult;
          
          // Notify executor if available
          if (this.executor) {
            this.executor.notifyResponseReceived(errorResult);
          } else {
            this.log('warn', '[ScenarioEngine] Executor not available - cannot notify of error response');
          }
          
          this.appendDotBotResponseToReport(errorResult);
          break;
        }
          
        case DotBotEventType.USER_MESSAGE_ADDED:
          // Log user message to report (for visibility)
          if (event.message) {
            this.appendToReport(`\n[INFO] User message: "${event.message.substring(0, 100)}${event.message.length > 100 ? '...' : ''}"\n`);
          }
          break;
          
        case DotBotEventType.EXECUTION_MESSAGE_UPDATED:
          // This event is handled via execution subscription (subscribeToExecutionUpdates)
          // But we log it here for visibility
          this.log('info', `[ScenarioEngine] Execution updated: ${event.executionId}`);
          break;
          
        default:
          // Log unhandled events for debugging
          this.log('debug', `[ScenarioEngine] Unhandled DotBot event: ${(event as any).type}`);
          break;
      }
    };
    
    // Subscribe to DotBot events
    dotbot.addEventListener(this.dotbotEventListener);
    this.log('info', 'Subscribed to DotBot events for automatic response capture');
  }
  
  /**
   * Append DotBot response to report
   */
  private appendDotBotResponseToReport(result: ChatResult): void {
    this.log('info', '[ScenarioEngine] appendDotBotResponseToReport called');
    
    // Always log that we're processing a response, even if empty
    this.appendToReport(`\n[INFO] DotBot Response Received\n`);
    
    if (!result || !result.response) {
      this.appendToReport(`  ⚠️ Empty or null response from DotBot\n`);
      this.log('warn', 'DotBot returned empty or null response');
      if (result) {
        this.log('debug', `Result object: ${JSON.stringify(Object.keys(result))}`);
      }
      return;
    }
    
    this.log('info', `Appending DotBot response to report (${result.response.length} chars)`);
    
    this.appendToReport(`\n  ┌─ DotBot Response ─────────────────────────────────────\n`);
    
    // Split response into lines and indent each line
    const lines = result.response.split('\n');
    lines.forEach((line: string) => {
      this.appendToReport(`  │ ${line}\n`);
    });
    
    this.appendToReport(`  └───────────────────────────────────────────────────────\n`);
    
    // Log response summary
    this.log('info', `DotBot response logged to report (${result.response.length} chars)`);
    
    // Add execution plan info if available
    if (result.plan) {
      this.appendToReport(`\n  [INFO] Execution Plan Detected\n`);
      this.appendToReport(`  ✓ Execution Plan: ${result.plan.steps.length} step(s)\n`);
      this.log('info', `Execution plan found: ${result.plan.steps.length} step(s)`);
      
      if (result.plan.steps.length > 0) {
        this.appendToReport(`    Steps:\n`);
        result.plan.steps.forEach((step, idx) => {
          const stepDesc = step.description || `${step.agentClassName}.${step.functionName}`;
          this.appendToReport(`      ${idx + 1}. ${stepDesc}\n`);
          this.log('debug', `  Step ${idx + 1}: ${stepDesc}`);
        });
      }
    } else {
      this.log('info', 'No execution plan in response (conversation only)');
    }
    
    // Add execution status
    if (result.executed) {
      this.appendToReport(`\n  [INFO] Execution Status\n`);
      this.appendToReport(`  ✓ Executed: ${result.completed} completed, ${result.failed} failed\n`);
      this.log('info', `Execution completed: ${result.completed} succeeded, ${result.failed} failed`);
    } else if (result.plan) {
      this.appendToReport(`\n  [INFO] Execution prepared but not yet executed (awaiting user approval)\n`);
      this.log('info', 'Execution plan prepared, awaiting user approval');
    }
    
    this.log('info', '[ScenarioEngine] Finished appending DotBot response to report');
  }
  
  /**
   * Subscribe to execution updates for a specific execution
   */
  private subscribeToExecutionUpdates(chatInstance: any, executionId: string): void {
    // Clean up existing subscription if any
    const existingUnsubscribe = this.executionSubscriptions.get(executionId);
    if (existingUnsubscribe) {
      existingUnsubscribe();
    }
    
    // Subscribe to execution updates
    const unsubscribe = chatInstance.onExecutionUpdate(executionId, (state: any) => {
      this.appendExecutionStatusToReport(state);
    });
    
    this.executionSubscriptions.set(executionId, unsubscribe);
  }
  
  /**
   * Append execution status updates to report
   */
  private appendExecutionStatusToReport(state: any): void {
    if (!state || !state.items || state.items.length === 0) return;
    
    const executionId = state.id;
    if (!executionId) return;
    
    // Get or create status tracking map for this execution
    if (!this.lastReportedStatus.has(executionId)) {
      this.lastReportedStatus.set(executionId, new Map());
    }
    const statusMap = this.lastReportedStatus.get(executionId)!;
    
    // Track overall execution status (same logic as ExecutionFlow component)
    const isComplete = state.items.every((item: any) => 
      item.status === 'completed' || item.status === 'finalized' || item.status === 'failed' || item.status === 'cancelled'
    );
    const isExecuting = !isComplete && (
      state.isExecuting || state.items.some((item: any) => 
        item.status === 'executing' || item.status === 'signing' || item.status === 'broadcasting'
      )
    );
    
    // Emit dotbot-activity update when execution completes
    if (isComplete && !this.lastExecutionCompleteState?.has(executionId)) {
      const completedCount = state.items.filter((item: any) => 
        item.status === 'completed' || item.status === 'finalized'
      ).length;
      const failedCount = state.items.filter((item: any) => item.status === 'failed').length;
      
      if (completedCount > 0) {
        this.emit({
          type: 'dotbot-activity',
          activity: `Execution completed: ${completedCount} succeeded${failedCount > 0 ? `, ${failedCount} failed` : ''}`,
        });
      }
      
      // Track that we've emitted completion for this execution
      if (!this.lastExecutionCompleteState) {
        this.lastExecutionCompleteState = new Set();
      }
      this.lastExecutionCompleteState.add(executionId);
    }
    
    // Find items with status changes (only report if status changed)
    state.items.forEach((item: any, index: number) => {
      const lastStatus = statusMap.get(item.id);
      if (lastStatus === item.status) {
        return; // Skip if status hasn't changed
      }
      
      // Update tracked status
      statusMap.set(item.id, item.status);
      
      const statusLabel = this.getExecutionStatusLabel(item.status);
      
      if (item.status === 'completed' || item.status === 'finalized') {
        this.appendToReport(`  ✓ Step ${index + 1}: ${item.description} - ${statusLabel}\n`);
        if (item.result?.txHash) {
          this.appendToReport(`    Tx: ${item.result.txHash.slice(0, 16)}...${item.result.txHash.slice(-8)}\n`);
        }
      } else if (item.status === 'failed') {
        this.appendToReport(`  ✗ Step ${index + 1}: ${item.description} - ${statusLabel}\n`);
        if (item.error) {
          this.appendToReport(`    Error: ${item.error}\n`);
        }
      } else if (item.status === 'signing' || item.status === 'broadcasting' || item.status === 'executing') {
        this.appendToReport(`  → Step ${index + 1}: ${item.description} - ${statusLabel}...\n`);
      }
    });
    
    // Show completion summary (only once)
    if (isComplete && !statusMap.has('_completed')) {
      statusMap.set('_completed', 'true');
      const completed = state.completedItems || 0;
      const failed = state.failedItems || 0;
      const total = state.totalItems || 0;
      
      if (failed === 0) {
        this.appendToReport(`\n  ✅ Execution completed successfully: ${completed}/${total} step(s)\n`);
      } else {
        this.appendToReport(`\n  ⚠️ Execution completed with errors: ${completed} succeeded, ${failed} failed\n`);
      }
    }
  }
  
  /**
   * Get human-readable status label
   */
  private getExecutionStatusLabel(status: string): string {
    switch (status) {
      case 'pending': return 'Pending';
      case 'ready': return 'Ready';
      case 'signing': return 'Signing';
      case 'broadcasting': return 'Broadcasting';
      case 'executing': return 'Executing';
      case 'in_block': return 'In Block';
      case 'finalized': return 'Finalized';
      case 'completed': return 'Completed';
      case 'failed': return 'Failed';
      case 'cancelled': return 'Cancelled';
      default: return status;
    }
  }
  
  /**
   * Append text to report and emit update event
   */
  private appendToReport(text: string): void {
    this.reportContent += text;
    this.emit({ type: 'report-update', content: text });
  }
  
  /**
   * Clear report and reset tracking
   * @param silent - If true, clears internal state without emitting report-clear event
   *                 Use this when immediately replacing content to avoid unnecessary renders
   */
  private clearReport(silent = false): void {
    this.reportContent = '';
    this.capturedEvents = [];
    this.capturedErrors = [];
    this.scenarioEndReason = null;
    if (!silent) {
      this.emit({ type: 'report-clear' });
    }
  }
  
  /**
   * Capture an event for summary generation
   */
  private captureEvent(event: ScenarioEngineEvent): void {
    this.capturedEvents.push(event);
    // Keep only last 1000 events to prevent memory issues
    if (this.capturedEvents.length > 1000) {
      this.capturedEvents.shift();
    }
  }
  
  /**
   * Capture an error for summary generation
   */
  private captureError(error: { step?: string; message: string; stack?: string }): void {
    this.capturedErrors.push({
      ...error,
      timestamp: Date.now(),
    });
  }
  
  /**
   * Get current report content
   */
  getReport(): string {
    return this.reportContent;
  }
  
  /**
   * Generate a short, easy-to-read summary of the scenario execution
   */
  private generateSummary(result: ScenarioResult, evaluation: EvaluationResult): string {
    const lines: string[] = [];
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('📊 SCENARIO SUMMARY');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Basic info
    lines.push(`Scenario: ${result.scenarioId}`);
    lines.push(`Status: ${evaluation.passed ? '✅ PASSED' : '❌ FAILED'}`);
    lines.push(`Duration: ${(result.duration / 1000).toFixed(2)}s`);
    lines.push(`End Reason: ${this.scenarioEndReason || 'unknown'}`);
    lines.push('');
    
    // Steps summary
    const totalSteps = result.stepResults.length;
    const successfulSteps = result.stepResults.filter(s => s.success).length;
    const failedSteps = totalSteps - successfulSteps;
    lines.push(`Steps: ${successfulSteps}/${totalSteps} succeeded${failedSteps > 0 ? `, ${failedSteps} failed` : ''}`);
    
    // Execution summary
    const executedSteps = result.stepResults.filter(s => s.executionStats?.executed).length;
    if (executedSteps > 0) {
      const totalExecuted = result.stepResults.reduce((sum, s) => sum + (s.executionStats?.completed || 0), 0);
      const totalFailed = result.stepResults.reduce((sum, s) => sum + (s.executionStats?.failed || 0), 0);
      lines.push(`Executions: ${totalExecuted} completed${totalFailed > 0 ? `, ${totalFailed} failed` : ''}`);
    }
    
    // Expectations summary
    const metExpectations = evaluation.expectations.filter(e => e.met).length;
    const totalExpectations = evaluation.expectations.length;
    lines.push(`Expectations: ${metExpectations}/${totalExpectations} met`);
    lines.push('');
    
    // Errors summary
    if (this.capturedErrors.length > 0) {
      lines.push(`⚠️ Errors: ${this.capturedErrors.length} error(s) occurred`);
      this.capturedErrors.slice(0, 3).forEach((err, idx) => {
        lines.push(`  ${idx + 1}. ${err.step ? `[${err.step}] ` : ''}${err.message.substring(0, 80)}${err.message.length > 80 ? '...' : ''}`);
      });
      if (this.capturedErrors.length > 3) {
        lines.push(`  ... and ${this.capturedErrors.length - 3} more`);
      }
      lines.push('');
    }
    
    // Key events summary
    const keyEvents = this.capturedEvents.filter(e => 
      e.type === 'step-start' || 
      e.type === 'step-complete' || 
      e.type === 'dotbot-activity' ||
      e.type === 'phase-start'
    );
    if (keyEvents.length > 0) {
      lines.push(`Events: ${keyEvents.length} key event(s) captured`);
    }
    
    // Recommendations
    if (evaluation.recommendations && evaluation.recommendations.length > 0) {
      lines.push('');
      lines.push('Recommendations:');
      evaluation.recommendations.slice(0, 3).forEach((rec, idx) => {
        lines.push(`  ${idx + 1}. ${rec.substring(0, 100)}${rec.length > 100 ? '...' : ''}`);
      });
    }
    
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(''); // Empty line for separation
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(''); // Empty line for separation
    
    return lines.join('\n');
  }
  
  /**
   * Download the current report as a file
   * 
   * Only works in browser environment. In Node.js, this method will log a warning.
   * 
   * @param scenarioName Name of the scenario (for filename)
   * @param environment Environment name (mainnet/testnet) for filename
   * @returns The filename that was used, or null if not in browser
   */
  downloadReport(scenarioName?: string, environment?: string): string | null {
    if (!isBrowser()) {
      this.log('warn', 'downloadReport() is only available in browser environment');
      return null;
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5); // Format: 2026-01-14T12-00-00
    const scenarioPart = scenarioName ? scenarioName.replace(/[^a-zA-Z0-9]/g, '_') : 'scenario';
    const envPart = environment ? environment : 'unknown';
    const filename = `${scenarioPart}_${timestamp}_${envPart}.txt`;
    
    // Create blob and download
    const blob = new Blob([this.reportContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    this.log('info', `Report downloaded: ${filename}`);
    return filename;
  }
  
  /**
   * Handle executor events to build report
   */
  private handleExecutorEventForReport(event: any): void {
    switch (event.type) {
      case 'step-start': {
        this.currentStepIndex = event.index || -1;
        this.currentStepPrompt = event.step?.input || null;
        this.lastDotBotResponse = null; // Reset for new step
        
        const stepNum = (event.index || 0) + 1;
        const stepTypeMap: Record<string, string> = {
          'prompt': 'Prompt',
          'action': 'Action',
          'wait': 'Wait',
          'assert': 'Assertion',
        };
        const stepTypeLabel = stepTypeMap[event.step?.type] || event.step?.type || 'Unknown';
        
        this.appendToReport(`\n[STEP ${stepNum}] ${stepTypeLabel}`);
        if (event.step?.id) {
          this.appendToReport(` (${event.step.id})`);
        }
        this.appendToReport(`\n`);
        
        if (event.step?.input) {
          this.appendToReport(`  Input: "${event.step.input.substring(0, 100)}${event.step.input.length > 100 ? '...' : ''}"\n`);
        } else if (event.step?.action) {
          this.appendToReport(`  Action: ${event.step.action.type}\n`);
          if (event.step.action.asEntity) {
            this.appendToReport(`  As Entity: ${event.step.action.asEntity}\n`);
          }
        } else if (event.step?.waitMs) {
          this.appendToReport(`  Duration: ${event.step.waitMs}ms\n`);
        } else if (event.step?.assertion) {
          this.appendToReport(`  Assertion Type: ${event.step.assertion.type}\n`);
        }
        break;
      }
        
      case 'step-complete':
        if (event.result) {
          this.appendToReport(`  ✓ Response Type: ${event.result.response?.type || 'N/A'}\n`);
          this.appendToReport(`  ✓ Duration: ${event.result.duration}ms\n`);
          
          // DotBot response should already be in report from DotBot events
          // Only add if missing (fallback needed)
          if (event.result.response?.content && !this.lastDotBotResponse) {
            this.appendDotBotResponseToReport({
              response: event.result.response.content,
              executed: false,
              success: event.result.success,
              completed: 0,
              failed: event.result.success ? 0 : 1,
            });
          }
          
          // Show execution plan from StepResult if available (more reliable than ChatResult)
          if (event.result.executionPlan) {
            this.appendToReport(`  ✓ Execution Plan: ${event.result.executionPlan.steps.length} step(s)\n`);
            if (event.result.executionPlan.steps.length > 0) {
              this.appendToReport(`    Steps:\n`);
              event.result.executionPlan.steps.forEach((step: any, idx: number) => {
                const stepDesc = step.description || `${step.agentClassName}.${step.functionName}`;
                this.appendToReport(`      ${idx + 1}. ${stepDesc}\n`);
              });
            }
          }
          
          // Show execution statistics if available
          if (event.result.executionStats) {
            const stats = event.result.executionStats;
            if (stats.executed) {
              this.appendToReport(`  ✓ Executed: ${stats.completed} completed, ${stats.failed} failed\n`);
            }
          }
          
          // Show assertion results if any
          if (event.result.assertions && event.result.assertions.length > 0) {
            this.appendToReport(`\n  Assertions:\n`);
            event.result.assertions.forEach((assertion: { passed: boolean; message: string }) => {
              const icon = assertion.passed ? '✓' : '✗';
              this.appendToReport(`    ${icon} ${assertion.message}\n`);
            });
          }
          
          // Show errors if any
          if (event.result.error) {
            this.appendToReport(`  ✗ Error: ${event.result.error.message}\n`);
            if (event.result.error.stack) {
              const stackLines = event.result.error.stack.split('\n').slice(0, 5);
              stackLines.forEach((line: string) => {
                this.appendToReport(`    ${line}\n`);
              });
            }
          }
        }
        this.appendToReport(`\n`);
        break;
        
      case 'log':
        // Only show non-debug logs in report
        if (event.level !== 'debug') {
          this.appendToReport(`[${event.level.toUpperCase()}] ${event.message}\n`);
        }
        break;
        
      case 'error':
        this.appendToReport(`\n[ERROR] ${event.error}\n`);
        if (event.step) {
          this.appendToReport(`  Step: ${event.step.id || 'unknown'}\n`);
        }
        // Error is already captured in emit() method
        break;
        
      case 'dotbot-activity':
        // DotBot activity is tracked but full response comes from DotBot events
        // This is just for status updates
        break;
    }
  }
  
  /**
   * Clean up execution subscriptions
   */
  private cleanupExecutionSubscriptions(): void {
    for (const unsubscribe of this.executionSubscriptions.values()) {
      unsubscribe();
    }
    this.executionSubscriptions.clear();
    this.lastReportedStatus.clear();
  }
  
  /**
   * Unsubscribe from DotBot events
   */
  unsubscribeFromDotBot(): void {
    if (this.dotbot && this.dotbotEventListener) {
      this.dotbot.removeEventListener(this.dotbotEventListener);
      this.dotbot = null;
      this.dotbotEventListener = null;
      this.log('info', 'Unsubscribed from DotBot events');
    }
    
    // Clean up execution subscriptions
    this.cleanupExecutionSubscriptions();
  }

  /**
   * Set RPC manager provider for StateAllocator
   * 
   * This allows StateAllocator to use the same RPC managers as DotBot,
   * ensuring consistent connections and proper chain selection.
   */
  setRpcManagerProvider(provider: () => {
    relayChainManager?: any;
    assetHubManager?: any;
  } | null): void {
    this.rpcManagerProvider = provider;
    this.log('debug', 'RPC manager provider set');
  }

  /**
   * Set wallet account and signer for live mode transfers
   * 
   * This allows StateAllocator to use the user's wallet for funding scenario entities.
   */
  setWalletForLiveMode(walletAccount: { address: string; name?: string; source: string }, signer: any): void {
    this.walletAccount = walletAccount;
    this.walletSigner = signer;
    this.log('debug', 'Wallet account and signer set for live mode');
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    this.log('info', 'Destroying ScenarioEngine...');
    
    // Clear state
    if (this.stateAllocator) {
      await this.stateAllocator.clearAllocatedState();
    }
    
    // Clear entities
    if (this.entityCreator) {
      this.entityCreator.clear();
    }

    this.updateState({
      status: 'idle',
      currentScenario: undefined,
      currentStepIndex: undefined,
      entities: new Map(),
      partialResults: undefined,
      error: undefined,
    });

    this.log('info', 'ScenarioEngine destroyed');
  }

  // ===========================================================================
  // SCENARIO EXECUTION
  // ===========================================================================

  /**
   * Run a complete scenario
   */
  async runScenario(scenario: Scenario): Promise<ScenarioResult> {
    // GUARD: Prevent concurrent scenario execution
    if (this.runningScenario !== null) {
      const errorMsg = 'Cannot run scenario: another scenario is already running. Call endScenarioEarly() or wait for completion.';
      this.log('error', errorMsg);
      throw new Error(errorMsg);
    }
    
    this.log('info', `Running scenario: ${scenario.name}`);
    const startTime = Date.now();
    
    // Store scenario reference for early ending
    this.runningScenario = scenario;
    this.scenarioStartTime = startTime;

    try {
      // CRITICAL: Defer ALL synchronous work to prevent UI freeze
      // This includes validation, setup, state updates, and initial event emissions
      // All of these operations can block the UI thread if done synchronously
      await new Promise<void>((resolve) => {
        queueMicrotask(() => {
          // Validate (synchronous but lightweight - still defer to be safe)
          this.validateScenario(scenario);
          this.ensureDependencies();
          
          // This prevents missing events that fire early (e.g., execution-message-added)
          if (this.dotbot && !this.dotbotEventListener) {
            this.log('info', 'DotBot subscription not active, subscribing now before scenario execution');
            this.subscribeToDotBot(this.dotbot);
          }

          // Ensure executor has wallet address resolver and Asset Hub API
          // Priority: walletAccount > dotbot wallet > undefined (will throw helpful error)
          if (this.executor && this.executorDeps) {
            // Try to get Asset Hub API from DotBot if not already in deps
            let assetHubApi = this.executorDeps.assetHubApi;
            if (!assetHubApi && this.dotbot) {
              const dotbotAny = this.dotbot as any;
              assetHubApi = dotbotAny.assetHubApi || null;
            }
            
            const enhancedDeps = {
              ...this.executorDeps,
              assetHubApi: assetHubApi || this.executorDeps.assetHubApi, // Preserve or add Asset Hub API
              getWalletAddress: () => {
                // Priority 1: Use wallet account set for live mode
                if (this.walletAccount?.address) {
                  return this.walletAccount.address;
                }
                // Priority 2: Try to get from DotBot's wallet
                if (this.dotbot) {
                  const dotbotAny = this.dotbot as any;
                  const wallet = dotbotAny.wallet;
                  if (wallet?.address) {
                    return wallet.address;
                  }
                }
                // Return undefined - will trigger helpful error message
                return undefined;
              },
            };
            this.executor.setDependencies(enhancedDeps);
          }

          this.updateState({
            status: 'preparing',
            currentScenario: scenario,
            currentStepIndex: 0,
          });

          // Clear previous report and tracking silently (no event)
          // We're immediately replacing with new content, so no need to emit clear event
          // This avoids unnecessary "empty state" render cycle
          this.clearReport(true); // silent = true
          
          // Phase 1: BEGINNING - Setup
          this.emit({ type: 'phase-start', phase: 'beginning', details: 'Setting up scenario environment' });
          
          // Batch initial report updates to prevent multiple rapid events
          const initialReportContent = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
            '[PHASE] BEGINNING - Setup\n' +
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
            'Setting up scenario environment\n\n';
          
          // Append as single batch instead of multiple calls
          this.reportContent += initialReportContent;
          this.emit({ type: 'report-update', content: initialReportContent });
          
          resolve();
        });
      });
      
      this.emit({ type: 'phase-update', phase: 'beginning', message: 'Creating test entities...' });
      this.appendToReport('  → Creating test entities...\n');
      await this.setupEntities(scenario);
      
      this.emit({ type: 'phase-update', phase: 'beginning', message: 'Allocating initial state...' });
      this.appendToReport('  → Allocating initial state...\n');
      await this.setupState(scenario);
      this.emit({ type: 'phase-update', phase: 'beginning', message: 'Setup complete' });
      this.appendToReport('  → Setup complete\n');

      // Phase 2: CYCLE - Execute steps (unknown number of rounds)
      this.emit({ type: 'phase-start', phase: 'cycle', details: 'Executing scenario steps' });
      
      // Batch report updates to prevent multiple rapid events
      const cycleReportContent = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
        '[PHASE] CYCLE - Execution\n' +
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
        'Executing scenario steps\n\n';
      
      this.reportContent += cycleReportContent;
      this.emit({ type: 'report-update', content: cycleReportContent });
      this.updateState({ status: 'running' });
      const stepResults = await this.executor!.executeScenario(scenario);
      
      // Log that execution phase completed
      this.log('info', `Execution phase completed with ${stepResults.length} step result(s)`);

      // Phase 3: FINAL REPORT - Evaluate
      // CRITICAL: Defer evaluation and summary generation to prevent UI freeze
      // evaluator.evaluate() and generateSummary() do heavy synchronous work
      const evaluation = await new Promise<EvaluationResult>((resolve) => {
        queueMicrotask(() => {
          this.emit({ type: 'phase-start', phase: 'final-report', details: 'Evaluating results' });
          
          // Batch report updates to prevent multiple rapid events
          const finalReportContent = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
            '[PHASE] FINAL REPORT - Evaluation\n' +
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
            'Evaluating results\n\n';
          
          this.reportContent += finalReportContent;
          this.emit({ type: 'report-update', content: finalReportContent });
          
          this.emit({ type: 'phase-update', phase: 'final-report', message: 'Analyzing scenario results...' });
          this.appendToReport('  → Analyzing scenario results...\n');
          
          // This is heavy synchronous work - now deferred
          const evalResult = this.evaluator!.evaluate(scenario, stepResults);
          resolve(evalResult);
        });
      });

      const endTime = Date.now();

      // Defer result creation and final report updates
      await new Promise<void>((resolve) => {
        queueMicrotask(() => {
          const result: ScenarioResult = {
            scenarioId: scenario.id,
            success: evaluation.passed,
            startTime,
            endTime,
            duration: endTime - startTime,
            stepResults,
            evaluation,
          };

          // Auto-save if enabled
          if (this.config.autoSaveResults) {
            this.saveResult(result);
          }

          // Mark scenario as completed
          this.scenarioEndReason = ScenarioEndReason.COMPLETED;
          
          // Generate and append summary (heavy synchronous work - now deferred)
          const summary = this.generateSummary(result, evaluation);
          this.appendToReport(`\n${summary}\n`);
          
          // Add final result to report
          this.appendToReport(`\n[COMPLETE] ${evaluation.passed ? '✅ PASSED' : '❌ FAILED'}\n`);
          this.appendToReport(`[SCORE] ${evaluation.score}/100\n`);
          this.appendToReport(`[DURATION] ${endTime - startTime}ms\n`);

          this.updateState({ status: 'completed' });
          this.emit({ type: 'scenario-complete', result });

          this.log('info', `Scenario completed: ${evaluation.passed ? 'PASSED' : 'FAILED'} (${evaluation.score}/100)`);
          
          // Clear running scenario reference
          this.runningScenario = null;
          this.scenarioStartTime = 0;

          resolve();
        });
      });

      // Return result after all deferred work completes
      const result: ScenarioResult = {
        scenarioId: scenario.id,
        success: evaluation.passed,
        startTime,
        endTime,
        duration: endTime - startTime,
        stepResults,
        evaluation,
      };

      return result;
    } catch (error) {
      const endTime = Date.now();
      
      // Mark scenario as ended due to error
      this.scenarioEndReason = ScenarioEndReason.ERROR;
      
      // Capture the error
      const errorMessage = String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.captureError({
        message: errorMessage,
        stack: errorStack,
      });
      
      this.log('error', `Scenario failed: ${error}`);
      this.updateState({ status: 'error', error: errorMessage });
      this.emit({ type: 'error', error: errorMessage });
      
      // Clean up execution subscriptions on error
      this.cleanupExecutionSubscriptions();
      
      // Append error to report
      this.appendToReport(`\n[ERROR] Scenario failed with error:\n`);
      this.appendToReport(`  ${errorMessage}\n`);
      if (errorStack) {
        const stackLines = errorStack.split('\n').slice(0, 10);
        stackLines.forEach((line: string) => {
          this.appendToReport(`    ${line}\n`);
        });
      }
      
      // Generate summary even for errors
      const errorResult: ScenarioResult = {
        scenarioId: scenario.id,
        success: false,
        startTime,
        endTime,
        duration: endTime - startTime,
        stepResults: [],
        evaluation: {
          passed: false,
          score: 0,
          expectations: [],
          summary: `Scenario failed with error: ${errorMessage}`,
        },
        errors: [{ message: errorMessage }],
      };
      
      const summary = this.generateSummary(errorResult, errorResult.evaluation);
      this.appendToReport(`\n${summary}\n`);

      // Clear running scenario reference
      this.runningScenario = null;
      this.scenarioStartTime = 0;
      
      return errorResult;
    }
  }
  
  /**
   * End scenario early and jump to evaluation
   * 
   * This allows the user to manually end a scenario before all steps complete.
   * The scenario will evaluate with whatever results have been collected so far.
   */
  async endScenarioEarly(): Promise<ScenarioResult | null> {
    if (!this.runningScenario || !this.scenarioStartTime) {
      this.log('warn', 'No scenario is currently running');
      return null;
    }
    
    const scenario = this.runningScenario;
    const startTime = this.scenarioStartTime;
    
    this.log('info', 'Scenario ended early by user');
    this.appendToReport('\n[INFO] Scenario ended early by user\n');
    
    // Check what DotBot was doing when scenario ended
    if (this.dotbot?.currentChat) {
      const messages = this.dotbot.currentChat.getDisplayMessages();
      const lastUserMessage = [...messages].reverse().find(m => m.type === 'user');
      
      if (lastUserMessage) {
        const userMsg = lastUserMessage as any;
        this.appendToReport(`\n[INFO] DotBot was processing: "${userMsg.content.substring(0, 100)}${userMsg.content.length > 100 ? '...' : ''}"\n`);
      }
      
      // Check for execution flows in progress
      const executionMessages = messages.filter(m => m.type === 'execution');
      if (executionMessages.length > 0) {
        this.appendToReport(`\n[INFO] Found ${executionMessages.length} execution flow(s) in progress\n`);
        executionMessages.forEach((execMsg: any) => {
          if (execMsg.executionPlan) {
            const stepCount = execMsg.executionPlan.steps?.length || 0;
            this.appendToReport(`  - Execution ID: ${execMsg.executionId}, Plan: ${stepCount} step(s)\n`);
          }
        });
      }
    }
    
    // Stop executor (will stop at next step check and cancel pending promises)
    if (this.executor) {
      this.executor.stop();
    }
    
    // Get current step results (may include partial/interrupted results now)
    let stepResults = this.executor?.getContext()?.results || [];
    
    // If executor has a current step in progress, create a partial result for it
    // NOTE: This is a fallback - the step's catch block should have already created a partial result
    // But we check here in case the step hasn't reached the catch block yet
    const executorContext = this.executor?.getContext();
    if (executorContext && executorContext.currentPrompt) {
      // Check if we already have a result for the current step
      const currentStepIndex = stepResults.length;
      const scenarioStep = scenario.steps[currentStepIndex];
      
      if (scenarioStep && !stepResults.find(r => r.stepId === scenarioStep.id)) {
        // Only create partial result if step hasn't completed yet
        // Use actual start time from context if available
        const startTime = executorContext.currentStepStartTime || Date.now() - 1000;
        const endTime = Date.now();
        const partialResult = {
          stepId: scenarioStep.id,
          success: false,
          startTime,
          endTime,
          duration: endTime - startTime,
          response: {
            type: 'text' as const,
            content: `Step interrupted - was waiting for DotBot response to: "${executorContext.currentPrompt.substring(0, 100)}${executorContext.currentPrompt.length > 100 ? '...' : ''}"`,
            parsed: undefined,
          },
        };
        stepResults.push(partialResult);
        this.appendToReport(`\n[INFO] Created partial result for interrupted step: ${scenarioStep.id}\n`);
      }
    }
    
    // Refresh execution state for any step results that have execution plans
    // This ensures we have the latest execution status even if execution completed after step result was captured
    if (this.dotbot?.currentChat && stepResults.length > 0) {
      const chatInstance = this.dotbot.currentChat;
      stepResults = await Promise.all(stepResults.map(async (result) => {
        // If this step has an execution plan, try to find the corresponding execution message
        // and get the latest execution state
        if (result.executionPlan?.id) {
          try {
            // Find execution message that matches this plan ID
            const executionMessages = chatInstance.messages.filter(
              (msg: any): msg is any => msg.type === 'execution' && msg.executionPlan?.id === result.executionPlan?.id
            );
            
            if (executionMessages.length > 0) {
              const executionMessage = executionMessages[0];
              const executionArray = chatInstance.getExecutionArray(executionMessage.executionId);
              
              if (executionArray) {
                const latestState = executionArray.getState();
                // Update execution stats from latest state
                if (latestState.items.length > 0) {
                  const completed = latestState.items.filter(item => 
                    item.status === 'completed' || item.status === 'finalized'
                  ).length;
                  const failed = latestState.items.filter(item => item.status === 'failed').length;
                  
                  return {
                    ...result,
                    executionStats: {
                      executed: true,
                      success: failed === 0 && completed > 0,
                      completed,
                      failed,
                    },
                  };
                }
              }
            }
          } catch (error) {
            // If we can't get execution state, use what we have
            console.debug('Could not refresh execution state:', error);
          }
        }
        return result;
      }));
    }
    
    // Jump to evaluation phase
    this.emit({ type: 'phase-start', phase: 'final-report', details: 'Evaluating results (ended early)' });
    this.appendToReport('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    this.appendToReport('[PHASE] FINAL REPORT - Evaluation (Ended Early)\n');
    this.appendToReport('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    this.appendToReport('Evaluating results\n\n');
    
    this.emit({ type: 'phase-update', phase: 'final-report', message: 'Analyzing scenario results...' });
    this.appendToReport('  → Analyzing scenario results...\n');
    
    // Evaluate with current results (now with refreshed execution state)
    const evaluation = this.evaluator!.evaluate(scenario, stepResults);
    
    const endTime = Date.now();
    
    const result: ScenarioResult = {
      scenarioId: scenario.id,
      success: evaluation.passed,
      startTime,
      endTime,
      duration: endTime - startTime,
      stepResults,
      evaluation,
    };
    
    // Auto-save if enabled
    if (this.config.autoSaveResults) {
      this.saveResult(result);
    }
    
    // Mark scenario as ended early
    this.scenarioEndReason = ScenarioEndReason.EARLY_END;
    
    // Generate and append summary
    const summary = this.generateSummary(result, evaluation);
    this.appendToReport(`\n${summary}\n`);
    
    // Add final result to report
    this.appendToReport(`\n[COMPLETE] ${evaluation.passed ? '✅ PASSED' : '❌ FAILED'} (Ended Early)\n`);
    this.appendToReport(`[DURATION] ${endTime - startTime}ms\n`);
    
    this.updateState({ status: 'completed' });
    this.emit({ type: 'scenario-complete', result });
    
    // Clear running scenario reference
    this.runningScenario = null;
    this.scenarioStartTime = 0;
    
    this.log('info', `Scenario ended early: ${evaluation.passed ? 'PASSED' : 'FAILED'} (${evaluation.score}/100)`);
    
    return result;
  }
  
  /**
   * Check if a scenario is currently running
   */
  isScenarioRunning(): boolean {
    return this.runningScenario !== null;
  }

  /**
   * Run multiple scenarios
   */
  async runScenarios(scenarios: Scenario[]): Promise<ScenarioResult[]> {
    this.log('info', `Running ${scenarios.length} scenarios`);
    const results: ScenarioResult[] = [];

    for (const scenario of scenarios) {
      const result = await this.runScenario(scenario);
      results.push(result);

      // Clean up between scenarios
      await this.destroy();
      await this.initialize();
      if (this.executorDeps && this.executor) {
        // Enhance dependencies with wallet address resolver
        const enhancedDeps = {
          ...this.executorDeps,
          getWalletAddress: () => this.walletAccount?.address,
        };
        this.executor.setDependencies(enhancedDeps);
      }
    }

    return results;
  }

  /**
   * Pause current execution
   */
  pause(): void {
    if (this.executor) {
      this.executor.pause();
      this.updateState({ status: 'paused' });
    }
  }

  /**
   * Resume paused execution
   */
  resume(): void {
    if (this.executor) {
      this.executor.resume();
      this.updateState({ status: 'running' });
    }
  }

  /**
   * Stop current execution
   */
  stop(): void {
    if (this.executor) {
      this.executor.stop();
      this.scenarioEndReason = ScenarioEndReason.STOPPED;
      this.appendToReport(`\n[INFO] Scenario execution stopped by user\n`);
    }
  }

  /**
   * Create test entities without running a scenario
   * 
   * Useful for pre-populating entities before running tests
   * 
   * NOTE: Entities are mode-specific. If entities exist for a different mode,
   * they will be cleared and recreated.
   */
  async createEntities(
    entityConfigs: EntityConfig[],
    environment: { chain: ScenarioChain; mode: ScenarioMode }
  ): Promise<void> {
    // Check if entities exist for a different mode/chain
    const currentEntityMode = this.state.entityMode;
    const currentEntityChain = this.state.entityChain;
    
    if (currentEntityMode && currentEntityMode !== environment.mode) {
      this.log('warn', `Clearing entities from ${currentEntityMode} mode (switching to ${environment.mode})`);
      if (this.entityCreator) {
        this.entityCreator.clear();
      }
      this.updateState({
        entities: new Map(),
        entityMode: undefined,
        entityChain: undefined,
      });
    }
    
    if (currentEntityChain && currentEntityChain !== environment.chain) {
      this.log('warn', `Clearing entities from ${currentEntityChain} chain (switching to ${environment.chain})`);
      if (this.entityCreator) {
        this.entityCreator.clear();
      }
      this.updateState({
        entities: new Map(),
        entityMode: undefined,
        entityChain: undefined,
      });
    }
    
    this.log('info', `Creating ${entityConfigs.length} entities for ${environment.mode} mode on ${environment.chain}...`);
    
    // Create entity creator if not already created or if mode changed
    if (!this.entityCreator || currentEntityMode !== environment.mode || currentEntityChain !== environment.chain) {
      this.entityCreator = createEntityCreator(environment.mode, {
        ss58Format: this.getSS58Format(environment.chain),
      });
      await this.entityCreator.initialize();
    }

    // Create entities from configs
    await this.entityCreator.createFromConfigs(entityConfigs);

    // Update state with entities and their mode
    this.updateState({
      entities: this.entityCreator.getAllEntities(),
      entityMode: environment.mode,
      entityChain: environment.chain,
    });

    this.log('info', `Created ${this.state.entities.size} entities for ${environment.mode} mode`);
  }

  /**
   * Clear all entities
   * 
   * Removes all created entities and resets entity state.
   */
  clearEntities(): void {
    if (this.entityCreator) {
      this.entityCreator.clear();
    }
    
    this.updateState({
      entities: new Map(),
      entityMode: undefined,
      entityChain: undefined,
    });
    
    this.log('info', 'All entities cleared');
  }

  // ===========================================================================
  // SETUP PHASES
  // ===========================================================================

  private async setupEntities(scenario: Scenario): Promise<void> {
    this.log('debug', 'Setting up entities...');

    const environment = scenario.environment || this.config.defaultEnvironment;

    // Create entity creator
    this.entityCreator = createEntityCreator(environment.mode, {
      ss58Format: this.getSS58Format(environment.chain),
    });
    await this.entityCreator.initialize();

    // Create predefined entities
    await this.entityCreator.createPredefinedEntities();

    // Create custom entities from scenario
    if (scenario.entities) {
      await this.entityCreator.createFromConfigs(scenario.entities);
    }

    // Update state with entities
    this.updateState({
      entities: this.entityCreator.getAllEntities(),
    });

    this.log('debug', `Created ${this.state.entities.size} entities`);
  }

  private async setupState(scenario: Scenario): Promise<void> {
    this.log('debug', 'Setting up state...');

    const environment = scenario.environment || this.config.defaultEnvironment;

    // Create state allocator
    this.stateAllocator = createStateAllocator({
      mode: environment.mode,
      chain: environment.chain,
      entityResolver: (name) => this.entityCreator?.getEntity(name),
      chopsticksEndpoint: environment.chopsticksConfig?.endpoint,
      rpcManagerProvider: this.rpcManagerProvider || undefined,
      // Pass wallet account and signer for live mode
      walletAccount: this.walletAccount,
      signer: this.walletSigner,
    });
    await this.stateAllocator.initialize();

    // Allocate wallet state
    if (scenario.walletState) {
      try {
        const result = await this.stateAllocator.allocateWalletState(scenario.walletState);
        if (!result.success) {
          throw new Error(`Failed to allocate wallet state: ${result.errors.join(', ')}`);
        }
        if (result.warnings.length > 0) {
          for (const warning of result.warnings) {
            this.log('warn', warning);
          }
        }
      } catch (error) {
        // If it's a FundingRequiredError, log it and re-throw to stop execution immediately
        // DO NOT continue to steps - this error means funding is required
        if (error instanceof FundingRequiredError) {
          this.log('error', error.message);
          this.updateState({ status: 'error', error: error.message });
          // Re-throw to stop execution - this will be caught by runScenario's catch block
          throw error;
        }
        // For other errors, re-throw as well
        throw error;
      }
    }

    // Allocate on-chain state
    if (scenario.onchainState) {
      const result = await this.stateAllocator.allocateOnchainState(scenario.onchainState);
      if (!result.success) {
        throw new Error(`Failed to allocate on-chain state: ${result.errors.join(', ')}`);
      }
    }

    // Allocate local state
    if (scenario.localState) {
      await this.stateAllocator.allocateLocalState(scenario.localState);
    }

    this.log('debug', 'State setup complete');
  }

  // ===========================================================================
  // EVENT HANDLING
  // ===========================================================================

  /**
   * Add event listener
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

  private emit(event: ScenarioEngineEvent): void {
    // Capture all events for summary generation (except report-update and report-clear to avoid duplicates)
    if (event.type !== 'report-update' && event.type !== 'report-clear') {
      this.captureEvent(event);
    }
    
    // Handle errors
    if (event.type === 'error') {
      this.captureError({
        step: event.step?.id,
        message: event.error,
      });
    }
    
    // Debug logging
    if (event.type === 'report-update' || event.type === 'inject-prompt' || event.type === 'phase-start') {
      this.log('info', `[emit] ${event.type}, listeners: ${this.eventListeners.size}`);
    }
    
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Event listener error:', error);
        this.log('error', `Event listener threw error: ${error}`);
      }
    }
  }

  private updateState(updates: Partial<ScenarioEngineState>): void {
    this.state = { ...this.state, ...updates };
    this.emit({ type: 'state-change', state: this.state });
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  /**
   * Get current state
   */
  getState(): ScenarioEngineState {
    return { ...this.state };
  }

  /**
   * Get entity by name
   */
  getEntity(name: string): TestEntity | undefined {
    return this.state.entities.get(name);
  }

  /**
   * Get entity by address
   */
  getEntityByAddress(address: string): TestEntity | undefined {
    for (const entity of this.state.entities.values()) {
      if (entity.address === address) {
        return entity;
      }
    }
    return undefined;
  }

  /**
   * Get all entities
   */
  getEntities(): Map<string, TestEntity> {
    return new Map(this.state.entities);
  }

  /**
   * Get the executor (for UI callbacks)
   */
  getExecutor(): ScenarioExecutor | null {
    return this.executor;
  }

  private validateScenario(scenario: Scenario): void {
    if (!scenario.id) {
      throw new Error('Scenario must have an id');
    }
    if (!scenario.name) {
      throw new Error('Scenario must have a name');
    }
    if (!scenario.steps || scenario.steps.length === 0) {
      throw new Error('Scenario must have at least one step');
    }
    if (!scenario.expectations || scenario.expectations.length === 0) {
      throw new Error('Scenario must have at least one expectation');
    }
  }

  private ensureDependencies(): void {
    if (!this.executorDeps) {
      throw new Error('Executor dependencies not set. Call setDependencies() before running scenarios.');
    }
  }

  private getSS58Format(chain: string): number {
    switch (chain) {
      case 'polkadot':
      case 'asset-hub-polkadot':
        return 0;
      case 'kusama':
        return 2;
      case 'westend':
      case 'asset-hub-westend':
      default:
        return 42;
    }
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevel = levels.indexOf(this.config.logLevel);
    const msgLevel = levels.indexOf(level);

    if (msgLevel >= configLevel) {
      const prefix = `[ScenarioEngine] [${level.toUpperCase()}]`;
      switch (level) {
        case 'debug':
          console.debug(prefix, message);
          break;
        case 'info':
          console.info(prefix, message);
          break;
        case 'warn':
          console.warn(prefix, message);
          break;
        case 'error':
          console.error(prefix, message);
          break;
      }
    }

    this.emit({ type: 'log', level, message });
  }

  private saveResult(result: ScenarioResult): void {
    try {
      const key = `${this.config.resultsStoragePrefix}${result.scenarioId}_${result.startTime}`;
      localStorage.setItem(key, JSON.stringify(result));
      this.log('debug', `Result saved: ${key}`);
    } catch (error) {
      this.log('warn', `Failed to save result: ${error}`);
    }
  }

  /**
   * Load saved results
   */
  loadSavedResults(): ScenarioResult[] {
    const results: ScenarioResult[] = [];
    const prefix = this.config.resultsStoragePrefix;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        try {
          const data = localStorage.getItem(key);
          if (data) {
            results.push(JSON.parse(data));
          }
        } catch (error) {
          this.log('warn', `Failed to load result ${key}: ${error}`);
        }
      }
    }

    return results.sort((a, b) => b.startTime - a.startTime);
  }

  /**
   * Clear saved results
   */
  clearSavedResults(): void {
    const prefix = this.config.resultsStoragePrefix;
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }

    this.log('info', `Cleared ${keysToRemove.length} saved results`);
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a ScenarioEngine with configuration
 */
export function createScenarioEngine(config?: ScenarioEngineConfig): ScenarioEngine {
  return new ScenarioEngine(config);
}

