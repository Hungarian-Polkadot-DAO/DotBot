# PaymentInfo Validation Fix

## Problem

Chopsticks simulation was reporting success, but:
1. `paymentInfo()` was failing with `wasm unreachable` in `TransactionPaymentApi_query_info`
2. Real transaction was failing with `wasm unreachable` in `TaggedTransactionQueue_validate_transaction`
3. Error messages were not displayed correctly (nested prefixes, WASM backtraces)

## Root Cause

**`paymentInfo()` is a stricter validation than `dryRunExtrinsic()`**:
- `dryRunExtrinsic()` can pass even with some structural issues
- `paymentInfo()` validates the extrinsic structure more strictly
- If `paymentInfo()` fails with `wasm unreachable`, the transaction **will definitely fail** on the real network

**The code was treating `paymentInfo()` failures as warnings**, allowing the simulation to pass when it should fail.

## Solution

### 1. Fail Simulation on `paymentInfo()` `wasm unreachable` Errors

**File**: `chopsticks.ts` lines 296-356

**Before**:
```typescript
catch (feeError) {
  // paymentInfo can fail with wasm trap if the extrinsic has issues
  // But simulation already passed, so we can proceed without fee estimate
  console.warn('[Chopsticks] Fee estimation failed...');
  // Continue - simulation marked as successful ❌
}
```

**After**:
```typescript
catch (feeError) {
  const isWasmUnreachable = 
    errorLower.includes('unreachable') ||
    errorLower.includes('wasm trap') ||
    errorLower.includes('transactionpaymentapi') ||
    errorLower.includes('taggedtransactionqueue');
  
  if (isWasmUnreachable) {
    // Fail the simulation - this extrinsic will fail on real network ✅
    return {
      success: false,
      error: `Extrinsic is malformed: ${cleanError}...`,
      ...
    };
  }
  // Only continue for non-critical errors (network issues, etc.)
}
```

### 2. Registry Validation Before `paymentInfo()`

**File**: `chopsticks.ts` lines 254-264

Added check to ensure extrinsic registry matches API registry before calling `paymentInfo()`:

```typescript
// CRITICAL: Validate extrinsic registry matches API registry before paymentInfo
if (extrinsic.registry !== api.registry) {
  throw new Error(`Registry mismatch: ...`);
}
```

### 3. Registry Validation Before `dryRunExtrinsic()`

**File**: `chopsticks.ts` lines 206-217

Added check before simulation to catch registry mismatches early:

```typescript
// CRITICAL: Validate extrinsic registry matches API registry before simulation
if (extrinsic.registry !== api.registry) {
  throw new Error(`Registry mismatch: ...`);
}
```

### 4. Enhanced Error Messages

**File**: `chopsticks.ts` lines 345-356, `executioner.ts` lines 479-492

**Before**:
```
Transaction validation failed: Simulation failed: Chopsticks simulation failed: 4003: Client error: Execution failed: Execution aborted due to trap: wasm trap: wasm `unreachable` instruction executed WASM backtrace: ...
```

**After**:
```
Extrinsic is malformed: wasm unreachable. The transaction structure is invalid for this chain's runtime and will fail on the real network.
```

### 5. Enhanced Logging

Added detailed logging:
- Extrinsic method, call index, arguments
- Registry information
- Outcome details
- Full extrinsic details on error

## Benefits

1. **✅ Catches malformed extrinsics early** - Before user approval
2. **✅ Clear error messages** - User knows what went wrong
3. **✅ Prevents false positives** - Simulation won't pass if transaction will fail
4. **✅ Better debugging** - Detailed logs help identify the issue

## Testing

### Test Case: Malformed Extrinsic

**Expected Behavior**:
1. Agent creates extrinsic
2. Executioner matches registry ✅
3. Chopsticks `dryRunExtrinsic` passes (or fails) ✅
4. `paymentInfo` fails with `wasm unreachable` ✅
5. **Simulation fails** (not just a warning) ✅
6. **Clear error message** shown to user ✅
7. Transaction **not sent** to network ✅

### Expected Error Message

```
❌ Unable to prepare your transaction: Extrinsic is malformed: wasm unreachable. The transaction structure is invalid for this chain's runtime and will fail on the real network.
```

**No more nested prefixes or WASM backtraces!**

## Files Changed

1. **`frontend/src/lib/services/simulation/chopsticks.ts`**
   - Lines 206-217: Registry validation before simulation
   - Lines 254-264: Registry validation before paymentInfo
   - Lines 296-356: Fail simulation on wasm unreachable errors
   - Lines 240-248: Enhanced outcome logging

2. **`frontend/src/lib/executionEngine/executioner.ts`**
   - Lines 479-492: Clean error messages (remove nested prefixes)

## Related Issues

This fix addresses:
- ✅ `paymentInfo` failures being ignored
- ✅ False positive simulations (passes but fails on network)
- ✅ Unclear error messages
- ✅ Registry mismatches not caught early

## Next Steps

If this still fails, check:
1. **Extrinsic creation** - Is the extrinsic created with the correct API?
2. **Call index** - Is the call index correct for the chain?
3. **Argument types** - Are arguments in the correct format (BN vs string)?
4. **Address encoding** - Are addresses encoded for the correct chain?

The enhanced logging will help identify which of these is the issue.


