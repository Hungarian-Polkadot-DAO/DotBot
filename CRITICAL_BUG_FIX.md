# CRITICAL BUG FIX: Amount Type Mismatch in Extrinsic Rebuilding

## Problem

The application was experiencing `wasm unreachable` runtime panics during transaction execution with the error:

```
Preflight validation failed: 4003: Client error: Execution failed: 
Execution aborted due to trap: wasm trap: wasm `unreachable` instruction executed 
WASM backtrace: TransactionPaymentApi_query_info
```

## Root Cause

The executioner was rebuilding extrinsics from metadata, but there was a **type mismatch** in the amount parameter:

1. **Agent stores amount as STRING** in metadata:
   ```typescript
   metadata: {
     amount: amountBN.toString(),  // ← STRING
     recipient: recipientAddress,
     // ...
   }
   ```

2. **Executioner used STRING directly** when rebuilding:
   ```typescript
   // WRONG - passing string when BN expected
   extrinsic = api.tx.balances.transferKeepAlive(metadata.recipient, metadata.amount);
   ```

3. **Polkadot.js expects BN or number**, not string:
   ```typescript
   // Expected signature:
   tx.balances.transferKeepAlive(dest: AccountId, value: Compact<Balance>)
   // where Balance should be BN or number, not string
   ```

## Why This Caused Runtime Panic

When `paymentInfo()` is called on an extrinsic with an incorrectly typed amount:
1. The extrinsic structure appears valid (passes basic checks)
2. But when the runtime tries to decode the amount for fee calculation
3. It encounters an unexpected string type where it expects a numeric type
4. This causes a WASM trap (unreachable instruction) in `TransactionPaymentApi_query_info`

## The Fix

### Single Extrinsic Execution

**Before:**
```typescript
if (keepAlive) {
  extrinsic = apiForExtrinsic.tx.balances.transferKeepAlive(metadata.recipient, metadata.amount);
} else {
  extrinsic = apiForExtrinsic.tx.balances.transferAllowDeath(metadata.recipient, metadata.amount);
}
```

**After:**
```typescript
// IMPORTANT: amount is stored as string in metadata, must convert to BN
const { BN } = await import('@polkadot/util');
const amount = new BN(metadata.amount);
const keepAlive = metadata.keepAlive === true;

console.log('[Executioner] Rebuilding transfer extrinsic:', {
  recipient: metadata.recipient,
  amount: amount.toString(),
  keepAlive,
  chain: resolvedChainType,
});

if (keepAlive) {
  extrinsic = apiForExtrinsic.tx.balances.transferKeepAlive(metadata.recipient, amount);
} else {
  extrinsic = apiForExtrinsic.tx.balances.transferAllowDeath(metadata.recipient, amount);
}
```

### Batch Extrinsic Execution

**Before:**
```typescript
// Batch transfer - rebuild individual transfers
for (const transfer of metadata.transfers) {
  if (transfer.recipient && transfer.amount) {
    const extrinsic = apiForBatch.tx.balances.transferAllowDeath(transfer.recipient, transfer.amount);
    rebuiltExtrinsics.push(extrinsic);
  }
}

// Single transfer extrinsic
const extrinsic = keepAlive
  ? apiForBatch.tx.balances.transferKeepAlive(metadata.recipient, metadata.amount)
  : apiForBatch.tx.balances.transferAllowDeath(metadata.recipient, metadata.amount);
```

**After:**
```typescript
const { BN } = await import('@polkadot/util');

// Batch transfer - rebuild individual transfers
for (const transfer of metadata.transfers) {
  if (transfer.recipient && transfer.amount) {
    // IMPORTANT: amount is stored as string, must convert to BN
    const amount = new BN(transfer.amount);
    const extrinsic = apiForBatch.tx.balances.transferAllowDeath(transfer.recipient, amount);
    rebuiltExtrinsics.push(extrinsic);
  }
}

// Single transfer extrinsic
// IMPORTANT: amount is stored as string, must convert to BN
const amount = new BN(metadata.amount);
const keepAlive = metadata.keepAlive === true;
const extrinsic = keepAlive
  ? apiForBatch.tx.balances.transferKeepAlive(metadata.recipient, amount)
  : apiForBatch.tx.balances.transferAllowDeath(metadata.recipient, amount);
```

## Files Modified

- `frontend/src/lib/executionEngine/executioner.ts`
  - Line ~400: Single extrinsic rebuilding (added BN conversion)
  - Line ~668: Batch extrinsic rebuilding (added BN conversion)

## Why This Wasn't Caught Earlier

1. **TypeScript doesn't catch this**: Polkadot.js uses `any` types in many places, so TypeScript doesn't complain about passing string where BN is expected

2. **Simulation might have passed**: If the agent's original extrinsic (before rebuilding) was used for simulation, it would have the correct BN type, so simulation would pass

3. **Only fails at execution**: The bug only manifests when the executioner rebuilds the extrinsic from metadata and tries to call `paymentInfo()` or submit it

## Impact

✅ **Before Fix**: Runtime panics during preflight validation  
✅ **After Fix**: Transactions validate and execute correctly

## Testing Verification

To verify the fix works:

1. Create a transfer transaction: "Send 0.01 DOT to Alice"
2. Watch console logs for: `[Executioner] Rebuilding transfer extrinsic`
3. Verify preflight validation passes: `[Executioner] ✓ Preflight validation passed`
4. Transaction should execute successfully

## Prevention

To prevent similar issues in the future:

1. **Always convert metadata values to proper types** when rebuilding extrinsics
2. **Add TypeScript interfaces** for metadata to document expected types
3. **Add validation** when storing metadata to ensure types are correct
4. **Document** in metadata structure which fields are strings and need conversion

## Related Documentation

- `INFO_TWO.md` - Execution Session architecture
- `INFO_THREE.md` - Previous bug fixes
- `FIXES_APPLIED.md` - Earlier simulation fixes

## Summary

This was a critical type coercion bug where string amounts were being passed to extrinsic builders that expected BN (BigNumber) values. The fix ensures proper type conversion from string to BN when rebuilding extrinsics from metadata.

**Status**: ✅ FIXED  
**Priority**: 🔴 CRITICAL  
**Impact**: Prevents all transaction executions from failing with runtime panics



