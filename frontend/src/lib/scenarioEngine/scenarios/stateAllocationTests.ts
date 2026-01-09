/**
 * State Allocation Test Scenarios
 * 
 * Tests the StateAllocator's ability to pre-allocate balances and state
 * across all execution modes (synthetic, emulated, live).
 */

import type { Scenario } from '../types';

export const STATE_ALLOCATION_TESTS: Scenario[] = [
  {
    id: "state-alloc-001",
    name: "Balance Pre-allocation Test",
    description: "Tests that StateAllocator correctly pre-allocates balances to entities in all modes",
    category: "state-allocation",
    tags: ["balance", "allocation", "infrastructure"],
    
    // Define entities required
    entities: [
      { name: 'Alice', type: 'keypair' },
      { name: 'Bob', type: 'keypair' },
      { name: 'Charlie', type: 'keypair' },
    ],
    
    // PRE-ALLOCATE BALANCES - This is what we're testing!
    walletState: {
      accounts: [
        { entityName: 'Alice', balance: '100 DOT' },
        { entityName: 'Bob', balance: '50 DOT' },
        { entityName: 'Charlie', balance: '25 DOT' },
      ]
    },
    
    steps: [
      {
        id: "step-1",
        type: "assert",
        assertion: {
          type: "check-balance-change",
          entityName: 'Alice',
          expected: { balance: '100 DOT' }
        }
      },
      {
        id: "step-2", 
        type: "assert",
        assertion: {
          type: "check-balance-change",
          entityName: 'Bob',
          expected: { balance: '50 DOT' }
        }
      },
      {
        id: "step-3",
        type: "assert",
        assertion: {
          type: "check-balance-change",
          entityName: 'Charlie',
          expected: { balance: '25 DOT' }
        }
      }
    ],
    
    // For infrastructure tests, success is determined by assertions passing
    // Minimal expectation: scenario should complete without errors
    expectations: [
      {
        // No specific response type required - assertions verify state
        // This expectation just ensures the scenario completes
      }
    ]
  },
  
  {
    id: "state-alloc-002",
    name: "Transfer After Pre-allocation",
    description: "Tests transfer functionality after StateAllocator has pre-allocated balances",
    category: "state-allocation",
    tags: ["balance", "allocation", "transfer", "integration"],
    
    entities: [
      { name: 'Alice', type: 'keypair' },
      { name: 'Bob', type: 'keypair' },
    ],
    
    // Pre-allocate so Alice can actually send to Bob
    walletState: {
      accounts: [
        { entityName: 'Alice', balance: '100 DOT' },
        { entityName: 'Bob', balance: '10 DOT' },
      ]
    },
    
    steps: [
      {
        id: "step-1",
        type: "prompt",
        input: "Send 5 DOT from Alice to Bob"
      }
    ],
    
    expectations: [
      {
        responseType: "execution",
        expectedAgent: "AssetTransferAgent",
        expectedFunction: "transfer",
        expectedParams: { 
          amount: "5", 
          recipient: "Bob" 
        }
      }
    ]
  },
  
  {
    id: "state-alloc-003",
    name: "Multi-mode Consistency Test",
    description: "Verifies that StateAllocator produces consistent results across all modes",
    category: "state-allocation",
    tags: ["balance", "allocation", "consistency", "multi-mode"],
    
    entities: [
      { name: 'Alice', type: 'keypair' },
    ],
    
    walletState: {
      accounts: [
        { entityName: 'Alice', balance: '42.123456 DOT' },  // Precise amount
      ]
    },
    
    steps: [
      {
        id: "step-1",
        type: "assert",
        assertion: {
          type: "check-balance-change",
          entityName: 'Alice',
          expected: { balance: '42.123456 DOT' }
        }
      }
    ],
    
    // Success determined by assertion passing
    expectations: [
      {
        // No specific response type - assertion verifies state
      }
    ]
  },
  
  {
    id: "state-alloc-004",
    name: "Zero Balance Test",
    description: "Tests StateAllocator handles zero/minimal balances correctly",
    category: "state-allocation",
    tags: ["balance", "allocation", "edge-case"],
    
    entities: [
      { name: 'Alice', type: 'keypair' },
      { name: 'Bob', type: 'keypair' },
    ],
    
    walletState: {
      accounts: [
        { entityName: 'Alice', balance: '0 DOT' },
        { entityName: 'Bob', balance: '0.000001 DOT' },  // Minimal non-zero
      ]
    },
    
    steps: [
      {
        id: "step-1",
        type: "assert",
        assertion: {
          type: "check-balance-change",
          entityName: 'Alice',
          expected: { balance: '0 DOT' }
        }
      },
      {
        id: "step-2",
        type: "assert",
        assertion: {
          type: "check-balance-change",
          entityName: 'Bob',
          expected: { balance: '0.000001 DOT' }
        }
      }
    ],
    
    // Success determined by assertions passing
    expectations: [
      {
        // No specific response type - assertions verify state
      }
    ]
  }
];
