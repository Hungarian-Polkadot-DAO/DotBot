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
  },
  
  // TODO: Multisig test needs proper implementation - executor doesn't support "auto" placeholders yet
  // {
  //   id: "state-alloc-005",
  //   name: "Multisig 2/3 Transfer Test",
  //   description: "Tests multisig creation and execution with 2/3 threshold. Creates a multisig, pre-allocates balance, then executes a transfer requiring 2 approvals using only ScenarioEngine background actions (no DotBot).",
  //   category: "state-allocation",
  //   tags: ["multisig", "allocation", "transfer", "integration"],
  //   
  //   // Create entities: Alice, Bob, Charlie (signatories) and MultisigAccount (2/3 multisig)
  //   entities: [
  //     { name: 'Alice', type: 'keypair' },
  //     { name: 'Bob', type: 'keypair' },
  //     { name: 'Charlie', type: 'keypair' },
  //     { 
  //       name: 'MultisigAccount', 
  //       type: 'multisig',
  //       signatoryNames: ['Alice', 'Bob', 'Charlie'],
  //       threshold: 2  // 2 out of 3 required
  //     }
  //   ],
  //   
  //   // Pre-allocate balances: multisig needs funds, signatories need small amounts for fees
  //   walletState: {
  //     accounts: [
  //       { entityName: 'MultisigAccount', balance: '1 WND' },  // Multisig has the funds
  //       { entityName: 'Alice', balance: '0.1 WND' },               // For transaction fees
  //       { entityName: 'Bob', balance: '0.1 WND' },                 // For transaction fees
  //       { entityName: 'Charlie', balance: '0.1 WND' },              // For transaction fees (optional)                                                                                                                                                    
  //     ]
  //   },
  //   
  //   steps: [
  //     {
  //       id: "step-1",
  //       type: "action",
  //       action: {
  //         type: "sign-as-participant",
  //         asEntity: "Alice",
  //         params: {
  //           // Note: Executor should resolve entity names to addresses and sort them
  //           // Transfer: 2 WND from MultisigAccount to Bob
  //           // The multisig account is created automatically when funded in walletState
  //           signatories: ["Alice", "Bob", "Charlie"],  // Entity names - executor resolves to addresses
  //           threshold: 2,
  //           // Call hash for: balances.transferKeepAlive(MultisigAccount -> Bob, 2 WND)
  //           // Executor should create: api.tx.balances.transferKeepAlive(Bob.address, 2000000000000)
  //           // Then get call hash: call.hash.toHex()
  //           callHash: "auto",  // Special value: executor creates transfer call and gets hash
  //           callParams: {
  //             from: "MultisigAccount",
  //             to: "Bob",
  //             amount: "0.1 WND"
  //           },
  //           maxWeight: 1000000000
  //         }
  //       }
  //     },
  //     {
  //       id: "step-2",
  //       type: "wait",
  //       waitMs: 3000  // Wait for Alice's approval to be included in block
  //     },
  //     {
  //       id: "step-3",
  //       type: "action",
  //       action: {
  //         type: "sign-as-participant",
  //         asEntity: "Bob",
  //         params: {
  //           signatories: ["Alice", "Bob", "Charlie"],  // Same multisig
  //           threshold: 2,
  //           callHash: "auto",  // Same call hash as step-1 (executor should reuse)
  //           callParams: {
  //             from: "MultisigAccount",
  //             to: "Bob",
  //             amount: "0.1 WND"
  //           },
  //           maxWeight: 1000000000
  //         }
  //       }
  //     },
  //     {
  //       id: "step-4",
  //       type: "wait",
  //       waitMs: 3000  // Wait for Bob's approval (now we have 2/3 threshold)
  //     },
  //     {
  //       id: "step-5",
  //       type: "action",
  //       action: {
  //         type: "execute-multisig",
  //         asEntity: "Alice",  // Any signatory can execute when threshold is reached
  //         params: {
  //           signatories: ["Alice", "Bob", "Charlie"],
  //           threshold: 2,
  //           // Executor should create the same transfer call and query timepoint from chain
  //           call: "auto",  // Special value: executor creates transfer call
  //           callParams: {
  //             from: "MultisigAccount",
  //             to: "Bob",
  //             amount: "0.1 WND"
  //           },
  //           timepoint: "auto",  // Special value: executor queries from on-chain state
  //           maxWeight: 1000000000
  //         }
  //       }
  //     },
  //     {
  //       id: "step-6",
  //       type: "wait",
  //       waitMs: 5000  // Wait for multisig execution to be finalized
  //     },
  //     {
  //       id: "step-7",
  //       type: "assert",
  //       assertion: {
  //         type: "check-balance-change",
  //         entityName: 'Bob',
  //         expected: { balance: '3 WND' }  // 1 (initial) + 2 (from multisig)
  //       }
  //     }
  //   ],
  //   
  //   // Minimal expectation - this is a pure ScenarioEngine test, not testing DotBot
  //   // Just need at least one expectation to pass validation
  //   expectations: [
  //     {
  //       // No specific checks - assertions verify the state
  //     }
  //   ]
  // }
];
