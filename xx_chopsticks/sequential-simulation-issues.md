# Chopsticks Sequential Simulation Issues

**Last Updated:** 2026-02-07

## Overview

Sequential transaction simulation using Chopsticks has two critical blocking issues:
1. **Simulations succeed when they should fail** (insufficient balance not detected)
2. **Fee calculations are wrong** (100x too high)

Both issues appear to stem from the same root cause: **Chopsticks is not actually applying extrinsics to the fork**, so each transaction is validated against the original state instead of the updated state.

### Quick Status

| Issue | Status | Latest Fix Applied | Needs Testing |
|-------|--------|-------------------|---------------|
| Empty blocks (`extrinsics: []`) | 🟡 FIX APPLIED | Fixed `genesisHash` in mock signature | ✅ YES - restart backend |
| Simulation succeeds incorrectly | 🔴 UNKNOWN | Depends on empty blocks fix | ✅ YES |
| Fee 100x too high | 🔴 UNKNOWN | Added extensive logging | ✅ YES |

**ACTION REQUIRED:** Restart backend and run tests. See `TESTING_INSTRUCTIONS.md`.

---

## Critical Issues (BLOCKING ScenarioEngine completion)

### Issue 1: Simulation Succeeds When It Should Fail (Insufficient Balance)

**Status:** 🔴 CRITICAL - NOT FIXED

**Description:**
The "Multi-Transaction: Second Transfer Insufficient Balance (Dynamic)" scenario is passing when it should fail. The scenario:
1. Sends 0.5 WND (should succeed)
2. Sends 70.51 WND when only ~70.32 WND remains (should FAIL with `InsufficientBalance`)

**Expected Behavior:**
- First transfer succeeds and updates the account balance
- Second transfer fails with `InsufficientBalance` error
- Simulation returns `success: false` with specific error

**Actual Behavior:**
- Both transfers appear to succeed
- Simulation returns `success: true`
- No error is reported

**Root Cause (Hypothesis):**
The fork state is not being updated between transactions. Chopsticks is building blocks with `extrinsics: []` (empty), meaning the transactions are NOT actually being applied to the fork. As a result:
- Each `dryRunExtrinsic` call runs against the ORIGINAL balance
- The balance never decreases after the first transfer
- The second transfer validates against the full balance, incorrectly succeeding

**Investigation History:**

1. **Initial Attempt:** Used `newBlock()` directly, tried to parse `ApplyExtrinsicResult` from block (doesn't exist in Block structure)
2. **Second Attempt:** Added `dryRunExtrinsic` before `newBlock` to get outcome
3. **Third Attempt:** Passed unsigned extrinsic hex to `newBlock` → rejected silently by Chopsticks
4. **Fourth Attempt:** Built mock-signed extrinsic using `GenericExtrinsic.signFake()` with `0xdeadbeef` signature
5. **Fifth Attempt (CURRENT):** Fixed `genesisHash` parameter (was using `head.hash` instead of actual chain genesis)

**Current Implementation:**

```typescript
// In simulateSequentialTransactionsInternal():
for (let i = 0; i < request.items.length; i++) {
  const currentHead = await chain.head;
  
  // 1) Dry-run to get the outcome
  const dryRun = await chain.dryRunExtrinsic(
    { call: callHex, address: item.senderAddress },
    currentHead.hash
  );
  
  const { succeeded, failureReason } = parseOutcome(api, dryRun.outcome, chainName);
  if (!succeeded) {
    // Return failure immediately
    return { success: false, error: failureReason, ... };
  }
  
  // 2) Build mock-signed extrinsic and apply to fork
  const mockSignedHex = await buildMockSignedExtrinsicHex(
    callHex, 
    item.senderAddress, 
    currentHead,
    api.genesisHash.toHex() // Fixed: was head.hash before
  );
  
  await chain.newBlock({ extrinsics: [mockSignedHex] });
  
  // 3) Calculate fees and continue
  // ...
}
```

**Mock Signature Helper:**

```typescript
async function buildMockSignedExtrinsicHex(
  callHex: string,
  senderAddress: string,
  head: ChopsticksHead,
  genesisHash: string
): Promise<string> {
  const registry = await head.registry;
  const meta = await head.meta;
  const account = await head.read('AccountInfo', meta.query.system.account, senderAddress);
  
  const call = registry.createType('Call', hexToU8a(callHex));
  const generic = registry.createType('GenericExtrinsic', call);
  
  generic.signFake(senderAddress, {
    blockHash: head.hash,
    genesisHash, // Critical: must be actual chain genesis, not head.hash
    runtimeVersion: await head.runtimeVersion,
    nonce: account.nonce,
  });
  
  const mockSig = new Uint8Array(64);
  mockSig.fill(0xcd);
  mockSig.set([0xde, 0xad, 0xbe, 0xef]); // 0xdeadbeef prefix
  generic.signature.set(mockSig);
  
  return generic.toHex();
}
```

**Verification Needed:**
- Check backend logs for `includedExtrinsicsCount` after `newBlock` calls
- If still `0`, then Chopsticks is still rejecting the mock-signed extrinsics
- If `>0`, then extrinsics are being included but validation logic has a different issue

**Backend must be restarted** for the `genesisHash` fix to take effect.

---

### Issue 2: Fee Calculation Is Wrong

**Status:** 🔴 CRITICAL - NOT FIXED

**Description:**
The estimated fee for a 2-step transaction sequence is reported as `0.179419 DOT`, which is:
1. **~100x higher than expected** (should be ~0.001-0.002 DOT per transfer)
2. **Same as a single transaction** (should be approximately the sum of both individual fees)

**Expected Behavior:**
- Each `assets.transfer` on Asset Hub costs ~0.0013-0.0016 WND
- Two transfers should cost ~0.0026-0.0032 WND total
- Fee should increase with each step: `totalFee = fee1 + fee2`

**Actual Behavior:**
- Reported fee: `0.179419 DOT` (17,941,900,000 planck)
- This is ~138x a typical transfer fee (~130,000,000 planck)

**Possible Causes:**

1. **Wrong Chain Metadata:** Fee calculation is using DOT decimals (10) instead of WND decimals (12)?
2. **Fee Reuse:** The same fee object is being reused/cached across steps
3. **Wrong Call Data:** `extrinsicForFee` might be reconstructed incorrectly, leading to bloated encoded length
4. **Wrong Block Context:** Fee estimation might be running against wrong block/state

**Current Fee Calculation:**

```typescript
// For each step:
if (extrinsicForFee) {
  const { encodeAddress, decodeAddress } = await import('@polkadot/util-crypto');
  const publicKey = decodeAddress(item.senderAddress);
  const ss58Format = api.registry.chainSS58 || 0;
  const encodedSender = encodeAddress(publicKey, ss58Format);
  const feeInfo = await extrinsicForFee.paymentInfo(encodedSender);
  fee = feeInfo.partialFee.toString();
}
totalFee = totalFee.add(new BN(fee));
```

**Debugging Steps:**

1. Add logging for each step's individual fee
2. Check if `extrinsicForFee` is being reconstructed correctly from `item.extrinsicHex`
3. Verify `api.registry.chainSS58` matches the expected chain (42 for Westend, not 0)
4. Check if `encodedLength` impacts fee calculation (though not passed to `paymentInfo`)
5. Compare with single-transaction simulation for the same call

---

### Issue 3: Empty Blocks Despite Mock-Signed Extrinsics

**Status:** 🟡 POTENTIALLY FIXED (needs verification)

**Description:**
Chopsticks `newBlock({ extrinsics: [mockSignedHex] })` was building blocks with `extrinsics: []`, even though we passed a full mock-signed extrinsic.

**Backend Logs (Before Fix):**
```
[09:00:48.777] DEBUG: dryRunExtrinsic completed
    outcome: { "ok": { "ok": [] } }
[10:00:48.841] INFO (block-builder): Westend Asset Hub building #13,500,911
    extrinsics: []     <-- EMPTY!
    umpCount: 0
[10:00:56.944] INFO (block-builder): Westend Asset Hub new head #13,500,911
    extrinsics: []     <-- EMPTY!
```

**Root Cause:**
The `genesisHash` parameter in `signFake()` was set to `head.hash` (current block hash) instead of the actual chain genesis hash. This caused signature validation to fail, and Chopsticks silently rejected the extrinsic.

**Fix Applied:**
```typescript
// Before:
generic.signFake(senderAddress, {
  blockHash: head.hash,
  genesisHash: head.hash, // WRONG!
  runtimeVersion: await head.runtimeVersion,
  nonce: account.nonce,
});

// After:
generic.signFake(senderAddress, {
  blockHash: head.hash,
  genesisHash, // Passed from caller: api.genesisHash.toHex()
  runtimeVersion: await head.runtimeVersion,
  nonce: account.nonce,
});
```

**Verification:** ✅ FIXED (see below).

---

### Issue 3b: Wrong Parameter Name — We Passed `extrinsics` Instead of `transactions`

**Status:** ✅ FIXED (2026-02-07)

**Description:**
We were calling `chain.newBlock({ extrinsics: [mockSignedHex] })`. Chopsticks' `BuildBlockParams` uses **`transactions`**, not `extrinsics`. The txpool does:

```javascript
const transactions = params?.transactions || this.#pool.splice(0).map(({ extrinsic }) => extrinsic);
```

So `params.extrinsics` was ignored, and with no submitted extrinsics in the pool, `transactions` was always `[]`. Blocks were built with zero user transactions (only inherents), so state never updated.

**Fix:**
```typescript
// Before (wrong):
await chain.newBlock({ extrinsics: [extrinsicToApply] });

// After (correct):
await chain.newBlock({ transactions: [extrinsicToApply] });
```

**Evidence from user logs:**
- Chopsticks log: `extrinsics: []` (empty)
- Our log: `includedExtrinsicsCount: 2` (those 2 are inherents, not our tx)
- Balance before/after identical: `70821707621624` → no state change

After this fix, blocks should include our extrinsic and balances should update between steps.

---

## Background: Why This Is Complex

### Chopsticks `newBlock()` Behavior

Chopsticks' `newBlock()` does NOT return `ApplyExtrinsicResult` directly. It returns a `Block` object:

```typescript
interface Block {
  hash: string;
  number: number;
  extrinsics: string[]; // Just hex strings, no results
  // ... other fields
}
```

To get the actual outcome (success/error), we must:
1. Call `dryRunExtrinsic({ call, address }, blockHash)` FIRST
2. Check its `outcome: ApplyExtrinsicResult`
3. If succeeded, apply to fork with `newBlock()`

### Extrinsic Format Requirements

Chopsticks with `mockSignatureHost: true` still requires properly formatted signed extrinsics for `newBlock()`:

- **Unsigned hex (from `txMethod(...).toHex()`):** ❌ Rejected silently
- **Signed with real key:** ❌ Too complex, requires actual account signing
- **Mock-signed with `signFake()` + `0xdeadbeef`:** ✅ Should work (if `genesisHash` is correct)

The `mockSignatureHost` option tells Chopsticks to accept mock signatures, but the extrinsic structure must still be valid.

### Metadata Matching

The `ApiPromise` created for the backend simulation MUST use the correct chain's RPC endpoint to get the correct metadata. We fixed this in `system.ts` by comparing `apiForExtrinsics === assetHubApi` instead of checking `chainSS58 === 0`.

---

## Quick Debugging Guide

### Read the Backend Logs

All critical information is logged. Check for:

1. **Balance updates between steps:**
   ```
   [DEBUG] Account balance before step (itemIndex: 0, balanceInTokens: "70.821707")
   [DEBUG] Account balance after step (itemIndex: 0, balanceInTokens: "70.321...")
   ```
   If balance doesn't change, extrinsics aren't being applied.

2. **Extrinsic inclusion:**
   ```
   [DEBUG] newBlock completed (itemIndex: 0, includedExtrinsicsCount: 1)
   ```
   If `includedExtrinsicsCount: 0`, Chopsticks is rejecting the mock-signed extrinsic.

3. **Dry-run outcomes:**
   ```
   [DEBUG] dryRunExtrinsic completed (itemIndex: 1, outcome: { err: { Module: { index: 52, error: "0x02000000" } } })
   ```
   This shows the actual chain error (e.g., `InsufficientBalance`).

4. **Fee calculations:**
   ```
   [DEBUG] Fee calculated for step (itemIndex: 0, fee: "130000000000", feeInWND_12decimals: "0.000130")
   ```
   Check both the raw planck value and the converted decimal values.

5. **Final summary:**
   ```
   [INFO] Sequential simulation completed successfully (totalFeeInWND_12decimals: "0.000260", individualFees: [...])
   ```

### Common Issues and What to Look For

| Symptom | Log Evidence | Likely Cause |
|---------|--------------|--------------|
| Simulation succeeds when it should fail | Balance doesn't change between steps | Extrinsics not being applied to fork |
| Empty blocks | `includedExtrinsicsCount: 0` | Mock signature format rejected by Chopsticks |
| Fee is 100x too high | `feeInWND_12decimals` looks wrong | Wrong chain metadata or API connection |
| Fee is same for both steps | Both steps show identical `fee` values | Fee reuse bug or API state not updating |
| Generic error | No `dryRunExtrinsic completed` log | Chopsticks crash or connectivity issue |

---

## Testing Checklist

To verify the fixes:

### 1. Restart Backend
```bash
# In terminal where backend is running
# Kill and restart the backend server
```

### 2. Test Insufficient Balance Scenario
- Run: "Send 0.5 WND to [address], then send 70.51 WND to [address]"
- Expected balance: ~70.82 WND
- Expected outcome: **FAIL** on second transfer with `InsufficientBalance`

### 3. Check Backend Logs
Look for:
```
[DEBUG] Running dryRunExtrinsic (itemIndex: 0)
[DEBUG] dryRunExtrinsic completed (itemIndex: 0, outcome: { ok: { ok: [] } })
[DEBUG] Built mock-signed extrinsic (itemIndex: 0, hexLength: ~400)
[INFO] (block-builder): building #N
    extrinsics: ["0x..."]  <-- Should have 1 extrinsic!
[INFO] (block-builder): new head #N
    extrinsics: ["0x..."]  <-- Should have 1 extrinsic!
[DEBUG] newBlock completed (itemIndex: 0, includedExtrinsicsCount: 1)  <-- Should be 1!

[DEBUG] Running dryRunExtrinsic (itemIndex: 1)
[DEBUG] dryRunExtrinsic completed (itemIndex: 1, outcome: { err: ... })  <-- Should FAIL!
```

### 4. Verify Fee Calculation
- Check individual step fees in logs
- Compare with single-transaction simulation
- Verify total fee = sum of individual fees

---

## Alternative Approaches (If Current Fix Doesn't Work)

### Option 1: Use `submitExtrinsic()` + `newBlock()`

Instead of passing extrinsics to `newBlock()`, submit to txpool:

```typescript
const mockSignedHex = await buildMockSignedExtrinsicHex(...);
await chain.submitExtrinsic(mockSignedHex);
await chain.newBlock(); // Build from txpool
```

Pros: Chopsticks handles validation internally
Cons: Might have same signature issues

### Option 2: Use Chopsticks' Internal Signing

Chopsticks might have an internal method to build signed extrinsics. Check:
- `@acala-network/chopsticks-core` source code
- Example test files in Chopsticks repo
- Internal `signExtrinsic()` or similar helpers

### Option 3: Manually Construct Signed Extrinsic

Follow Substrate's exact signed extrinsic format:
```
[address][signature][era][nonce][tip][call]
```

But this is very complex and error-prone.

---

## Related Files

- `/home/user/projects/DotBot/lib/dotbot-express/src/routes/simulationRoutes.ts` - Backend simulation logic
- `/home/user/projects/DotBot/lib/dotbot-core/executionEngine/system.ts` - Frontend orchestration
- `/home/user/projects/DotBot/lib/dotbot-core/scenarioEngine/scenarios/testPrompts.ts` - Test scenario definitions
- `/home/user/projects/DotBot/xx_scenario_engine/maind.md` - ScenarioEngine documentation

---

## Next Steps

1. **IMMEDIATE:** Restart backend server to deploy the `genesisHash` fix
2. **TEST:** Run insufficient balance scenario and capture full backend logs
3. **ANALYZE:** Check if `includedExtrinsicsCount` > 0 now
4. **DEBUG FEE:** Add more logging to understand why fee is 100x too high
5. **ITERATE:** If blocks still empty, try alternative approaches above

---

## References

- [Chopsticks GitHub](https://github.com/AcalaNetwork/chopsticks)
- [Polkadot.js Extrinsic Format](https://polkadot.js.org/docs/api/cookbook/tx)
- [Substrate Signed Extensions](https://docs.substrate.io/reference/transaction-format/)
