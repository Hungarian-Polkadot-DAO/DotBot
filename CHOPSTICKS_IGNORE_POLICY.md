# Chopsticks Ignore Policy Implementation

## Overview

After the Asset Hub migration, Chopsticks simulation encounters known limitations that cause errors **which are safe to ignore**. These errors occur due to differences between Chopsticks' simulation environment and the real on-chain execution environment, but they do NOT indicate invalid extrinsics.

This document describes the implementation of a conditional ignore policy that distinguishes between:
- **Safe-to-ignore errors**: Known Chopsticks limitations that won't affect on-chain execution
- **Blocking errors**: Real structural problems that will fail on-chain

## Problem Context

### Asset Hub Migration Impact

The Asset Hub migration introduced new fee hooks and payment logic that:
1. Assume a fully signed extrinsic with complete signature extensions
2. Require full block context (not available in Chopsticks)
3. Execute runtime paths that panic in Chopsticks but work perfectly on-chain

### Common Safe-to-Ignore Errors

```
TransactionPaymentApi_query_info: wasm unreachable
- Occurs during paymentInfo calls
- Asset Hub payment logic hits runtime paths unavailable in Chopsticks
- Does NOT indicate an invalid extrinsic
```

```
InvalidTransaction::Payment / BadOrigin
- Chopsticks simulates unsigned/partially signed extrinsics
- Asset Hub runtimes reject these during simulation
- Fully signed submissions work perfectly on-chain
```

```
AssetTxPayment / OnChargeTransaction errors
- Asset-aware fee hooks require full block context
- Chopsticks cannot reproduce this environment
- On-chain execution computes fees correctly
```

## Implementation

### 1. Ignore Policy Definition

**File**: `frontend/src/lib/services/simulation/chopsticksIgnorePolicy.ts`

Defines two critical lists:

#### Safe-to-Ignore Errors (`CHOPSTICKS_IGNORE_ERRORS`)

Each rule specifies:
- `id`: Unique identifier for the error pattern
- `match`: Array of strings that must ALL be present in the error message
- `phase`: When the error occurs (`paymentInfo`, `dryRun`, or `both`)
- `severity`: `NON_FATAL` (safe to ignore)
- `reason`: Explanation of why it's safe to ignore
- `chains`: Optional - specific chains where this applies
- `safeSince`: Optional - runtime version where this became safe

#### Fatal Errors (`CHOPSTICKS_FATAL_ERRORS`)

Structural errors that MUST cause hard failures:
- Call decoding failed
- Invalid call index
- Unknown pallet
- Invalid SS58
- Cannot decode AccountId
- Scale codec error
- Invalid Compact
- Metadata mismatch
- SpecVersion mismatch

### 2. Error Classification Function

```typescript
function classifyChopsticksError(
  error: Error | string,
  phase: 'paymentInfo' | 'dryRun',
  chainName?: string
): ErrorClassification
```

**Logic**:
1. Check if error matches any **fatal** patterns → BLOCKING
2. Check if error matches any **ignore** patterns:
   - **paymentInfo phase**: OR logic (`some()`) - ANY match string triggers the rule
   - **dryRun phase**: AND logic (`every()`) - ALL match strings must be present
   - Phase must match (or rule applies to both)
   - Chain must match (if chain-specific rule)
3. If no match found → BLOCKING (conservative default)

**Why OR logic for paymentInfo?**
- Fee calculation errors manifest in different ways
- Example: "wasm trap: wasm `unreachable` instruction executed" doesn't include "TransactionPaymentApi_query_info"
- BUT it's the same underlying issue - fee hooks panic in Chopsticks
- Using OR logic catches all variants without being too loose

**Returns**:
```typescript
{
  ignore: boolean,           // true = safe to ignore
  classification: string,    // Error ID or 'UNKNOWN'
  severity: 'NON_FATAL' | 'BLOCKING',
  reason?: string,           // Explanation
  phase?: 'paymentInfo' | 'dryRun' | 'both'
}
```

### 3. Integration in Chopsticks Simulation

**File**: `frontend/src/lib/services/simulation/chopsticks.ts`

#### A. Chain Name Detection

```typescript
// Get chain name for error classification
const chainName = (await api.rpc.system.chain()).toString();
```

#### B. PaymentInfo Error Handling

```typescript
// Classify the error using the ignore policy
const errorClassification = classifyChopsticksError(
  errorMessage, 
  'paymentInfo', 
  chainName
);

if (errorClassification.ignore) {
  // Safe to ignore - log warning and continue
  console.warn('[Chopsticks] ⚠️ Ignoring known Chopsticks limitation:', {
    classification: errorClassification.classification,
    reason: errorClassification.reason,
  });
  // Continue with simulation (fee = '0')
} else {
  // BLOCKING error - fail the simulation
  return {
    success: false,
    error: `${errorClassification.classification}: ${cleanError}. ${errorClassification.reason}`,
    estimatedFee: '0',
    balanceChanges: [],
    events: [],
  };
}
```

#### C. DryRun Error Handling

Updated `parseOutcome` function to classify InvalidTransaction errors:

```typescript
function parseOutcome(
  api: ApiPromise,
  outcome: any,
  chainName: string
): { succeeded: boolean; failureReason: string | null }
```

If `outcome.asErr` (InvalidTransaction):
1. Classify the error
2. If safe to ignore → return `{ succeeded: true, failureReason: null }`
3. If blocking → return `{ succeeded: false, failureReason: errorMessage }`

## Trust Levels (Mental Model)

| Phase             | Trust Chopsticks? | Why                                    |
|-------------------|-------------------|----------------------------------------|
| Call decoding     | ✅ YES            | Pure SCALE decoding                    |
| Metadata match    | ✅ YES            | Structural correctness                 |
| paymentInfo       | ❌ NO             | Runtime-dependent, often fails         |
| dryRun            | ⚠️ PARTIAL        | Often unsigned, may reject             |
| On-chain          | ✅ FINAL          | Ground truth                           |

## Usage Example

### Before (Hard Failure)

```
[Chopsticks] ✗ paymentInfo failed with wasm unreachable
Error: Extrinsic is malformed: TransactionPaymentApi_query_info wasm unreachable
❌ Simulation failed - transaction blocked
```

### After (Conditional Ignore)

```
[Chopsticks] 🔍 Error classification: {
  ignore: true,
  classification: 'PAYMENT_INFO_WASM_UNREACHABLE',
  severity: 'NON_FATAL'
}
[Chopsticks] ⚠️ Ignoring known Chopsticks limitation: {
  classification: 'PAYMENT_INFO_WASM_UNREACHABLE',
  reason: 'Known Chopsticks limitation. Occurs when Asset Hub payment logic...'
}
✅ Simulation passed - safe to submit on-chain
```

## Adding New Ignore Rules

To add a new safe-to-ignore error pattern:

1. **Verify it's actually safe**: Test on-chain to confirm the extrinsic succeeds
2. **Add to `CHOPSTICKS_IGNORE_ERRORS`**:

```typescript
{
  id: 'YOUR_ERROR_ID',
  match: ['error', 'pattern', 'fragments'],  // All must be present
  phase: 'paymentInfo',  // or 'dryRun' or 'both'
  severity: 'NON_FATAL',
  reason: `
    Detailed explanation of why this is safe to ignore.
    Include context about when it occurs and why it won't affect on-chain execution.
  `,
  chains: ['Asset Hub Polkadot'],  // Optional
  safeSince: 'runtime v2000000+',  // Optional
}
```

3. **Test thoroughly**: Ensure the classification works correctly

## Critical Safeguards

### 1. Conservative Default

Unknown errors are treated as **BLOCKING** by default:

```typescript
return {
  ignore: false,
  classification: 'UNKNOWN',
  severity: 'BLOCKING',
  reason: 'Unknown error pattern. Being conservative - treating as blocking.',
};
```

### 2. Fatal Errors Always Block

Structural errors (SCALE decoding, metadata mismatch, etc.) **always** cause hard failures, regardless of ignore rules.

### 3. Detailed Logging

Every classification decision is logged:
- Error message
- Classification result
- Reason for decision
- Whether error was ignored or blocked

## Testing Strategy

### Manual Testing

1. **Test with Asset Hub transfers**:
   - Should ignore `TransactionPaymentApi_query_info wasm unreachable`
   - Should succeed and allow on-chain submission

2. **Test with invalid extrinsics**:
   - Wrong pallet name → Should BLOCK
   - Invalid SS58 address → Should BLOCK
   - Metadata mismatch → Should BLOCK

3. **Test with edge cases**:
   - Network errors → Should handle gracefully
   - Timeout errors → Should handle gracefully

### Verification

After implementing ignore policy:
1. ✅ Asset Hub transfers work (previously failed)
2. ✅ Invalid extrinsics still blocked
3. ✅ Detailed logs show classification decisions
4. ✅ On-chain submissions succeed

## Files Modified

1. **`frontend/src/lib/services/simulation/chopsticksIgnorePolicy.ts`** (NEW)
   - Defines ignore rules and fatal errors
   - Implements classification function
   - Exports trust level constants

2. **`frontend/src/lib/services/simulation/chopsticks.ts`**
   - Imports `classifyChopsticksError`
   - Gets chain name from API
   - Applies classification to paymentInfo errors
   - Updates `parseOutcome` to classify dryRun errors

3. **`frontend/src/lib/services/simulation/index.ts`**
   - Exports ignore policy for external use

## Benefits

1. **Unblocks Asset Hub transfers**: Known Chopsticks limitations no longer block valid transactions
2. **Maintains safety**: Real structural errors still cause failures
3. **Transparency**: Detailed logging shows why errors are ignored
4. **Extensibility**: Easy to add new ignore rules as needed
5. **Conservative**: Unknown errors default to blocking

## Future Considerations

### 1. Runtime Version Detection

Could enhance rules to check runtime version:
```typescript
if (rule.safeSince && runtimeVersion < rule.safeSince) {
  // Don't ignore - might not be safe on older runtime
}
```

### 2. Chain-Specific Overrides

Could allow per-chain configuration:
```typescript
const config = {
  'Asset Hub Polkadot': {
    ignorePaymentInfoErrors: true,
    ignoreDryRunErrors: false,
  },
};
```

### 3. Telemetry

Could track ignored errors to identify patterns:
```typescript
telemetry.track('chopsticks_error_ignored', {
  classification: errorClassification.id,
  chain: chainName,
  phase: phase,
});
```

## Conclusion

The Chopsticks ignore policy provides a **safe, conditional** way to handle known Chopsticks limitations after the Asset Hub migration, while maintaining strict validation for real structural errors.

**Key principle**: Be conservative (block by default), but allow well-understood, verified safe-to-ignore errors to pass through.

