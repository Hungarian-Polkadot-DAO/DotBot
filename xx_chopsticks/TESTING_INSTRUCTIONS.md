# Testing Instructions for Sequential Simulation Fixes

## CRITICAL: You Must Restart the Backend Server

The fixes to the sequential simulation logic require restarting the backend to take effect.

### 1. Stop the current backend process

Find and kill the running `@dotbot/express` server process.

### 2. Restart the backend

```bash
cd /home/user/projects/DotBot
npm run backend:dev
# or however you normally start the backend
```

Wait for the server to start and listen on its port (usually 3001).

---

## Test Scenario: Insufficient Balance (Must Fail)

### Setup

1. Make sure your test account has ~70.82 WND on Westend Asset Hub
2. Use the ScenarioEngine test: "Multi-Transaction: Second Transfer Insufficient Balance (Dynamic)"

### Expected Input (from expressionCalculations.ts)

Given balance of 70.82 WND:
- **First transfer:** 0.5 WND (should succeed)
- **Second transfer:** 70.51 WND (= remaining 70.32 + 0.2, should FAIL)

### Expected Results

#### Frontend Display

```
❌ Simulation failed
Validation Method: 🌿 Chopsticks (Runtime Simulation)
Error: Transaction 2 (Second transfer) failed: InsufficientBalance
Estimated Fee: ~0.0026 WND (for the successful first step)
Would Succeed: ✗ No
```

**NOT** this:
```
✅ Simulation completed successfully
Validation Method: 🌿 Chopsticks (Runtime Simulation)
Estimated Fee: 0.179419 DOT  ❌ WRONG
Would Succeed: ✓ Yes  ❌ WRONG
```

#### Backend Logs (Key Sections)

Look for these patterns in the logs:

**Step 0 (0.5 WND) - Should Succeed:**
```
[DEBUG] Account balance before step
    itemIndex: 0
    balanceInTokens: "70.821707"

[DEBUG] dryRunExtrinsic completed
    itemIndex: 0
    outcome: { "ok": { "ok": [] } }

[DEBUG] Built mock-signed extrinsic
    itemIndex: 0
    hexLength: ~400

[INFO] (block-builder): Westend Asset Hub building #N
    extrinsics: ["0x..."]  ✓ Should have 1 extrinsic

[DEBUG] Account balance after step
    itemIndex: 0
    balanceInTokens: "70.320..."  ✓ Should be reduced

[DEBUG] Fee calculated for step
    itemIndex: 0
    fee: "130000000000"  (example)
    feeInWND_12decimals: "0.000130"  ✓ Should be ~0.0013 WND
```

**Step 1 (70.51 WND) - Should Fail:**
```
[DEBUG] Account balance before step
    itemIndex: 1
    balanceInTokens: "70.320..."  ✓ Should be reduced from step 0

[DEBUG] dryRunExtrinsic completed
    itemIndex: 1
    outcome: { "err": { "Module": { "index": 52, "error": "0x02000000" } } }
    ✓ Should show an error!

[INFO] Request completed
    status: 200
    duration: "...ms"
```

**Key Success Indicators:**

1. ✅ Balance decreases after step 0 (from ~70.82 to ~70.32)
2. ✅ `includedExtrinsicsCount: 1` (not 0)
3. ✅ Step 1 dry-run outcome shows `{ err: ... }`
4. ✅ Response has `success: false` with error message
5. ✅ Fee for step 0 is ~0.0013 WND (130,000,000,000 planck)

**Key Failure Indicators (What We Had Before):**

1. ❌ Balance stays the same (70.82) after step 0
2. ❌ `includedExtrinsicsCount: 0` or `extrinsics: []`
3. ❌ Both steps show `outcome: { ok: ... }`
4. ❌ Response has `success: true`
5. ❌ Fee is 0.179419 or some other absurdly high value

---

## Test Scenario: Two Small Transfers (Must Succeed)

### Setup

Use a scenario with two small transfers that should both succeed:
- **First transfer:** 0.1 WND
- **Second transfer:** 0.1 WND
- Balance requirement: > 0.21 WND (accounting for fees)

### Expected Results

#### Frontend Display

```
✅ Simulation completed successfully
Validation Method: 🌿 Chopsticks (Runtime Simulation)
Estimated Fee: ~0.0026 WND (sum of both steps)
Would Succeed: ✓ Yes
```

#### Backend Logs

Both steps should succeed:
```
[DEBUG] dryRunExtrinsic completed (itemIndex: 0, outcome: { ok: ... })
[DEBUG] dryRunExtrinsic completed (itemIndex: 1, outcome: { ok: ... })
[INFO] Sequential simulation completed successfully
    totalFeeInWND_12decimals: "0.000260"  (approximately, 2x single transfer)
    individualFees: ["130000000000", "130000000000"]  (approximate)
```

Balance should decrease after each step.

---

## Debugging: If Tests Still Fail

### Issue: Blocks Still Empty (`extrinsics: []`)

**Check:**
1. Is backend actually restarted with new code?
2. Are logs showing `Built mock-signed extrinsic` with reasonable `hexLength`?
3. Any errors in `buildMockSignedExtrinsicHex`?

**Try Alternative:**
- Modify `simulationRoutes.ts` to use `submitExtrinsic()` instead:
  ```typescript
  await chain.submitExtrinsic(mockSignedHex);
  await chain.newBlock(); // Build from txpool
  ```

### Issue: Fee Still Wrong

**Check:**
1. What does `apiChain` show in fee calculation logs? Should be "Westend Asset Hub"
2. What is `apiSS58`? Should be 42 for Westend Asset Hub
3. What is the raw `fee` planck value? Should be ~130,000,000,000
4. Are both `feeInDOT_10decimals` and `feeInWND_12decimals` logged?

**Potential Causes:**
- API connected to wrong chain (Relay instead of Asset Hub)
- Metadata mismatch (Asset Hub call decoded with Relay metadata)
- `paymentInfo` called on wrong API instance

### Issue: Simulation Still Succeeds When It Should Fail

**Check:**
1. Is `balanceAfter` different from `balanceBefore`? If yes, fork is updating correctly
2. If balance IS updating but step 1 still succeeds, check the amounts:
   - Is second amount actually > remaining balance?
   - Check `calculateInsufficientBalance` in `expressionCalculations.ts`

**Verify Calculation:**
```typescript
// In expressionCalculations.ts
export function calculateInsufficientBalance(balance: string, firstAmount: string): string {
  const remainingAfterFirst = parseFloat(balance) - parseFloat(firstAmount);
  return remainingAfterFirst > 0 
    ? (remainingAfterFirst + 0.2).toFixed(2)
    : '0.2';
}
```

For balance 70.82, first 0.5: should return 70.52 (70.32 + 0.2).

---

## Success Criteria

### Must Pass BOTH:

1. **Insufficient Balance Test:** Simulation FAILS on second step with clear error
2. **Small Transfers Test:** Simulation SUCCEEDS for both steps

### Must Fix BOTH:

1. **Empty Blocks:** All built blocks must include the extrinsic (`extrinsics: ["0x..."]`)
2. **Wrong Fees:** Total fee must be ~0.0026 WND, not 0.179 or other absurd value

---

## After Testing

Report back with:
1. Screenshot or copy/paste of frontend simulation result
2. Full backend logs for the sequential simulation request
3. Whether each test passed or failed

If any test fails, include the specific error messages and log excerpts.
