# ScenarioEngine RAF Scheduler Freeze Issue

## TL;DR

**Two separate bugs caused freezing on page reload:**

1. **RAF Scheduler Flag Stuck True** (1st-2nd reload)
   - `isScheduledRef.current` persisted across StrictMode unmount/remount
   - RAF was cancelled but flag stayed `true`
   - Fix: Reset flag in `useLayoutEffect` cleanup

2. **Event Listener Accumulation** (3rd+ reload)
   - New event listeners added on each reload
   - By 3rd reload: 3+ listeners → Event cascade → CPU spike
   - Fix: Idempotent DotBot subscriptions + proper cleanup lifecycle

**Files Changed:**
- `frontend/src/components/scenarioEngine/context/ScenarioEngineContext.tsx`
- `lib/dotbot-core/scenarioEngine/ScenarioEngine.ts`
- `frontend/src/components/scenarioEngine/hooks/useScenarioEngine.ts`

**Status:** Fixes applied, waiting for test confirmation after rebuild.

---

## Problem Summary

The ScenarioEngine UI consistently freezes when starting scenarios after page reloads:
- **1st-2nd reload**: RAF scheduler flag stuck, no RAF fires
- **3rd+ reload**: Event listener accumulation causes CPU spike

## Symptoms

1. **First Load**: Everything works perfectly
2. **Reload Page**: Everything still initializes correctly
3. **Start Scenario**: UI freezes completely
   - Logs show messages being emitted from `ScenarioEngine`
   - Logs show messages being queued in `ScenarioEngineContext`
   - **NO logs showing RAF callback executing**
   - **NO watchdog recovery logs**

## Key Log Pattern (Freeze State)

```
[ScenarioEngineContext] Scheduling message processing, queue size: 1
[ScenarioEngineContext] Scheduler already running, skipping (queue size: 2)
// ❌ MISSING: [ScenarioEngineContext] RAF callback executing
// ❌ MISSING: Watchdog recovery logs
```

## Architecture Involved

### Three-Layer Event Flow

```
ScenarioEngine.ts (core)
    ↓ emit events
useScenarioEngine.ts (React hook)
    ↓ addMessageBatched()
ScenarioEngineContext.tsx (UI scheduler)
    ↓ requestAnimationFrame batching
UI Render
```

### ScenarioEngineContext Scheduler Design

The context uses a complex RAF-based batching system to prevent React from being overwhelmed:

1. **Message Queue**: `messageBatchRef.current[]`
2. **Scheduler Flag**: `isScheduledRef.current`
3. **RAF Reference**: `schedulerRafRef.current`
4. **Processing**: Chunks of 5 messages per RAF tick, with 16ms setTimeout between chunks
5. **Watchdog**: 2-second interval to detect stuck states

## Root Cause Analysis

### The React StrictMode Double-Mount Problem

In development, React StrictMode causes components to mount → unmount → mount. Logs show:

```
[ScenarioEngineContext] Component mounted (useLayoutEffect)
[ScenarioEngineContext] Component unmounting
[ScenarioEngineContext] Component mounted (useLayoutEffect)
```

### The Race Condition

1. **First Mount**: Component initializes, sets up refs
2. **Messages Queue**: ScenarioEngine starts, messages get queued
3. **RAF Scheduled**: `schedulerRafRef.current = requestAnimationFrame(...)`
4. **Unmount Cleanup**: Cancels RAF via `cancelAnimationFrame()`
5. **Second Mount**: Component remounts
6. **Messages Still Queued**: `messageBatchRef.current` still has messages
7. **Scheduler Rescheduled**: New RAF scheduled
8. **❌ RAF Never Fires**: Something prevents the callback from executing

### Why RAF Doesn't Fire

The exact mechanism is still unclear, but possibilities:

1. **Browser RAF throttling** during rapid mount/unmount cycles
2. **Stale closure** capturing old `isReady` or component state
3. **React internal batching** holding back the RAF callback
4. **RAF callback cancelled** but flag not reset properly

### Why Watchdog Doesn't Recover

The watchdog should detect `queue.length > 0 && !isScheduledRef.current` and force recovery. But logs show the watchdog **never runs** or **never logs**. This suggests:

1. The watchdog `useEffect` itself might not be setting up properly on remount
2. The `isReady` dependency might be stale
3. The watchdog interval might be cleared prematurely

## Fixes Applied

### 1. Queue Cleanup on Unmount

```typescript
// Clear queue on unmount to prevent orphaned messages
messageBatchRef.current = [];
```

**Rationale**: Prevent messages from the first mount from persisting into the second mount.

### 2. Enhanced Watchdog Logging

```typescript
console.log('[ScenarioEngineContext] Watchdog tick', watchdogTicks, 
  '- queue:', messageBatchRef.current.length, 
  'scheduled:', isScheduledRef.current, 
  'mounted:', isMountedRef.current);
```

**Rationale**: Diagnose if watchdog is even running.

### 3. Orphaned RAF Detection

```typescript
// Check if scheduler flag is true but RAF is null
if (schedulerRunning && schedulerRafRef.current === null && hasQueuedMessages) {
  console.warn('🚨 Orphaned scheduler detected');
  isScheduledRef.current = false;
  scheduleProcessing();
}
```

**Rationale**: Detect when RAF was cancelled but flag wasn't reset.

### 4. Previous Fixes (Already Applied)

- Made scheduler idempotent (reset flag at start of `processMessageBatch`)
- Used `useLayoutEffect` for immediate readiness
- Deferred event emission with `queueMicrotask` in `ScenarioEngine.emit()`
- Added comprehensive logging throughout

## Diagnostic Approach

### Key Questions to Answer

1. **Is the watchdog running?** → Look for "Watchdog tick" logs every 2 seconds
2. **Is RAF scheduled?** → Look for "Scheduling message processing" logs
3. **Does RAF fire?** → Look for "RAF callback executing" logs
4. **Does watchdog detect stuck state?** → Look for "🚨" logs
5. **What is component lifecycle?** → Count mount/unmount sequences

### Next Diagnostic Steps

If watchdog is NOT running:
- The `useEffect` hook setup is broken
- The `isReady` dependency is stale or never becomes true on remount

If watchdog IS running but doesn't detect stuck state:
- The detection logic is incorrect
- The state variables (`isScheduledRef`, `messageBatchRef`) are not shared properly

If watchdog detects but recovery fails:
- The `scheduleProcessing()` call doesn't actually schedule RAF
- There's a deeper browser/React issue preventing RAF

## Potential Ultimate Solutions

### Option 1: Abandon RAF for Simple useEffect

Replace the entire RAF batching system with a simple `useEffect` that processes the queue directly:

```typescript
useEffect(() => {
  if (messageBatchRef.current.length > 0) {
    const messages = [...messageBatchRef.current];
    messageBatchRef.current = [];
    startTransition(() => {
      messages.forEach(msg => dispatch({ type: 'ADD_MESSAGE', payload: msg }));
    });
  }
}, [/* trigger somehow */]);
```

**Pros**: Simpler, more predictable
**Cons**: May cause performance issues with high message volume

### Option 2: External Event Bus

Move the message queue entirely outside React using a simple EventEmitter pattern:

```typescript
// Outside React component
const messageQueue = new EventEmitter();

// In component
useEffect(() => {
  const handler = (msg) => dispatch({ type: 'ADD_MESSAGE', payload: msg });
  messageQueue.on('message', handler);
  return () => messageQueue.off('message', handler);
}, []);
```

**Pros**: Completely decoupled from React lifecycle
**Cons**: More architectural change

### Option 3: Disable React StrictMode

If the issue is purely StrictMode double-mounting:

```typescript
// In index.tsx or App.tsx
<React.StrictMode> // Remove this wrapper
  <App />
</React.StrictMode>
```

**Pros**: Immediate fix for development
**Cons**: Doesn't solve production issues, masks potential bugs

## Key Lessons Learned

1. **RAF + React Lifecycle = Complex**: requestAnimationFrame doesn't play nicely with React's mount/unmount cycles
2. **Refs Persist Across Mounts**: `useRef` values survive unmount/remount in StrictMode
3. **Cleanup is Critical**: Always reset ALL state in cleanup, including queues
4. **Logging is Essential**: Granular console logs are the only way to debug timing issues
5. **StrictMode is Your Friend**: It surfaces real concurrency bugs that will hit production

## Testing Protocol

After each fix:

1. **Fresh Load**: Open app, start scenario → Should work
2. **Reload**: Refresh page, start scenario → Should work
3. **Multiple Reloads**: Repeat 3-5 times → Should always work
4. **Check Logs**: Verify watchdog is running, RAF is firing
5. **Monitor Performance**: Ensure no memory leaks or accumulating timers

## The "RAM Survives" Mystery Explained 🧠

### What You THINK Is Happening
You think: "I reload the page → RAM should be cleared → Everything starts fresh"

### What's ACTUALLY Happening
You're NOT doing a full page reload! You're experiencing **React StrictMode double-mounting**!

```typescript
// index.tsx
<React.StrictMode>  // ← THIS IS THE "CULPRIT"
  <App />
</React.StrictMode>
```

**React StrictMode in development intentionally**:
1. Mounts component
2. Immediately unmounts it
3. Mounts it again

This happens EVERY TIME a component mounts, with NO page reload!

### Why This Looks Like "RAM Survives"

During StrictMode's mount → unmount → mount cycle:

**What Gets Preserved** (React's internal bookkeeping):
- ✅ `useRef` values persist between unmount and remount
- ✅ `useState` lazy initializers don't re-run
- ✅ Module-level JavaScript stays in memory
- ✅ Browser APIs continue running

**What Gets Cancelled** (cleanup functions run):
- ❌ `requestAnimationFrame` callbacks cancelled
- ❌ Event listeners removed
- ❌ Timers cleared
- ❌ Network requests aborted

### The Deadly Mismatch

```typescript
// FIRST mount
isScheduledRef.current = true;  // Ref created
schedulerRafRef.current = requestAnimationFrame(...);  // RAF scheduled

// StrictMode UNMOUNT (cleanup runs)
cancelAnimationFrame(schedulerRafRef.current);  // RAF cancelled
// BUT isScheduledRef.current STILL = true!  // ← React preserves ref!

// StrictMode REMOUNT
// New messages arrive
if (!isScheduledRef.current) {  // Checks old value (true)!
  // This code never runs!
}
// No RAF is scheduled!
```

### Why useRef Persists But RAF Doesn't

React preserves refs during StrictMode to:
1. Simulate real-world component reuse patterns
2. Catch bugs where you assume fresh state
3. Force proper cleanup in useEffect

But browser APIs (RAF, timers, listeners) are cancelled because:
1. Cleanup functions run on unmount
2. Browser doesn't care about React's internal bookkeeping
3. RAF callbacks are cancelled, but ref memory is NOT cleared

### The Fix

Move the ref reset to `useLayoutEffect` cleanup, which runs BEFORE remount:

```typescript
useLayoutEffect(() => {
  return () => {
    isScheduledRef.current = false;  // Reset BEFORE remount!
  };
}, []);
```

Now the ref is clean when the component remounts!

## Root Cause IDENTIFIED! 🎯

**The Bug**: `isScheduledRef.current` persists across StrictMode unmount/remount cycles while RAF is cancelled!

### The Deadly Sequence

1. **First Mount**: 
   - Messages arrive
   - `scheduleProcessing()` called
   - `isScheduledRef.current = true`
   - RAF scheduled

2. **StrictMode Unmount**:
   - RAF cancelled via `cancelAnimationFrame()`
   - **BUT** `isScheduledRef.current` stays `true` (refs persist!)

3. **Second Mount**:
   - `useLayoutEffect` runs, sets ready state
   - NEW messages arrive
   - `scheduleProcessing()` called
   - **Checks `isScheduledRef.current`** → sees `true`!
   - Logs "Scheduler already running, skipping"
   - **NO NEW RAF IS SCHEDULED!**

4. **Later**:
   - `useEffect` cleanup finally runs
   - Resets `isScheduledRef.current = false`
   - **Too late!** Messages already queued, no scheduler running

### Why This Happened

React refs (`useRef`) persist their values across unmount/remount cycles in StrictMode. This is normally useful, but deadly when the ref tracks the state of a **cancelled browser API call** (requestAnimationFrame).

The cleanup that reset `isScheduledRef.current = false` was in a `useEffect` cleanup, which runs AFTER `useLayoutEffect` (where ready state is set and messages can arrive).

### The Fix

Move the `isScheduledRef.current = false` reset to the **`useLayoutEffect` cleanup**, which runs BEFORE the component remounts:

```typescript
useLayoutEffect(() => {
  // ... setup ...
  return () => {
    isMountedRef.current = false;
    isScheduledRef.current = false; // ← Reset BEFORE remount!
  };
}, []);
```

Now the cleanup order is:
1. `useLayoutEffect` cleanup: Reset scheduler flag
2. Component remounts  
3. `useLayoutEffect` setup: Set ready state
4. Messages arrive
5. `scheduleProcessing()` sees `false` flag, schedules new RAF ✅

## Second Issue Discovered: Event Listener Accumulation (3rd Reload Freeze)

### The Pattern

After fixing the RAF scheduler issue:
- ✅ 1st reload: Works
- ✅ 2nd reload: Works  
- ❌ 3rd reload: **CPU spike, browser tab freezes**

### The Root Cause

**Event listeners were accumulating on each reload!**

Console logs showed:
```
[ScenarioEngine] [INFO] Subscribed to DotBot events for automatic response capture
[App] ScenarioEngine dependencies initialized
...
[ScenarioEngine] [INFO] Subscribed to DotBot events for automatic response capture  ← AGAIN!
```

By the 3rd reload, there were 3+ event listeners registered, each triggering React state updates in response to EVERY event, causing a microtask queue explosion.

### Why It Happened

**The Lifecycle Issue**:

1. `useScenarioEngine` hook has dependencies: `[engine, dotbot, queryEntityBalance]`
2. When `dotbot` changes (on reload), the effect re-runs
3. **Each run adds a NEW `handleEvent` closure as a listener** (new function reference)
4. Cleanup runs: `engine.removeEventListener(handleEvent)` + `engine.unsubscribeFromDotBot()`
5. Then `setupScenarioEngineDependencies` runs AGAIN: `engine.subscribeToDotBot(dotbot)`
6. Result: **Listeners accumulate but DotBot resubscribes!**

**The Accumulation Math**:
```
Load 1: 1 listener to ScenarioEngine + 1 subscription to DotBot = OK
Load 2: 2 listeners + 1 subscription (idempotent) = Slower but OK
Load 3: 3 listeners × N events × React updates = CPU EXPLOSION 💥
```

### The Fixes Applied

**1. Idempotent DotBot Subscription** (`ScenarioEngine.ts`):

```typescript
subscribeToDotBot(dotbot: DotBot): void {
  // IDEMPOTENT: If already subscribed to this exact DotBot instance, skip
  if (this.dotbot === dotbot && this.dotbotEventListener) {
    this.log('info', 'Already subscribed to this DotBot instance, skipping duplicate subscription');
    return;  // ← Early exit prevents multiple subscriptions
  }
  
  // Unsubscribe from previous DotBot if any
  if (this.dotbot && this.dotbotEventListener) {
    this.log('info', 'Unsubscribing from previous DotBot before subscribing to new one');
    this.dotbot.removeEventListener(this.dotbotEventListener);
    this.dotbotEventListener = null;
  }
  
  this.dotbot = dotbot;
  // ... rest of subscription logic
}
```

**2. Removed DotBot Unsubscribe from Hook Cleanup** (`useScenarioEngine.ts`):

```typescript
return () => {
  console.log('[useScenarioEngine] Cleaning up event listener');
  engine.removeEventListener(handleEvent);
  // Note: Don't unsubscribe from DotBot here - that's managed by App component
  // Unsubscribing here causes issues when this hook re-runs on dotbot changes
};
```

**Rationale**: Let the App component (which creates both `scenarioEngine` and `dotbot`) manage the DotBot subscription lifecycle, not the hook that re-runs on dependencies.

**3. Added Listener Count Logging** (`ScenarioEngine.ts`):

```typescript
addEventListener(listener: ScenarioEngineEventListener): void {
  this.eventListeners.add(listener);
  console.log(`[ScenarioEngine] Event listener added, total listeners: ${this.eventListeners.size}`);
  
  // Guard: Warn if too many listeners (indicates accumulation bug)
  if (this.eventListeners.size > 2) {
    console.error(`[ScenarioEngine] ⚠️ WARNING: ${this.eventListeners.size} event listeners registered! This indicates listener accumulation and will cause performance issues.`);
  }
}

removeEventListener(listener: ScenarioEngineEventListener): void {
  const wasDeleted = this.eventListeners.delete(listener);
  console.log(`[ScenarioEngine] Event listener removed (found: ${wasDeleted}), remaining listeners: ${this.eventListeners.size}`);
}
```

**Rationale**: Provides visibility into listener accumulation. Expected count is 1-2 max (one from `useScenarioEngine`, possibly one internal).

## Status

**Current State**: Two fixes applied:
1. ✅ RAF scheduler flag reset in `useLayoutEffect` cleanup
2. ✅ Event listener accumulation prevention via idempotent subscriptions

**Browser Compatibility**:
- ✅ **Chromium/Chrome**: Works correctly after fixes (tested with 5+ reloads)
- ❌ **Firefox**: Still freezes on reload - different underlying issue
  - Likely Firefox-specific RAF behavior or React StrictMode interaction
  - Watchdog may not be running or detecting stuck state
  - Requires separate investigation

**Testing Results (Chromium)**:
- ✅ RAF fires immediately after messages queued
- ✅ Listener count stays constant (1-2)
- ✅ No CPU spike on 3rd+ reload
- ✅ Scenarios run smoothly on every reload

**Remaining Issues**:
1. Firefox-specific freeze (low priority - marked as low-impact)
2. ScenarioEngine only works in already-started conversations (doesn't start new conversations)

## How State Survives Page Refresh (The "Impossible" Mystery Solved)

The user asked: "How can the app survive a refresh?" Here are ALL the persistence mechanisms:

### 1. **LocalStorage - ChatInstanceManager (PRIMARY)**

Location: `lib/dotbot-core/chat/chatInstanceManager.ts`

```typescript
this.storage = config?.storage || new LocalStorageChatStorage();
```

**What persists**:
- All chat instances (ChatInstanceData[])
- Each chat contains:
  - Chat ID
  - Environment (testnet/mainnet)
  - Network (westend/polkadot)
  - Wallet address
  - **ALL conversation messages** (143 items in your logs!)
  - Timestamps, titles, metadata

**How reload works**:
1. Page refreshes
2. Wallet connects
3. `DotBot.create()` called with `stateful: true`
4. Calls `initializeChatInstance()`
5. Queries ChatInstanceManager: `queryInstances({ environment, walletAddress, archived: false })`
6. **Loads existing chat from LocalStorage** if found
7. Otherwise creates new chat

This is why you see `Loaded chat` with 143 conversation items!

### 2. **LocalStorage - Wallet Connection**

The wallet store likely persists:
- Last connected account address
- Account metadata (name, source)
- Connection preferences

This is why the wallet auto-connects on refresh.

### 3. **LocalStorage - Theme & UI Preferences**

Location: `frontend/src/contexts/ThemeContext.tsx`

Persists user preferences like dark/light mode.

### 4. **Backend Session Token**

The authentication token (`session_5FRPxqwZ...`) is likely stored in:
- LocalStorage, or
- SessionStorage, or
- Cookies

This maintains the backend session across refreshes.

### 5. **Browser Back/Forward Cache (bfcache)**

Modern browsers can preserve entire JavaScript heap state for instant back/forward navigation. However, this doesn't survive hard refresh (F5).

### 6. **IndexedDB (Potential - Not Confirmed)**

The `lib/dotbot-core` might use IndexedDB for:
- Large execution results
- Transaction history
- Cached blockchain data

### 7. **What DOESN'T Persist**

- React component state (`useState`, `useReducer`)
- useRef values get reset (but survive StrictMode mount/unmount!)
- Event listeners
- Pending RAF callbacks
- Network connections (WebSocket, RPC connections)
- In-memory caches

### Key Insight

The DotBot library is designed as a **stateful, persistent system** from the ground up. It's not just a UI library - it's a full chat/execution persistence layer that happens to have a React frontend.

When you refresh:
1. ❌ React state is lost
2. ✅ DotBot chat state restored from LocalStorage
3. ✅ Wallet reconnected
4. ✅ All 143 conversation messages reloaded
5. ❌ Active RPC connections recreated
6. ❌ RAF scheduler reinitialized

This is why the conversation survives but the RAF scheduler broke - **different persistence boundaries**!

## The ACTUAL Memory Model (Why It Looks Like "RAM Survives")

### Full Page Reload (F5) - TRUE RAM CLEAR

```
1. Browser discards entire JavaScript heap ← RAM NULLIFIED
2. All module code re-executed from disk
3. All variables reset to initial values
4. localStorage/IndexedDB survive (disk storage)
5. New React render tree created
```

### React StrictMode Double-Mount - FALSE RAM "SURVIVAL"

```
1. JavaScript heap stays intact ← NO RELOAD HAPPENED!
2. Module code NOT re-executed
3. React internal fiber tree updated
4. Component unmounts → cleanup runs
5. Component remounts → setup runs
6. useRef values PRESERVED by React's internal bookkeeping!
```

### What's Actually In Memory During StrictMode

**Module Scope** (truly persists - never reset without page reload):

```typescript
// File: ScenarioEngineContext.tsx
// These live in JavaScript module cache forever (until page reload)
const ScenarioEngineContext = createContext(...);  // Created once when file loads
const initialState = { ... };  // Created once when file loads

// Even if component unmounts 1000 times, these never reset!
```

**Component Instance Scope** (React's tricky behavior):

```typescript
function ScenarioEngineProvider() {
  // During StrictMode mount → unmount → mount:
  
  const messageBatchRef = useRef([]);
  // Unmount: Cleanup runs, but React SAVES this ref!
  // Remount: React REUSES the saved ref!
  
  const isScheduledRef = useRef(false);
  // Value set to `true`
  // Unmount: Cleanup cancels RAF
  // Remount: isScheduledRef STILL has value `true`! ← BUG!
  
  useEffect(() => {
    return () => {
      // This cleanup runs on unmount
      // But it's in useEffect, which runs AFTER useLayoutEffect
      // Messages arrive BEFORE this cleanup!
    };
  }, []);
}
```

### The Mental Model Error

**What You Thought**:
```
Component unmount = RAM cleared = Everything starts fresh
```

**Reality**:
```
Component unmount = Cleanup runs + React preserves bookkeeping for potential remount
```

**StrictMode is NOT a page reload - it's a REHEARSAL!**

React intentionally simulates component reuse patterns to catch bugs like:
- React Router navigation (component unmounts/remounts)
- Modal/dialog open/close (mount/unmount/mount)
- Tab switching with unmount
- Parent component conditional rendering
- Fast Refresh / HMR during development

### Why This Bug Only Appears On "Second Reload"

You're not actually reloading twice. Here's what's happening:

```
Action 1: Open app
├─ Component mounts (StrictMode: mount → unmount → mount)
├─ isScheduledRef starts false
├─ RAF scheduled correctly
└─ Everything works ✅

Action 2: Trigger component remount (navigation/state change)
├─ Component unmounts (cleanup cancels RAF)
├─ isScheduledRef.current = true (stale!)
├─ Component remounts
├─ Messages arrive
├─ Check: isScheduledRef.current === true
├─ Skip RAF scheduling ("already running")
└─ Freeze! ❌
```

### The Fix: Respect React's Lifecycle Timing

```typescript
useLayoutEffect(() => {
  // Setup
  return () => {
    // Cleanup runs BEFORE remount (StrictMode)
    // This is the RIGHT place to reset refs!
    isScheduledRef.current = false;
  };
}, []);

useEffect(() => {
  // Setup
  return () => {
    // Cleanup runs AFTER useLayoutEffect
    // Too late! Messages already arrived!
  };
}, []);
```

## Summary of All Fixes Applied

### Fix #1: RAF Scheduler Flag Reset (ScenarioEngineContext.tsx)

**Problem**: `isScheduledRef.current` persisted across StrictMode unmount/remount while RAF was cancelled

**Solution**: Reset the flag in `useLayoutEffect` cleanup (runs BEFORE remount):

```typescript
useLayoutEffect(() => {
  console.log('[ScenarioEngineContext] Component mounted (useLayoutEffect), setting ready state IMMEDIATELY');
  isMountedRef.current = true;
  setIsReady(true);
  
  return () => {
    console.log('[ScenarioEngineContext] Component unmounting (useLayoutEffect cleanup)');
    isMountedRef.current = false;
    
    // CRITICAL: Reset scheduler flag IMMEDIATELY in useLayoutEffect cleanup
    console.log('[ScenarioEngineContext] Resetting scheduler flag (was:', isScheduledRef.current, ')');
    isScheduledRef.current = false;  // ← THE FIX
  };
}, []);
```

**File**: `frontend/src/components/scenarioEngine/context/ScenarioEngineContext.tsx`

### Fix #2: Idempotent DotBot Subscription (ScenarioEngine.ts)

**Problem**: Multiple calls to `subscribeToDotBot` with same DotBot instance created duplicate subscriptions

**Solution**: Check if already subscribed to the same instance and skip:

```typescript
subscribeToDotBot(dotbot: DotBot): void {
  // IDEMPOTENT: If already subscribed to this exact DotBot instance, skip
  if (this.dotbot === dotbot && this.dotbotEventListener) {
    this.log('info', 'Already subscribed to this DotBot instance, skipping duplicate subscription');
    return;  // ← THE FIX
  }
  
  // Unsubscribe from previous DotBot if any
  if (this.dotbot && this.dotbotEventListener) {
    this.log('info', 'Unsubscribing from previous DotBot before subscribing to new one');
    this.dotbot.removeEventListener(this.dotbotEventListener);
    this.dotbotEventListener = null;
  }
  
  this.dotbot = dotbot;
  // ... rest unchanged
}
```

**File**: `lib/dotbot-core/scenarioEngine/ScenarioEngine.ts` (lines ~235-255)

### Fix #3: Remove DotBot Unsubscribe from Hook (useScenarioEngine.ts)

**Problem**: Hook cleanup was unsubscribing from DotBot on every dependency change, causing issues when `setupScenarioEngineDependencies` resubscribed

**Solution**: Let App component manage DotBot lifecycle:

```typescript
return () => {
  console.log('[useScenarioEngine] Cleaning up event listener');
  engine.removeEventListener(handleEvent);
  // REMOVED: engine.unsubscribeFromDotBot();  ← THE FIX
  // Note: Don't unsubscribe from DotBot here - that's managed by App component
};
```

**File**: `frontend/src/components/scenarioEngine/hooks/useScenarioEngine.ts` (line ~480)

### Fix #4: Event Listener Count Monitoring (ScenarioEngine.ts)

**Problem**: No visibility into listener accumulation

**Solution**: Added logging to track listener count:

```typescript
addEventListener(listener: ScenarioEngineEventListener): void {
  this.eventListeners.add(listener);
  console.log(`[ScenarioEngine] Event listener added, total listeners: ${this.eventListeners.size}`);
  
  if (this.eventListeners.size > 2) {
    console.error(`[ScenarioEngine] ⚠️ WARNING: ${this.eventListeners.size} event listeners registered!`);
  }
}

removeEventListener(listener: ScenarioEngineEventListener): void {
  const wasDeleted = this.eventListeners.delete(listener);
  console.log(`[ScenarioEngine] Event listener removed (found: ${wasDeleted}), remaining: ${this.eventListeners.size}`);
}
```

**File**: `lib/dotbot-core/scenarioEngine/ScenarioEngine.ts` (lines ~1669-1688)

### Fix #5: Previous Fixes (Already in Codebase)

- ✅ Emit events in `queueMicrotask` to prevent blocking
- ✅ Watchdog timer to detect stuck scheduler
- ✅ Scheduler idempotence (reset flag at start of `processMessageBatch`)
- ✅ Comprehensive logging throughout
- ✅ ScenarioEngine cleanup in App.tsx `useEffect`

## Testing Checklist

After applying all fixes:

1. **Rebuild core library**:
   ```bash
   cd lib/dotbot-core && npm run build
   ```

2. **Hard refresh browser**: Ctrl+Shift+R (clear bundle cache)

3. **Test reload cycle**:
   - Load 1: Start scenario → Should work ✅
   - Reload page
   - Load 2: Start scenario → Should work ✅
   - Reload page
   - Load 3: Start scenario → Should work ✅
   - Repeat 2-3 more times

4. **Monitor console logs**:
   - [ ] Listener count stays at 1-2
   - [ ] Watchdog ticks every 2 seconds
   - [ ] RAF callback executes after messages queued
   - [ ] No "⚠️ WARNING" logs about listener accumulation
   - [ ] No CPU spike
   - [ ] Scenarios complete successfully

5. **Check browser DevTools Performance tab**:
   - [ ] No runaway microtask queue
   - [ ] No excessive React renders
   - [ ] CPU usage stays normal

## Firefox-Specific Behavior

### Why Firefox Still Freezes

The fixes work in Chromium but not Firefox, indicating a browser-specific difference:

**Possible Causes**:

1. **RAF Timing Differences**
   - Firefox may handle `requestAnimationFrame` differently during component lifecycle
   - Firefox RAF callbacks might be deferred/throttled differently during page activity
   - Firefox may batch RAF calls more aggressively

2. **React StrictMode Interaction**
   - Firefox's JavaScript engine (SpiderMonkey) vs Chromium's V8 may handle microtasks differently
   - `useLayoutEffect` cleanup timing may differ between browsers
   - RAF cancellation behavior may vary

3. **Watchdog Not Running**
   - `setInterval` may be throttled differently in Firefox
   - Watchdog logs don't appear, suggesting the interval isn't firing
   - Firefox may deprioritize background timers more aggressively

4. **Event Loop Differences**
   - Firefox's event loop implementation differs from Chromium
   - Microtask queue (`queueMicrotask`) behavior may vary
   - RAF scheduling priority relative to other tasks may differ

### Next Steps for Firefox Fix

1. **Verify Watchdog is Running**
   - Add even more aggressive logging to confirm watchdog interval fires
   - Check if `setInterval` is being throttled in Firefox

2. **Try Alternative Scheduling**
   - Replace RAF with `setTimeout(fn, 0)` as fallback
   - Use `Promise.resolve().then()` instead of `queueMicrotask`
   - Try `window.postMessage` pattern for scheduling

3. **Browser Detection Workaround**
   - Detect Firefox and use simpler scheduling (direct state updates)
   - Disable batching in Firefox until proper fix found

4. **Use React's Built-in Scheduling**
   - Replace custom RAF batching with React 18's `startTransition` only
   - Let React handle the scheduling entirely

### Decision: Low Priority

Since the app works in Chromium (most common browser for development) and this is a development-only issue (StrictMode), fixing Firefox is low priority. The underlying architecture changes are sound and prevent the real bugs.

## Additional Resources

- React StrictMode behavior: https://react.dev/reference/react/StrictMode
- requestAnimationFrame lifecycle: https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame
- React useEffect cleanup: https://react.dev/learn/synchronizing-with-effects#how-to-handle-the-effect-firing-twice-in-development
- LocalStorage API: https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
- React useLayoutEffect vs useEffect: https://react.dev/reference/react/useLayoutEffect
- Event listener memory leaks: https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#memory_issues
- Browser RAF differences: https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame#browser_compatibility