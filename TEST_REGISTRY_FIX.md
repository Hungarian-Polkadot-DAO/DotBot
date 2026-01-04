# Test Plan: Registry Match Fix

## What Was Fixed

Fixed `InvalidTransaction: Invalid` error caused by registry mismatch between the extrinsic's API and the executioner's API.

## Changes Made

**File: `frontend/src/lib/executionEngine/executioner.ts`**

1. Added registry matching logic that:
   - Checks if `this.api.registry === extrinsic.registry` → uses Relay Chain API
   - Checks if `this.assetHubApi.registry === extrinsic.registry` → uses Asset Hub API
   - Falls back to Relay Chain API with warning if no match

2. Uses the matched API for:
   - Address encoding (line 427)
   - Simulation (line 432)
   - Signing
   - Broadcasting

## Test Cases

### Test 1: Single DOT Transfer (Asset Hub)

**Expected behavior:**
- ✅ Agent creates extrinsic with Asset Hub API
- ✅ Executioner detects Asset Hub registry
- ✅ Logs: `[Executioner] Using Asset Hub API (registry match)`
- ✅ Logs: `[Executioner] Registry validation: { registryMatch: true }`
- ✅ Chopsticks simulation passes
- ✅ Transaction executes successfully

**Command:**
```
Send 0.01 DOT to Alice
```

**What to check:**
1. No `InvalidTransaction: Invalid` errors
2. Registry match logs show `true`
3. Simulation uses Asset Hub API
4. Transaction succeeds

### Test 2: Batch Transfer (Asset Hub)

**Expected behavior:**
- ✅ Agent creates batch extrinsic with Asset Hub API
- ✅ Executioner detects Asset Hub registry
- ✅ Logs: `[Executioner] Using Asset Hub API (registry match)`
- ✅ Batch simulation passes
- ✅ Batch executes successfully

**Command:**
```
Send 0.01 DOT to Alice and 0.02 DOT to Bob
```

**What to check:**
1. Batch extrinsic has correct registry
2. All transfers in batch succeed
3. No registry mismatch warnings

### Test 3: Balance Check (Relay or Asset Hub)

**Expected behavior:**
- ✅ Agent uses correct API for balance query
- ✅ Balance shown from correct chain

**Command:**
```
What is my DOT balance?
```

**What to check:**
1. Balance query uses appropriate chain
2. Balance is accurate

## Expected Log Output

### Successful Transfer

```
[AssetTransferAgent] Preparing transfer on Asset Hub
[AssetTransferAgent] Detected chain capabilities: { ... }
[AssetTransferAgent] ✓ Transfer extrinsic created: { method: 'transferAllowDeath', ... }

[Executioner] Using extrinsic from agent: { method: 'balances.transferAllowDeath' }
[Executioner] Using Asset Hub API (registry match)
[Executioner] Registry validation: { registryMatch: true }

[Executioner] Simulating extrinsic...
[Chopsticks] ✓ Simulation successful!

[Executioner] Signing transaction...
[Executioner] Broadcasting transaction...
[Executioner] ✓ Transaction finalized: { ... }
```

### If Registry Mismatch Occurs (Should NOT happen)

```
[Executioner] No exact registry match found, using relay chain API as fallback
[Executioner] This may cause issues! Agent should use executioner APIs.
[Executioner] Registry validation: { registryMatch: false }
```

**Action:** If you see this, the agent is not using the orchestrator's API instances.

## Debugging

If the fix doesn't work:

1. **Check agent initialization:**
   - Verify `orchestrator.ts` passes both APIs to agent
   - Check `agent.initialize(this.api!, this.assetHubApi, ...)`

2. **Check API instances:**
   - Verify agent's `this.assetHubApi` is same object as executioner's `this.assetHubApi`
   - Use `===` comparison or log object IDs

3. **Check registry comparison:**
   - Log `extrinsic.registry`
   - Log `this.api.registry`
   - Log `this.assetHubApi.registry`
   - Verify one matches the extrinsic

4. **Check simulation API:**
   - Verify `simulateTransaction()` receives `apiForExtrinsic`, not `this.api`

## Success Criteria

✅ All transfer types work without `InvalidTransaction: Invalid` error
✅ Registry match logs always show `true`
✅ No registry mismatch warnings appear
✅ Chopsticks simulation passes consistently
✅ Real transactions execute successfully

## Rollback

If this fix causes issues, the previous version had:
```typescript
const apiForExtrinsic = extrinsic.registry.metadata ? this.api : this.api;
```

But this was incorrect and should not be reverted.


