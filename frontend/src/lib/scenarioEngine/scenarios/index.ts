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

