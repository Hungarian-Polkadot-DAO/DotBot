# Execution Flow Diagram

Visual representation of how all components connect in the DotBot execution system.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER REQUEST                             │
│                  "Send 5 DOT to Bob"                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      LLM (Claude/GPT)                            │
│  • Understands natural language                                 │
│  • Plans execution steps                                        │
│  • Outputs ExecutionArrayPlan (JSON)                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ ExecutionArrayPlan {
                             │   steps: [{
                             │     agentClassName: "AssetTransferAgent",
                             │     functionName: "transfer",
                             │     parameters: { address, recipient, amount }
                             │   }]
                             │ }
                             │
                             ▼
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                    EXECUTION SYSTEM                              ┃
┃                   (Turnkey Solution)                             ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━┯━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
                             │
                             ├─── Phase 1: Orchestration ─────┐
                             │                                 │
                             ▼                                 │
          ┌─────────────────────────────────────┐             │
          │    EXECUTION ORCHESTRATOR            │             │
          │  • Reads ExecutionArrayPlan          │             │
          │  • Loops through ExecutionSteps      │             │
          │  • Calls agents dynamically          │             │
          └────────────┬────────────────────────┬┘             │
                       │                        │               │
                       │ For each step:         │               │
                       │                        │               │
                       ▼                        │               │
          ┌──────────────────────────┐          │               │
          │   AGENT REGISTRY          │          │               │
          │  AGENT_REGISTRY[]         │          │               │
          │  • AssetTransferAgent     │          │               │
          │  • StakingAgent (future)  │          │               │
          │  • GovernanceAgent (...)  │          │               │
          └────────────┬───────────────┘          │               │
                       │                          │               │
                       │ createAgent(className)   │               │
                       │                          │               │
                       ▼                          │               │
          ┌──────────────────────────┐            │               │
          │   AGENT INSTANCE          │            │               │
          │  new AssetTransferAgent() │            │               │
          │  • initialize(api)        │            │               │
          │  • transfer(params) ────► │            │               │
          └────────────┬───────────────┘            │               │
                       │                            │               │
                       │ Creates extrinsic          │               │
                       │ using Polkadot.js API      │               │
                       │                            │               │
                       ▼                            │               │
          ┌──────────────────────────┐              │               │
          │    AGENT RESULT           │              │               │
          │  {                        │              │               │
          │    extrinsic: <Submittable>,            │               │
          │    description: "Transfer 5 DOT...",    │               │
          │    estimatedFee: "...",                 │               │
          │    executionType: "extrinsic"           │               │
          │  }                        │              │               │
          └────────────┬───────────────┘              │               │
                       │                              │               │
                       │                              │               │
                       ▼                              │               │
          ┌──────────────────────────┐                │               │
          │   EXECUTION ARRAY         │◄───────────────┘               │
          │  • add(agentResult)       │                                │
          │  • Wraps in ExecutionItem │                                │
          │  • Preserves extrinsic    │                                │
          │  • Status: pending        │                                │
          └────────────┬───────────────┘                                │
                       │                                                │
                       │ executionArray populated                       │
                       │ with ExecutionItems                            │
                       │                                                │
                       ├─── Phase 2: Execution ─────────────────────────┘
                       │
                       ▼
          ┌──────────────────────────┐
          │      EXECUTIONER          │
          │  • execute(executionArray)│
          │  • For each item:         │
          │    1. Extract extrinsic   │
          │    2. Request approval    │
          │    3. Sign transaction    │
          │    4. Broadcast           │
          │    5. Monitor             │
          └────────────┬───────────────┘
                       │
                       │ For each ExecutionItem:
                       │
                       ▼
          ┌──────────────────────────┐
          │  Extract Extrinsic        │
          │  item.agentResult.extrinsic
          └────────────┬───────────────┘
                       │
                       ▼
          ┌──────────────────────────┐
          │  Request Approval         │
          │  • Show modal to user     │
          │  • Display: description   │
          │  •   fee, warnings        │
          │  • Wait for user decision │
          └────────────┬───────────────┘
                       │
                       │ if approved
                       │
                       ▼
          ┌──────────────────────────┐
          │  PLUGGABLE SIGNER         │
          │  ┌────────────────────┐   │
          │  │ BrowserWalletSigner│   │  ← Browser
          │  │ (web3FromAddress)  │   │
          │  └────────────────────┘   │
          │  ┌────────────────────┐   │
          │  │  KeyringSigner     │   │  ← CLI/Backend
          │  │  (from mnemonic)   │   │
          │  └────────────────────┘   │
          │                           │
          │  sign(extrinsic, address) │
          └────────────┬───────────────┘
                       │
                       │ Signed Extrinsic
                       │
                       ▼
          ┌──────────────────────────┐
          │  Broadcast Transaction    │
          │  signedExtrinsic.send()   │
          └────────────┬───────────────┘
                       │
                       ▼
          ┌──────────────────────────┐
          │  POLKADOT BLOCKCHAIN      │
          │  • Receive transaction    │
          │  • Validate               │
          │  • Include in block       │
          │  • Finalize               │
          └────────────┬───────────────┘
                       │
                       │ Status events
                       │
                       ▼
          ┌──────────────────────────┐
          │  Monitor Status           │
          │  • In Block (included)    │
          │  • Finalized (confirmed)  │
          │  • Extract events         │
          └────────────┬───────────────┘
                       │
                       │ ExecutionResult
                       │
                       ▼
          ┌──────────────────────────┐
          │  Update Status            │
          │  executionArray.update()  │
          │  • Status: finalized      │
          │  • Result: { blockHash }  │
          └────────────┬───────────────┘
                       │
                       ▼
          ┌──────────────────────────┐
          │  CALLBACKS                │
          │  • onExecutingStep()      │
          │  • onComplete()           │
          │  • UI updates             │
          └────────────┬───────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TRANSACTION COMPLETE                          │
│             User sees: "✅ Transfer successful!"                 │
│          LLM explains: "Successfully sent 5 DOT to Bob"         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Type Flow

```
User Input (string)
    │
    ▼
┌─────────────────────────────┐
│  ExecutionArrayPlan          │  ← LLM Output
│  {                           │
│    steps: ExecutionStep[]    │
│  }                           │
└────────┬─────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  ExecutionStep               │  ← What to do
│  {                           │
│    agentClassName: string    │  → "AssetTransferAgent"
│    functionName: string      │  → "transfer"
│    parameters: object        │  → { address, recipient, amount }
│  }                           │
└────────┬─────────────────────┘
         │
         │ Orchestrator calls agent
         │
         ▼
┌─────────────────────────────┐
│  AgentResult                 │  ← Agent Output
│  {                           │
│    extrinsic: Submittable    │  → Created extrinsic
│    description: string       │  → "Transfer 5 DOT..."
│    executionType: string     │  → "extrinsic"
│    estimatedFee: string      │  → "100000000"
│  }                           │
└────────┬─────────────────────┘
         │
         │ ExecutionArray wraps it
         │
         ▼
┌─────────────────────────────┐
│  ExecutionItem               │  ← Runtime Queue Item
│  {                           │
│    id: string                │  → "exec-item-1"
│    agentResult: AgentResult  │  → Preserved!
│    status: ExecutionStatus   │  → "pending"
│    executionType: string     │  → "extrinsic"
│  }                           │
└────────┬─────────────────────┘
         │
         │ Executioner extracts
         │
         ▼
┌─────────────────────────────┐
│  SubmittableExtrinsic        │  ← Polkadot.js Type
│  item.agentResult.extrinsic  │
└────────┬─────────────────────┘
         │
         │ Signer signs
         │
         ▼
┌─────────────────────────────┐
│  SignedExtrinsic             │  ← Ready to broadcast
└────────┬─────────────────────┘
         │
         │ Broadcast
         │
         ▼
┌─────────────────────────────┐
│  ExecutionResult             │  ← Final Result
│  {                           │
│    success: true             │
│    blockHash: "0x..."        │
│    events: [...]             │
│    status: "finalized"       │
│  }                           │
└─────────────────────────────┘
```

---

## Component Interactions

```
┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│  ExecutionSystem│────│  Orchestrator   │────│  Agent Registry │
│                │     │                │     │                │
│  • initialize()│     │  • orchestrate()│     │  • createAgent()│
│  • execute()   │     │  • executeStep()│     │  • REGISTRY[]  │
└────────┬───────┘     └────────┬───────┘     └────────┬───────┘
         │                      │                       │
         │                      │                       ▼
         │                      │              ┌────────────────┐
         │                      │              │  Agent Instance │
         │                      │              │                │
         │                      │              │  • initialize() │
         │                      └─────────────►│  • transfer()   │
         │                                     │  • createResult()│
         │                                     └────────┬───────┘
         │                                              │
         │                                              ▼
         │                      ┌────────────────────────────────┐
         │                      │         AgentResult            │
         │                      │  (with SubmittableExtrinsic)   │
         │                      └────────┬───────────────────────┘
         │                               │
         ▼                               ▼
┌────────────────┐              ┌────────────────┐
│ ExecutionArray │◄─────────────│  Orchestrator   │
│                │              │  adds results   │
│  • add()       │              └─────────────────┘
│  • getItems()  │
│  • update()    │
└────────┬───────┘
         │
         │ provides items
         │
         ▼
┌────────────────┐     ┌────────────────┐
│   Executioner   │────│ Pluggable Signer│
│                │     │                │
│  • execute()   │     │  • sign()      │
│  • sign()      │     │  • approve()   │
│  • broadcast() │     │                │
│  • monitor()   │     │  [Browser]     │
└────────┬───────┘     │  [Keyring]     │
         │             └────────────────┘
         │
         │ broadcasts
         │
         ▼
┌────────────────┐
│   Blockchain    │
│                │
│  • Validate    │
│  • Include     │
│  • Finalize    │
└────────────────┘
```

---

## Frontend Integration Pattern

```
┌───────────────────────────────────────────────────────────────┐
│                        FRONTEND APP                            │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  1. Initialize (One-time setup)                          │ │
│  │                                                          │ │
│  │  import { ExecutionSystem, BrowserWalletSigner }        │ │
│  │          from '@dotbot/lib';                            │ │
│  │                                                          │ │
│  │  const system = new ExecutionSystem();                  │ │
│  │  const signer = new BrowserWalletSigner();              │ │
│  │                                                          │ │
│  │  system.initialize(api, account, signer);               │ │
│  │  system.setSigningRequestHandler(showModal);            │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  2. Get LLM Plan                                         │ │
│  │                                                          │ │
│  │  const userRequest = "Send 5 DOT to Bob";               │ │
│  │  const llmResponse = await callLLM(userRequest);        │ │
│  │  const plan = JSON.parse(llmResponse);                  │ │
│  │  // plan is ExecutionArrayPlan                          │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  3. Execute (That's it!)                                 │ │
│  │                                                          │ │
│  │  await system.execute(plan, {}, {                       │ │
│  │    onPreparingStep: (desc, cur, tot) => {               │ │
│  │      showProgress(`Preparing ${cur}/${tot}: ${desc}`);  │ │
│  │    },                                                    │ │
│  │    onExecutingStep: (desc, status) => {                 │ │
│  │      showProgress(`${desc} (${status})`);               │ │
│  │    },                                                    │ │
│  │    onComplete: (success, completed, failed) => {        │ │
│  │      showResult(`Done! ${completed} successful`);       │ │
│  │    }                                                     │ │
│  │  });                                                     │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  Everything else is AUTOMATIC:                                │
│  • Agent calling ✅                                            │
│  • Extrinsic creation ✅                                       │
│  • Queue management ✅                                         │
│  • User approval ✅                                            │
│  • Transaction signing ✅                                      │
│  • Broadcasting ✅                                             │
│  • Status monitoring ✅                                        │
│                                                                │
└───────────────────────────────────────────────────────────────┘
```

---

## Portability: Same Code, Different Environments

```
┌─────────────────────────────────────────────────────────────┐
│                      BROWSER                                 │
│                                                              │
│  import { ExecutionSystem, BrowserWalletSigner }            │
│          from '@dotbot/lib';                                │
│                                                              │
│  const signer = new BrowserWalletSigner();                  │
│  system.initialize(api, account, signer);                   │
│                                                              │
│  // Uses wallet extension (Polkadot.js, Talisman, etc.)    │
│  // User approves in browser UI                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   TERMINAL / CLI                             │
│                                                              │
│  import { ExecutionSystem, KeyringSigner }                  │
│          from '@dotbot/lib';                                │
│                                                              │
│  const signer = KeyringSigner.fromMnemonic(mnemonic);      │
│  system.initialize(api, account, signer);                   │
│                                                              │
│  // Uses local keyring, signs automatically                 │
│  // No browser wallet needed                                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                 BACKEND SERVICE                              │
│                                                              │
│  import { ExecutionSystem, KeyringSigner }                  │
│          from '@dotbot/lib';                                │
│                                                              │
│  const signer = KeyringSigner.fromSeed(seed);              │
│  system.initialize(api, account, signer);                   │
│                                                              │
│  // Signs server-side, no user interaction                  │
│  // Can be used in automated services                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      TESTS                                   │
│                                                              │
│  import { ExecutionSystem, KeyringSigner }                  │
│          from '@dotbot/lib';                                │
│                                                              │
│  const signer = KeyringSigner.fromUri('//Alice');          │
│  system.initialize(api, account, signer);                   │
│                                                              │
│  // Uses test accounts (Alice, Bob, etc.)                   │
│  // Automated signing for tests                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Takeaways

1. **One Entry Point:** `ExecutionSystem` handles everything
2. **Minimal Wiring:** Initialize once, execute many times
3. **LLM-Driven:** LLM plans, system executes automatically
4. **Agent Registry:** Agents discoverable by name
5. **Type-Safe:** All connections typed and verified
6. **Pluggable:** Different signers for different environments
7. **Real-time Feedback:** Callbacks at every step
8. **Production Ready:** Error handling, monitoring, retries

All components are properly connected and work together seamlessly! ✅

