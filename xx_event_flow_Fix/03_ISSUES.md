# Known Issues and Solutions

## ✅ RESOLVED: Render Loops and UI Freeze

### Problem
UI froze for several seconds when starting scenarios, causing render loops.

### Root Causes
1. Scattered state management (multiple `useState` calls)
2. Rapid synchronous event emissions causing excessive re-renders
3. No batching of report-update events
4. Synchronous work in `runScenario()` blocking UI thread

### Solutions

#### 1. Centralized State Management ✅
- Created `ScenarioEngineContext` with `useReducer`
- Single source of truth for all state
- Removed duplicate state from components

#### 2. Batched Message Updates ✅
- Messages accumulate in `messageBatchRef`
- Processed in chunks of 20 with 50ms initial delay
- 30ms delays between chunks
- All wrapped in `startTransition`

#### 3. Deferred Heavy Work ✅
- All synchronous work in `runScenario()` deferred via `queueMicrotask`:
  - Initial setup (validation, dependencies, subscriptions)
  - Evaluation phase (`evaluator.evaluate()`)
  - Summary generation (`generateSummary()`)
- Frontend: Scenario execution deferred by 100ms

#### 4. Optimized Event Emissions ✅
- Multiple `appendToReport()` calls batched into single events
- `clearReport(silent: true)` to avoid unnecessary renders
- All state updates wrapped in `startTransition`

### Results
- ✅ No UI freeze - UI remains responsive
- ✅ No render loops - Batched updates prevent excessive re-renders
- ✅ Smooth message appearance in batches

## Entity Balance Queries

Entity balance queries are optimized with chunked processing (5 entities at a time, 50ms delays, `startTransition`). They should not cause UI freezes.

## Message Batching

Messages are batched via `requestAnimationFrame` + `setTimeout`:
- Accumulate in `messageBatchRef`
- 50ms initial delay
- Split into chunks of 20
- Processed with `startTransition`
