# Test Plan: Chopsticks Block Hash Fix

## Error Fixed

```
❌ Cannot find header for 0x47e3161d3bf858624e11f9ec4397bd9d30fa9a639fb3d84e22ed6792a2afb861
```

This error occurred when Chopsticks tried to fork at a stale block hash from the API instance.

## Solution Implemented

**Always let Chopsticks fetch the latest block from the RPC endpoint** instead of using the API's cached block hash.

## Files Changed

1. **`frontend/src/lib/services/simulation/chopsticks.ts`**
   - Removed: `api.rpc.chain.getBlockHash()` call
   - Changed: `block: undefined` in `setup()` (let Chopsticks fetch latest)
   - Added: Get block info from `chain.head` after setup

## How to Test

### Test 1: Single Transfer

**Command:**
```
Send 0.01 DOT to Alice
```

**Expected Result:**
- ✅ No "Cannot find header" errors
- ✅ Chopsticks simulation passes
- ✅ Transaction executes successfully

**Expected Logs:**
```
🌿 [Chopsticks] Creating chain fork (fetching latest block from endpoint)... [████░░░░░░] 40%
🌿 [Chopsticks] Chain fork created at block #12345678... [████░░░░░░] 45%
⚡ [Chopsticks] Simulating transaction execution... [██████░░░░] 60%
✅ [Chopsticks] ✓ Simulation successful! [██████████] 100%
```

### Test 2: Batch Transfer

**Command:**
```
Send 0.01 DOT to Alice and 0.02 DOT to Bob
```

**Expected Result:**
- ✅ No block hash errors
- ✅ Batch simulation passes
- ✅ Batch executes successfully

### Test 3: Repeated Transfers (Long-lived Session)

**Purpose:** Verify it works even after the API has been connected for a while

**Commands:**
```
1. Send 0.01 DOT to Alice
2. Wait 30 seconds
3. Send 0.01 DOT to Bob
4. Wait 30 seconds
5. Send 0.01 DOT to Charlie
```

**Expected Result:**
- ✅ All three transfers succeed
- ✅ No block hash errors on any transfer
- ✅ Chopsticks always uses the latest block

## What Should NOT Happen

❌ No more "Cannot find header" errors
❌ No "Block not found" errors
❌ No "Invalid block hash" errors
❌ No "RPC timeout while fetching block" errors

## Technical Verification

### Before the Fix

```typescript
// ❌ BAD: Uses stale block hash from API
blockHash = await api.rpc.chain.getBlockHash();
chain = await setup({ block: blockHash.toHex() }); // Fails if block doesn't exist
```

### After the Fix

```typescript
// ✅ GOOD: Let Chopsticks fetch latest block
chain = await setup({ block: undefined }); // Always uses latest available block

// Get block info from the chain AFTER setup
const chainBlockHash = await chain.head; // Fresh block that exists
```

## Success Criteria

1. ✅ Single transfers work consistently
2. ✅ Batch transfers work consistently
3. ✅ No block hash related errors
4. ✅ Works with public RPC nodes (which prune blocks)
5. ✅ Works after long-lived API connections
6. ✅ Chopsticks always forks at the latest available block

## Rollback

If this fix causes issues (unlikely), revert these lines in `chopsticks.ts`:
- Lines 94-104: Block hash fetching logic
- Lines 112-123: Block info retrieval

But the old code was broken, so rollback is NOT recommended.

## Related Fixes

This fix works together with:
1. **Registry Match Fix** - Ensures correct API is used
2. **Address Encoding Fix** - Ensures correct address format
3. **Production Safe Transfers** - Ensures correct extrinsic creation

All four fixes together ensure reliable transaction execution.


