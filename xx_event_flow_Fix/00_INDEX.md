# ScenarioEngine Event Flow Documentation

## Overview
Documentation for ScenarioEngine event handling and message flow. **Status**: ✅ **RESOLVED** - Render loops and UI freeze issues fixed. Page reload race condition fixed.

## Document Structure

1. **[01_ARCHITECTURE.md](./01_ARCHITECTURE.md)** - System architecture
2. **[02_EVENT_FLOW.md](./02_EVENT_FLOW.md)** - Event flow sequences
3. **[03_ISSUES.md](./03_ISSUES.md)** - Issues and solutions
4. **[04_PAGE_RELOAD_FIX.md](./04_PAGE_RELOAD_FIX.md)** - Page reload UI freeze fix
5. **[05_LIFECYCLE_LEAK_FIXES.md](./05_LIFECYCLE_LEAK_FIXES.md)** - Lifecycle leak prevention fixes
6. **[06_DYNAMIC_IMPORTS_ANALYSIS.md](./06_DYNAMIC_IMPORTS_ANALYSIS.md)** - Dynamic imports analysis and freeze connection
7. **[07_SIMULATION_USAGE_ANALYSIS.md](./07_SIMULATION_USAGE_ANALYSIS.md)** - Simulation usage analysis: Frontend vs ScenarioEngine
8. **[08_SIMULATION_FREEZE_ROOT_CAUSE.md](./08_SIMULATION_FREEZE_ROOT_CAUSE.md)** - Corrected root cause: HTTP availability check blocks UI
9. **[09_BROWSER_IMPORT_PREVENTION.md](./09_BROWSER_IMPORT_PREVENTION.md)** - Browser import prevention implementation

## Quick Reference

### Key Components
- **ScenarioEngine** - Main orchestrator, emits `report-update` events
- **ScenarioEngineContext** - Centralized state with batched updates
- **useScenarioEngine** - React hook that receives events and dispatches to context
- **ReportTab** - Displays report messages

### Event Flow
```
ScenarioEngine.appendToReport(text)
  → emit('report-update')
  → useScenarioEngine.handleEvent()
  → ScenarioEngineContext.addMessageBatched()
  → Batched via requestAnimationFrame + startTransition
  → ReportTab receives messages
```

## Fixes (2024)

**Problem**: UI freeze and render loops during scenario execution.

**Solutions**:
1. Centralized state management (`ScenarioEngineContext` with `useReducer`)
2. Batched message updates (chunks of 20, 50ms delay, `startTransition`)
3. Deferred heavy work (`queueMicrotask` for setup, evaluation, summary)
4. Optimized event emissions (batched `appendToReport()` calls)

See [03_ISSUES.md](./03_ISSUES.md) for details.

## Current Status

✅ Event flow working with batched updates  
✅ Centralized state management  
✅ UI remains responsive  
✅ Messages appear smoothly in batches
