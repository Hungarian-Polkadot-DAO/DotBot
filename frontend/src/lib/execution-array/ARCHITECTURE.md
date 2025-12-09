# Execution Array Architecture

## System Overview

The Execution Array system is a **simple, robust** execution layer for blockchain operations.

## Core Principle

**Agents create extrinsics → ExecutionArray manages them → Executioner executes them**

## Components

### 1. ExecutionArray (State Management)

**Responsibility**: Queue management and status tracking

```typescript
const executionArray = new ExecutionArray();

// Add operations
executionArray.add(agentResult);

// Track status
executionArray.onStatusUpdate((item) => {
  console.log(`${item.description}: ${item.status}`);
});

// Get state
const state = executionArray.getState();
```

**Features**:
- Queue of ExecutionItem[]
- Status tracking for each item
- Real-time callbacks
- Pause/resume
- Progress tracking

### 2. Executioner (Operation Execution)

**Responsibility**: Execute blockchain operations

```typescript
const executioner = new Executioner();
executioner.initialize(api, account);

// Set signing handler (REQUIRED)
executioner.setSigningRequestHandler((request) => {
  showSigningModal(request);
});

// Execute!
await executioner.execute(executionArray);
```

**Features**:
- User signing (NO automatic execution)
- Transaction broadcasting
- Status monitoring
- Batching support
- Error handling

## Complete Flow (Automatic)

```
┌─────────────────────────────┐
│ User: "Send 5 DOT to Alice" │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│ LLM Creates ExecutionArrayPlan (JSON)       │
│ {                                           │
│   steps: [{                                 │
│     agentClassName: "AssetTransferAgent",  │
│     functionName: "transfer",              │
│     parameters: {                           │
│       address: "...",                       │
│       recipient: "Alice",                   │
│       amount: "5"                           │
│     }                                       │
│   }]                                        │
│ }                                           │
└──────────┬──────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────┐
│ Orchestrator.orchestrate(llmPlan)            │
│                                              │
│ For each ExecutionStep:                     │
│ 1. Find agent: AssetTransferAgent          │
│ 2. Create instance: new AssetTransferAgent()│
│ 3. Initialize: agent.initialize(api)        │
│ 4. Call function: agent.transfer(params)   │
│ 5. Agent creates extrinsic                  │
│ 6. Agent returns AgentResult                │
│ 7. Add to ExecutionArray                    │
└──────────┬────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ ExecutionArray populated     │
│ - Has extrinsics ready       │
│ - Status: pending            │
└──────────┬───────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│ Executioner.execute()           │
│ 1. Request user signature       │
│ 2. Sign with wallet             │
│ 3. Broadcast transaction        │
│ 4. Monitor finalization         │
└──────────┬──────────────────────┘
           │
           ▼
┌──────────────────┐
│ Transaction      │
│ Finalized ✅     │
└──────────────────┘
```

## Key Design Decisions

### 1. Orchestrator Converts LLM Plans ✅

**Why?**
- Frontend doesn't need to interpret LLM output
- Automatic agent calling based on ExecutionStep[]
- Turnkey solution - minimal wiring
- Library handles everything

### 2. Executioner is Separate ✅

**Why?**
- Single Responsibility Principle
- ExecutionArray = state management
- Executioner = operations
- Can test independently
- Can swap implementations

### 3. Agents Return Extrinsics ✅

**Why?**
- Extrinsics are created BEFORE signing
- User can review complete transaction
- Type-safe AgentResult
- No complex orchestration needed

### 4. User Always Signs ✅

**Why?**
- Security: User controls private keys
- Transparency: User sees what they're signing
- Standard pattern: Wallet extension handles signing
- No custody: System never has keys

## Example Usage

### Turnkey Usage (Recommended)

```typescript
import { ApiPromise } from '@polkadot/api';
import { ExecutionSystem } from '@dotbot/lib';

// 1. Setup - ONE TIME
const api = await ApiPromise.create();
const account = { address: '5GrwvaEF...', ... };

const system = new ExecutionSystem();
system.initialize(api, account);
system.setSigningHandler(showSigningModal);

// 2. Execute LLM plan - THAT'S IT!
// LLM returns ExecutionArrayPlan (JSON)
const llmPlan = await getLLMResponse("Send 5 DOT to Alice");

// Automatic: orchestration + agent calls + execution
await system.execute(llmPlan, {}, {
  onPreparingStep: (desc, current, total) => {
    // LLM feedback: "Preparing step 1 of 1: Transfer 5 DOT..."
  },
  onExecutingStep: (desc, status) => {
    // LLM feedback: "Transaction is being signed..."
  }
});
```

### Manual Usage (Advanced)

```typescript
import { ExecutionOrchestrator, Executioner } from '@dotbot/lib';

// 1. Orchestrate (convert LLM plan to operations)
const orchestrator = new ExecutionOrchestrator();
orchestrator.initialize(api);

const result = await orchestrator.orchestrate(llmPlan);
const { executionArray } = result;

// 2. Execute
const executioner = new Executioner();
executioner.initialize(api, account);
executioner.setSigningRequestHandler(showSigningModal);

await executioner.execute(executionArray);
```

### Direct Agent Usage (Rare)

```typescript
// If you want to bypass LLM and call agents directly
import { AssetTransferAgent, ExecutionArray, Executioner } from '@dotbot/lib';

const agent = new AssetTransferAgent();
agent.initialize(api);

const result = await agent.transfer({
  address: account.address,
  recipient: '5FHneW46...',
  amount: '5'
});

const executionArray = new ExecutionArray();
executionArray.add(result);

const executioner = new Executioner();
await executioner.execute(executionArray);
```

### With LLM Feedback

```typescript
// LLM explains what's happening
executionArray.onStatusUpdate((item) => {
  switch (item.status) {
    case 'signing':
      tellLLM('Please approve the transaction in your wallet');
      break;
    case 'broadcasting':
      tellLLM('Broadcasting transaction to Polkadot network...');
      break;
    case 'in_block':
      tellLLM('Transaction included in block, waiting for finalization...');
      break;
    case 'finalized':
      tellLLM(`Success! Transaction finalized at block ${item.result?.blockHash}`);
      break;
  }
});
```

### Multiple Operations

```typescript
// Create multiple operations
const transfer1 = await agent.transfer({ ... });
const transfer2 = await agent.transfer({ ... });
const staking = await stakingAgent.bond({ ... });

// Add all to array
executionArray.add(transfer1);
executionArray.add(transfer2);
executionArray.add(staking);

// Execute sequentially
await executioner.execute(executionArray, {
  sequential: true,
  allowBatching: true,
  continueOnError: false
});
```

## LLM Integration Points

The LLM can track and explain at every step:

1. **Before execution**: "I'll transfer 5 DOT to Alice. Let me prepare the transaction..."
2. **During preparation**: "Transaction prepared. Estimated fee: 0.01 DOT"
3. **Requesting signature**: "Please approve the transaction in your wallet"
4. **Broadcasting**: "Transaction signed! Broadcasting to network..."
5. **In block**: "Transaction included in block #12345"
6. **Finalized**: "Success! Your 5 DOT has been sent to Alice"
7. **Error**: "Transaction failed: Insufficient balance"

## Error Handling

Errors are handled at multiple levels:

```typescript
try {
  // Agent validation
  const result = await agent.transfer({ ... });
  
  executionArray.add(result);
  
  // Execution errors
  await executioner.execute(executionArray);
  
} catch (error) {
  if (error instanceof AgentError) {
    // Agent-level error (validation, balance check, etc.)
    tellLLM(`Cannot create transaction: ${error.message}`);
  } else {
    // Execution error (network, signing rejected, etc.)
    tellLLM(`Transaction failed: ${error.message}`);
  }
}
```

## Status Lifecycle

```
pending → ready → signing → broadcasting → in_block → finalized
                     ↓           ↓            ↓
                 cancelled   failed      failed
```

## Security Guarantees

1. ✅ **No automatic signing**: User must approve every transaction
2. ✅ **Extrinsics prepared first**: User sees complete transaction before signing
3. ✅ **Multiple approval points**: UI modal + wallet extension
4. ✅ **No key custody**: Private keys never leave wallet
5. ✅ **Full transparency**: Status tracking and callbacks for every step

## Performance Considerations

1. **Batching**: Compatible extrinsics can be batched (saves fees)
2. **Sequential by default**: Prevents race conditions
3. **Parallel support**: Non-extrinsic operations can run in parallel
4. **Timeout handling**: Each operation has timeout
5. **Error recovery**: Continue on error option available

## Testing Strategy

1. **Unit tests**: Test ExecutionArray state management
2. **Integration tests**: Test Executioner with mock API
3. **E2E tests**: Test complete flow with test network
4. **Mock signing**: Test without real wallet for CI/CD

## Summary

The Execution Array system is:

✅ **Simple**: Clear separation of concerns
✅ **Robust**: Comprehensive error handling
✅ **Secure**: User always controls signing
✅ **Transparent**: Full status tracking
✅ **Flexible**: Supports sequential, parallel, and batch execution
✅ **LLM-friendly**: Callbacks for progress tracking and explanation
✅ **Production-ready**: Handles edge cases and failures gracefully

**No orchestrator needed** - agents are called directly by the frontend! 🚀

