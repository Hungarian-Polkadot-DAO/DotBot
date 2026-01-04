# Chopsticks Simulation Service

## Overview

This service provides transaction simulation using Chopsticks (fork-based runtime execution) with intelligent error classification to handle known limitations after the Asset Hub migration.

## Quick Start

```typescript
import { simulateTransaction, isChopsticksAvailable } from '@/lib/services/simulation';

// Check if Chopsticks is available
if (await isChopsticksAvailable()) {
  // Simulate a transaction
  const result = await simulateTransaction(
    api,                    // ApiPromise instance
    rpcEndpoints,           // WebSocket RPC endpoint(s)
    extrinsic,              // Extrinsic to simulate
    senderAddress,          // Sender's address
    onStatusUpdate          // Optional status callback
  );
  
  if (result.success) {
    console.log('✓ Simulation passed');
    console.log('Estimated fee:', result.estimatedFee);
    console.log('Balance changes:', result.balanceChanges);
  } else {
    console.log('✗ Simulation failed:', result.error);
  }
}
```

## Files

### Core Files

- **`chopsticks.ts`**: Main simulation implementation
  - `simulateTransaction()`: Simulates transaction execution
  - `isChopsticksAvailable()`: Checks if Chopsticks is available

- **`chopsticksIgnorePolicy.ts`**: Error classification system
  - `classifyChopsticksError()`: Classifies errors as safe-to-ignore or blocking
  - `CHOPSTICKS_IGNORE_ERRORS`: Safe-to-ignore error patterns
  - `CHOPSTICKS_FATAL_ERRORS`: Errors that must block

- **`database.ts`**: Persistent storage for simulation cache
  - `ChopsticksDatabase`: IndexedDB wrapper for caching chain state

- **`diagnostics.ts`**: Diagnostic utilities
  - `runSimulationDiagnostics()`: Tests simulation capabilities

- **`sequentialSimulation.ts`**: Sequential simulation queue
  - Ensures simulations run one at a time (Chopsticks limitation)

- **`index.ts`**: Exports all public APIs

## Error Classification

### Safe-to-Ignore Errors (NON_FATAL)

These errors occur due to Chopsticks limitations but **do not** indicate invalid extrinsics:

1. **PAYMENT_INFO_WASM_UNREACHABLE**
   - Asset Hub payment logic hits runtime paths unavailable in Chopsticks
   - Common after Asset Hub migration
   - Safe to ignore - extrinsic will work on-chain

2. **UNSIGNED_SIMULATION_REJECTED**
   - Chopsticks simulates unsigned extrinsics
   - Asset Hub runtimes reject these during simulation
   - Fully signed submissions work on-chain

3. **WEIGHT_FEE_CALCULATION_FAILED**
   - Fee model requires runtime state unavailable in Chopsticks
   - On-chain execution computes fees correctly

### Blocking Errors (FATAL)

These errors indicate real structural problems:

- Call decoding failed
- Invalid call index
- Unknown pallet
- Invalid SS58
- Cannot decode AccountId
- Scale codec error
- Metadata mismatch
- SpecVersion mismatch

## Usage Examples

### Basic Simulation

```typescript
import { simulateTransaction } from '@/lib/services/simulation';

const result = await simulateTransaction(
  api,
  'wss://polkadot-asset-hub-rpc.polkadot.io',
  extrinsic,
  senderAddress
);

if (result.success) {
  console.log('Simulation passed!');
}
```

### With Status Updates

```typescript
const result = await simulateTransaction(
  api,
  rpcEndpoints,
  extrinsic,
  senderAddress,
  (status) => {
    console.log(`${status.phase}: ${status.message}`);
    if (status.progress) {
      console.log(`Progress: ${status.progress}%`);
    }
  }
);
```

### Error Classification

```typescript
import { classifyChopsticksError } from '@/lib/services/simulation';

try {
  // ... simulation code ...
} catch (error) {
  const classification = classifyChopsticksError(
    error,
    'paymentInfo',  // or 'dryRun'
    'Asset Hub Polkadot'
  );
  
  if (classification.ignore) {
    console.warn('Safe to ignore:', classification.reason);
    // Continue with transaction
  } else {
    console.error('Blocking error:', classification.reason);
    // Abort transaction
  }
}
```

### Pattern Matching Logic

**PaymentInfo Phase (OR logic)**:
- Uses `some()` - ANY pattern match triggers the rule
- Example: "wasm trap: wasm \`unreachable\` instruction executed" triggers `ASSET_HUB_GENERIC_WASM_PANIC` even without "TransactionPaymentApi_query_info"
- Why? Fee calculation errors manifest in different ways but are the same underlying issue

**DryRun Phase (AND logic)**:
- Uses `every()` - ALL patterns must match
- More precise matching for execution validation
- Prevents false positives

## Trust Levels

Different simulation phases have different trust levels:

| Phase           | Trust Level | Description                          |
|-----------------|-------------|--------------------------------------|
| Call decoding   | ✅ FULL     | Pure SCALE decoding - always trust  |
| Metadata match  | ✅ FULL     | Structural correctness - always trust |
| paymentInfo     | ❌ NO       | Runtime-dependent - often fails      |
| dryRun          | ⚠️ PARTIAL  | Often unsigned - may reject          |
| On-chain        | ✅ FINAL    | Ground truth - always trust          |

## Adding New Ignore Rules

If you encounter a new safe-to-ignore error pattern:

1. **Verify it's safe**: Test on-chain to confirm the extrinsic succeeds
2. **Add to `chopsticksIgnorePolicy.ts`**:

```typescript
{
  id: 'YOUR_ERROR_ID',
  match: ['error', 'pattern', 'fragments'],  // All must be present
  phase: 'paymentInfo',  // or 'dryRun' or 'both'
  severity: 'NON_FATAL',
  reason: `
    Detailed explanation of why this is safe to ignore.
  `,
  chains: ['Asset Hub Polkadot'],  // Optional
  safeSince: 'runtime v2000000+',  // Optional
}
```

3. **Test thoroughly**: Ensure the classification works correctly

## Debugging

### Enable Detailed Logging

The simulation service logs extensively to the console:

```
[Chopsticks] 🔧 Preparing transaction simulation...
[Chopsticks] 🌿 Fetching current blockchain state...
[Chopsticks] ⚡ Simulating transaction execution...
[Chopsticks] 🔍 Analyzing simulation results...
[Chopsticks] ✅ Simulation successful!
```

### Error Classification Logging

When errors are classified:

```
[Chopsticks] 🔍 Error classification: {
  ignore: true,
  classification: 'PAYMENT_INFO_WASM_UNREACHABLE',
  severity: 'NON_FATAL'
}
[Chopsticks] ⚠️ Ignoring known Chopsticks limitation: {
  classification: 'PAYMENT_INFO_WASM_UNREACHABLE',
  reason: '...'
}
```

### Common Issues

**Issue**: "Cannot find header" error
- **Cause**: Using a pruned node or stale block hash
- **Solution**: Chopsticks automatically fetches the latest block from the endpoint

**Issue**: "Registry mismatch" error
- **Cause**: Extrinsic registry doesn't match API registry
- **Solution**: Ensure extrinsic is constructed with the correct API instance

**Issue**: "Chopsticks not available"
- **Cause**: `@acala-network/chopsticks-core` not installed
- **Solution**: Install Chopsticks: `npm install @acala-network/chopsticks-core`

## Performance

- **First simulation**: ~2-5 seconds (fetches chain state)
- **Cached simulations**: ~500ms-1s (uses cached state)
- **Cache storage**: IndexedDB (per genesis hash)
- **Cleanup**: Automatic cleanup after each simulation

## Limitations

1. **WebSocket only**: Chopsticks requires WebSocket (wss://) endpoints, not HTTP
2. **Sequential execution**: Only one simulation at a time (Chopsticks limitation)
3. **Memory usage**: Forks entire chain state (can be memory-intensive)
4. **Fee estimation**: May fail on Asset Hub (safe to ignore with policy)
5. **Unsigned extrinsics**: May be rejected during simulation (safe to ignore with policy)

## Further Reading

- **`CHOPSTICKS_IGNORE_POLICY.md`**: Comprehensive documentation on error classification
- **`CHOPSTICKS_IGNORE_IMPLEMENTATION_SUMMARY.md`**: Implementation details and changes
- **Chopsticks GitHub**: https://github.com/AcalaNetwork/chopsticks

## Support

For issues or questions:
1. Check the console logs for detailed error information
2. Review the error classification in `chopsticksIgnorePolicy.ts`
3. Verify the extrinsic is valid using metadata inspection
4. Test on-chain to confirm the extrinsic works despite simulation errors

