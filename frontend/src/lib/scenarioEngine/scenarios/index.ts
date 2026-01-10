/**
 * Scenario Library
 * 
 * Pre-built test scenarios for DotBot evaluation.
 * All tests are full Scenario objects ready for execution.
 */

export {
  // Test collections
  ALL_TESTS,
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
} from './testPrompts';

export {
  STATE_ALLOCATION_TESTS,
} from './stateAllocationTests';

// Scenario construction helpers (DRY, KISS)
export {
  createScenario,
  transferScenario,
  insufficientBalanceScenario,
  adversarialScenario,
  clarificationScenario,
  knowledgeScenario,
  expectExecution,
  expectTextContaining,
  expectRejection,
  expectClarificationFor,
  keypairEntity,
  multisigEntity,
  proxyEntity,
  scenarioSuite,
  parametrizedScenarios,
  validateScenario,
  assertValidScenario,
  ScenarioBuilder,
} from './scenarioHelpers';

// Example scenarios
export {
  ALL_EXAMPLES,
  EXAMPLE_BASIC_TRANSFER,
  EXAMPLE_INSUFFICIENT_BALANCE,
  EXAMPLE_PROMPT_INJECTION,
  EXAMPLE_MISSING_INFO,
  EXAMPLE_KNOWLEDGE_QUERY,
  EXAMPLE_MULTI_STEP,
  EXAMPLE_COMPLEX_EXECUTION,
  EXAMPLE_LOW_BALANCE_WARNING,
  EXAMPLE_CUSTOM_VALIDATION,
  EXAMPLE_LONG_INPUT,
} from './exampleScenarios';

