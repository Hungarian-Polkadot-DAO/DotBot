# Fix: ScenarioEngine freeze on reload (RAF scheduler + event listener accumulation)

## Problem

The ScenarioEngine UI would freeze when starting scenarios after page reloads:
- **1st-2nd reload**: RAF scheduler flag stuck, no RAF fires → UI freeze
- **3rd+ reload**: Event listener accumulation → CPU spike → browser tab freeze

## Root Causes

### Issue #1: RAF Scheduler Flag Persistence (StrictMode)

In React StrictMode, components mount → unmount → remount to catch bugs. The `isScheduledRef.current` flag persisted across this cycle while the `requestAnimationFrame` callback was cancelled:

1. First mount: RAF scheduled, `isScheduledRef.current = true`
2. Unmount (StrictMode): RAF cancelled, but **ref stays `true`**
3. Remount: New messages arrive, check sees `true`, skips scheduling
4. Result: No RAF scheduled, messages stuck in queue → freeze

**Why it happened**: `useEffect` cleanup ran too late (after messages arrived on remount).

### Issue #2: Event Listener Accumulation

Multiple event listeners accumulated on each reload:

1. `useScenarioEngine` hook re-runs when `dotbot` dependency changes
2. Each run creates a NEW `handleEvent` closure and adds it as a listener
3. By 3rd reload: 3+ listeners × events × React updates → microtask queue explosion → CPU spike

**Why it happened**: Hook cleanup unsubscribed from DotBot, then `setupScenarioEngineDependencies` resubscribed, but listeners weren't properly cleaned up.

## Fixes Applied

### 1. Reset RAF Scheduler Flag in `useLayoutEffect` Cleanup

**File**: `frontend/src/components/scenarioEngine/context/ScenarioEngineContext.tsx`

```typescript
useLayoutEffect(() => {
  isMountedRef.current = true;
  setIsReady(true);
  
  return () => {
    isMountedRef.current = false;
    // CRITICAL: Reset in useLayoutEffect cleanup (runs BEFORE remount)
    isScheduledRef.current = false;  // ← THE FIX
  };
}, []);
```

**Why `useLayoutEffect`**: Runs synchronously before browser paint, ensuring flag is reset BEFORE component remounts and messages arrive.

### 2. Idempotent DotBot Subscription

**File**: `lib/dotbot-core/scenarioEngine/ScenarioEngine.ts`

```typescript
subscribeToDotBot(dotbot: DotBot): void {
  // IDEMPOTENT: Skip if already subscribed to this exact instance
  if (this.dotbot === dotbot && this.dotbotEventListener) {
    return;  // ← THE FIX
  }
  
  // Unsubscribe from previous DotBot if any
  if (this.dotbot && this.dotbotEventListener) {
    this.dotbot.removeEventListener(this.dotbotEventListener);
    this.dotbotEventListener = null;
  }
  
  this.dotbot = dotbot;
  // ... rest unchanged
}
```

**Why idempotent**: Prevents multiple subscriptions to the same DotBot instance when hook re-runs.

### 3. Remove DotBot Unsubscribe from Hook Cleanup

**File**: `frontend/src/components/scenarioEngine/hooks/useScenarioEngine.ts`

```typescript
return () => {
  engine.removeEventListener(handleEvent);
  // REMOVED: engine.unsubscribeFromDotBot();  // ← THE FIX
  // Note: DotBot lifecycle is managed by App component
};
```

**Why removed**: Prevents conflict with `setupScenarioEngineDependencies` which manages DotBot subscription. App component handles cleanup on unmount.

### 4. Event Listener Count Warning

**File**: `lib/dotbot-core/scenarioEngine/ScenarioEngine.ts`

```typescript
addEventListener(listener: ScenarioEngineEventListener): void {
  this.eventListeners.add(listener);
  
  // Guard: Warn if too many listeners
  if (this.eventListeners.size > 2) {
    console.warn(`[ScenarioEngine] Warning: ${this.eventListeners.size} event listeners registered (expected 1-2)`);
  }
}
```

**Why added**: Provides early warning if listener accumulation bug returns.

### 5. Cleanup: Removed Debug Logging

Removed excessive console.log statements while keeping:
- Warnings and errors
- Critical lifecycle events
- Watchdog recovery logs

## Files Changed

- `frontend/src/components/scenarioEngine/context/ScenarioEngineContext.tsx`
- `lib/dotbot-core/scenarioEngine/ScenarioEngine.ts`
- `frontend/src/components/scenarioEngine/hooks/useScenarioEngine.ts`

## Testing

**Chromium/Chrome** - Tested with multiple reloads (5+ times):
- ✅ RAF fires immediately after messages queued
- ✅ Listener count stays at 1-2
- ✅ No CPU spike on 3rd+ reload
- ✅ Scenarios run smoothly every time
- ✅ Watchdog never needs to force recovery

**Firefox** - Still has issues:
- ❌ Still freezes on reload after fixes
- Different underlying issue (possibly Firefox-specific RAF behavior)
- Marked as low-impact (works in Chromium)
- Requires separate investigation

## Notes

- Issue only manifests in development due to React StrictMode double-mounting
- However, the bug could appear in production during:
  - React Router navigation
  - Modal/dialog open/close cycles
  - Component conditional rendering
- StrictMode helped catch a real production bug early!
- **Browser-specific**: Chromium works, Firefox requires additional investigation

## Known Remaining Issues

1. **Firefox-specific freeze** (low priority)
2. **ScenarioEngine only works in already-started conversations** - doesn't start new conversations

## Related Documentation

See `xx_raf_issue/main.md` for detailed analysis and debugging process.
