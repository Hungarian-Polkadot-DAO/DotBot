# INFO_TWO: Execution Session Architecture & Runtime Panic Prevention

## Problem Statement

The core issue causing `wasm unreachable` runtime panics is **metadata mismatch** between the API instance that creates an extrinsic and the API instance that submits it.

### Root Cause

1. **Multiple ApiPromise instances**: Different API instances can have different runtime metadata, even for the same chain
2. **Silent failover**: RPC manager switches endpoints during transaction lifecycle
3. **Cross-registry extrinsics**: Extrinsics created with one API's registry are submitted with another API's registry
4. **No immutability guarantee**: API instance can change between extrinsic creation and submission

### Why This Causes Runtime Panics

Substrate runtime validation (`TaggedTransactionQueue_validate_transaction`, `TransactionPaymentApi_query_info`) assumes:
- Exact metadata layout
- Exact pallet indices  
- Exact types for balances, assets, fees

If anything is off → runtime panics, not errors.

## Solution: Execution Sessions

### Core Principle

**Once an extrinsic lifecycle starts, the ApiPromise must be immutable.**

### Implementation

#### 1. Split RPC Usage by Intent

```typescript
// For READ operations (can failover)
const readApi = await rpcManager.getReadApi();
const balance = await readApi.query.balances.account(address);

// For EXECUTION (locked, no failover)
const session = await rpcManager.createExecutionSession();
const extrinsic = session.api.tx.balances.transferAllowDeath(recipient, amount);
await extrinsic.signAndSend(...);
```

#### 2. Execution Session Pattern

```typescript
class ExecutionSession {
  public readonly api: ApiPromise;  // Immutable
  public readonly endpoint: string;  // Immutable
  public readonly registry: Registry; // Immutable
  
  assertSameRegistry(extrinsic): void {
    if (extrinsic.registry !== this.registry) {
      throw new Error('Cross-registry extrinsic detected');
    }
  }
}
```

#### 3. Registry Validation

Before submitting any extrinsic:
```typescript
session.assertSameRegistry(extrinsic);
```

This prevents extrinsics from being submitted with the wrong API instance.

## Architecture Changes

### RpcManager Changes

**Before:**
- `connect()` - Returns best API, can switch anytime
- No guarantee of immutability

**After:**
- `getReadApi()` - For reads, can failover
- `createExecutionSession()` - For transactions, locks API (no failover)
- `ExecutionSession` - Immutable API instance for transaction lifecycle

### Executioner Changes

**Before:**
- Uses `apiInstance` from metadata (can be wrong API)
- No preflight validation
- No registry checking

**After:**
- Creates execution session at start of transaction
- Rebuilds extrinsic using session API
- Preflight validation before user approval
- Registry validation before submission

### Agent Changes

**Before:**
- Stores `apiInstance` in metadata
- Extrinsic created with one API, might be submitted with another

**After:**
- Stores `chainType` in metadata (not API instance)
- Executioner rebuilds extrinsic with correct API
- No API instance passed through metadata

## Transaction Lifecycle

### Old Flow (Problematic)
```
Agent → Creates extrinsic with API A → Stores API A → 
Executioner → Uses API A (but might have switched) → Runtime panic
```

### New Flow (Fixed)
```
Agent → Validates with simulation → Stores chainType →
Executioner → Creates execution session → Rebuilds extrinsic with session API →
Preflight validation → User approval → Registry check → Sign → Broadcast
```

## Preflight Validation

Before user approval, test the extrinsic:
```typescript
try {
  await extrinsic.paymentInfo(address);
} catch (error) {
  // Runtime panic detected - fail early
  throw new Error('RUNTIME_VALIDATION_PANIC');
}
```

This catches runtime panics BEFORE the user sees the transaction.

## Error Classification

- `RUNTIME_VALIDATION_PANIC` - Runtime rejected transaction shape
- `PREFLIGHT_VALIDATION_FAILED` - Preflight check failed
- `EXTRINSIC_REBUILD_FAILED` - Failed to rebuild extrinsic
- `CROSS_REGISTRY_EXTRINSIC` - Extrinsic from wrong API instance

## Key Guarantees

1. **Execution API is immutable** - Once session created, API never changes
2. **No silent switching** - If endpoint dies, session fails, user retries
3. **Registry validation** - Extrinsics checked before submission
4. **Preflight validation** - Runtime panics caught before user approval
5. **Extrinsic rebuilding** - Always built with exact API that submits

## Files Modified

1. **`rpcManager.ts`** - Complete rewrite with execution sessions:
   - Added `ExecutionSession` class - immutable API instance for transaction lifecycle
   - Added `getReadApi()` - For read operations (can failover)
   - Added `createExecutionSession()` - For transactions (locks API, no failover)
   - Added `assertSameRegistry()` - Validates extrinsic belongs to session's registry
   - Deprecated `connect()` - Use `getReadApi()` or `createExecutionSession()` instead

2. **`executioner.ts`** - Complete rewrite with execution sessions:
   - Creates execution session at start of transaction
   - Rebuilds extrinsic using session API (ensures metadata match)
   - Preflight validation before user approval (catches runtime panics early)
   - Registry validation before signing and broadcasting
   - Session health monitoring (detects disconnections)

3. **`agent.ts`** - Removed `apiInstance` from metadata:
   - Stores `chainType` ('assetHub' | 'relay') instead of API instance
   - Executioner rebuilds extrinsic with correct API based on chainType

4. **`baseAgent.ts`** - Added API readiness checks:
   - Validates API is ready before creating extrinsics
   - Validates balances pallet exists
   - Better error handling for API failures

5. **`system.ts`** - Passes RPC managers to executioner:
   - Executioner now has access to RPC managers for creating sessions

## Implementation Status

✅ **Execution Sessions** - Implemented
- `ExecutionSession` class locks API instance
- `createExecutionSession()` creates immutable API
- Session tracks endpoint and registry

✅ **Split RPC Usage** - Implemented
- `getReadApi()` for reads (can failover)
- `createExecutionSession()` for transactions (no failover)

✅ **Registry Validation** - Implemented
- `assertSameRegistry()` checks extrinsic registry matches session
- Validated before signing and broadcasting

✅ **Preflight Validation** - Implemented
- `paymentInfo()` called before user approval
- Catches runtime panics early
- Proper error classification (`RUNTIME_VALIDATION_PANIC`)

✅ **Extrinsic Rebuilding** - Implemented
- Executioner rebuilds extrinsics using session API
- Based on metadata (recipient, amount, keepAlive)
- Ensures exact metadata match

✅ **Error Classification** - Implemented
- `RUNTIME_VALIDATION_PANIC` - Runtime rejected transaction
- `PREFLIGHT_VALIDATION_FAILED` - Preflight check failed
- `EXTRINSIC_REBUILD_FAILED` - Failed to rebuild
- `CROSS_REGISTRY_EXTRINSIC` - Wrong API instance
- `SESSION_DISCONNECTED` - Endpoint died during execution
- `EXECUTION_SESSION_FAILED` - Failed to create session

## Migration Notes

- `RpcManager.connect()` is deprecated - use `getReadApi()` or `createExecutionSession()`
- Agents should not store `apiInstance` in metadata - store `chainType` instead
- Executioner will rebuild extrinsics - agents just need to provide chain info
- All transactions now use execution sessions - API instance is immutable during lifecycle

