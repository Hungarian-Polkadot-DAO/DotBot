# Browser Import Prevention - Simulation Services

## Implementation

Prevented dynamic imports of simulation services in the browser to eliminate blocking HTTP availability checks that cause UI freezes.

## Changes Made

### 1. `lib/dotbot-core/executionEngine/system.ts` (Line 387)

**Before:**
```typescript
// Check if Chopsticks is available
const { isChopsticksAvailable, simulateSequentialTransactions } = await import('../services/simulation');
const chopsticksAvailable = await isChopsticksAvailable();
```

**After:**
```typescript
// Check if Chopsticks is available
// NEVER import simulation in browser - prevents blocking HTTP availability check
let isChopsticksAvailable: (() => Promise<boolean>) | null = null;
let simulateSequentialTransactions: any = null;
let chopsticksAvailable = false;

if (typeof window === 'undefined') {
  // Server-only: import simulation services
  const simulationModule = await import('../services/simulation');
  isChopsticksAvailable = simulationModule.isChopsticksAvailable;
  simulateSequentialTransactions = simulationModule.simulateSequentialTransactions;
  chopsticksAvailable = await isChopsticksAvailable();
} else {
  // Browser: simulation unavailable (prevents blocking import)
  this.executionLogger.debug({}, 'Skipping simulation import in browser - prevents blocking availability check');
  chopsticksAvailable = false;
}
```

### 2. `lib/dotbot-core/agents/baseAgent.ts` (Line 265)

**Before:**
```typescript
// Try Chopsticks simulation first (real runtime execution)
try {
  const { simulateTransaction, isChopsticksAvailable } = await import(
    '../services/simulation'
  );
  
  if (await isChopsticksAvailable()) {
    // ... use simulation
  }
} catch (error) {
  chopsticksError = error;
}
```

**After:**
```typescript
// Try Chopsticks simulation first (real runtime execution)
// NEVER import simulation in browser - prevents blocking HTTP availability check
if (typeof window === 'undefined') {
  // Server-only: import simulation services
  try {
    const { simulateTransaction, isChopsticksAvailable } = await import(
      '../services/simulation'
    );
    
    if (await isChopsticksAvailable()) {
      // ... use simulation
    }
  } catch (error) {
    chopsticksError = error;
  }
} else {
  // Browser: simulation unavailable (prevents blocking import)
  // Skip simulation to prevent blocking HTTP availability check
}
```

## Why This Works

### The Problem
1. Dynamic import loads simulation client code
2. `isChopsticksAvailable()` makes HTTP GET to `/api/simulation/health`
3. HTTP request blocks JavaScript thread for up to 5 seconds
4. React can't process ScenarioEngineContext messages
5. Messages queue up, then burst → UI freeze

### The Solution
1. **Import check happens BEFORE import statement**
   - `if (typeof window === 'undefined')` prevents import in browser
   - Import never happens → no module loading → no HTTP check → no blocking

2. **Server-only execution**
   - Simulation imports only happen on backend (Node.js)
   - Frontend never loads simulation module
   - No blocking HTTP availability check

3. **Graceful fallback**
   - Browser code path skips simulation
   - Falls back to `paymentInfo` for fee estimation
   - No errors, just different validation method

## Impact

### ✅ **Eliminates UI Freeze**
- No dynamic import in browser
- No HTTP availability check
- No blocking operations
- React can process messages normally

### ✅ **Maintains Functionality**
- Backend still uses simulation (server-only)
- Frontend falls back to `paymentInfo` (acceptable for ScenarioEngine)
- No breaking changes

### ⚠️ **Trade-offs**
- Frontend DotBot instances won't use simulation
- Only backend DotBot instances can use simulation
- This is acceptable because:
  - ScenarioEngine doesn't need simulation (live mode only)
  - Regular chat can still use simulation via backend
  - Frontend simulation was causing the freeze anyway

## Testing

1. **Browser Environment:**
   - Import should NOT happen
   - Code should skip simulation
   - Fall back to `paymentInfo`
   - No HTTP requests to `/api/simulation/health`

2. **Server Environment:**
   - Import should happen normally
   - Simulation should work as before
   - No changes to backend behavior

## Notes

- The check `typeof window === 'undefined'` is the standard way to detect Node.js vs browser
- This is more reliable than `isBrowser()` because it prevents the import at the statement level
- The import statement itself is conditional, not just the function calls
- This is the minimal, tactical fix as requested
