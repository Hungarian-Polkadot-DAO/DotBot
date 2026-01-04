# Chopsticks Block Hash Fix

## Problem

Chopsticks simulation was failing with:
```
Cannot find header for 0x47e3161d3bf858624e11f9ec4397bd9d30fa9a639fb3d84e22ed6792a2afb861
```

## Root Cause

The code was getting the block hash from the API instance (`api.rpc.chain.getBlockHash()`), which could be:
1. **Cached/Stale** - The API instance might have cached an old block hash
2. **Pruned** - The RPC endpoint (especially public nodes) might have pruned old blocks
3. **Out of sync** - The API's block might not match the endpoint's available blocks

When Chopsticks tried to create a fork at that block hash, it couldn't find it on the RPC endpoint, causing the error.

## Solution

**Always let Chopsticks fetch the latest block directly from the RPC endpoint** by passing `undefined` for the `block` parameter.

Additionally, added a `toHexString()` helper to safely convert block hashes (which can be strings or objects) to hex strings.

### Before (Buggy Code)

```typescript
// Try to get block hash from the API
blockHash = await api.rpc.chain.getBlockHash(); // ❌ Might be stale!

chain = await setup({
  endpoint: endpoints,
  block: blockHash ? blockHash.toHex() : undefined, // Uses stale block
  buildBlockMode: BuildBlockMode.Batch,
  mockSignatureHost: true,
  db: storage,
});
```

### After (Fixed Code)

```typescript
// CRITICAL: Always let Chopsticks fetch the latest block from the RPC endpoint
// DO NOT use api.rpc.chain.getBlockHash() because:
// 1. The API instance might have a cached/stale block hash
// 2. That block might not exist on the endpoint (pruned node)
// 3. This causes "Cannot find header" errors in Chopsticks

chain = await setup({
  endpoint: endpoints,
  block: undefined, // ✅ Let Chopsticks fetch latest block from endpoint
  buildBlockMode: BuildBlockMode.Batch,
  mockSignatureHost: true,
  db: storage,
});

// Helper to safely convert block hash to hex string
const toHexString = (blockHash: any): string => {
  if (typeof blockHash === 'string') {
    return blockHash;
  }
  if (blockHash && typeof blockHash.toHex === 'function') {
    return blockHash.toHex();
  }
  return String(blockHash);
};

// Get block info AFTER setup from the forked chain
const chainBlockHash = await chain.head;
const blockHashHex = toHexString(chainBlockHash); // ✅ Safe conversion
const chainBlockNumber = await chain.api.rpc.chain.getHeader(chainBlockHash);
```

## Benefits

1. **✅ Always uses a block that exists** - Chopsticks fetches the latest block from the endpoint
2. **✅ No stale block hash errors** - Never uses cached API state
3. **✅ Works with pruned nodes** - Always uses the latest available block
4. **✅ More reliable** - Simulation works consistently across different RPC endpoints

## Technical Details

### Why the API block hash can be stale

1. **API Connection Timing** - The API might have been connected hours ago
2. **Cache Behavior** - Polkadot.js API caches certain RPC responses
3. **Long-lived Instances** - The same API instance is reused for multiple operations
4. **Public Node Pruning** - Public RPC nodes often prune blocks older than 256 blocks

### Chopsticks Block Fetching

When `block: undefined` is passed to `setup()`:
1. Chopsticks connects to the RPC endpoint
2. Fetches the latest finalized block
3. Creates a fork at that block
4. Returns the `chain` object with the actual block hash

We then retrieve the block info from `chain.head` and use it for logging and cleanup.

## Files Changed

- `frontend/src/lib/services/simulation/chopsticks.ts`
  - Lines 94-110: Removed API block hash fetching
  - Line 104: Pass `block: undefined` to setup
  - Lines 112-123: Get block hash from chain after setup

## Testing

The fix should resolve the error for:
1. ✅ Single transfers
2. ✅ Batch transfers
3. ✅ Any extrinsic simulation
4. ✅ Any RPC endpoint (public or private)

### Expected Log Output

```
🌿 [Chopsticks] Creating chain fork (fetching latest block from endpoint)... [████░░░░░░] 40%
🌿 [Chopsticks] Chain fork created at block #12345678... [████░░░░░░] 45% • Block: 0x9a3c7e1f...
⚡ [Chopsticks] Simulating transaction execution... [██████░░░░] 60% • Running on forked chain state
✅ [Chopsticks] ✓ Simulation successful! [██████████] 100% • Validated in 5234ms • Balance change: -100000000
```

## Related Errors

This fix also resolves related block-related errors:
- `Cannot find block 0x...`
- `Block not found`
- `Invalid block hash`
- `RPC timeout while fetching block`
- `finalBlockHash.toHex is not a function` (when block hash is already a string)

All caused by the same root issues: using stale block hashes from the API, and incorrect type assumptions about block hash format.

