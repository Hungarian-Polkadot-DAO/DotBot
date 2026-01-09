/**
 * Scenario Engine Constants
 */

import {
  HAPPY_PATH_TESTS,
  ADVERSARIAL_TESTS,
  JAILBREAK_TESTS,
  AMBIGUITY_TESTS,
  EDGE_CASE_TESTS,
  STRESS_TESTS,
  CONTEXT_AWARENESS_TESTS,
  KNOWLEDGE_TESTS,
} from '../../lib/scenarioEngine';
import { Scenario } from '../../lib';

export interface TestCategory {
  category: string;
  name: string;
  tests: Scenario[];
}

export const TEST_CATEGORIES: TestCategory[] = [
  { category: 'happy-path', name: 'Happy Path Tests', tests: HAPPY_PATH_TESTS },
  { category: 'adversarial', name: 'Security Tests', tests: ADVERSARIAL_TESTS },
  { category: 'jailbreak', name: 'Jailbreak Attempts', tests: JAILBREAK_TESTS },
  { category: 'ambiguity', name: 'Ambiguity Tests', tests: AMBIGUITY_TESTS },
  { category: 'edge-case', name: 'Edge Cases', tests: EDGE_CASE_TESTS },
  { category: 'stress', name: 'Stress Tests', tests: STRESS_TESTS },
  { category: 'context', name: 'Context Awareness', tests: CONTEXT_AWARENESS_TESTS },
  { category: 'knowledge', name: 'Knowledge Base', tests: KNOWLEDGE_TESTS },
];

export type TabType = 'entities' | 'scenarios' | 'report';

