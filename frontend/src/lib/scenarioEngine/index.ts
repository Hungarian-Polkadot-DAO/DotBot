/**
 * ScenarioEngine
 * 
 * A testing and evaluation framework for DotBot.
 * Enables systematic testing of prompt handling, security, and functionality.
 * 
 * ## Overview
 * 
 * The ScenarioEngine provides:
 * - **EntityCreator**: Creates test accounts (Alice, Bob, multisigs, etc.)
 * - **StateAllocator**: Sets up initial state (balances, on-chain state)
 * - **ScenarioExecutor**: Runs prompts against the DotBot UI
 * - **Evaluator**: Evaluates responses against expectations
 * 
 * ## Quick Start
 * 
 * ```typescript
 * import { 
 *   ScenarioEngine,
 *   getSmokeTestScenarios 
 * } from '@dotbot/core/scenarioEngine';
 * 
 * // Create engine
 * const engine = new ScenarioEngine();
 * 
 * // Initialize
 * await engine.initialize();
 * 
 * // Set UI hooks (connect to your UI)
 * engine.setUIHooks({
 *   getChatInput: () => document.querySelector('textarea'),
 *   getSendButton: () => document.querySelector('.send-button'),
 *   getCurrentResponse: () => { ... },
 *   isBotTyping: () => { ... },
 * });
 * 
 * // Run scenarios
 * const scenarios = getSmokeTestScenarios();
 * const results = await engine.runScenarios(scenarios);
 * 
 * // Check results
 * console.log(results.map(r => ({
 *   name: r.scenarioId,
 *   passed: r.success,
 *   score: r.evaluation.score,
 * })));
 * ```
 * 
 * ## Architecture
 * 
 * ```
 * ┌─────────────────────────────────────────────────────────┐
 * │                    ScenarioEngine                        │
 * │  (Main orchestrator - coordinates all components)       │
 * └─────────────────────────────────────────────────────────┘
 *                            │
 *        ┌───────────────────┼───────────────────┐
 *        ▼                   ▼                   ▼
 * ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
 * │EntityCreator│    │ Allocator   │    │  Executor   │
 * │             │    │             │    │             │
 * │ Creates:    │    │ Sets up:    │    │ Runs:       │
 * │ - Keypairs  │    │ - Balances  │    │ - Prompts   │
 * │ - Multisigs │    │ - Storage   │    │ - Actions   │
 * │ - Proxies   │    │ - Chain     │    │ - Waits     │
 * └─────────────┘    └─────────────┘    └─────────────┘
 *                                              │
 *                                              ▼
 *                                       ┌─────────────┐
 *                                       │  Evaluator  │
 *                                       │             │
 *                                       │ Checks:     │
 *                                       │ - Content   │
 *                                       │ - Security  │
 *                                       │ - Behavior  │
 *                                       └─────────────┘
 * ```
 * 
 * ## Execution Modes
 * 
 * 1. **Synthetic** (default): Fully mocked, no chain interaction
 * 2. **Emulated**: Uses Chopsticks for realistic chain simulation
 * 3. **Live**: Real chain interaction (Westend recommended)
 * 
 * ## Scenario Categories
 * 
 * - `happy-path`: Basic functionality tests
 * - `adversarial`: Prompt injection tests
 * - `jailbreak`: Advanced manipulation attempts
 * - `ambiguity`: Clarification handling
 * - `edge-case`: Runtime limits and edge cases
 * - `context-awareness`: Conversation context tests
 * - `knowledge-base`: Domain knowledge tests
 * - `stress`: Performance and load tests
 * - `multi-step`: Complex conversation flows
 * 
 * @packageDocumentation
 */

// =============================================================================
// MAIN EXPORTS
// =============================================================================

// Core engine
export { ScenarioEngine, createScenarioEngine } from './ScenarioEngine';

// Types
export type {
  // Environment
  ScenarioChain,
  ScenarioMode,
  ScenarioEnvironment,
  
  // Entities
  TestEntity,
  EntityConfig,
  
  // State
  AssetState,
  WalletStateConfig,
  OnchainStateConfig,
  LocalStateConfig,
  BalanceOverrides,
  StakingSetup,
  GovernanceSetup,
  ChatSnapshot,
  
  // Scenario definition
  Scenario,
  ScenarioCategory,
  ScenarioStep,
  ScenarioAction,
  ScenarioAssertion,
  ScenarioConstraints,
  ScenarioExpectation,
  
  // Results
  StepResult,
  ScenarioResult,
  EvaluationResult,
  
  // Engine
  ScenarioEngineConfig,
  ScenarioEngineState,
  ScenarioEngineEvent,
  ScenarioEngineEventListener,
} from './types';

// =============================================================================
// COMPONENT EXPORTS
// =============================================================================

export {
  // Entity creation
  EntityCreator,
  createEntityCreator,
  PREDEFINED_NAMES,
  
  // State allocation
  StateAllocator,
  createStateAllocator,
  
  // Execution
  ScenarioExecutor,
  createScenarioExecutor,
  
  // Evaluation
  Evaluator,
  createEvaluator,
} from './components';

export type {
  EntityCreatorConfig,
  PredefinedName,
  StateAllocatorConfig,
  AllocationResult,
  ExecutorConfig,
  ExecutionContext,
  ExecutorDependencies,
  EvaluatorConfig,
  ExpectationResult,
  EvaluationReport,
} from './components';

// =============================================================================
// SCENARIO LIBRARY EXPORTS
// =============================================================================

export {
  // All tests
  ALL_TESTS,
  
  // By category
  HAPPY_PATH_TESTS,
  ADVERSARIAL_TESTS,
  JAILBREAK_TESTS,
  AMBIGUITY_TESTS,
  EDGE_CASE_TESTS,
  STRESS_TESTS,
  CONTEXT_AWARENESS_TESTS,
  KNOWLEDGE_TESTS,
  
  // Helper functions
  getTestsByType,
  getSecurityTests,
  getSmokeTests,
} from './scenarios';

