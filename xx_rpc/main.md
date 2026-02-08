# RpcManager Analysis and Solution

## Summary

- **Backend log**: `Resetting health data - only 0/3 endpoints available` and `RPC connections will be lazy-loaded when needed` are expected: health is loaded from storage and reset when too few endpoints are “available” (not recently failed); RPC is intentionally lazy.
- **Frontend error**: `WebSocket is not connected` / `FATAL: Unable to initialize the API` occurs when the first RPC use runs (e.g. `getApi()`, `getBalance()`, chat flow). The failure happens **during** `ApiPromise.create()` (metadata fetch) when the provider has already emitted `connected` but the WebSocket drops or is not yet ready for RPC — a **timing/race** between “connected” and “ready for getMetadata”.

RpcManager logic is correct; the main issue is **stability** of the first connection (provider “connected” vs actually ready, flaky endpoints, no retry for this specific error).

---

## 1. Root cause

### 1.1 Backend: “0/3 endpoints available”

- Source: `lib/dotbot-core/rpcManager/healthTracker.ts` in `loadHealthData()`.
- On startup, health is loaded from storage (FileStorage in backend). If stored data has **most endpoints recently failed** (e.g. `lastFailure` within last 2 minutes), `getOrderedEndpoints()` would return 0. The code then **resets** health so all endpoints are tried again and logs: “Resetting health data - only 0/3 endpoints available”.
- So this is **correct behavior**: we’re clearing stale failure state, not saying “no endpoints exist”. The log can be misleading; see “Suggested improvements” below.

### 1.2 Frontend: “WebSocket is not connected”

- Flow: Wallet connects → `initializeDotBot()` → `createDotBotInstance(..., null)` → `DotBot.create(config)` with new RpcManagers (no preloaded managers). No connection is made at create time (lazy).
- First use of API (e.g. `getApi()`, `getBalance()`, chat that triggers `ensureRpcConnectionsReady`) → `getReadApi()` → `tryConnect(endpoint)`.
- In `tryConnect()`:
  1. `new WsProvider(endpoint)` and listen for `connected`.
  2. On `connected`, call `ApiPromise.create({ provider })`.
  3. Inside `ApiPromise.create()`, Polkadot.js does RPC (e.g. `getMetadata`). If at that moment the WebSocket is disconnected or not yet ready, you get:  
     `RPC-CORE: getMetadata(...): WebSocket is not connected` and  
     `API/INIT: Error: FATAL: Unable to initialize the API: WebSocket is not connected`.

So the bug is **not** “we never connect” but “we sometimes use the provider before it’s stable for RPC”, or the endpoint drops during the metadata fetch. That leads to:

- **Race**: `connected` can fire before the socket is fully ready for RPC.
- **Flakiness**: Public RPCs can accept the connection then drop during metadata fetch.
- **No retry**: One “WebSocket is not connected” and we fail over to the next endpoint (or throw); we don’t retry the same endpoint once.

---

## 2. Is RpcManager working correctly?

- **Design**: Lazy loading, health-based ordering, failover, `getReadApi()` vs `createExecutionSession()`, disconnect/error clearing cache — all consistent with ARCHITECTURE.
- **Health**: Load/save, reset when &lt;30% available, “all filtered out” reset, and ordering logic are correct.
- **tryConnect()**: Timeouts, cleanup, disconnect/error handling, and FATAL/disconnect detection are in place. The only gap is **no retry for “WebSocket is not connected”** and **no small delay after `connected`** before creating the API, which would reduce races.

So: **RpcManager is correct; the issue is stability of the first connection and missing retry/delay for this specific failure.**

---

## 3. Stability issues

| Issue | Where | Impact |
|-------|--------|--------|
| Provider “connected” vs RPC-ready | `RpcManager.tryConnect()` | Race: we call `ApiPromise.create()` as soon as `connected` fires; socket may not be ready for `getMetadata`. |
| No retry for “WebSocket is not connected” | `RpcManager.tryConnect()` | One transient drop during metadata fetch → we fail over or throw; could often succeed on one retry. |
| Public endpoint flakiness | External | Endpoints sometimes drop during metadata fetch; we don’t absorb that with a retry. |
| “0/3 endpoints available” log | `healthTracker.loadHealthData()` | Sounds like “no endpoints” but means “we’re resetting stale failure state”; can confuse. |
| Backend health from previous runs | FileStorage | If last run had all endpoints failed, we start with 0 “available” until reset; again correct but noisy. |

---

## 4. Suggested solution

Two concrete changes in `lib/dotbot-core/rpcManager/RpcManager.ts`:

### 4.1 Retry once on “WebSocket is not connected” (same endpoint)

Inside `tryConnect()`, when `ApiPromise.create()` (or the surrounding logic) rejects with a message containing “WebSocket is not connected” or “Unable to initialize the API”, **retry the same endpoint once** with a **new provider** before failing (and thus before failover or throw). This should be done in a small helper or inline loop (max 2 attempts per endpoint). Only do this for that specific error type so we don’t retry indefinitely on hard failures.

### 4.2 Short delay after `connected` before `ApiPromise.create()`

Right after the provider fires `connected`, wait a short time (e.g. 100–200 ms) before calling `ApiPromise.create({ provider })`. This reduces the chance of calling RPC before the socket is fully ready. Keep existing timeouts (connection timeout, API init timeout, max total timeout) unchanged so we don’t hang longer.

**Implemented:** In `healthTracker.loadHealthData()`, the log was reworded to: “Resetting stale RPC health data (X/Y marked available); will try all endpoints again” so it’s clear we’re resetting, not missing config.

---

## 5. Implementation sketch (RpcManager.ts)

- **Retry**: In `tryConnect()`, wrap the “connect + ApiPromise.create” logic in a loop: `for (let attempt = 0; attempt < 2; attempt++)`. On catch, if the error message includes “WebSocket is not connected” or “Unable to initialize the API”, and `attempt === 0`, disconnect the current provider and run the loop again (new provider); otherwise rethrow or fail over as today.
- **Delay**: In the `connected` handler, after `isConnected = true` and before `ApiPromise.create()`, add:
  `await new Promise(r => setTimeout(r, 150));`
  and then re-check `provider.isConnected` (and that we’re not resolved) before creating the API. If disconnected, reject and let the retry or failover run.

These two changes address the race and transient “WebSocket is not connected” without changing the rest of the RpcManager design (health, failover, sessions, timeouts).

---

## 6. Analysis of persisted health data (`data/storage/dotbot_rpc_health_*`)

Reasoning from the four stored health files (Polkadot Asset Hub, Polkadot Relay, Westend Asset Hub, Westend Relay):

### 6.1 Why "0/3 endpoints available" is Westend Asset Hub

- The log says **0/3** → exactly **3 total endpoints**. In code, only **Westend Asset Hub** has 3 endpoints (`WESTEND_ASSET_HUB`: polkadot.io, onfinality westmint, ibp westmint). Westend Relay has 6; Polkadot Relay 11; Polkadot Asset Hub 5.
- So the "Resetting health data - only 0/3 endpoints available" log comes from the **Westend Asset Hub** RpcManager when it loads health from storage.

### 6.2 When do we get 0/3?

- In `loadHealthData()`, an endpoint counts as **available** only if it has no `lastFailure`, or `lastFailure` was **more than 2 minutes ago** (`STALE_FAILURE_TIMEOUT`).
- So **0/3** means: at load time, all 3 Westend Asset Hub endpoints had `lastFailure` within the last 2 minutes.
- That happens when: (1) In a previous run, all 3 were tried and failed (e.g. "WebSocket is not connected" or network blip), so all got `lastFailure` and we persisted. (2) User restarts the app **within 2 minutes**. (3) On load, we see 0 available → we reset and log "0/3".
- So the log is **correct behavior**: we're resetting stale failure state so we can try all 3 again. The snapshot you shared (1 healthy, 2 unhealthy) is either from a different moment or after that reset had already given one endpoint a successful check.

### 6.3 What the four files show

| File | Endpoints | Healthy | Unhealthy / notes |
|------|-----------|--------|--------------------|
| **Polkadot Asset Hub** | 5 | 3 | 2 (Dwellir, rpc-asset-hub.polkadot.io) — failureCount 1 each. |
| **Polkadot Relay** | 11 | 9 | 2 (Dwellir, Integritee) — failureCount 1 each. |
| **Westend Asset Hub** | 3 | 1 | 2 (OnFinality westmint, IBP westmint) — failureCount 1 each, recent lastFailure. |
| **Westend Relay** | 6 | 3 | 3 with **very high failureCount**: rpc.ibp.network/westend **35**, dwellir westend-tn **34**, dwellir westend **34**. |

- **Polkadot**: Mostly healthy; a few one-off failures. System is in good shape.
- **Westend Asset Hub**: Only 1 healthy (official polkadot.io). The other two (OnFinality, IBP) have recent failures. So 2/3 endpoints are flaky → if the official one fails or is slow, we quickly get into "all failed" and then 0/3 on next load.
- **Westend Relay**: 3 healthy (onfinality, westend-rpc.polkadot.io, curie). The other 3 (IBP westend, both Dwellir) have **34–35** failures each. That implies many failed connection or health-check attempts over time — consistent with "WebSocket is not connected" or endpoint instability. `getOrderedEndpoints()` filters out recently failed (lastFailure &lt; 2 min), so we still use the 3 healthy ones; the high counts just show those three endpoints have failed repeatedly.

### 6.4 Dwellir and IBP

- **Dwellir** is unhealthy in multiple networks (Polkadot relay, Polkadot asset hub, Westend relay ×2) with at least one failure each. Westend Dwellir endpoints have 34 failures. Suggests either systematic issues (rate limit, blocking, or init/WebSocket failures) with Dwellir or with how we connect to them.
- **IBP** is healthy for Polkadot (relay + statemint) but unhealthy for Westend (relay 35 failures, asset hub 1 failure). So Westend IBP endpoints are much less reliable than Polkadot in your data.

### 6.5 Root cause (reasoning from data)

1. **"0/3"** = Westend Asset Hub manager loading health where all 3 endpoints had failed recently → reset and "will try all endpoints again" is correct.
2. **Westend is fragile**: Few endpoints (3 for Asset Hub, 6 for Relay), and several of them (Dwellir, IBP westend/westmint) show repeated or recent failures. One transient "WebSocket is not connected" on each of the 3 Asset Hub endpoints in a short window is enough to produce 0/3 on next startup.
3. **High failure counts** (34–35) on Westend Relay show that connection/init failures are happening often on those endpoints — consistent with the "WebSocket is not connected" / API init failure we analyzed; each failed attempt increments `failureCount` and sets `lastFailure`.
4. **Conclusion**: The persisted data supports the same story: RpcManager and health logic are behaving as designed; the issue is **endpoint stability** (especially Westend and Dwellir/IBP) and **transient init failures** that mark endpoints failed and, when all of a small set (e.g. 3) fail within 2 minutes, trigger the 0/3 reset. The retry + delay we added is aimed at reducing those transient failures so fewer attempts get marked as failed and we see fewer 0/3 resets.

---

## 7. Analysis: Invalid sender address + SES healthTimer (no code changes)

User reported:

1. `Invalid sender address: Address is required` / `INVALID_SENDER_ADDRESS`
2. `Failed to prepare transaction: … Invalid sender address: Address is required` (prepareExecution → orchestrateExecutionArray → system.ts:175)
3. `SES_UNCAUGHT_EXCEPTION: TypeError: "__internal__healthTimer" is read-only` in `_unsubscribeHealth`

User said: prompt contains address; this didn’t used to happen. Analysis only.

### 7.1 Where “Invalid sender address: Address is required” comes from

- **Source**: `lib/dotbot-core/agents/asset-transfer/utils/addressValidation.ts`: `validateAddress(sender)` returns `errors: ['Address is required']` when `!address || address.trim().length === 0`. That is then wrapped as `Invalid sender address: Address is required` (and `INVALID_SENDER_ADDRESS`) in `validateTransferAddresses(sender, recipient)`.
- **Call path**: Orchestrator calls the agent with **step.parameters** from the ExecutionPlan (LLM output). `prepareAgentParameters(step)` only spreads `step.parameters` (+ onSimulationStatus). So **sender** is whatever the **plan** has in `step.parameters.sender`. There is **no injection** of `dotbot.wallet.address` into the plan in the orchestrator; the ExecutionSystem has `initializedAccount` but that is used for the **executioner** (signing) and for **simulation** (`accountAddress`), not for rewriting plan parameters before orchestration.
- So if `step.parameters.sender` is missing, undefined, or empty string, the agent sees no sender → “Address is required”.

### 7.2 Where the sender in the plan is supposed to come from

- The **LLM** is supposed to put the sender in the plan. The system prompt is built by `buildContextualSystemPrompt(dotbot)`, which includes **Current Context** with `**Wallet**: Connected (${context.wallet.address})` when `context.wallet.isConnected && context.wallet.address` (see `loader.ts` formatContext). The agent docs say sender “Should use the wallet address from the Current Context section above”.
- So under normal conditions the LLM sees the wallet address in the prompt and should set `parameters.sender` in the JSON ExecutionPlan. If the prompt **does not** contain the wallet (e.g. “No context information available”), the LLM has nothing to copy → plan can have missing/empty sender.

### 7.3 Critical: fallback when buildContextualSystemPrompt fails

- In `lib/dotbot-core/dotbot/llm.ts`, `buildContextualSystemPrompt(dotbot)`:
  - Calls `ensureRpcConnectionsReady()` then `getBalance()` and `getChainInfo()` to build full context (wallet + network + balance).
  - On **any exception** it catches and does: `return await buildSystemPrompt();` — **no context**.
- In `loader.ts`, `buildSystemPrompt(context?)` with **no context** (or undefined) leads to `formatContext(undefined)` → “No context information available.” So the LLM gets a prompt **without** wallet address.
- So: **if the backend fails to build RPC/balance context** (e.g. “WebSocket is not connected”, getBalance fails, ensureRpcConnectionsReady fails), we fall back to a prompt with **no wallet**. The LLM then returns a plan that often has no or empty `sender` → frontend calls `prepareExecution(plan)` → orchestration uses that plan → agent validates sender → “Invalid sender address: Address is required”.

So the **Invalid sender** error can be **directly caused** by **RPC/context build failure on the backend**: when the backend can’t build the full context (e.g. due to RPC instability), it falls back to a prompt without wallet, so the plan doesn’t include sender. “Prompt contains address” can still be true when context is built successfully; when it isn’t (fallback), the prompt does **not** contain the address, and that’s when you get the error. “We didn’t used to have this” is consistent with more frequent RPC/init failures (e.g. Westend, “WebSocket is not connected”) leading to more fallbacks and thus more plans without sender.

### 7.4 Are the two issues related?

- **Invalid sender**: Explained above — downstream of **backend** failing to build context (often due to RPC), so the plan has no sender.
- **"__internal__healthTimer" is read-only**: Not present in our repo; it comes from a **dependency**, almost certainly **Polkadot.js** (internal provider/API health or cleanup). The name `_unsubscribeHealth` suggests an internal unsubscribe that tries to clear or assign to `__internal__healthTimer`; in an **SES (Secure EcmaScript)** or similarly locked-down environment, that property may be non-writable, so assignment throws.
- **Relation**: They can appear together but are different:
  - Invalid sender: **application-level** — missing sender in plan because backend prompt had no wallet (due to RPC/context failure).
  - healthTimer read-only: **environment/dependency-level** — Polkadot.js internals hitting a read-only property (e.g. during disconnect/cleanup or health unsubscribe). It could be triggered more often if we create/destroy or reconnect providers more (e.g. RPC retries, health checks), but the root cause is the dependency + environment (SES/strict), not our business logic.

### 7.5 Summary

| Error | Cause | Related? |
|-------|--------|----------|
| Invalid sender address: Address is required | Plan has no/empty `sender`. Backend often built prompt with **no context** (buildContextualSystemPrompt failed → buildSystemPrompt() with no wallet). Failure is often due to RPC (e.g. getBalance/ensureRpcConnectionsReady). | Yes, to RPC/context: more RPC failures → more fallbacks → more plans without sender. |
| "__internal__healthTimer" is read-only | Polkadot.js internal (_unsubscribeHealth) assigning to a read-only property in SES/strict environment. | Only indirectly: more reconnects/cleanups could trigger it more; root cause is dependency + environment. |

So: **Invalid sender** is likely **related** to the same RPC/context issues we analyzed earlier (backend can’t build wallet context → no sender in plan). **healthTimer** is a separate, dependency/environment issue, possibly surfaced more when RPC code path runs more (reconnects, health checks).

### 7.6 Why it happens on sandbox / deployed (UI breaks)

- **Stack**: `_unsubscribeHealth` (Init.js) → `_unsubscribe` → `__internal__onProviderDisconnect` → `emit` (index.js). So when the **WebSocket provider disconnects** (server closed, network drop, or we call `provider.disconnect()`), Polkadot.js runs `__internal__onProviderDisconnect` and then `_unsubscribe` / `_unsubscribeHealth`. Inside `_unsubscribeHealth` it tries to assign to or clear `__internal__healthTimer`. In an **SES (Secure EcmaScript)** or frozen-object environment, that property is **read-only**, so the assignment throws.
- **Where SES comes from**: The sandbox (e.g. sandbox.dotbot.zelmacorp.io) or the browser extension (Talisman / polkadot{.js}) may run in a context where objects are frozen or SES is enabled. "Disconnected from polkadot{.js}-0x07fc01cb6e..." suggests the extension or an injected script. So when **any** disconnect happens (our cleanup, health check, or server closing the socket), Polkadot.js cleanup runs in that context and throws. The exception is **uncaught** → React / the app crashes → UI is not usable.
- **Why deployed and not npm start**: Local dev often does not use the same extension/sandbox context or SES; production/sandbox may be embedded or run with stricter lockdown, so the throw only appears there.
- **Mitigation**: We cannot fix Polkadot.js internals. We add a **global error handler** in the frontend (index.tsx) that catches this specific `TypeError: "__internal__healthTimer" is read-only` (and unhandledrejection) and does not rethrow so the UI stays usable. The disconnect still occurs; we only prevent the uncaught exception from breaking the app.
