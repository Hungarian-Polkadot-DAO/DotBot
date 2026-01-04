# SIMULATION ARCHITECTURE FIX: Simulate What You Execute

## Critical Issue Identified

**Problem**: Chopsticks simulation passed, but actual transaction execution failed with runtime panic.

**Root Cause**: We were simulating a DIFFERENT extrinsic than what we were executing.

### The Broken Flow

```
1. Agent creates extrinsic (with agent's API)
2. Agent simulates with Chopsticks → ✅ PASSES
3. Agent returns extrinsic in ExecutionArray
4. Executioner rebuilds NEW extrinsic (from metadata, with session API)
5. Executioner executes rebuilt extrinsic → ❌ FAILS
```

**Why it failed**: Steps 2 and 5 used DIFFERENT extrinsics!
- Step 2: Simulated original extrinsic (created with agent's API)
- Step 5: Executed rebuilt extrinsic (created with session's API)

## The Fix: Simulate After Rebuild

### New Correct Flow

```
1. Agent validates parameters and creates metadata
2. Agent returns AgentResult with metadata (no extrinsic)
3. Orchestrator creates ExecutionArray
4. Executioner creates execution session (locks API)
5. Executioner rebuilds extrinsic from metadata (using session API)
6. Executioner simulates rebuilt extrinsic with Chopsticks → Test exact extrinsic
7. If simulation passes:
   - Request user approval
   - Sign extrinsic
   - Broadcast to network
8. If simulation fails:
   - Fail early (before user approval)
   - Show clear error
```

**Key principle**: **Simulate what you execute!**

## Implementation Details

### Before (Broken)

```typescript
// In Agent
const extrinsic = this.api.tx.balances.transferKeepAlive(recipient, amount);
const dryRun = await this.dryRunExtrinsic(api, extrinsic, address);  // ← Simulates here
return this.createResult(description, extrinsic, { ... });

// In Executioner
const rebuiltExtrinsic = session.api.tx.balances.transferKeepAlive(recipient, amount);  // ← Different!
await paymentInfo(rebuiltExtrinsic);  // ← Only basic check
await execute(rebuiltExtrinsic);  // ← Executes different extrinsic
```

### After (Fixed)

```typescript
// In Agent
// Just validate and return metadata (no extrinsic in result)
return this.createResult(description, undefined, {
  metadata: {
    recipient,
    amount: amount.toString(),
    keepAlive,
    chainType,
  }
});

// In Executioner
// Rebuild extrinsic from metadata
const amount = new BN(metadata.amount);
const extrinsic = session.api.tx.balances.transferKeepAlive(recipient, amount);

// Simulate the REBUILT extrinsic (same one that will execute!)
const simulation = await simulateTransaction(session.api, endpoints, extrinsic, address);
if (!simulation.success) {
  throw new Error('Simulation failed');
}

// User approval, sign, execute
await execute(extrinsic);  // ← Same extrinsic that was simulated!
```

## Why This Matters

### 1. API Instance Consistency

Each `ApiPromise` instance has its own:
- Runtime metadata
- Type registry  
- Pallet indices
- Type definitions

Using extrinsic from one API with another API = runtime panic!

### 2. Execution Session Guarantees

The execution session ensures:
- API instance is immutable during transaction
- No RPC failover mid-transaction
- Registry matches exactly

### 3. Accurate Simulation

Simulating the actual extrinsic that will be sent means:
- We catch ALL runtime errors before execution
- User only sees transactions that will work
- No wasted gas or failed transactions

## Files Modified

### `frontend/src/lib/executionEngine/executioner.ts`

**Changes**:
1. After rebuilding single extrinsic (line ~467):
   - Removed: Simple `paymentInfo()` check
   - Added: Full Chopsticks simulation of rebuilt extrinsic
   - Falls back to `paymentInfo` if Chopsticks unavailable (with warning)

2. After rebuilding batch extrinsic (line ~769):
   - Removed: Simple `paymentInfo()` check  
   - Added: Full Chopsticks simulation of rebuilt batch
   - Falls back to `paymentInfo` if Chopsticks unavailable (with warning)

**Key code**:
```typescript
// Try Chopsticks simulation first (real runtime validation)
const { simulateTransaction, isChopsticksAvailable } = await import('../../services/simulation');

if (await isChopsticksAvailable()) {
  console.log('[Executioner] Using Chopsticks for runtime simulation of rebuilt extrinsic...');
  
  const simulationResult = await simulateTransaction(
    apiForExtrinsic,    // ← Session API (matches extrinsic)
    rpcEndpoints,
    extrinsic,          // ← REBUILT extrinsic (what will actually execute)
    this.account.address
  );
  
  if (!simulationResult.success) {
    // Fail early - don't bother user with transaction that won't work
    throw new Error(`Simulation failed: ${simulationResult.error}`);
  }
}
```

### Future: Agent Simplification

**Current state**: Agents still create and simulate extrinsics (but results are ignored)

**Future improvement**: Remove simulation from agents entirely:
```typescript
// Agents just validate parameters and return metadata
async transfer(params: TransferParams): Promise<AgentResult> {
  // Validate addresses
  this.validateTransferAddresses(params.address, params.recipient);
  
  // Validate amount
  const amountBN = this.parseAndValidateAmount(params.amount);
  
  // Check balance
  const balance = await this.getBalance(params.address);
  if (balance.available < totalRequired) {
    throw new AgentError('Insufficient balance');
  }
  
  // Return metadata only (no extrinsic)
  return this.createResult(
    description,
    undefined,  // ← No extrinsic!
    {
      metadata: {
        recipient: params.recipient,
        amount: amountBN.toString(),
        keepAlive: params.keepAlive,
        chainType: 'assetHub',
      }
    }
  );
}
```

All simulation happens in executioner after rebuild.

## Benefits

### ✅ Correctness
- Simulate the exact extrinsic that will execute
- No more false positives (simulation passes but execution fails)
- No more false negatives (simulation fails but execution would work)

### ✅ User Experience
- Only show users transactions that will work
- Catch errors BEFORE requesting signature
- Clear error messages from actual simulation

### ✅ Architecture
- Clear separation: agents validate, executioner executes
- Execution session guarantees API consistency
- Simulation happens at the right time (after rebuild)

### ✅ Reliability
- No registry mismatches
- No API instance confusion
- Proper error classification

## Testing

### Test Case 1: Basic Transfer

```bash
# In app
"Send 0.01 DOT to Alice"

# Expected console logs:
[Executioner] Rebuilding transfer extrinsic: {...}
[Executioner] Using Chopsticks for runtime simulation of rebuilt extrinsic...
🌿 [Chopsticks] Creating chain fork at block #123...
⚡ [Chopsticks] Simulating transaction execution...
✅ [Chopsticks] ✓ Simulation successful!
[Executioner] ✓ Chopsticks simulation passed: {...}
[Executioner] Requesting user approval...
```

### Test Case 2: Invalid Transaction

```bash
# In app
"Send 1000000 DOT to Alice"  # (insufficient balance)

# Expected console logs:
[Executioner] Rebuilding transfer extrinsic: {...}
[Executioner] Using Chopsticks for runtime simulation of rebuilt extrinsic...
🌿 [Chopsticks] Creating chain fork at block #123...
⚡ [Chopsticks] Simulating transaction execution...
❌ [Chopsticks] ✗ Simulation failed: balances.InsufficientBalance
[Executioner] ✗ Chopsticks simulation failed: balances.InsufficientBalance
❌ Unable to prepare your transaction: Simulation failed: balances.InsufficientBalance
```

### Test Case 3: Chopsticks Unavailable

```bash
# Expected console logs:
[Executioner] Rebuilding transfer extrinsic: {...}
[Executioner] Chopsticks unavailable, using paymentInfo for basic validation...
[Executioner] ⚠️ Basic validation passed (runtime not fully tested): {...}
⚠️ Warning: Transaction validated using basic check only
[Executioner] Requesting user approval...
```

## Migration Notes

### Current State (Hybrid)

- Agents still do simulation (legacy)
- Executioner also does simulation (new)
- Agent simulation results are ignored
- Executioner simulation is what matters

### Future State (Clean)

- Agents only validate parameters
- Agents return metadata (no extrinsic)
- Executioner rebuilds extrinsic
- Executioner simulates rebuilt extrinsic
- Executioner executes same extrinsic

## Related Documentation

- `INFO_TWO.md` - Execution Session architecture
- `INFO_THREE.md` - Bug fixes for execution sessions
- `CRITICAL_BUG_FIX.md` - Amount type mismatch fix
- `FIXES_APPLIED.md` - Earlier simulation improvements

## Summary

**The Golden Rule**: **Simulate what you execute!**

By moving simulation to AFTER extrinsic rebuilding, we ensure that:
1. The simulated extrinsic is IDENTICAL to the executed extrinsic
2. API instance, registry, and metadata all match exactly
3. Chopsticks catches ALL runtime errors before execution
4. Users never see transactions that will fail

**Status**: ✅ FIXED  
**Priority**: 🔴 CRITICAL  
**Impact**: Ensures simulation accurately predicts execution outcome



