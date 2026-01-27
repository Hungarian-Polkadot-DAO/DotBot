# ScenarioEngine Architecture

## System Overview

ScenarioEngine orchestrates scenario execution by:
1. Injecting prompts into Chat UI
2. Subscribing to DotBot events
3. Building execution reports
4. Emitting events for UI updates

## Component Hierarchy

```
App.tsx
  └─► ScenarioEngineProvider (Context)
      └─► ScenarioEngineOverlay
          ├─► useScenarioEngine hook
          │   └─► Subscribes to events → dispatches to context
          └─► ReportTab (displays messages)
```

## Key Components

### ScenarioEngine
- Orchestrates scenario execution
- Subscribes to DotBot events
- Builds report via `appendToReport()`
- Emits `report-update` events
- **Optimizations**: Batched `appendToReport()` calls, deferred heavy work via `queueMicrotask`

### ScenarioEngineContext
- Centralized state management with `useReducer`
- Manages `reportMessages`, `executionPhase`, `statusMessage`, `runningScenario`, `entities`
- Batched message updates via `requestAnimationFrame` + `startTransition`
- Processes messages in chunks of 20 with delays

### useScenarioEngine Hook
- Subscribes ScenarioEngine to DotBot
- Listens to ScenarioEngine events
- Creates `ReportMessageData` objects
- Calls context's `addMessage` (batched)
- No local state - all state in context

### ReportTab
- Displays report messages
- Receives `messages` prop from context
- Optimized with `useMemo`

## Event Flow

```
ScenarioEngine.appendToReport(text)
  └─► emit('report-update')
      └─► useScenarioEngine.handleEvent()
          └─► ScenarioEngineContext.addMessageBatched()
              └─► Batched via requestAnimationFrame + startTransition
                  └─► ReportTab receives messages
```

## Event Types

### ScenarioEngine Events
- `report-update` - Report content appended (batched)
- `report-clear` - Report cleared (can be silent)
- `phase-start`, `phase-update` - Execution phases
- `step-start`, `step-complete` - Step execution
- `scenario-complete` - Scenario finished
- `state-change`, `dotbot-activity`, `log` - State/activity tracking
- `inject-prompt` - Inject prompt into ChatInput
- `error` - Error occurred

### DotBot Events (subscribed by ScenarioEngine)
- `chat-started`, `chat-complete`, `chat-error`
- `user-message-added`, `bot-message-added`
- `execution-message-added`, `execution-message-updated`

**Note**: Documentation uses kebab-case. Implementation uses enum constants converted to strings.

## Performance Optimizations

1. **Batched Message Updates**: `requestAnimationFrame` → 50ms delay → chunks of 20 → `startTransition`
2. **Deferred Heavy Work**: All synchronous work in `runScenario()` deferred via `queueMicrotask`
3. **Silent Report Clearing**: `clearReport(silent: true)` avoids unnecessary renders
4. **Batched Report Updates**: Multiple `appendToReport()` calls combined into single events
