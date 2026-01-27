# Event Flow Sequences

## Normal Execution Flow

### Step 1: Prompt Injection
```
ScenarioExecutor.executePromptStep()
  ├─► emit('step-start') → appendToReport() → emit('report-update')
  ├─► emit('inject-prompt') → Chat fills input
  └─► await waitForResponseReceived()
```

### Step 2: DotBot Processing
```
DotBot.chat(message)
  ├─► emit('chat-started') → appendToReport() → emit('report-update')
  ├─► emit('user-message-added') → appendToReport() → emit('report-update')
  ├─► emit('execution-message-added') → appendToReport() → emit('report-update')
  ├─► emit('execution-message-updated') → appendToReport() → emit('report-update')
  └─► emit('chat-complete') → appendToReport() → notifyResponseReceived()
```

### Step 3: Step Completion
```
ScenarioExecutor
  └─► emit('step-complete') → appendToReport() → emit('report-update')
```

## Report Update Flow

```
ScenarioEngine.appendToReport(text)
  └─► emit('report-update')
      └─► useScenarioEngine.handleEvent()
          └─► Creates ReportMessageData
              └─► ScenarioEngineContext.addMessageBatched()
                  ├─► Accumulates in messageBatchRef
                  └─► requestAnimationFrame → setTimeout(50ms)
                      └─► Split into chunks of 20
                          └─► Process with startTransition
                              └─► ReportTab receives messages
```

### Batching Details
- Messages accumulate in `messageBatchRef`
- `requestAnimationFrame` schedules processing
- 50ms delay via `setTimeout`
- Split into chunks of 20
- First chunk processed immediately
- Remaining chunks with 30ms delays
- All wrapped in `startTransition`

## Scenario Start Flow

```
User clicks "Play"
  ├─► setActiveTab('report') [startTransition]
  ├─► setRunningScenario(name) [startTransition]
  └─► setTimeout(100ms)
      └─► engine.runScenario(scenario)
          └─► queueMicrotask() [defer heavy work]
              ├─► clearReport(silent: true)
              └─► emit('phase-start') + batched report update
```

## Performance Characteristics

- **Message Batching**: Chunks of 20, 50ms initial delay, 30ms between chunks
- **Deferred Work**: All synchronous work deferred via `queueMicrotask`
- **Result**: No UI freeze, smooth message appearance, non-blocking updates
