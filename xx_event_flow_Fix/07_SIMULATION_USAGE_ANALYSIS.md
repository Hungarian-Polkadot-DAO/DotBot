# Simulation Usage Analysis: Frontend vs ScenarioEngine

## Executive Summary

**Answer: YES, frontend uses simulation, but NO, ScenarioEngine doesn't need it.**

The frontend DotBot instance runs simulation for regular chat operations (ExecutionFlow UI), but ScenarioEngine only uses "live" mode which doesn't require simulation services. However, **ScenarioEngine can trigger DotBot operations that DO use simulation**, creating an indirect dependency.

## Frontend Simulation Usage

### ✅ **Regular DotBot Chat Uses Simulation - CLIENT-SERVER ARCHITECTURE**

**Location:** `frontend/src/App.tsx:341-361`

```typescript
// Frontend rebuilds ExecutionArray from plan and runs simulation
if (chatResult.plan && dotbot) {
  console.log('[App] Rebuilding ExecutionArray from plan and running simulation on frontend');
  await (dotbot as any).prepareExecution(chatResult.plan, executionId, false);
  // This triggers simulation CLIENT which calls BACKEND SERVER
}
```

**Architecture: Client-Server**

1. **Frontend (Client):**
   - Uses `chopsticksClient.ts` - lightweight HTTP client
   - Makes HTTP POST requests to backend `/api/simulation/simulate`
   - Shows status: "Simulating transaction on server..." (see `chopsticksClient.ts:172`)

2. **Backend (Server):**
   - Runs actual Chopsticks simulation on server
   - Handles all heavy computation
   - Returns results to frontend

3. **Configuration:**
   - Backend config: `backendSimulation: false` (see `lib/dotbot-express/src/sessionManager.ts:381`)
   - Backend DotBot: Returns execution plan only, skips orchestration
   - Frontend DotBot: Rebuilds ExecutionArray and calls simulation CLIENT
   - Simulation CLIENT: Makes HTTP request to backend simulation server

**Purpose:**
- Shows simulation status in ExecutionFlow UI
- Validates transactions before user approval
- Provides preview of transaction effects
- Catches errors early

**When It Runs:**
- After backend returns execution plan
- Frontend DotBot instance rebuilds ExecutionArray
- Calls `prepareExecution()` which triggers simulation CLIENT
- **Dynamic import happens here** ← CRITICAL
- Client makes HTTP request to backend server
- Backend server runs actual simulation
- Results returned to frontend

**Current Setup:**
- `stateful: false` (SESSION_SERVER_MODE)
- `backendSimulation: false` (frontend orchestrates, backend simulates)
- Result: **Backend returns plan, frontend orchestrates, backend simulates via HTTP**

### ✅ **ExecutionFlow UI Depends on Simulation**

**Files:**
- `frontend/src/components/execution-flow/simulationUtils.ts`
- `frontend/src/components/execution-flow/components/SimulationStatus.tsx`
- `frontend/src/components/execution-flow/components/SimulationStatusLine.tsx`

**Purpose:**
- Display simulation progress
- Show simulation results
- Indicate simulation phases (initializing, simulating, complete, error)
- Calculate simulation statistics

**Dependency:**
- UI components check `item.simulationStatus` to render status
- Without simulation, these components would show no status
- But they gracefully handle missing simulation status

---

## ScenarioEngine Simulation Usage

### ❌ **ScenarioEngine Does NOT Use Simulation**

**Evidence:**

1. **Mode Selector Shows Only "Live" Mode Active:**
   ```typescript
   // frontend/src/components/scenarioEngine/components/ModeSelector.tsx
   const MODE_TITLES: Record<ExecutionMode, string> = {
     synthetic: 'Synthetic: DISABLED - TODO: Requires DotBot API mocking',
     emulated: 'Emulated: DISABLED - TODO: Requires DotBot reconnection to Chopsticks',
     live: 'Live: Real Westend testnet (actual transactions) - READY',
   };
   ```

2. **ScenarioEngine Only Uses "Live" Mode:**
   - Creates real test entities
   - Funds accounts on real testnet
   - Executes real transactions
   - **No simulation needed** - uses actual chain

3. **No Simulation Code in ScenarioEngine:**
   - ScenarioEngine doesn't import simulation services
   - Doesn't call `prepareExecution()` directly
   - Doesn't use Chopsticks
   - Only orchestrates DotBot operations

---

## The Indirect Dependency Problem

### 🔴 **ScenarioEngine → DotBot → Simulation Client → Backend Server**

**The Chain:**

```
ScenarioEngine.runScenario()
  → Injects prompts to DotBot
  → DotBot.chat() processes prompt
  → Backend returns execution plan
  → Frontend DotBot.prepareExecution() ← TRIGGERS SIMULATION CLIENT
  → ExecutionSystem.executeBatch()
  → await import('../services/simulation') ← DYNAMIC IMPORT ON FRONTEND
  → await isChopsticksAvailable() ← HTTP REQUEST (5s timeout) ← BLOCKS HERE
  → Blocks JavaScript thread while waiting for HTTP response
  → React can't process ScenarioEngineContext messages
  → Messages queue up, then burst → UI FREEZE
```

**Key Points:**
1. **Simulation work runs on backend server** (via HTTP POST to `/api/simulation/simulate`)
2. **But availability check runs on frontend** (`isChopsticksAvailable()` makes HTTP GET with 5s timeout)
3. **Dynamic import loads client code** (lightweight, but includes the availability check)
4. **The HTTP request blocks the thread** while waiting for server response
5. **This is why it freezes** - not the simulation itself, but the availability check!

**Why This Happens:**

1. **ScenarioEngine triggers DotBot operations:**
   - Scenarios inject prompts into DotBot's chat
   - DotBot processes prompts like normal chat
   - Backend returns execution plan
   - Frontend handles execution plans the same way as regular chat

2. **Frontend orchestrates simulation (client-server):**
   - `App.tsx` always calls `prepareExecution()` when plan is received
   - This happens for BOTH regular chat AND scenario-triggered chat
   - No distinction between scenario and regular execution
   - Frontend uses simulation CLIENT (not server directly)

3. **Dynamic import + availability check blocks thread:**
   - `prepareExecution()` → `ExecutionSystem.executeBatch()`
   - `executeBatch()` → `await import('../services/simulation')` ← Loads client code
   - `isChopsticksAvailable()` → `fetch('/api/simulation/health')` ← **HTTP REQUEST WITH 5s TIMEOUT**
   - **Blocks JavaScript thread while waiting for HTTP response**
   - React can't process ScenarioEngineContext messages during HTTP wait
   - Messages queue up, then burst when HTTP completes → freeze

**The Real Problem:**
- Not the simulation work (that's on backend)
- Not the dynamic import itself (client code is lightweight)
- **The `isChopsticksAvailable()` HTTP health check** that blocks for up to 5 seconds!

---

## Is Simulation Needed for ScenarioEngine?

### **Direct Answer: NO**

**ScenarioEngine doesn't need simulation because:**
- ✅ Only uses "live" mode (real transactions)
- ✅ Doesn't need to preview transaction effects
- ✅ Doesn't need to validate before execution
- ✅ Real transactions are the test

### **Indirect Answer: YES (Currently)**

**But simulation runs anyway because:**
- ❌ Frontend always runs simulation for execution plans
- ❌ No way to distinguish scenario-triggered plans
- ❌ ScenarioEngine uses same DotBot instance as regular chat
- ❌ Same code path triggers simulation

---

## Solutions

### 🟢 **Option 1: Skip Simulation for ScenarioEngine (RECOMMENDED)**

**Approach:**
Add a flag to skip simulation when execution is triggered by ScenarioEngine.

**Implementation:**
```typescript
// In App.tsx, detect if execution is from scenario
const isScenarioExecution = /* check if from ScenarioEngine */;

if (chatResult.plan && dotbot && !isScenarioExecution) {
  // Only run simulation for regular chat, not scenarios
  await (dotbot as any).prepareExecution(chatResult.plan, executionId, false);
}
```

**Benefits:**
- ✅ Eliminates dynamic import for ScenarioEngine
- ✅ Eliminates `isChopsticksAvailable()` HTTP check
- ✅ Faster scenario execution
- ✅ No UI freeze from availability check
- ✅ ScenarioEngine doesn't need simulation anyway

**Drawbacks:**
- ⚠️ Need to track execution source
- ⚠️ ScenarioEngine execution won't show simulation status (but doesn't need it)

### 🟡 **Option 2: Preload and Cache Availability Check**

**Approach:**
Preload simulation services and cache `isChopsticksAvailable()` result during initialization.

**Implementation:**
```typescript
// In createDotBotInstance or DotBot.create()
// Preload simulation services
const simulationModule = await import('@dotbot/core/services/simulation').catch(() => null);
if (simulationModule) {
  // Check availability once during init (not during execution)
  simulationModule.isChopsticksAvailable().then(available => {
    // Cache result for later use
    window.__chopsticksAvailable = available;
  });
}

// In ExecutionSystem, use cached result
const available = window.__chopsticksAvailable ?? await isChopsticksAvailable();
```

**Benefits:**
- ✅ Import happens once during initialization
- ✅ Availability check happens once (not during execution)
- ✅ Cached result eliminates HTTP blocking during execution
- ✅ No blocking during time-sensitive execution

**Drawbacks:**
- ⚠️ Still loads simulation even if not needed
- ⚠️ Adds initialization time
- ⚠️ Availability might change (server goes down/up)

### 🟡 **Option 3: Make Availability Check Non-Blocking**

**Approach:**
Don't await the availability check - proceed optimistically and handle errors gracefully.

**Implementation:**
```typescript
// Instead of blocking await
const { isChopsticksAvailable, simulateSequentialTransactions } = await import('../services/simulation');
const chopsticksAvailable = await isChopsticksAvailable(); // ← BLOCKS HERE

// Non-blocking approach
const simulationModule = await import('../services/simulation');
// Don't await - proceed optimistically
let chopsticksAvailable = false;
simulationModule.isChopsticksAvailable().then(available => {
  chopsticksAvailable = available;
  // Update state if needed
});
// Proceed with simulation attempt (will fail gracefully if server unavailable)
```

**Benefits:**
- ✅ Doesn't block thread waiting for HTTP response
- ✅ Proceeds optimistically
- ✅ Handles errors gracefully

**Drawbacks:**
- ⚠️ More complex error handling
- ⚠️ May attempt simulation when server unavailable
- ⚠️ Requires refactoring ExecutionSystem

---

## Recommendation

### **Best Solution: Skip Simulation for ScenarioEngine**

**Why:**
1. ✅ ScenarioEngine doesn't need simulation (live mode only)
2. ✅ Eliminates the root cause of freeze (dynamic import + HTTP availability check)
3. ✅ Simplest implementation (just skip `prepareExecution` for scenarios)
4. ✅ Faster scenario execution
5. ✅ No impact on regular chat (still gets simulation)
6. ✅ Eliminates blocking HTTP request that freezes UI

**Implementation Steps:**

1. **Track execution source:**
   ```typescript
   // In ScenarioEngine, mark execution as scenario-triggered
   // Pass flag through DotBot events or execution metadata
   ```

2. **Skip simulation in App.tsx:**
   ```typescript
   // Check if execution is from scenario
   const isFromScenario = executionMessage.metadata?.fromScenario;
   
   if (chatResult.plan && dotbot && !isFromScenario) {
     await (dotbot as any).prepareExecution(chatResult.plan, executionId, false);
   }
   ```

3. **Alternative: Skip for all ScenarioEngine overlay:**
   ```typescript
   // If ScenarioEngine is enabled, skip simulation
   if (chatResult.plan && dotbot && !scenarioEngineEnabled) {
     await (dotbot as any).prepareExecution(chatResult.plan, executionId, false);
   }
   ```

---

## Conclusion

**Frontend uses simulation:** ✅ YES - via client-server architecture (client makes HTTP requests to backend)

**Simulation runs on:** ✅ BACKEND SERVER (not frontend)

**ScenarioEngine needs simulation:** ❌ NO - only uses live mode

**The Real Problem:**
- Not the simulation work itself (runs on backend)
- Not the dynamic import (loads lightweight client code)
- **The `isChopsticksAvailable()` HTTP health check** that blocks the frontend thread for up to 5 seconds while waiting for server response

**Root Cause:**
```
Dynamic import → Loads client code → isChopsticksAvailable() → 
HTTP GET /api/simulation/health (5s timeout) → 
BLOCKS JavaScript thread → React can't process → Messages queue → FREEZE
```

**Solution:** Skip simulation for ScenarioEngine-triggered executions. This eliminates both the dynamic import AND the blocking HTTP availability check, solving the freeze issue while maintaining simulation for regular chat where it's actually needed.
