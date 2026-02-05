/**
 * ScenarioEngine Core Types
 * 
 * The ScenarioEngine is a **live demonstration and evaluation tool** for DotBot.
 *  * 
 * ## Example Use Case: Multisig Demo
 * ```typescript
 * // 1. ScenarioEngine sets up the scenario (background)
 * engine.setupScenario({
 *   entities: [Alice, Bob, Charlie],  // Deterministic test accounts
 *   multisig: { threshold: 2, signatories: [Alice, Bob, Charlie] },
 *   balances: { Alice: "100 DOT", Bob: "50 DOT", Charlie: "50 DOT" }
 * });
 * 
 * // 2. User interacts with DotBot UI (visible)
 * // UI shows: "Try this: Approve multisig transaction 0x123..."
 * // User pastes prompt into ChatInput
 * // DotBot processes it and creates approval extrinsic
 * 
 * // 3. ScenarioEngine acts as other participants (background)
 * engine.signAsEntity("Bob", multisigTx);
 * engine.signAsEntity("Charlie", multisigTx);
 * // Multisig executes on Westend - REAL and visible!
 * ```
 * 
 * ## Modes
 * - **synthetic**: Fully mocked - fast, no chain needed
 * - **emulated**: Chopsticks fork - realistic simulation
 * - **live**: Real Westend testnet - for demos to evaluators
 */

// =============================================================================
// ENVIRONMENT TYPES
// =============================================================================

/** Supported chains for scenario execution */
export type ScenarioChain = 'polkadot' | 'kusama' | 'westend' | 'asset-hub-polkadot' | 'asset-hub-westend';

/** Execution mode determines how state is managed */
export type ScenarioMode = 
  | 'synthetic'   // Fully mocked - no real chain interaction
  | 'emulated'    // Chopsticks fork - simulated chain state
  | 'live';       // Real chain (Westend recommended for testing)

export interface ScenarioEnvironment {
  /** Target chain */
  chain: ScenarioChain;
  
  /** Execution mode */
  mode: ScenarioMode;
  
  /** Optional Chopsticks configuration for emulated mode */
  chopsticksConfig?: {
    endpoint?: string;
    blockNumber?: number;
  };
}

// =============================================================================
// ENTITY TYPES
// =============================================================================

/** A test entity (account) created by EntityCreator */
export interface TestEntity {
  /** Human-readable name (Alice, Bob, MultisigA) */
  name: string;
  
  /** SS58 address */
  address: string;
  
  /** Substrate URI for keypair derivation (//Alice, etc.) - used for signing */
  uri?: string;
  
  /** Mnemonic (deprecated - use URI instead) */
  mnemonic?: string;
  
  /** Entity type */
  type: 'keypair' | 'multisig' | 'proxy';
  
  /** For multisigs: signatories */
  signatories?: string[];
  
  /** For multisigs: threshold */
  threshold?: number;
  
  /** For proxies: proxied account */
  proxiedAccount?: string;
}

/** Configuration for entity creation */
export interface EntityConfig {
  /** Name for the entity */
  name: string;
  
  /** Type of entity to create */
  type: 'keypair' | 'multisig' | 'proxy';
  
  /** For multisigs: names of signatory entities */
  signatoryNames?: string[];
  
  /** For multisigs: threshold */
  threshold?: number;
  
  /** For proxies: name of proxied entity */
  proxiedEntityName?: string;
}

// =============================================================================
// STATE TYPES
// =============================================================================

/** Asset state for an account */
export interface AssetState {
  /** Asset ID (for Asset Hub tokens) */
  assetId: string | number;
  
  /** Balance in human-readable format */
  balance: string;
  
  /** Asset symbol (e.g., "USDT", "USDC") */
  symbol?: string;
}

/** Wallet/account state configuration */
export interface WalletStateConfig {
  accounts: {
    /** Entity name (resolved to address by StateAllocator) */
    entityName: string;
    
    /** Native token balance (e.g., "5 DOT", "100 WND") */
    balance: string;
    
    /** Additional assets */
    assets?: AssetState[];
  }[];
}

/** Balance overrides for on-chain state */
export interface BalanceOverrides {
  [address: string]: {
    free: string;
    reserved?: string;
    frozen?: string;
  };
}

/** Staking setup configuration */
export interface StakingSetup {
  /** Validators to set up */
  validators?: {
    entityName: string;
    commission: number;
    blocked?: boolean;
  }[];
  
  /** Nominators to set up */
  nominators?: {
    entityName: string;
    targets: string[];  // Validator addresses or entity names
    amount: string;
  }[];
  
  /** Staking era configuration */
  era?: {
    currentEra: number;
    activeEraStart: number;
  };
}

/** Governance setup configuration */
export interface GovernanceSetup {
  /** Referenda to create */
  referenda?: {
    id: number;
    track: string;
    proposal: string;
    status: 'ongoing' | 'approved' | 'rejected' | 'cancelled';
    tally?: {
      ayes: string;
      nays: string;
    };
  }[];
  
  /** Delegations to set up */
  delegations?: {
    from: string;  // Entity name
    to: string;    // Entity name
    conviction: number;
    balance: string;
  }[];
}

/** On-chain state configuration */
export interface OnchainStateConfig {
  /** Balance overrides */
  balances?: BalanceOverrides;
  
  /** Governance setup */
  governance?: GovernanceSetup;
  
  /** Staking setup */
  staking?: StakingSetup;
}

/** Local storage state configuration */
export interface LocalStateConfig {
  /** Key-value pairs for localStorage */
  storage: Record<string, string>;
  
  /** Pre-populated chat history */
  chatHistory?: ChatSnapshot;
}

/** Chat history snapshot */
export interface ChatSnapshot {
  /** Chat instance ID */
  chatId: string;
  
  /** Environment for the chat */
  environment: 'mainnet' | 'testnet';
  
  /** Messages in the chat */
  messages: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
  }[];
}

// =============================================================================
// SCENARIO TYPES
// =============================================================================

/** Execution constraints */
export interface ScenarioConstraints {
  /** Allow real transactions (only for live mode) */
  allowRealTx?: boolean;
  
  /** Require user confirmation before execution */
  requireConfirmation?: boolean;
  
  /** Timeout for scenario execution (ms) */
  timeout?: number;
  
  /** Maximum number of retries */
  maxRetries?: number;
}

/** A complete scenario definition */
export interface Scenario {
  /** Unique identifier */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Description of what this scenario tests */
  description: string;
  
  /** Category for grouping */
  category: ScenarioCategory;
  
  /** Tags for filtering */
  tags?: string[];
  
  /** Environment configuration (optional - can be provided at runtime) */
  environment?: ScenarioEnvironment;
  
  /** Entities to create */
  entities?: EntityConfig[];
  
  /** Initial wallet state */
  walletState?: WalletStateConfig;
  
  /** Initial on-chain state */
  onchainState?: OnchainStateConfig;
  
  /** Initial local state */
  localState?: LocalStateConfig;
  
  /** Execution constraints */
  constraints?: ScenarioConstraints;
  
  /** The prompts/actions to execute */
  steps: ScenarioStep[];
  
  /** Expected outcomes for evaluation */
  expectations: ScenarioExpectation[];
}

/** Categories for scenarios */
export type ScenarioCategory = 
  | 'happy-path'
  | 'adversarial'
  | 'jailbreak'
  | 'ambiguity'
  | 'edge-case'
  | 'stress'
  | 'context-awareness'
  | 'knowledge-base'
  | 'multi-step'
  | 'state-allocation'
  | 'custom';

/** A single step in a scenario */
export interface ScenarioStep {
  /** Step identifier */
  id: string;
  
  /** Type of step */
  type: 'prompt' | 'action' | 'wait' | 'assert';
  
  /** For prompt steps: the user input */
  input?: string;
  
  /** For action steps: the action to perform */
  action?: ScenarioAction;
  
  /** For wait steps: duration in ms */
  waitMs?: number;
  
  /** For assert steps: condition to check */
  assertion?: ScenarioAssertion;
  
  /** Optional delay before this step (ms) */
  delayBefore?: number;
  
  /** Optional delay after this step (ms) */
  delayAfter?: number;
}

/** Actions that can be performed in a scenario */
/**
 * Actions that the scenario executor can perform.
 * 
 * TWO TYPES OF ACTIONS:
 * 1. **User actions**: Simulate user interaction with DotBot
 *    - input-message, wait-for-response
 * 
 * 2. **Background actions**: ScenarioEngine performs automatically (invisible to user)
 *    - sign-as-participant, approve-multisig, fund-account, etc.
 *    - These use KeyringSigner with test account keypairs
 *    - Executed on-chain in live/emulated modes
 * 
 * This enables complex scenarios like:
 * - User: "Approve multisig transaction XYZ" (via DotBot UI)
 * - Background: ScenarioEngine signs as Bob & Charlie automatically
 * - Result: Multisig executes on Westend (visible to evaluators)
 */
export interface ScenarioAction {
  type: 
    // User-facing actions (interact with DotBot LLM)
    | 'input-message'              // Send a message to DotBot
    | 'wait-for-response'          // Wait for DotBot to finish processing
    
    // Background actions (performed by ScenarioEngine automatically)
    | 'sign-as-participant'        // Sign a multisig/batch tx as a background account
    | 'approve-multisig'           // Approve a multisig call (live/emulated)
    | 'execute-multisig'           // Execute a multisig when threshold reached
    | 'fund-account'               // Fund an account from dev/faucet
    | 'submit-extrinsic'           // Submit an extrinsic as a specific entity
    | 'wait-blocks'                // Wait for N blocks (for finalization)
    | 'query-on-chain-state'       // Query blockchain state
    
    // Extensibility
    | 'custom';                    // Custom extensible actions
  
  /** Parameters for the action */
  params?: Record<string, unknown>;
  
  /** Which entity performs this action (for background actions) */
  asEntity?: string;  // Entity name (e.g., "Bob", "Charlie")
}

/**
 * Assertions for scenario validation.
 * 
 * These verify LOGIC, not UI state.
 * Focus: Verify LLM behavior, agent calls, extrinsic creation.
 */
export interface ScenarioAssertion {
  type: 
    | 'check-llm-response'         // Check the content of the LLM's text response
    | 'check-agent-call'           // Verify a specific agent was called
    | 'check-extrinsic-creation'   // Verify an extrinsic was created
    | 'check-balance-change'       // Verify a balance change occurred
    | 'check-error'                // Verify a specific error was thrown
    | 'custom';                    // Custom extensible assertions
  
  /** Expected value or pattern */
  expected?: string | RegExp | Record<string, unknown>;
  
  /** Entity name for balance checks */
  entityName?: string;
  
  /** Custom validator function (serialized) */
  customValidator?: string;
}

// =============================================================================
// EXPECTATION TYPES
// =============================================================================

/**
 * Comparison operators for parameter validation
 * 
 * Allows flexible matching beyond exact equality.
 * 
 * @example
 * ```typescript
 * expectedParams: {
 *   amount: { gte: '0.01', lte: '10' }  // Between 0.01 and 10
 * }
 * ```
 */
export type ComparisonOperator<T = string | number> = {
  /** Equals (exact match) */
  eq?: T;
  /** Not equals */
  ne?: T;
  /** Greater than */
  gt?: T;
  /** Greater than or equal */
  gte?: T;
  /** Less than */
  lt?: T;
  /** Less than or equal */
  lte?: T;
  /** Inclusive range [min, max] */
  between?: [T, T];
  /** Regex pattern match (string values only) */
  matches?: RegExp | string;
  /** Value must be in this list */
  in?: T[];
  /** Value must NOT be in this list */
  notIn?: T[];
};

/**
 * A parameter value can be:
 * - A simple value (string/number/boolean) for exact match (backward compatible)
 * - A comparison operator for flexible matching (new feature)
 */
export type ParamValue = string | number | boolean | ComparisonOperator;

/**
 * Base expectation interface (without logical operators)
 * 
 * This is the traditional flat format that all existing scenarios use.
 */
export interface BaseExpectation {
  /** What type of response is expected */
  responseType?: 'text' | 'json' | 'execution' | 'error' | 'clarification';
  
  /** Expected agent to be called */
  expectedAgent?: string;
  
  /** Expected function on the agent */
  expectedFunction?: string;
  
  /** 
   * Expected parameters (partial match)
   * 
   * Can use simple values (exact match) or comparison operators (flexible match)
   * 
   * @example
   * ```typescript
   * // Simple (backward compatible)
   * expectedParams: { amount: '0.1', recipient: 'Alice' }
   * 
   * // With comparisons (new)
   * expectedParams: { 
   *   amount: { gte: '0.1', lte: '10' },
   *   recipient: 'Alice'
   * }
   * ```
   */
  expectedParams?: Record<string, ParamValue>;
  
  /** Response should contain these strings */
  shouldContain?: string[];
  
  /** Response should NOT contain these strings */
  shouldNotContain?: string[];
  
  /** Response should mention these topics */
  shouldMention?: string[];
  
  /** Should ask for clarification on these items */
  shouldAskFor?: string[];
  
  /** Should warn about these issues */
  shouldWarn?: string[];
  
  /** Should reject the request */
  shouldReject?: boolean;
  
  /** Reason for rejection */
  rejectionReason?: string;
  
  /** Custom validation function (serialized) */
  customValidator?: string;
}

/**
 * Logical expectation with AND/OR/NOT/IF-THEN-ELSE operators
 * 
 * Allows composing complex expectations from simpler ones.
 * 
 * @example
 * ```typescript
 * // AND: All must pass
 * { all: [
 *   { responseType: 'execution' },
 *   { expectedFunction: 'transfer' }
 * ]}
 * 
 * // OR: At least one must pass
 * { any: [
 *   { shouldContain: ['insufficient'] },
 *   { shouldContain: ['not enough'] }
 * ]}
 * 
 * // NOT: Must not pass
 * { not: { shouldContain: ['error'] } }
 * 
 * // IF-THEN-ELSE: Conditional
 * {
 *   when: { contextBalance: { gt: '10' } },
 *   then: { responseType: 'execution' },
 *   else: { shouldWarn: ['insufficient balance'] }
 * }
 * ```
 */
export interface LogicalExpectation extends BaseExpectation {
  /** AND operator: All sub-expectations must pass */
  all?: ScenarioExpectation[];
  
  /** OR operator: At least one sub-expectation must pass */
  any?: ScenarioExpectation[];
  
  /** NOT operator: Sub-expectation must NOT pass */
  not?: ScenarioExpectation;
  
  /** IF condition (when/then/else) */
  when?: ScenarioExpectation;
  
  /** THEN branch (if 'when' passes) */
  then?: ScenarioExpectation;
  
  /** ELSE branch (if 'when' fails) */
  else?: ScenarioExpectation;
}

/**
 * Scenario expectation - can be either flat (BaseExpectation) or logical (LogicalExpectation)
 * 
 * The system automatically detects which format is used via type guards.
 * 
 * Backward Compatible: All existing flat expectations continue working unchanged.
 */
export type ScenarioExpectation = BaseExpectation | LogicalExpectation;

// =============================================================================
// RESULT TYPES
// =============================================================================

/** Result of a single step execution */
export interface StepResult {
  /** Step ID */
  stepId: string;
  
  /** Whether the step succeeded */
  success: boolean;
  
  /** Start time */
  startTime: number;
  
  /** End time */
  endTime: number;
  
  /** Duration in ms */
  duration: number;
  
  /** The response received (for prompt steps) */
  response?: {
    type: 'text' | 'json' | 'execution' | 'error';
    content: string;
    parsed?: Record<string, unknown>;
  };
  
  /** Execution plan (if DotBot created a plan) */
  executionPlan?: {
    id: string;
    steps: {
      agentClassName: string;
      functionName: string;
      parameters: Record<string, any>;
      description: string;
      executionType: string;
    }[];
    requiresApproval: boolean;
  };
  
  /** Execution statistics (if plan was executed) */
  executionStats?: {
    executed: boolean;
    success: boolean;
    completed: number;
    failed: number;
  };
  
  /** Error if step failed */
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
  
  /** Assertion results */
  assertions?: {
    passed: boolean;
    message: string;
  }[];
}

/** Result of scenario execution */
export interface ScenarioResult {
  /** Scenario ID */
  scenarioId: string;
  
  /** Overall success */
  success: boolean;
  
  /** Start time */
  startTime: number;
  
  /** End time */
  endTime: number;
  
  /** Total duration in ms */
  duration: number;
  
  /** Results for each step */
  stepResults: StepResult[];
  
  /** Evaluation results */
  evaluation: EvaluationResult;
  
  /** Any errors encountered */
  errors?: {
    step?: string;
    message: string;
    code?: string;
  }[];
}

/** Evaluation result */
export interface EvaluationResult {
  /** Overall pass/fail */
  passed: boolean;
  
  /** Score (0-100) */
  score: number;
  
  /** Individual expectation results */
  expectations: {
    expectation: ScenarioExpectation;
    met: boolean;
    details: string;
  }[];
  
  /** Summary */
  summary: string;
  
  /** Recommendations */
  recommendations?: string[];
}

// =============================================================================
// ENGINE TYPES
// =============================================================================

/** ScenarioEngine configuration */
export interface ScenarioEngineConfig {
  /** Default environment */
  defaultEnvironment?: ScenarioEnvironment;
  
  /** Log level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  
  /** Auto-save results */
  autoSaveResults?: boolean;
  
  /** Results storage key prefix */
  resultsStoragePrefix?: string;
}

/** State of the scenario engine */
export interface ScenarioEngineState {
  /** Current status */
  status: 'idle' | 'preparing' | 'running' | 'paused' | 'completed' | 'error';
  
  /** Currently loaded scenario */
  currentScenario?: Scenario;
  
  /** Current step index */
  currentStepIndex?: number;
  
  /** Entities created */
  entities: Map<string, TestEntity>;
  
  /** Mode that entities belong to (entities are mode-specific) */
  entityMode?: ScenarioMode;
  
  /** Chain that entities belong to */
  entityChain?: ScenarioChain;
  
  /** Results so far */
  partialResults?: Partial<ScenarioResult>;
  
  /** Error if in error state */
  error?: string;
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Check if an expectation uses logical operators (all/any/not/when)
 * 
 * @param expectation - The expectation to check
 * @returns true if it uses logical operators, false if it's a flat expectation
 */
export function isLogicalExpectation(expectation: ScenarioExpectation): expectation is LogicalExpectation {
  const logical = expectation as LogicalExpectation;
  return !!(
    logical.all ||
    logical.any ||
    logical.not ||
    logical.when ||
    logical.then ||
    logical.else
  );
}

/**
 * Check if a parameter value uses comparison operators
 * 
 * @param value - The parameter value to check
 * @returns true if it's a comparison operator object, false if it's a simple value
 */
export function isComparisonOperator(value: ParamValue): value is ComparisonOperator {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  
  const operators = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'matches', 'in', 'notIn'];
  return operators.some(op => op in value);
}

// =============================================================================
// ENGINE EVENT TYPES
// =============================================================================

/**
 * Event types emitted by the engine
 * 
 * UI components subscribe to these events to react to scenario execution.
 * 
 * Key events:
 * - `inject-prompt`: Tell the UI to fill ChatInput with a prompt
 *   - Autopilot mode: UI auto-submits immediately
 *   - Half-autopilot mode: UI fills, waits for user to press Enter
 * - `report-update`: Report content has been updated (for display components)
 */
export type ScenarioEngineEvent = 
  | { type: 'state-change'; state: ScenarioEngineState }
  | { type: 'phase-start'; phase: 'beginning' | 'cycle' | 'final-report'; details?: string }
  | { type: 'phase-update'; phase: 'beginning' | 'cycle' | 'final-report'; message: string; progress?: { current: number; total?: number } }
  | { type: 'dotbot-activity'; activity: string; details?: string }  // Track what DotBot is doing
  | { type: 'step-start'; step: ScenarioStep; index: number }
  | { type: 'step-input-updated'; stepId: string; originalInput: string; modifiedInput: string }  // Step input was modified (e.g., entity names replaced with addresses)
  | { type: 'step-complete'; step: ScenarioStep; result: StepResult }
  | { type: 'scenario-complete'; result: ScenarioResult }
  | { type: 'error'; error: string; step?: ScenarioStep }
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string }
  | { type: 'inject-prompt'; prompt: string }  // Tell UI to inject a prompt into ChatInput
  | { type: 'report-update'; content: string }  // Report content updated (append-only)
  | { type: 'report-clear' };  // Report cleared

/** Listener for engine events */
export type ScenarioEngineEventListener = (event: ScenarioEngineEvent) => void;

// =============================================================================
// SCENARIO END REASON
// =============================================================================

/**
 * Reason why a scenario ended
 */
export enum ScenarioEndReason {
  /** Scenario completed normally (all steps executed) */
  COMPLETED = 'completed',
  /** Scenario failed with an error */
  ERROR = 'error',
  /** Scenario ended early by user */
  EARLY_END = 'early-end',
  /** Scenario execution was stopped by user */
  STOPPED = 'stopped',
}
