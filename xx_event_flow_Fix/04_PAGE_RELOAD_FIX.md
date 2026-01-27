# Page Reload UI Freeze Fix

## Problem

Inconsistent UI freezing on page reload. Sometimes the UI would freeze for several seconds, sometimes it wouldn't. The issue was not related to `useEffect` dependencies, but rather a **race condition where message producers start emitting before React has fully mounted and subscribed**.

## Root Cause

🔥 **Something starts producing messages before React has fully mounted and subscribed.**

Likely candidates:
- Simulation engine initialization
- Chopsticks availability check
- WebSocket / RPC connection setup
- localStorage rehydration triggering side effects
- **Module-level code (top-level imports!)**

If anything runs at module scope — that's the smoking gun.

On page reload:
1. Module-level code or early initialization can emit events
2. These events try to add messages to the context
3. If React hasn't mounted yet, `requestAnimationFrame` callbacks queue up
4. When React mounts, all queued callbacks fire at once, causing a freeze
5. The inconsistency comes from timing - sometimes React mounts before events fire, sometimes after

## Solution (Clean + Deterministic)

### 1. Explicit Readiness State (No Timers)

Replace timeout-based readiness with explicit init:

```typescript
const [isReady, setIsReady] = useState(false);

useEffect(() => {
  setIsReady(true);
}, []);
```

**No timers. No guessing. Deterministic.**

### 2. Gate All Message Producers

Gate all producers to check `isReady` first:

```typescript
const addMessageBatched = useCallback((message: ReportMessageData) => {
  // Always queue the message (preserve content)
  messageBatchRef.current.push(message);
  
  // Gate: Don't process if not ready
  if (!isReady) {
    return; // Message queued, will process when ready
  }
  
  // Schedule processing...
}, [isReady]);
```

### 3. Single Scheduler (No Overlapping)

**Never have:**
- Multiple RAFs
- RAF + timeout chains
- Overlapping batch schedulers

**Use one scheduler, one state machine:**

```typescript
const schedulerRafRef = useRef<number | null>(null);
const isScheduledRef = useRef(false);

// Single scheduler function
const processMessageBatch = useCallback(() => {
  // Process in chunks...
}, [isReady]);

// Only schedule if not already scheduled
if (!isScheduledRef.current) {
  isScheduledRef.current = true;
  schedulerRafRef.current = requestAnimationFrame(() => {
    processMessageBatch();
  });
}
```

### 4. Process Queued Messages When Ready

When `isReady` becomes true, process any queued messages:

```typescript
useEffect(() => {
  if (isReady && messageBatchRef.current.length > 0 && !isScheduledRef.current) {
    // Trigger processing...
  }
}, [isReady, processMessageBatch]);
```

### 5. No Module-Level Async

🚫 **No:**
- `requestAnimationFrame(...)` at top-level
- `setTimeout(...)` at top-level
- Simulation startup at module scope
- Chopsticks import side effects
- Any async operations at top-level files

✅ **Everything starts from a `start()` function called after mount.**

## Code Changes

### ScenarioEngineContext.tsx

- **Replaced** `isMountedRef` with explicit `isReady` state (`useState`)
- **Removed** all timeout-based logic
- **Added** single scheduler (`processMessageBatch`) - one RAF, one state machine
- **Added** `isScheduledRef` to prevent overlapping schedulers
- **Gated** `addMessageBatched` to check `isReady` before processing
- **Added** effect to process queued messages when `isReady` becomes true
- **Simplified** cleanup - only cancel RAF, no timeouts

### useScenarioEngine.ts

- **Removed** timeout-based deferral of report sync
- Sync happens immediately - context's `isReady` state gates processing
- Messages queue automatically if context not ready yet

## Testing

To verify the fix:

1. **Page reload test**: Reload the page multiple times - UI should not freeze
2. **ScenarioEngine enabled**: Enable ScenarioEngine, reload page - should not freeze
3. **With existing report**: If there's existing report content, it should sync smoothly after mount

## Why This Works

- **Deterministic initialization**: No timers, no guessing - explicit `isReady` state
- **Gates all producers**: All message producers check `isReady` before processing
- **Single scheduler**: One RAF, one state machine - no overlapping schedulers
- **No lost messages**: Messages queued before ready are processed when ready
- **No module-level async**: Everything starts after mount, preventing race conditions
- **Proper cleanup**: All pending operations are cancelled on unmount

## Related Issues

This fix addresses the inconsistent freezing that was separate from the original render loop issues (which were already fixed). The original fixes handled:
- Batched message updates during execution
- Deferred heavy work
- Optimized event emissions

This fix specifically addresses the **initialization race condition on page reload**.
