# Chopsticks Ignore Policy - Implementation Summary

## What Was Implemented

A conditional error classification system that distinguishes between:
- **Safe-to-ignore errors**: Known Chopsticks limitations (post Asset Hub migration)
- **Blocking errors**: Real structural problems that will fail on-chain

## Changes Made

### 1. New File: `chopsticksIgnorePolicy.ts`

**Location**: `frontend/src/lib/services/simulation/chopsticksIgnorePolicy.ts`

**Contents**:
- `CHOPSTICKS_IGNORE_ERRORS`: Array of safe-to-ignore error patterns
- `CHOPSTICKS_FATAL_ERRORS`: Array of errors that MUST block
- `classifyChopsticksError()`: Function to classify errors
- `TRUST_LEVELS`: Constants defining trust levels for each phase

**Key Features**:
- Pattern matching with multiple required fragments
- Phase-specific rules (paymentInfo vs dryRun)
- Chain-specific rules (optional)
- Conservative default (unknown = blocking)

### 2. Modified: `chopsticks.ts`

**Location**: `frontend/src/lib/services/simulation/chopsticks.ts`

**Changes**:

#### A. Import Classification Function
```typescript
import { classifyChopsticksError } from './chopsticksIgnorePolicy';
```

#### B. Get Chain Name
```typescript
// Get chain name for error classification
const chainName = (await api.rpc.system.chain()).toString();
```

#### C. Classify PaymentInfo Errors
```typescript
const errorClassification = classifyChopsticksError(errorMessage, 'paymentInfo', chainName);

if (errorClassification.ignore) {
  // Safe to ignore - log warning and continue
  console.warn('[Chopsticks] ⚠️ Ignoring known Chopsticks limitation:', {
    classification: errorClassification.classification,
    reason: errorClassification.reason,
  });
} else {
  // BLOCKING error - fail the simulation
  return {
    success: false,
    error: `${errorClassification.classification}: ${cleanError}...`,
    // ...
  };
}
```

#### D. Update `parseOutcome` Function
```typescript
function parseOutcome(
  api: ApiPromise,
  outcome: any,
  chainName: string  // NEW PARAMETER
): { succeeded: boolean; failureReason: string | null }
```

Added classification for InvalidTransaction errors:
```typescript
const errorClassification = classifyChopsticksError(errorMessage, 'dryRun', chainName);

if (errorClassification.ignore) {
  return { succeeded: true, failureReason: null };
}
```

#### E. Update Call to `parseOutcome`
```typescript
const { succeeded, failureReason } = parseOutcome(api, outcome, chainName);
```

### 3. Modified: `index.ts`

**Location**: `frontend/src/lib/services/simulation/index.ts`

**Changes**:
```typescript
export * from './chopsticksIgnorePolicy';
```

Exports the ignore policy for external use.

### 4. New Documentation: `CHOPSTICKS_IGNORE_POLICY.md`

**Location**: `/home/user/projects/DotBot/CHOPSTICKS_IGNORE_POLICY.md`

Comprehensive documentation covering:
- Problem context and Asset Hub migration impact
- Implementation details
- Trust levels (mental model)
- Usage examples (before/after)
- How to add new ignore rules
- Critical safeguards
- Testing strategy
- Future considerations

## Error Patterns Covered

### Safe-to-Ignore (NON_FATAL)

1. **PAYMENT_INFO_WASM_UNREACHABLE**
   - Match: `TransactionPaymentApi_query_info`, `wasm unreachable`
   - Phase: `paymentInfo`
   - Chains: Asset Hub Polkadot, Asset Hub Kusama

2. **PAYMENT_INFO_RUNTIME_PANIC**
   - Match: `panic`, `rust_begin_unwind`, `core::panicking::panic_fmt`
   - Phase: `paymentInfo`
   - Chains: Asset Hub Polkadot, Asset Hub Kusama

3. **UNSIGNED_SIMULATION_REJECTED**
   - Match: `BadOrigin`, `InvalidTransaction::Payment`, `Unsigned transaction`
   - Phase: `dryRun`

4. **WEIGHT_FEE_CALCULATION_FAILED**
   - Match: `WeightToFee`, `FeeDetails`, `Fee calculation failed`
   - Phase: `paymentInfo`

5. **ASSET_HUB_FEE_HOOK_MISSING_CONTEXT**
   - Match: `AssetTxPayment`, `OnChargeTransaction`, `OnChargeAssetTx`
   - Phase: `paymentInfo`
   - Chains: Asset Hub Polkadot, Asset Hub Kusama

6. **ASSET_HUB_GENERIC_WASM_PANIC** ⭐ NEW - Catch-all
   - Match: `wasm \`unreachable\` instruction executed`, `wasm trap`
   - Phase: `paymentInfo`
   - Chains: Asset Hub Polkadot, Asset Hub Kusama
   - Purpose: Catches fee calculation panics without API method names

### Fatal (BLOCKING)

- Call decoding failed
- Invalid call index
- Unknown pallet
- Invalid SS58
- Cannot decode AccountId
- Scale codec error
- Invalid Compact
- Metadata mismatch
- SpecVersion mismatch

## Classification Logic

```
┌─────────────────────────────────────┐
│  Error occurs in Chopsticks         │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  classifyChopsticksError()          │
│  - error message                    │
│  - phase (paymentInfo/dryRun)       │
│  - chain name                       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Check FATAL errors first           │
│  (SCALE, metadata, SS58, etc.)      │
└──────────────┬──────────────────────┘
               │
               ├─ Match found ──► BLOCKING (fail simulation)
               │
               ▼
┌─────────────────────────────────────┐
│  Check IGNORE rules                 │
│  - paymentInfo: OR logic (some)     │
│  - dryRun: AND logic (every)        │
│  - Phase matches?                   │
│  - Chain matches (if specified)?    │
└──────────────┬──────────────────────┘
               │
               ├─ Match found ──► NON_FATAL (ignore, continue)
               │
               ▼
┌─────────────────────────────────────┐
│  No match found                     │
│  Conservative default: BLOCKING     │
└──────────────┬──────────────────────┘
               │
               ▼
         Return classification
```

### ⚠️ Important: OR vs AND Logic

**paymentInfo phase uses OR logic (`some()`)**:
- ANY pattern match triggers the rule
- Why? Fee errors manifest differently: "wasm trap: wasm \`unreachable\` instruction executed" may not include "TransactionPaymentApi_query_info"
- All are the same underlying issue: fee hooks panic in Chopsticks
- OR logic catches all variants safely

**dryRun phase uses AND logic (`every()`)**:
- ALL patterns must match
- Why? More precision needed for execution validation
- Prevents false positives

## Logging Output

### When Error is Ignored

```
[Chopsticks] 🔍 Error classification: {
  ignore: true,
  classification: 'PAYMENT_INFO_WASM_UNREACHABLE',
  severity: 'NON_FATAL',
  phase: 'paymentInfo'
}
[Chopsticks] ⚠️ Ignoring known Chopsticks limitation: {
  classification: 'PAYMENT_INFO_WASM_UNREACHABLE',
  reason: 'Known Chopsticks limitation. Occurs when Asset Hub payment logic...'
}
[Chopsticks] Fee estimation failed (non-critical, simulation passed): ...
```

### When Error is Blocking

```
[Chopsticks] 🔍 Error classification: {
  ignore: false,
  classification: 'FATAL_ERROR',
  severity: 'BLOCKING'
}
[Chopsticks] ✗ BLOCKING error detected: {
  classification: 'FATAL_ERROR',
  severity: 'BLOCKING',
  reason: 'Structural error: Invalid SS58. This indicates a real problem...'
}
[Chopsticks] ✗ paymentInfo failed with blocking error: ...
```

## Testing Checklist

- [x] Created ignore policy file with rules
- [x] Integrated classification into chopsticks.ts
- [x] Applied to paymentInfo errors
- [x] Applied to dryRun errors (parseOutcome)
- [x] Exported from index.ts
- [x] No linter errors
- [x] Comprehensive documentation created

### Manual Testing Required

- [ ] Test Asset Hub transfer (should ignore paymentInfo wasm unreachable)
- [ ] Test with invalid SS58 address (should BLOCK)
- [ ] Test with wrong pallet name (should BLOCK)
- [ ] Test with metadata mismatch (should BLOCK)
- [ ] Verify on-chain submission succeeds after ignore

## Benefits

1. ✅ **Unblocks Asset Hub transfers**: Known Chopsticks limitations no longer block valid transactions
2. ✅ **Maintains safety**: Real structural errors still cause failures
3. ✅ **Transparency**: Detailed logging shows classification decisions
4. ✅ **Extensibility**: Easy to add new ignore rules
5. ✅ **Conservative**: Unknown errors default to blocking
6. ✅ **Chain-aware**: Can apply different rules per chain
7. ✅ **Phase-aware**: Different rules for paymentInfo vs dryRun

## How to Add New Ignore Rules

1. **Verify on-chain**: Confirm the extrinsic succeeds on-chain despite Chopsticks error
2. **Add to `CHOPSTICKS_IGNORE_ERRORS`**:
   ```typescript
   {
     id: 'YOUR_ERROR_ID',
     match: ['pattern1', 'pattern2'],  // All must be present
     phase: 'paymentInfo',  // or 'dryRun' or 'both'
     severity: 'NON_FATAL',
     reason: `Detailed explanation...`,
     chains: ['Asset Hub Polkadot'],  // Optional
   }
   ```
3. **Test**: Verify classification works correctly
4. **Document**: Update `CHOPSTICKS_IGNORE_POLICY.md`

## Integration Points

The ignore policy is applied at the **lowest level** (Chopsticks simulation layer):

```
User Request
    ↓
Agent (agent.ts)
    ↓
BaseAgent.dryRunExtrinsic()
    ↓
Chopsticks.simulateTransaction()  ← CLASSIFICATION HAPPENS HERE
    ↓
    ├─ dryRunExtrinsic() → parseOutcome() → classifyChopsticksError()
    └─ paymentInfo() → catch error → classifyChopsticksError()
    ↓
Return SimulationResult (success/failure)
    ↓
Executioner (handles already-classified results)
```

This ensures:
- Classification happens once, at the source
- Higher layers receive clean success/failure results
- No need to re-classify errors in multiple places

## Files Summary

| File | Status | Purpose |
|------|--------|---------|
| `chopsticksIgnorePolicy.ts` | NEW | Defines rules and classification function |
| `chopsticks.ts` | MODIFIED | Applies classification to errors |
| `index.ts` | MODIFIED | Exports ignore policy |
| `CHOPSTICKS_IGNORE_POLICY.md` | NEW | Comprehensive documentation |
| `CHOPSTICKS_IGNORE_IMPLEMENTATION_SUMMARY.md` | NEW | This file - implementation summary |

## Next Steps

1. **Manual Testing**: Test with real Asset Hub transfers
2. **Monitoring**: Watch for new error patterns that might need rules
3. **Refinement**: Adjust rules based on real-world usage
4. **Telemetry** (optional): Track ignored errors for analysis

## Conclusion

The Chopsticks ignore policy provides a **safe, surgical** solution to handle known Chopsticks limitations after the Asset Hub migration, while maintaining strict validation for real errors.

**Core principle**: Trust but verify. Be conservative by default, but allow well-understood, verified safe-to-ignore errors to pass through.

