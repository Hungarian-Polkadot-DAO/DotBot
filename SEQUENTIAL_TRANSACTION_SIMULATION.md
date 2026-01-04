# Sequential Transaction Simulation

## Problem: Transaction Flows That Build on Each Other

When you have a transaction flow with multiple steps where each step depends on the previous one, you need **sequential simulation** on the same fork.

### Example Flow (5 Elements)

```
1. Transfer 100 DOT to account
   ↓ (account now has 100 DOT)
2. Stake 50 DOT (requires the 100 DOT from step 1)
   ↓ (account has 50 DOT free, 50 DOT staked)
3. Vote with staked DOT (requires the stake from step 2)
   ↓ (vote is active)
4. Claim rewards (requires the vote from step 3)
   ↓ (rewards claimed)
5. Unstake (requires the stake from step 2)
   ↓ (50 DOT unstaking)
```

### Why Regular Simulation Fails

**Current implementation** (`simulateTransaction`):
- Each transaction is simulated **independently** on a fresh fork
- Transaction 2 doesn't see the state changes from Transaction 1
- Transaction 2 would fail because it doesn't have the 100 DOT from step 1

**Sequential simulation** (`simulateSequentialTransactions`):
- All transactions are simulated **on the same fork**
- Each transaction sees the state changes from previous transactions
- Transaction 2 can use the 100 DOT from Transaction 1

---

## Solution: Sequential Simulation

### New Function

**File**: `frontend/src/lib/services/simulation/sequentialSimulation.ts`

**Function**: `simulateSequentialTransactions()`

### How It Works

1. **Create Fork Once**: Fork the chain at the latest block
2. **Simulate Sequentially**: For each transaction:
   - Simulate on the **same fork** (not a new fork)
   - State changes accumulate
   - Next transaction sees previous state changes
3. **Fail Fast**: If any transaction fails, stop and return error
4. **Return Results**: Results for each transaction + total fees + final balance changes

### Usage Example

```typescript
import { simulateSequentialTransactions } from '@dotbot/lib/services/simulation';

const items = [
  {
    extrinsic: transferExtrinsic, // Transfer 100 DOT
    description: 'Transfer 100 DOT',
    senderAddress: account.address,
  },
  {
    extrinsic: stakeExtrinsic, // Stake 50 DOT
    description: 'Stake 50 DOT',
    senderAddress: account.address,
  },
  {
    extrinsic: voteExtrinsic, // Vote
    description: 'Vote with staked DOT',
    senderAddress: account.address,
  },
  {
    extrinsic: claimExtrinsic, // Claim rewards
    description: 'Claim rewards',
    senderAddress: account.address,
  },
  {
    extrinsic: unstakeExtrinsic, // Unstake
    description: 'Unstake 50 DOT',
    senderAddress: account.address,
  },
];

const result = await simulateSequentialTransactions(
  api,
  rpcEndpoints,
  items,
  onStatusUpdate
);

if (result.success) {
  console.log('All transactions would succeed!');
  console.log('Total fee:', result.totalEstimatedFee);
  for (const { index, description, result: txResult } of result.results) {
    console.log(`Transaction ${index + 1} (${description}): ${txResult.success ? '✅' : '❌'}`);
  }
} else {
  console.error('Flow would fail:', result.error);
}
```

---

## Integration with Executioner

### Current Implementation

The `Executioner` currently simulates each item **independently**:

```typescript
// In executeExtrinsic()
const simulationResult = await simulateTransaction(
  apiForExtrinsic,
  rpcEndpoints,
  extrinsic,
  encodedSender,
  this.onStatusUpdate
);
```

### Future Enhancement

For sequential flows, the `Executioner` should:

1. **Detect Sequential Dependencies**: Check if items depend on each other
2. **Group Sequential Items**: Group items that need sequential simulation
3. **Use Sequential Simulation**: Call `simulateSequentialTransactions()` for grouped items

### Example Implementation

```typescript
// In Executioner.execute()
const sequentialGroups = this.detectSequentialGroups(executionArray);

for (const group of sequentialGroups) {
  if (group.length > 1) {
    // Use sequential simulation
    const items = group.map(item => ({
      extrinsic: item.agentResult.extrinsic!,
      description: item.description,
      senderAddress: this.account.address,
    }));
    
    const result = await simulateSequentialTransactions(
      apiForExtrinsic,
      rpcEndpoints,
      items,
      this.onStatusUpdate
    );
    
    if (!result.success) {
      // Fail all items in group
      for (const item of group) {
        executionArray.updateStatus(item.id, 'failed', result.error || 'Sequential simulation failed');
      }
      continue;
    }
    
    // All passed - mark as ready
    for (const item of group) {
      executionArray.updateStatus(item.id, 'ready');
    }
  } else {
    // Single item - use regular simulation
    await this.executeItem(executionArray, group[0], timeout, autoApprove);
  }
}
```

---

## Benefits

1. **✅ Accurate Simulation**: Each transaction sees previous state changes
2. **✅ Fail Fast**: Stops at first failure, doesn't waste time
3. **✅ Complete Flow Validation**: Validates entire flow, not just individual steps
4. **✅ Better UX**: User knows if entire flow will work before approving

---

## Limitations

1. **Performance**: Sequential simulation is slower (one transaction at a time)
2. **Complexity**: Need to detect which items need sequential simulation
3. **State Management**: Need to track state changes across transactions

---

## When to Use

**Use Sequential Simulation When:**
- ✅ Transactions depend on each other (e.g., transfer → stake → vote)
- ✅ Later transactions use outputs from earlier transactions
- ✅ State changes from one transaction affect another

**Use Regular Simulation When:**
- ✅ Transactions are independent (e.g., transfer to Alice, transfer to Bob)
- ✅ Transactions can be executed in any order
- ✅ No state dependencies between transactions

---

## Current Status

- ✅ **Sequential simulation function created** (`simulateSequentialTransactions`)
- ⏳ **Not yet integrated** into Executioner (future enhancement)
- ✅ **Ready for use** when needed

---

## Testing

To test sequential simulation:

```typescript
// Create a test flow
const items = [
  { extrinsic: transferExtrinsic, description: 'Transfer', senderAddress: '...' },
  { extrinsic: stakeExtrinsic, description: 'Stake', senderAddress: '...' },
  { extrinsic: voteExtrinsic, description: 'Vote', senderAddress: '...' },
];

const result = await simulateSequentialTransactions(api, endpoints, items);

console.log('Success:', result.success);
console.log('Results:', result.results);
```

---

## Answer to User's Question

**Q: When we will have transaction flows of 5 elements, this simulation will work? They build on each other. How will that go?**

**A:** 

1. **Current State**: Regular simulation (`simulateTransaction`) simulates each transaction independently. For 5-element flows that build on each other, this **won't work correctly** because each transaction won't see the state changes from previous transactions.

2. **Solution Created**: I've created `simulateSequentialTransactions()` which:
   - Creates **one fork** for all transactions
   - Simulates them **sequentially** on the same fork
   - Each transaction sees **state changes from previous transactions**
   - **Fails fast** if any transaction fails

3. **Integration Needed**: The `Executioner` needs to be enhanced to:
   - Detect when items need sequential simulation
   - Group dependent items together
   - Use `simulateSequentialTransactions()` for those groups

4. **For Now**: You can use `simulateSequentialTransactions()` directly for flows that build on each other. The Executioner will be enhanced in the future to automatically detect and use sequential simulation when needed.

**Example 5-element flow:**
```typescript
// All 5 transactions simulated on same fork
const result = await simulateSequentialTransactions(api, endpoints, [
  { extrinsic: tx1, description: 'Transfer', senderAddress },
  { extrinsic: tx2, description: 'Stake', senderAddress },
  { extrinsic: tx3, description: 'Vote', senderAddress },
  { extrinsic: tx4, description: 'Claim', senderAddress },
  { extrinsic: tx5, description: 'Unstake', senderAddress },
]);
// ✅ Each transaction sees state from previous ones!
```


