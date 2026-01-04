# WASM Unreachable Error - Debugging & Fix

## Problem

Getting `wasm unreachable` errors in BOTH:
1. **Chopsticks simulation** - During `TransactionPaymentApi_query_info` (fee calculation)
2. **Real network** - During `TaggedTransactionQueue_validate_transaction` (transaction submission)

## Error Details

```
wasm trap: wasm `unreachable` instruction executed
WASM backtrace:
  0: asset_hub_polkadot_runtime.wasm!__rustc::rust_begin_unwind
  1: asset_hub_polkadot_runtime.wasm!core::panicking::panic_fmt
  2: asset_hub_polkadot_runtime.wasm!TransactionPaymentApi_query_info  OR
     asset_hub_polkadot_runtime.wasm!TaggedTransactionQueue_validate_transaction
```

## Root Cause Analysis

A `wasm unreachable` panic means the **runtime cannot process the extrinsic call**. This happens when:

1. ❌ **Wrong method name** - Method doesn't exist in runtime
2. ❌ **Wrong parameters** - Method signature doesn't match
3. ❌ **Wrong chain** - Using wrong API instance for the chain
4. ❌ **Incompatible runtime** - Method not available in this runtime version

## Key Observation

**BOTH Chopsticks AND real network fail with the SAME error**.

This rules out:
- ✅ Signature/crypto issues (would only affect real network)
- ✅ Network connectivity (Chopsticks is local)
- ✅ Account/balance issues (would show different errors)

This confirms:
- ❌ **The extrinsic call itself is malformed**

## Hypothesis

### Suspect #1: `transferAllowDeath` Not Available

Asset Hub might still use the **older** `transfer` method instead of the **newer** `transferAllowDeath` method.

**Method names**:
- `balances.transfer` - Old name (Substrate < v1.0)
- `balances.transferAllowDeath` - New name (Substrate >= v1.0) 
- `balances.transferKeepAlive` - Exists in both

**Why this matters**:
- Polkadot Relay Chain updated to use `transferAllowDeath`
- Asset Hub might be on older runtime version
- Using non-existent method → runtime panic

### Suspect #2: Wrong API Instance

Even though we use execution sessions, there could be a mismatch:
- Session created for Relay Chain, but used for Asset Hub
- API metadata doesn't match actual chain
- RPC manager returning wrong API

## Fix Applied

### 1. Added Method Fallback

Added fallback from `transferAllowDeath` to `transfer`:

```typescript
if (keepAlive) {
  extrinsic = api.tx.balances.transferKeepAlive(recipient, amount);
} else {
  // Try transferAllowDeath first (newer), fallback to transfer (older)
  if (api.tx.balances.transferAllowDeath) {
    extrinsic = api.tx.balances.transferAllowDeath(recipient, amount);
  } else if (api.tx.balances.transfer) {
    console.log('[Executioner] Using legacy transfer method');
    extrinsic = api.tx.balances.transfer(recipient, amount);
  } else {
    throw new Error('No suitable transfer method available');
  }
}
```

**Applied to**:
- Single extrinsic execution
- Batch extrinsic execution

### 2. Added Detailed Logging

Added API diagnostics before building extrinsic:

```typescript
console.log('[Executioner] API details:', {
  genesisHash: api.genesisHash.toHex(),
  runtimeChain: api.runtimeChain?.toString(),
  runtimeVersion: api.runtimeVersion?.specName?.toString(),
  hasTransferAllowDeath: !!api.tx?.balances?.transferAllowDeath,
  hasTransfer: !!api.tx?.balances?.transfer,
  hasTransferKeepAlive: !!api.tx?.balances?.transferKeepAlive,
});
```

This will show us:
- Which API we're using (genesisHash, runtimeChain)
- Which methods are available
- Whether we're using the right API for the intended chain

## Testing Instructions

### Test 1: Check Console Logs

When you run a transaction, look for:

```
[Executioner] API details: {
  genesisHash: "0x68d56f15f85d3136970ec16946040bc1752654e906147f7e43e9d539d7c3de2f",
  runtimeChain: "Polkadot Asset Hub",
  runtimeVersion: "statemint",
  hasTransferAllowDeath: true/false,
  hasTransfer: true/false,
  hasTransferKeepAlive: true
}
```

**Check**:
1. Is `runtimeChain` correct? Should be "Polkadot Asset Hub" for Asset Hub
2. Is `genesisHash` correct for Asset Hub?
   - Asset Hub: `0x68d56f15f85d3136970ec16946040bc1752654e906147f7e43e9d539d7c3de2f`
   - Relay Chain: `0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3`
3. Which transfer methods are available?

### Test 2: Check Which Method Is Used

Look for:
```
[Executioner] Using transferAllowDeath method
```
OR
```
[Executioner] Using legacy transfer method
```

If you see "legacy transfer method", it means `transferAllowDeath` doesn't exist and we're falling back.

### Test 3: Try Transaction

Try a simple transfer:
```
"Send 0.01 DOT to Alice"
```

**Expected outcomes**:

**If fix works**:
- Simulation passes
- Transaction executes successfully
- No wasm unreachable errors

**If still fails**:
- Check console logs to see which API/methods are being used
- The issue might be something else (wrong chain, wrong API, etc.)

## Next Steps If Still Failing

### If `transferAllowDeath` exists but still fails:

The problem is NOT the method name. Check:
1. **API instance mismatch** - Wrong API for wrong chain
2. **Parameter encoding** - Amount or recipient malformed
3. **Runtime version mismatch** - API metadata out of sync with chain

### If `transferAllowDeath` doesn't exist:

The fallback to `transfer` should work. If it still fails:
1. **Check method signature** - `transfer(dest, value)` vs other signatures
2. **Check if balances pallet exists** - Maybe using wrong chain entirely
3. **Check API connection** - Maybe API isn't fully initialized

### Diagnostic Checklist

When transaction fails, check console for:

1. ✅ **API details logged** - Shows which chain/methods
2. ✅ **Method used logged** - transferAllowDeath or transfer
3. ✅ **Simulation started** - Chopsticks attempts to run
4. ✅ **Where it fails** - During fee calc or during validation

## Files Modified

- `frontend/src/lib/executionEngine/executioner.ts`
  - Added method fallback (transferAllowDeath → transfer)
  - Added diagnostic logging for API details
  - Applied to both single and batch execution

## Related Issues

- `CRITICAL_BUG_FIX.md` - Amount type mismatch (already fixed)
- `SIMULATION_ARCHITECTURE_FIX.md` - Simulate what you execute (already fixed)
- `AGENT_SIMPLIFICATION.md` - Remove double simulation (already fixed)
- `IMPORT_PATH_FIX.md` - Import paths corrected (already fixed)

## Summary

**Hypothesis**: Asset Hub uses `transfer` instead of `transferAllowDeath`

**Fix**: Added fallback mechanism with diagnostic logging

**Next**: Run transaction and check console logs to confirm

---

**Status**: ⏳ TESTING REQUIRED  
**Priority**: 🔴 CRITICAL  
**Impact**: Blocks all transaction execution


