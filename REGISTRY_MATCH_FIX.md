# Registry Match Fix

## Problem

After reverting to the original architecture where agents create extrinsics directly, we encountered the following error:

```
❌ Execution preparation failed: Error: Transaction validation failed: Simulation failed: InvalidTransaction: Invalid
```

This was caused by **registry mismatch** between the extrinsic's API and the executioner's API.

## Root Cause

The flow was:
1. **Orchestrator** initializes agent with `this.api` (Relay Chain) and `this.assetHubApi` (Asset Hub)
2. **Agent** calls `getApiForChain('assetHub')` which returns `this.assetHubApi`
3. **Agent** creates extrinsic with Asset Hub API → extrinsic has Asset Hub registry
4. **Executioner** tries to simulate with `this.api` (Relay Chain API) → **REGISTRY MISMATCH!**

The extrinsic was created with one API's registry, but the executioner was trying to use a different API with a different registry. This caused the `InvalidTransaction: Invalid` error.

## Solution

**The executioner now uses the API that matches the extrinsic's registry**, not just `this.api`.

### Implementation

In `executioner.ts`, the `executeItem()` method now:

1. **Checks which API's registry matches the extrinsic**:
   - If `this.api.registry === extrinsic.registry` → use Relay Chain API
   - Else if `this.assetHubApi.registry === extrinsic.registry` → use Asset Hub API
   - Else → fallback to `this.api` with warning

2. **Uses the matched API for all operations**:
   - Simulation (Chopsticks)
   - Signing
   - Broadcasting

### Code Changes

```typescript
// CRITICAL: Use the API that created the extrinsic!
// The extrinsic knows which API it came from via its registry
let apiForExtrinsic: ApiPromise;

// Check which API's registry matches the extrinsic
if (this.api.registry === extrinsic.registry) {
  apiForExtrinsic = this.api;
  console.log('[Executioner] Using relay chain API (registry match)');
} else if (this.assetHubApi && this.assetHubApi.registry === extrinsic.registry) {
  apiForExtrinsic = this.assetHubApi;
  console.log('[Executioner] Using Asset Hub API (registry match)');
} else {
  // Fallback: try to determine from metadata
  console.warn('[Executioner] No exact registry match found, using relay chain API as fallback');
  console.warn('[Executioner] This may cause issues! Agent should use executioner APIs.');
  apiForExtrinsic = this.api;
}

console.log('[Executioner] Registry validation:', {
  extrinsicRegistryAddr: extrinsic.registry.constructor.name,
  selectedApiRegistryAddr: apiForExtrinsic.registry.constructor.name,
  registryMatch: extrinsic.registry === apiForExtrinsic.registry,
});
```

## Benefits

1. **✅ Eliminates registry mismatch errors** - Extrinsic is always processed with its own API
2. **✅ Works for both single and batch extrinsics** - Uses the same `extrinsic` field
3. **✅ Automatic API selection** - No manual chain type resolution needed
4. **✅ Maintains architectural separation** - Agent creates, executioner executes

## Testing

To verify the fix works:
1. Send a DOT transfer (uses Asset Hub API)
2. Check logs for `[Executioner] Using Asset Hub API (registry match)`
3. Verify simulation passes without `InvalidTransaction: Invalid` error
4. Confirm transaction executes successfully

## Notes

- This fix assumes the agent is initialized with the same API instances that the executioner has
- The orchestrator already does this correctly (line 394 in `orchestrator.ts`)
- If APIs are created separately, registry match will fail and fallback to Relay Chain API

## Related Files

- `frontend/src/lib/executionEngine/executioner.ts` - Registry matching logic
- `frontend/src/lib/agents/baseAgent.ts` - `getApiForChain()` method
- `frontend/src/lib/executionEngine/orchestrator.ts` - Agent initialization


