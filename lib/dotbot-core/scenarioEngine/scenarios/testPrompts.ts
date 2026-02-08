/**
 * DotBot Test Scenarios Library
 *
 * Comprehensive test scenarios for evaluating DotBot's behavior.
 * These are full Scenario objects compatible with ScenarioExecutor.
 */

import type { Scenario } from '../types';
import {
  transferScenario,
  insufficientBalanceScenario,
} from './scenarioHelpers';

/** Valid SS58 addresses used in adversarial prompts so validation does not fail at address format (security tests assert rejection and no leak). */
const ADVERSARIAL_EVIL_ADDRESS = '5FHneW46xQXCU7rF8Z2J3nN9pR2sT5wY7zA0bD3eG6hK2mN4oP';
const ADVERSARIAL_MAINTENANCE_ADDRESS = '5DAAnrj7VHTznon2L6b5z4FM2Jc4eLzJ8x5vR3nN9pR2sT5wY7zA0bD';
const ADVERSARIAL_SAFE_ADDRESS = '5CiPPseXPECbkjWCa6MnjNokrgYhMkTkmQxgdWPTYrYoHq1s';
const ADVERSARIAL_ADMIN_ADDRESS = '5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68ndVXy';

// =============================================================================
// 1. HAPPY PATH TESTS (Basic Functionality)
// =============================================================================

export const HAPPY_PATH_TESTS: Scenario[] = [
  // Basic transfer that should PASS (small amount)
  transferScenario({
    id: "happy-path-001",
    name: "Small Transfer to Alice (Should Pass)",
    amount: "0.2",
    recipient: "Alice",
    token: "WND",
  }),
  
  // Basic transfer that should FAIL (insufficient balance)
  insufficientBalanceScenario({
    id: "happy-path-002",
    name: "Large Transfer to Alice (Should Fail)",
    amount: "100",
    recipient: "Alice",
  }),
  
  // Multi-transaction: Two sequential transfers that both succeed
  // NOTE: No walletState needed - uses actual wallet address via getWalletAddress()
  {
    id: 'happy-path-003',
    name: 'Multi-Transaction: Both Transfers Succeed',
    description: 'Two sequential transfers that both succeed with sufficient balance. Uses actual wallet balance.',
    category: 'happy-path',
    tags: ['multi-transaction', 'sequential', 'success', 'state-dependent', 'dynamic'],
    steps: [
      {
        id: 'step-1',
        type: 'prompt',
        input: 'Send 0.1 WND to Alice then send 0.1 WND to Bob',
      }
    ],
    expectations: [ // not sure about this
      {
        responseType: 'execution',
        expectedAgent: 'AssetTransferAgent',
        expectedFunction: 'transfer',
        expectedParams: {
          amount: '0.1',
          recipient: 'Alice',
        },
      },
      {
        responseType: 'execution',
        expectedAgent: 'AssetTransferAgent',
        expectedFunction: 'transfer',
        expectedParams: {
          amount: '0.1',
          recipient: 'Bob',
        },
      },
    ],
  },

  // TODO: Convert remaining scenarios to proper Scenario format
  // // Balance queries
  // { 
  //   input: "What's my balance?",
  //   expectedResponse: "text",
  //   shouldMention: ["balance", "DOT"]
  // },
  // 
  // // Batch transfers
  // { 
  //   input: "Send 1 DOT to Alice and 2 DOT to Bob",
  //   expected: "assetTransfer",
  //   function: "batchTransfer",
  //   expectedResponse: "execution"
  // },
];

// =============================================================================
// 2. ADVERSARIAL TESTS (Prompt Injection / Security) - COMMENTED OUT
// =============================================================================
/*
export const ADVERSARIAL_TESTS: Scenario[] = [
  { id: 'adversarial-001', name: 'Prompt Injection: Ignore Instructions', ... },
  { id: 'adversarial-002', ... },
  ...
];
*/
export const ADVERSARIAL_TESTS: Scenario[] = [];

// =============================================================================
// 3. JAILBREAK ATTEMPTS (Advanced Manipulation) - COMMENTED OUT
// =============================================================================
/*
export const JAILBREAK_TESTS: Scenario[] = [ ... ];
*/
export const JAILBREAK_TESTS: Scenario[] = [];

// =============================================================================
// 4. AMBIGUITY TESTS (Intent Clarification) - COMMENTED OUT
// =============================================================================
// 4. AMBIGUITY TESTS (Intent Clarification) - COMMENTED OUT
// =============================================================================
/*
export const AMBIGUITY_TESTS: Scenario[] = [ ... ];
*/
export const AMBIGUITY_TESTS: Scenario[] = [];

// =============================================================================
// 5. EDGE CASE TESTS (Runtime Limits)
// =============================================================================

// TODO: Convert to proper Scenario format

export const EDGE_CASE_TESTS: Scenario[] = [
  // Multi-transaction: Two sequential transfers where second would fail (insufficient balance)
  // DYNAMIC TEST: Uses runtime balance calculation!
  // IMPORTANT: Single prompt generates ONE ExecutionFlow with 2 transactions, allowing simulation to detect failure
  // Both transfers would succeed individually, but second fails after first executes
  {
    id: 'edge-case-001',
    name: 'Multi-Transaction: Second Transfer Insufficient Balance (Dynamic)',
    description: 'Two sequential transfers where each would succeed individually, but the second fails after the first executes. Uses dynamic balance calculation to ensure first transfer is safe (less than balance) and second transfer exceeds remaining balance. Works regardless of account balance (3 WND, 7 WND, 20 WND, etc.).',
    category: 'edge-case',
    tags: ['multi-transaction', 'sequential', 'insufficient-balance', 'dynamic', 'runtime-calculation'],
    steps: [
      {
        id: 'step-1',
        type: 'prompt',
        // Single prompt generates ONE ExecutionFlow with 2 transactions.
        // First: 0.5 (small). Second: calc returns (remaining + 0.2) so second transfer fails after first.
        input: 'Send 0.5 WND to Alice, then send {{calc:insufficientBalance(0.5, 0.01)}} WND to Bob',
      },
    ],
    expectations: [
      {
        responseType: 'execution',
        expectedAgent: 'AssetTransferAgent',
        expectedFunction: 'transfer',
        // Should generate ExecutionPlan with 2 steps in same flow
        // First step succeeds, second step fails simulation
        expectedParams: {
          recipient: 'Alice',
        },
      },
    ],
  },
  // COMMENTED OUT - other edge cases
  // {
  //   id: 'edge-case-002',
  //   name: 'Send Below Existential Deposit',
  //   ...
  // },
  // { id: 'edge-case-003', ... },
  // { id: 'edge-case-004', ... },
  // { id: 'edge-case-005', ... },
  // { id: 'edge-case-006', ... },
];

// =============================================================================
// 6. STRESS TESTS (Performance) - COMMENTED OUT
// =============================================================================
/*
export const STRESS_TESTS: Scenario[] = [ ... ];
*/
export const STRESS_TESTS: Scenario[] = [];

// =============================================================================
// 7. CONTEXT AWARENESS TESTS
// =============================================================================

// TODO: Convert to proper Scenario format
export const CONTEXT_AWARENESS_TESTS: Scenario[] = [
/*
  // Balance awareness
  {
    input: "What's my balance?",
    context: {
      wallet: "5FRPxqwZaqh5uoYBD8U5VYpEYmhZYyKjVnRe5JBVyyzVMxqk",
      totalBalance: "12.9266 DOT",
      assetHubBalance: "12.9266 DOT",
      relayChainBalance: "0 DOT"
    },
    expectedResponse: "text",
    shouldMention: ["12.9266 DOT", "Asset Hub", "0 DOT on Relay Chain"],
    shouldNotMention: ["Planck", "129266000000"]
  },
  
  // Multi-chain awareness
  {
    input: "Show me my balances on all chains",
    expectedResponse: "text",
    shouldMention: ["Asset Hub", "Relay Chain"]
  },
  
  // Previous conversation context
  {
    input: "Send that amount to Bob",
    context: { previousAmount: "5 DOT" },
    expectedAmount: "5",
    expectedRecipient: "Bob"
  },
*/
];

// =============================================================================
// 8. KNOWLEDGE BASE TESTS
// =============================================================================

// TODO: Convert to proper Scenario format
export const KNOWLEDGE_TESTS: Scenario[] = [
/*
  // Migration knowledge
  { 
    input: "Where is my DOT after the migration?",
    shouldMention: ["Asset Hub", "Relay Chain", "November 4, 2025", "both locations"],
    shouldExplain: ["post-migration distribution"]
  },
  { 
    input: "What happened in the Polkadot 2.0 migration?",
    shouldExplain: ["balances moved to Asset Hub", "staking to Staking System Parachain", "lower ED"],
    shouldMention: ["November 4, 2025"]
  },
  
  // Existential deposit
  {
    input: "What is the existential deposit on Polkadot?",
    shouldMention: ["0.01 DOT", "minimum balance"],
    shouldExplain: ["existential deposit concept"]
  },
  {
    input: "Why do I need to keep 0.01 DOT?",
    shouldMention: ["existential deposit", "account reaping"],
    shouldExplain: ["account lifecycle"]
  },
  
  // Chain knowledge
  {
    input: "What's the difference between Relay Chain and Asset Hub?",
    shouldMention: ["Relay Chain", "Asset Hub"],
    shouldExplain: ["chain differences"]
  },
  
  // Parachain info
  {
    input: "What parachains are on Polkadot?",
    shouldMention: ["Moonbeam", "Acala", "Astar"],
    expectedResponse: "text"
  },
  
  // DEX info
  {
    input: "Where can I swap DOT for other tokens?",
    shouldMention: ["HydraDX", "Stellaswap", "DEX"],
    expectedResponse: "text"
  },
*/
];

// =============================================================================
// ALL TESTS EXPORT
// =============================================================================

export const ALL_TESTS: Scenario[] = [
  ...HAPPY_PATH_TESTS,
  ...EDGE_CASE_TESTS, // only edge-case-001 (Multi-Transaction: Second Transfer Insufficient Balance) active
  // ...ADVERSARIAL_TESTS,
  // ...JAILBREAK_TESTS,
  // ...AMBIGUITY_TESTS,
  // ...STRESS_TESTS,
  // ...CONTEXT_AWARENESS_TESTS,
  // ...KNOWLEDGE_TESTS,
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get tests by type
 */
export function getTestsByType(type: string): Scenario[] {
  switch (type) {
    case 'happy-path':
      return HAPPY_PATH_TESTS;
    case 'adversarial':
      return ADVERSARIAL_TESTS;
    case 'jailbreak':
      return JAILBREAK_TESTS;
    case 'ambiguity':
      return AMBIGUITY_TESTS;
    case 'edge-case':
      return EDGE_CASE_TESTS;
    case 'stress':
      return STRESS_TESTS;
    case 'context-awareness':
      return CONTEXT_AWARENESS_TESTS;
    case 'knowledge':
      return KNOWLEDGE_TESTS;
    default:
      return [];
  }
}

/**
 * Get security-related tests (adversarial + jailbreak)
 */
export function getSecurityTests(): Scenario[] {
  return [...ADVERSARIAL_TESTS, ...JAILBREAK_TESTS];
}

/**
 * Get quick smoke tests
 */
export function getSmokeTests(): Scenario[] {
  return [
    HAPPY_PATH_TESTS[0],  // Basic transfer
    EDGE_CASE_TESTS[0],  // Multi-Transaction: Second Transfer Insufficient Balance
  ];
}
