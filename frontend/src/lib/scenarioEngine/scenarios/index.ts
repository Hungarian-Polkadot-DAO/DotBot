/**
 * Test Prompts Library
 * 
 * Pre-built test prompts for DotBot evaluation.
 * These are simple test data objects that get converted to full Scenarios by the engine.
 */

// TestPrompt type removed - scenarios now use Scenario type directly
// export type { TestPrompt } from './testPrompts';

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

