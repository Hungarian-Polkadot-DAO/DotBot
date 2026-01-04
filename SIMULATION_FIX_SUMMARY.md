# Simulation & Transaction Flow Fixes

## Problem Statement

The simulation system was not properly catching transaction failures, and transactions themselves were failing. The main issues were:

1. **Silent Chopsticks failures**: When Chopsticks simulation failed, the system silently fell back to `paymentInfo` without logging the error
2. **paymentInfo limitations**: `paymentInfo` only validates transaction structure, NOT runtime execution, leading to false positives
3. **Insufficient error detection**: Some error patterns weren't being caught by the retry logic
4. **Lack of visibility**: No logging made debugging difficult

## Solutions Implemented

### 1. Enhanced Chopsticks Error Handling

**File**: `frontend/src/services/simulation/chopsticks.ts`

**Changes**:
- Added comprehensive console logging throughout the simulation process
- Better error messages that include context about what failed
- Improved cleanup handling even when errors occur
- More detailed outcome parsing

**Impact**: Developers can now see exactly what's happening during simulation, making debugging much easier.

### 2. Improved Dry-Run Validation

**File**: `frontend/src/lib/agents/baseAgent.ts`

**Changes**:
- No longer silently falls back to `paymentInfo`
- Logs when Chopsticks fails and why
- Adds warnings to results when `paymentInfo` is used
- Includes Chopsticks error in metadata when fallback occurs

**Key Addition**:
```typescript
runtimeInfo: {
  // ...
  warning: 'Runtime execution not validated - paymentInfo only checks structure',
  chopsticksError: chopsticksError ? errorMessage : undefined,
}
```

**Impact**: Users and developers are explicitly warned when full validation isn't available.

### 3. Enhanced Error Detection

**File**: `frontend/src/lib/agents/errorAnalyzer.ts`

**New Error Categories Added**:
- **Module errors**: `ModuleError`, `DispatchError` (pallet-level errors)
- **Token errors**: `TokenError`, balance-related issues that might be chain-specific
- Better detection of configuration vs user errors

**Impact**: Retry logic can now handle more error scenarios intelligently.

### 4. Improved Transaction Execution Logging

**File**: `frontend/src/lib/executionEngine/executioner.ts`

**Changes**:
- Comprehensive console logging at every step:
  - Request approval
  - Signing
  - Broadcasting
  - Result handling
- Better error extraction from dispatch errors
- Handles invalid/dropped/usurped transactions explicitly

**Key Features**:
```typescript
// Extracts human-readable error from module errors
if (dispatchError.isModule) {
  const decoded = api.registry.findMetaError(dispatchError.asModule);
  errorDetails = `${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`;
}
```

**Impact**: Complete visibility into what's happening during transaction execution.

### 5. User-Facing Warnings

**File**: `frontend/src/lib/agents/asset-transfer/agent.ts`

**Changes**:
- Adds warning to AgentResult when `paymentInfo` is used
- Logs validation method in attempt log
- Distinguishes between Chopsticks validation and basic validation

**User-Visible Warning**:
```
⚠️ Transaction validated using basic check only (Chopsticks unavailable). 
Runtime execution not fully validated.
```

**Impact**: Users are informed when validation is incomplete, setting proper expectations.

## How to Debug Issues

### Console Logs to Monitor

1. **Simulation Phase**:
   ```
   [Chopsticks] Starting transaction simulation...
   [Chopsticks] Forking chain at block: 0x1234...
   [Chopsticks] Using RPC endpoints: [...]
   [Chopsticks] Fork created, running dry-run...
   [Chopsticks] Dry-run complete, analyzing outcome...
   [Chopsticks] Outcome: SUCCESS/FAILURE
   [Chopsticks] Simulation completed in XXXms
   ```

2. **Validation Phase**:
   ```
   [Simulation] Using Chopsticks for runtime validation
   [Simulation] ✓ Chopsticks validation passed
   ```
   OR
   ```
   [Simulation] Chopsticks not available, falling back to paymentInfo
   [Simulation] ⚠ Using paymentInfo only - runtime execution NOT validated!
   ```

3. **Execution Phase**:
   ```
   [Executioner] Executing extrinsic: {...}
   [Executioner] Requesting user approval...
   [Executioner] User approved transaction
   [Executioner] Signing transaction...
   [Executioner] Transaction signed successfully
   [Executioner] Broadcasting transaction...
   [Executioner] Transaction included in block: 0x5678...
   [Executioner] Transaction finalized in block: 0x5678...
   [Executioner] ✓ Transaction succeeded
   ```

### Common Error Scenarios

#### Scenario 1: Chopsticks Import Fails
**Log**: `[Simulation] Chopsticks not available, falling back to paymentInfo`

**Cause**: Chopsticks package not installed or import failed

**Fix**: 
```bash
npm install @acala-network/chopsticks-core
```

#### Scenario 2: Simulation Fails but Transaction Proceeds
**Log**: 
```
[Simulation] ⚠ Using paymentInfo only - runtime execution NOT validated!
```

**Cause**: Chopsticks failed to simulate (could be RPC issue, chain fork issue, etc.)

**Risk**: Transaction might fail at runtime even though paymentInfo passed

**Fix**: Check browser console for Chopsticks error details, investigate RPC connectivity

#### Scenario 3: Transaction Fails After Successful Simulation
**Log**:
```
[Executioner] ✗ Extrinsic failed: balances.InsufficientBalance: Balance too low...
```

**Cause**: State changed between simulation and execution (e.g., fees changed, balance changed)

**Fix**: This is expected in some cases - simulation is a best-effort prediction

#### Scenario 4: Wrong Chain Error
**Log**:
```
[Chopsticks] Outcome: FAILURE InvalidTransaction: ...
```

**Cause**: Transaction created for wrong chain (e.g., trying Asset Hub transaction on Relay Chain)

**Fix**: Retry logic should automatically try alternate chain

## Testing Recommendations

### 1. Test Chopsticks Availability
```typescript
import { isChopsticksAvailable } from './services/simulation';

const available = await isChopsticksAvailable();
console.log('Chopsticks available:', available);
```

### 2. Test Simulation with Known Transaction
```typescript
// Create a simple transfer
const extrinsic = api.tx.balances.transferKeepAlive(recipient, amount);

// Run simulation
const result = await simulateTransaction(api, rpcEndpoint, extrinsic, senderAddress);

console.log('Simulation result:', {
  success: result.success,
  error: result.error,
  fee: result.estimatedFee,
});
```

### 3. Monitor Validation Method
Check the AgentResult metadata:
```typescript
if (agentResult.metadata?.validationMethod === 'paymentInfo') {
  console.warn('Transaction validated with paymentInfo only!');
}
```

## Architecture Improvements

### Before
```
dryRunExtrinsic()
  ├─> Try Chopsticks
  │   └─> if error: silently fall back
  └─> Use paymentInfo (no warning)
```

### After
```
dryRunExtrinsic()
  ├─> Try Chopsticks
  │   ├─> Success: return with 'chopsticks' flag
  │   └─> Error: log error + save to metadata
  └─> Fallback: paymentInfo
      ├─> Add warning to result
      └─> Include Chopsticks error in metadata
```

## Retry Logic Improvements

The retry logic now handles:
1. **Module errors**: May indicate wrong chain or invalid parameters
2. **Token errors**: May need different chain
3. **Configuration errors**: Automatically tries alternate chain
4. **User errors**: Fails fast without retry

Example flow:
```
Attempt 1: Asset Hub → WASM unreachable
  ↓ (Error analyzer detects: CONFIGURATION_ERROR)
  ↓ (Retry strategy: try alternate chain)
Attempt 2: Relay Chain → Success
```

## Monitoring Best Practices

### In Development
- Keep browser console open
- Look for `[Simulation]` and `[Executioner]` prefixes
- Check for ⚠️ and ✗ symbols indicating warnings/errors

### In Production
- Consider adding error reporting service
- Log validation method statistics
- Monitor Chopsticks availability rate
- Track transaction failure reasons

## Future Improvements

### Potential Enhancements
1. **Retry Chopsticks with different RPC**: If first RPC fails, try others
2. **Cache chain metadata**: Speed up Chopsticks fork creation
3. **Parallel validation**: Try both chains simultaneously
4. **Pre-execution validation**: Re-validate just before signing
5. **Better error categorization**: More specific error types for better retry logic

### Known Limitations
1. **paymentInfo doesn't catch runtime errors**: By design - it only validates structure
2. **State can change between simulation and execution**: Inherent limitation of pre-validation
3. **Chopsticks may be slow on first run**: Chain state download takes time
4. **RPC rate limits**: Multiple simulations might hit rate limits

## Summary

These improvements provide:
- ✅ **Full visibility** into simulation and execution process
- ✅ **Proper warnings** when validation is incomplete
- ✅ **Better error detection** and retry logic
- ✅ **Debugging capabilities** through comprehensive logging
- ✅ **No silent failures** - all errors are logged and reported

The system now properly distinguishes between validated (Chopsticks) and unvalidated (paymentInfo) transactions, and users are informed when runtime validation is not available.



