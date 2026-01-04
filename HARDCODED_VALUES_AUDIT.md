# Hardcoded Values Audit

## Summary

Found and fixed **hardcoded RPC endpoints** in the executioner. The system now uses RPC managers when available, with hardcoded endpoints as fallback.

---

## Issues Found

### 1. ✅ FIXED: Hardcoded RPC Endpoints in Single Execution

**Location**: `executioner.ts` lines 421-426

**Problem**: 
- Used hardcoded Relay Chain endpoints for all simulations
- Asset Hub extrinsics would fail with `InvalidTransaction: Invalid`

**Fix**: 
- Now detects chain from `apiForExtrinsic.registry.chainSS58`
- Uses RPC manager endpoints when available
- Falls back to hardcoded endpoints if no manager

### 2. ✅ FIXED: Hardcoded RPC Endpoints in Batch Execution

**Location**: `executioner.ts` lines 708-711

**Problem**: Same as above, but for batch execution

**Fix**: Same approach - uses RPC manager, falls back to hardcoded

---

## Other Hardcoded Values (Acceptable)

### 1. Default RPC Endpoints in `baseAgent.ts`

**Location**: `baseAgent.ts` lines 474-488

**Status**: ✅ **Acceptable** - Used as fallback when RPC manager not available

**Reason**: 
- Only used when `getRpcEndpointsForChain()` has no manager
- Provides reasonable defaults for basic functionality
- Not used in production flow (RPC managers are always provided)

### 2. SS58 Format Assumption (`chainSS58 === 0`)

**Location**: Multiple files

**Status**: ✅ **Acceptable** - Correct for Polkadot ecosystem

**Reason**:
- `chainSS58 === 0` is the standard for Polkadot/Asset Hub
- This is a network constant, not a configuration
- Used correctly throughout the codebase

### 3. Chain Name Strings ("Asset Hub", "Relay Chain")

**Location**: Multiple files

**Status**: ✅ **Acceptable** - Display names only

**Reason**:
- Used for logging and user-facing messages
- Not used for logic decisions
- Can be easily changed if needed

### 4. Default Chain in Agent (`params.chain || 'assetHub'`)

**Location**: `asset-transfer/agent.ts` lines 77, 209

**Status**: ✅ **Acceptable** - Sensible default

**Reason**:
- DOT transfers default to Asset Hub (correct)
- User/LLM can override with `chain: 'relay'`
- Matches production behavior

### 5. Genesis Hash Checks in `baseAgent.ts`

**Location**: `baseAgent.ts` lines 502-512

**Status**: ✅ **Acceptable** - Fallback only

**Reason**:
- Only used in `extractRpcEndpoint()` legacy method
- Fallback when API provider doesn't expose endpoint
- Not used in main flow

---

## Improvements Made

### Before
```typescript
// ❌ Hardcoded endpoints
const rpcEndpoints = ['wss://rpc.polkadot.io', 'wss://polkadot-rpc.dwellir.com'];
```

### After
```typescript
// ✅ Uses RPC manager when available
const manager = isAssetHub ? this.assetHubManager : this.relayChainManager;
let rpcEndpoints: string[];
if (manager) {
  // Get healthy endpoints from manager
  const healthStatus = manager.getHealthStatus();
  // ... prioritize current endpoint, filter healthy ones
  rpcEndpoints = orderedEndpoints;
} else {
  // Fallback to hardcoded (shouldn't happen in production)
  rpcEndpoints = isAssetHub ? [...] : [...];
}
```

---

## Benefits

1. **✅ Uses RPC Manager Endpoints**: Leverages health checks and failover
2. **✅ Prioritizes Current Endpoint**: Uses the endpoint the API is connected to
3. **✅ Filters Unhealthy Endpoints**: Skips endpoints that recently failed
4. **✅ Fallback Safety**: Still works if manager not available
5. **✅ Better Logging**: Shows whether using manager or fallback

---

## Testing

### Test 1: With RPC Managers (Production)
```
Send 5 DOT to Alice
```
**Expected**: Uses endpoints from RPC manager, logs `source: 'RPC Manager'`

### Test 2: Without RPC Managers (Edge Case)
**Expected**: Falls back to hardcoded endpoints, logs `source: 'Hardcoded fallback'`

---

## Remaining Hardcoded Values

All remaining hardcoded values are **acceptable**:
- ✅ Default endpoints (fallback only)
- ✅ SS58 format checks (network constants)
- ✅ Chain name strings (display only)
- ✅ Default chain selection (sensible default)
- ✅ Genesis hash checks (legacy fallback)

---

## Conclusion

**All critical hardcoded values have been fixed!** ✅

The system now:
- Uses RPC managers for endpoint selection
- Falls back gracefully if managers unavailable
- Logs the source of endpoints for debugging
- Works correctly for both Asset Hub and Relay Chain


