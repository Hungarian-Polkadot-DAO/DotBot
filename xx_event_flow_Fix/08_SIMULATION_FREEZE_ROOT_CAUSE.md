# Simulation Freeze Root Cause - Corrected Analysis

## Key Correction

**Previous misunderstanding:** Thought simulation ran on frontend  
**Actual architecture:** Simulation runs on **backend server**, frontend uses **client-server architecture**

## The Real Problem

### ✅ **Simulation Work: Runs on Backend**
- Backend server (`@dotbot/express`) runs actual Chopsticks simulation
- Frontend makes HTTP POST to `/api/simulation/simulate`
- Message shown: "Simulating transaction on server..." (from `chopsticksClient.ts:172`)

### ❌ **The Blocker: Availability Check on Frontend**

**Location:** `lib/dotbot-core/services/simulation/chopsticksClient.ts:60-114`

```typescript
export async function isChopsticksAvailable(): Promise<boolean> {
  const serverUrl = getServerUrl();
  const healthUrl = `${serverUrl}/api/simulation/health`;
  
  const response = await fetch(healthUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(5000), // ← 5 SECOND TIMEOUT
    // ...
  });
  // ...
}
```

**The Problem:**
- Dynamic import loads simulation client code (lightweight)
- `isChopsticksAvailable()` is called immediately after import
- Makes HTTP GET request to `/api/simulation/health`
- **Blocks JavaScript thread for up to 5 seconds** waiting for response
- React can't process ScenarioEngineContext messages during this time
- Messages queue up, then burst when HTTP completes → **UI FREEZE**

## Execution Flow (Corrected)

```
ScenarioEngine.runScenario()
  → DotBot.chat() processes prompt
  → Backend returns execution plan
  → Frontend DotBot.prepareExecution()
  → ExecutionSystem.executeBatch()
  → await import('../services/simulation') ← Loads client code (lightweight)
  → await isChopsticksAvailable() ← HTTP GET /api/simulation/health (5s timeout) ← BLOCKS HERE
  → Blocks JavaScript thread waiting for HTTP response
  → React can't process ScenarioEngineContext messages
  → Messages accumulate in messageBatchRef
  → HTTP completes → All messages process at once → UI FREEZE
```

## Why It's Inconsistent

The freeze happens inconsistently because:

1. **Server Response Time:**
   - Fast response (< 100ms) → No noticeable freeze
   - Slow response (1-5s) → Noticeable freeze
   - Timeout (5s) → Long freeze

2. **Network Conditions:**
   - Good network → Fast response → No freeze
   - Slow network → Slow response → Freeze
   - Network issues → Timeout → Long freeze

3. **Server State:**
   - Server running → Fast health check → No freeze
   - Server starting → Slow health check → Freeze
   - Server down → 5s timeout → Long freeze

4. **Module Cache:**
   - Cached → Fast import → Less noticeable
   - Uncached → Slower import → More noticeable

## The Fix

### **Skip Simulation for ScenarioEngine**

Since ScenarioEngine:
- ✅ Only uses "live" mode (real transactions)
- ✅ Doesn't need simulation validation
- ✅ Doesn't need to preview transaction effects

**Solution:** Skip `prepareExecution()` for scenario-triggered executions.

This eliminates:
- ✅ Dynamic import of simulation client
- ✅ `isChopsticksAvailable()` HTTP health check
- ✅ 5-second potential blocking
- ✅ UI freeze

## Summary

**Simulation runs on:** ✅ Backend server (via HTTP)

**The freeze is caused by:** ❌ Frontend availability check (`isChopsticksAvailable()` HTTP request)

**Not caused by:** 
- ❌ Simulation work itself (runs on backend)
- ❌ Dynamic import (loads lightweight client)
- ❌ Heavy computation (all on backend)

**Root cause:** The HTTP health check blocks the JavaScript thread for up to 5 seconds, preventing React from processing ScenarioEngineContext messages.
