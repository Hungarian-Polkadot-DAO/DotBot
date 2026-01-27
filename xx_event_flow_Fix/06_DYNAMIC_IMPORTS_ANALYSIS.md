# Dynamic Imports Analysis: Connection to ScenarioEngine Freeze Issues

## Executive Summary

This analysis examines the relationship between dynamic imports (`import()`) in the codebase and the ScenarioEngine UI freeze/lifecycle leak issues. **Several critical connections have been identified** that could contribute to the inconsistent freezing behavior.

## Critical Findings

### 🔴 **HIGH RISK: Simulation Service Dynamic Imports During Execution**

**Location:** `lib/dotbot-core/executionEngine/system.ts:387` and `lib/dotbot-core/agents/baseAgent.ts:265`

**The Problem:**
```typescript
// This happens DURING scenario execution, not at initialization
const { isChopsticksAvailable, simulateSequentialTransactions } = await import('../services/simulation');
const chopsticksAvailable = await isChopsticksAvailable();
```

**Why This Causes Freezes:**

1. **Execution Flow:**
   ```
   ScenarioEngine.runScenario()
     → DotBot.chat() / executeTransaction()
       → ExecutionSystem.executeBatch() / baseAgent.executeTransaction()
         → await import('../services/simulation')  ← DYNAMIC IMPORT DURING EXECUTION
         → await isChopsticksAvailable()  ← POTENTIALLY SLOW CHECK
   ```

2. **Timing Issues:**
   - Dynamic import happens **synchronously during transaction execution**
   - `isChopsticksAvailable()` may make network requests or check server availability
   - This blocks the execution thread **while React is trying to render updates**
   - If this happens during initial page load or scenario start, it can freeze the UI

3. **Race Condition:**
   - If multiple transactions execute simultaneously, multiple dynamic imports occur
   - No coordination between imports
   - Could cause cascading delays

**Connection to ScenarioEngineContext:**
- ScenarioEngine emits events during execution
- Events trigger `addMessageBatched()` in ScenarioEngineContext
- If dynamic import blocks the thread, React can't process batched messages
- Messages queue up, then all fire at once when import completes → UI freeze

---

### 🟡 **MEDIUM RISK: IndexedDB Module-Level State**

**Location:** `lib/dotbot-core/services/simulation/database.ts:54-60`

**The Problem:**
```typescript
// Module-level variable - persists across imports
let idbModule: any = null;
async function getIdbModule() {
  if (!idbModule) {
    idbModule = await import('idb');  // First call triggers import
  }
  return idbModule;
}
```

**Why This Could Cause Issues:**

1. **Module-Level State:**
   - `idbModule` is a module-level variable
   - First call to `getIdbModule()` triggers dynamic import
   - If called during initialization or page load, could block

2. **Browser API Initialization:**
   - IndexedDB requires browser APIs to be ready
   - If called before React mounts, could cause timing issues
   - Browser APIs might not be fully initialized on page reload

3. **Potential Connection:**
   - If simulation database is accessed during scenario initialization
   - Could trigger import before React context is ready
   - Might contribute to inconsistent freezing (only happens when database is accessed)

---

### 🟡 **MEDIUM RISK: Execution Simulator Dynamic Import**

**Location:** `lib/dotbot-core/executionEngine/system.ts:668`

**The Problem:**
```typescript
// Dynamic import happens during transaction execution
const { runSimulation } = await import('./simulation/executionSimulator');
```

**Why This Could Cause Issues:**

1. **Heavy Module:**
   - `executionSimulator.ts` likely contains substantial code
   - Dynamic import could take time to parse and execute
   - Blocks execution thread during import

2. **Timing:**
   - Happens during `executeTransaction()` method
   - If called during scenario start, could block UI
   - No preloading or caching mechanism

---

### 🟢 **LOW RISK: Polkadot Extension Imports**

**Location:** Multiple files importing `@polkadot/extension-dapp`

**Why Lower Risk:**
- Wrapped in `isBrowser()` checks
- Only called when explicitly needed (signing operations)
- Not directly called during scenario execution flow
- Less likely to cause freeze during scenario run

---

## Root Cause Analysis

### The Freeze Pattern

Based on the analysis, here's what likely happens:

1. **Page Reload / Scenario Start:**
   - React mounts, ScenarioEngineContext initializes
   - `isReady` state is `false` initially
   - Messages start queuing

2. **Scenario Execution Begins:**
   - User clicks "Play" or scenario auto-starts
   - DotBot begins processing transactions
   - **Dynamic import of simulation services occurs** ← BLOCKING POINT
   - `isChopsticksAvailable()` check runs (potentially slow)

3. **UI Freeze Occurs:**
   - Dynamic import blocks JavaScript thread
   - React can't process batched messages
   - Messages accumulate in `messageBatchRef`
   - When import completes, all messages process at once
   - UI freezes due to sudden burst of updates

4. **Inconsistency Explained:**
   - If Chopsticks server is available → fast check → no freeze
   - If Chopsticks server is unavailable → slow timeout → freeze
   - If network is slow → slow import → freeze
   - If module is cached → fast import → no freeze

### Why Server Restart Helps

When you restart the dev server (`npm run start`):
- Clears module cache
- Forces fresh imports
- Resets any module-level state
- Changes timing of when imports occur
- May change whether Chopsticks is "available" (server state)

---

## Specific Connections to ScenarioEngineContext

### 1. **Message Batching Interference**

**Problem:**
- ScenarioEngine emits `report-update` events during execution
- Events trigger `addMessageBatched()` in context
- If dynamic import blocks thread, batching can't process
- Messages queue up, then burst when import completes

**Evidence:**
```typescript
// In ScenarioEngineContext.tsx
const addMessageBatched = useCallback((message: ReportMessageData) => {
  messageBatchRef.current.push(message);  // Queues message
  if (!isReady) return;  // Won't process if not ready
  
  // Schedules RAF for processing
  schedulerRafRef.current = requestAnimationFrame(() => {
    processMessageBatch();  // ← This can't run if thread is blocked
  });
}, [isReady, processMessageBatch]);
```

If dynamic import blocks the thread:
- `requestAnimationFrame` callbacks can't execute
- Messages accumulate
- When import completes, all RAF callbacks fire at once
- UI freezes from processing all messages simultaneously

### 2. **Readiness Gate Timing**

**Problem:**
- Context uses `isReady` state to gate processing
- But dynamic imports happen in DotBot/ExecutionSystem
- These are **outside React's control**
- Can block before `isReady` is even set to `true`

**Timeline:**
```
T0: Page loads
T1: ScenarioEngineContext mounts, isReady = false
T2: useEffect sets isReady = true
T3: Scenario starts
T4: DotBot.executeTransaction() called
T5: await import('../services/simulation') ← BLOCKS HERE
T6: Thread blocked, React can't process
T7: Import completes
T8: All queued operations fire at once → FREEZE
```

### 3. **Event Emission During Block**

**Problem:**
- ScenarioEngine emits events during execution
- If execution is blocked by dynamic import, events still queue
- When import completes, events fire rapidly
- Context tries to batch, but too many arrive at once

---

## Recommendations

### 🔴 **CRITICAL: Preload Simulation Services**

**Solution:**
Preload simulation services during ScenarioEngine initialization, not during execution.

```typescript
// In setupScenarioEngineDependencies or ScenarioEngine.initialize()
// Preload simulation services
await import('../services/simulation').catch(() => {
  // Gracefully handle if simulation not available
});
```

**Benefits:**
- Import happens once during initialization
- Not during time-sensitive execution
- Can be done before React context is ready
- Eliminates blocking during scenario execution

### 🟡 **MEDIUM: Cache isChopsticksAvailable Result**

**Solution:**
Cache the result of `isChopsticksAvailable()` check.

```typescript
let chopsticksAvailableCache: boolean | null = null;
let chopsticksCheckPromise: Promise<boolean> | null = null;

export async function isChopsticksAvailable(): Promise<boolean> {
  if (chopsticksAvailableCache !== null) {
    return chopsticksAvailableCache;
  }
  if (chopsticksCheckPromise) {
    return chopsticksCheckPromise;
  }
  chopsticksCheckPromise = checkChopsticks();
  chopsticksAvailableCache = await chopsticksCheckPromise;
  return chopsticksAvailableCache;
}
```

**Benefits:**
- First check happens during initialization
- Subsequent checks are instant
- No blocking during execution

### 🟡 **MEDIUM: Defer Simulation Checks**

**Solution:**
Use `queueMicrotask` or `setTimeout` to defer simulation checks.

```typescript
// Instead of blocking await
await import('../services/simulation');

// Defer to next tick
await new Promise(resolve => queueMicrotask(resolve));
const { isChopsticksAvailable } = await import('../services/simulation');
```

**Benefits:**
- Allows React to process pending updates
- Breaks up blocking work
- Reduces freeze duration

### 🟢 **LOW: Add Timeout to isChopsticksAvailable**

**Solution:**
Add timeout to prevent indefinite blocking.

```typescript
async function isChopsticksAvailable(): Promise<boolean> {
  try {
    const result = await Promise.race([
      checkChopsticks(),
      new Promise<boolean>((resolve) => 
        setTimeout(() => resolve(false), 2000)  // 2s timeout
      )
    ]);
    return result;
  } catch {
    return false;
  }
}
```

**Benefits:**
- Prevents indefinite blocking
- Fails fast if server unavailable
- Reduces freeze duration

---

## Testing Recommendations

### 1. **Test with Slow Network**
- Throttle network in DevTools
- Trigger scenario execution
- Observe if freeze occurs during import

### 2. **Test with Chopsticks Unavailable**
- Disable Chopsticks server
- Trigger scenario execution
- Observe timeout behavior

### 3. **Test with Module Cache Cleared**
- Clear browser cache
- Hard reload page
- Trigger scenario execution
- Compare timing with cached vs uncached

### 4. **Profile Dynamic Imports**
- Use Chrome DevTools Performance tab
- Record during scenario execution
- Identify which imports take longest
- Measure blocking duration

---

## Conclusion

**Primary Suspect:** Dynamic imports of simulation services during scenario execution are the most likely cause of UI freezes. The blocking nature of `await import()` combined with potentially slow `isChopsticksAvailable()` checks creates a perfect storm for UI freezes.

**Secondary Factors:**
- Module-level state in database.ts
- Heavy execution simulator module
- Lack of preloading/caching

**Recommended Action:**
1. **Immediate:** Preload simulation services during initialization
2. **Short-term:** Cache `isChopsticksAvailable()` result
3. **Long-term:** Refactor to avoid dynamic imports during execution

The inconsistency of the freeze (sometimes happens, sometimes not) aligns perfectly with:
- Network timing variations
- Chopsticks server availability
- Module cache state
- Browser API readiness

This analysis strongly suggests that **dynamic imports during execution are the root cause** of the ScenarioEngine freeze issues.
