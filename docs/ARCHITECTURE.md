# DotBot Architecture

This document explains **why** DotBot is built the way it is. It covers design decisions, architectural patterns, and the rationale behind key choices.

## Table of Contents

- [System Architecture](#system-architecture)
- [Core Design Principles](#core-design-principles)
- [Module Structure](#module-structure)
- [Testing Infrastructure](#testing-infrastructure)
- [Design Decisions](#design-decisions)
- [Data Flow](#data-flow)
- [Conventions](#conventions)
- [Dependencies](#dependencies)

---

## System Architecture

DotBot is a distributed system with frontend and backend components, designed for secure API key management and scalable blockchain operations.

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         FRONTEND                            │
│  ┌────────────────────────────────────────────────────┐     │
│  │  React Application                                 │     │
│  │  - UI Components                                   │     │
│  │  - Wallet Integration                              │     │
│  │  - @dotbot/core (client-side operations)           │     │
│  └────────────────────────────────────────────────────┘     │
│                          ↓ HTTP API                         │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                         BACKEND                             │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Express.js Server (TypeScript)                    │     │
│  │  - @dotbot/express (routes & middleware)           │     │
│  │  - @dotbot/core (server-side operations)           │     │
│  │  - Secure API key management                       │     │
│  │  - OpenAPI specification (base truth)              │     │
│  │  - Prism mock server for testing                   │     │
│  └────────────────────────────────────────────────────┘     │
│                          ↓                                  │
│  ┌────────────────────────────────────────────────────┐     │
│  │  AI Providers                                      │     │
│  │  - ASI-One (Fetch.ai)                              │     │
│  │  - Claude (Anthropic)                              │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### Project Structure

```
DotBot/                      # Monorepo root
├── package.json             # Workspace configuration (4 workspaces)
│
├── lib/                     # Shared libraries (both frontend & backend)
│   ├── dotbot-core/         # @dotbot/core - Core logic
│   │   ├── dotbot.ts        # DotBot class (~500 lines, turnkey API)
│   │   ├── dotbot/          # DotBot logic modules (create, chat, execution, RPC, LLM)
│   │   │   ├── create.ts    # Factory args for DotBot.create()
│   │   │   ├── chatHandlers.ts
│   │   │   ├── chatLifecycle.ts
│   │   │   ├── executionPreparation.ts
│   │   │   ├── executionRunner.ts
│   │   │   ├── llm.ts       # getLLMResponse, buildContextualSystemPrompt
│   │   │   ├── rpcLifecycle.ts  # ensureRpcConnectionsReady (lazy loading)
│   │   │   ├── balanceChain.ts  # getBalance, getChainInfo
│   │   │   └── types.ts    # DotBotConfig, ChatResult, etc.
│   │   ├── agents/          # Blockchain operation agents
│   │   ├── executionEngine/ # Transaction execution system
│   │   ├── chat/            # ChatInstance, ChatInstanceManager
│   │   ├── rpcManager/      # RpcManager, health, factories
│   │   ├── prompts/        # LLM system prompts
│   │   ├── services/       # AI, logger, simulation
│   │   ├── storage/        # chatStorage, fileStorage
│   │   ├── scenarioEngine/  # Testing framework
│   │   └── env.ts           # Environment abstraction (browser/Node.js)
│   │
│   └── dotbot-express/      # @dotbot/express - Express integration
│       ├── src/
│       │   ├── routes/      # API routes (chat, dotbot operations, sessions)
│       │   ├── middleware/  # Request logging, error handling
│       │   ├── utils/       # Utilities (logger)
│       │   └── index.ts     # Main exports
│       └── package.json
│
├── backend/
│   ├── src/
│   │   ├── app.ts           # Express app configuration
│   │   └── index.ts         # Main server entry point
│   ├── test/
│   │   └── integration/
│   │       └── openapi-test-runner.ts  # OpenAPI-based integration tests
│   ├── openapi.yaml         # API specification (base truth)
│   ├── test-mock-api.sh     # Prism mock server launcher
│   ├── package.json         # Links to @dotbot/core, @dotbot/express
│   └── tsconfig.json
│
└── frontend/
    ├── src/
    │   ├── components/      # React UI components
    │   └── services/
    │       └── backendApi.ts # Backend API client
    ├── package.json         # Links to @dotbot/core
    └── tsconfig.json
```

**Key principle:** Both frontend and backend import from the **same** `lib/` folder at project root. No code duplication.

**Monorepo Structure:**
- **Root**: npm workspaces configuration
- **4 Workspaces**: `backend`, `frontend`, `lib/dotbot-core`, `lib/dotbot-express`
- **Shared Dependencies**: Libraries link via `file:../lib/dotbot-core` syntax
- **Independent Development**: Each workspace has its own build/test scripts

### Design Rationale: Why Backend?

**Problem**: AI provider API keys exposed in frontend code

**Solution**: Move AI services to backend, keep blockchain operations client-side

**Benefits**:
1. **Security**: API keys never exposed to client
2. **Flexibility**: Easy to switch AI providers server-side
3. **Cost Control**: Rate limiting and usage monitoring
4. **Hybrid Architecture**: Blockchain ops stay client-side (leverages user's wallet)

### dotbot-core: Environment-Agnostic Design

The `@dotbot/core` library is designed to work in both browser and Node.js:

```typescript
// Environment abstraction (lib/dotbot-core/env.ts)
export function getEnv(key: string): string | undefined {
  // In browser: tries REACT_APP_* first, falls back to regular name
  // In Node.js: uses process.env directly
  if (typeof process !== 'undefined' && process.env) {
    const reactAppKey = key.startsWith('REACT_APP_') ? key : `REACT_APP_${key}`;
    return process.env[reactAppKey] || process.env[key];
  }
  return undefined;
}
```

**Key Features**:
- Works in both environments without modification
- Storage abstraction (localStorage in browser, in-memory in Node.js)
- No browser-specific APIs in core logic
- **Shared codebase**: Both frontend and backend import from `lib/dotbot-core`
- Future-ready for npm package publishing

**Usage in both environments:**
```typescript
// In frontend (or any consumer)
import { DotBot, createRpcManagersForNetwork } from '@dotbot/core';
import { AssetTransferAgent } from '@dotbot/core';  // or agents/asset-transfer

// In backend
import { AIService } from '@dotbot/core';

// Monorepo: both resolve to lib/dotbot-core (same files). Future: npm install @dotbot/core.
```

### API Flow: Chat Example

```typescript
// 1. Frontend sends request to backend
const response = await fetch('http://localhost:8000/api/chat', {
  method: 'POST',
  body: JSON.stringify({
    message: 'Transfer 10 DOT to Alice',
    provider: 'asi-one'
  })
});

// 2. Backend (dotbot-express) handles request
router.post('/api/chat', async (req, res) => {
  const aiService = new AIService(); // Uses server-side API keys
  const response = await aiService.sendMessage(req.body.message);
  res.json({ response });
});

// 3. AI response returned to frontend
// 4. Frontend uses dotbot-core to execute blockchain operations client-side
```

### Shared Library Development

**Current Setup (Monorepo):**
```
DotBot/lib/dotbot-core     ← Shared by frontend and backend
         └─ (TypeScript path aliases allow importing as @dotbot/core)
```

**Advantages:**
- Edit once, both frontend and backend get updates immediately
- No code duplication or sync issues
- Single source of truth for business logic
- Type safety across entire stack

**Future npm Package Migration:**

When `@dotbot/core` stabilizes, publish to npm:

```bash
npm install @dotbot/core      # Shared blockchain operations
npm install @dotbot/express   # Backend Express integration
npm install @dotbot/react     # Frontend React components (future)
```

**Migration Path**:
1. ✅ Current: Monorepo with shared `lib/` folder
2. Publish `@dotbot/core` when stable (usable in any environment)
3. Publish `@dotbot/express` for backend integrations
4. Publish `@dotbot/react` for frontend components
5. Projects install packages instead of sharing via monorepo

---

## Core Design Principles

### 1. Agent-First Architecture

**Principle**: Agents are responsible for creating extrinsics, not the execution engine.

**Why?**
- **Separation of Concerns**: Agent knows the business logic (what to build), executioner knows the execution logic (how to execute)
- **Scalability**: Adding a new agent doesn't require modifying the executioner
- **Testability**: Agents can be tested independently by verifying extrinsic creation
- **Reusability**: Agents can be used by any execution environment

**What This Means:**
```typescript
// ✅ CORRECT: Agent creates extrinsic
const result = await agent.transfer({ ... });
const extrinsic = result.extrinsic; // Ready to sign!
await executioner.execute(result);

// ❌ WRONG: Executioner creates extrinsic from metadata
const result = await agent.transfer({ ... });
const metadata = result.metadata; // Just data
// Executioner rebuilds extrinsic (bad - agent logic in executioner)
```

**History**: We initially tried having agents return metadata and letting the executioner build extrinsics. This failed because:
- Executioner became agent-specific (doesn't scale)
- Registry mismatches caused errors
- Violates single responsibility principle

(Reverted to agent-first: January 2026, see ARCHITECTURE_REVERSION_COMPLETE.md)

---

### 2. Production-Safe by Default

**Principle**: All operations should work reliably across different runtime versions and chains.

**Why?**
- Polkadot runtimes evolve (methods get added/deprecated)
- Different chains have different capabilities
- Users shouldn't face cryptic errors
- Automatic fallbacks prevent breakage

**Implementation:**
- Runtime capability detection before extrinsic creation
- Automatic fallbacks (transferKeepAlive → transferAllowDeath → transfer)
- Comprehensive error messages
- Simulation before execution

**Example:**
```typescript
// Capability detection
const capabilities = await detectTransferCapabilities(api);

// Safe extrinsic building with fallbacks
const result = buildSafeTransferExtrinsic(api, params, capabilities);
// Automatically selects best available method
```

---

### 3. Pluggable Components

**Principle**: Key components should be replaceable without changing core logic.

**Why?**
- Different environments have different constraints (browser vs terminal vs backend)
- Testing requires mock implementations
- Future extensibility

**Pluggable Components:**
- **Signers**: BrowserWalletSigner, KeyringSigner, CustomSigner
- **RPC Providers**: Multiple endpoints with automatic failover
- **Simulation**: Chopsticks client (optional, makes HTTP requests to backend), can be replaced with dry-run

---

### 4. Explicit Chain Selection

**Principle**: Never infer which chain to use based on balance or heuristics. Always explicit.

**Why?**
- Post-migration, DOT exists on both Relay Chain and Asset Hub
- Inferring from balance is unreliable and confusing
- User intent must drive chain selection
- Prevents accidental wrong-chain operations

**Decision Record**: Decision 1 (see below)

---

## Module Structure

### DotBot and dotbot/ Modules (`lib/dotbot-core/dotbot.ts` and `lib/dotbot-core/dotbot/`)

**Purpose:** Turnkey DotBot class and extracted logic modules.

- **dotbot.ts**: Single class `DotBot` (~500 lines). Public API: `create()`, `chat()`, `getBalance()`, `getChainInfo()`, `prepareExecution()` (internal), `startExecution()`, chat lifecycle, events. RPC and execution system are **lazy-loaded** on first use (e.g. first `chat()` or `getBalance()`).
- **dotbot/create.ts**: `getCreateArgs(config)` — builds RPC managers, ExecutionSystem, config, network, chat manager for constructor.
- **dotbot/chatHandlers.ts**: `handleConversationResponse`, `handleExecutionResponse` (route LLM response to text vs execution flow).
- **dotbot/chatLifecycle.ts**: `initializeChatInstance`, `clearHistory`, `switchEnvironment`, `loadChatInstance`.
- **dotbot/executionPreparation.ts**: `prepareExecution`, `prepareExecutionStateless` (orchestrate plan, add ExecutionMessage to chat).
- **dotbot/executionRunner.ts**: `startExecution`, `startExecutionStateless`, `cleanupExecutionSessions`, `cleanupExpiredExecutions`.
- **dotbot/llm.ts**: `getLLMResponse`, `buildContextualSystemPrompt` (wallet/network/balance context for system prompt). Includes a **format-retry guardrail**: when the LLM returns prose instead of a JSON ExecutionPlan (e.g. "I've prepared a transaction flow..."), the response is detected and the LLM is called once more with a correction prompt asking for JSON only.
- **dotbot/rpcLifecycle.ts**: `ensureRpcConnectionsReady` (connect relay + optional Asset Hub, init ExecutionSystem and signer).
- **dotbot/balanceChain.ts**: `getBalance`, `getChainInfo`.
- **dotbot/types.ts**: `DotBotConfig`, `ChatResult`, `ChatOptions`, `DotBotEvent`, etc.

**Design:** DotBot methods are thin wrappers that call these modules with `this`; state lives on the DotBot instance.

---

### Agents (`lib/dotbot-core/agents/`)

**Purpose**: Create production-safe extrinsics for specific operations.

**Structure:**
```
lib/dotbot-core/agents/
├── baseAgent.ts              # Base class with common utilities
├── types.ts                  # Shared agent interfaces
└── asset-transfer/           # Asset transfer agent
    ├── agent.ts              # Main agent implementation
    ├── types.ts              # Agent-specific types
    └── utils/                # Production-safe utilities
        ├── transferCapabilities.ts   # Runtime capability detection
        ├── safeExtrinsicBuilder.ts  # Extrinsic creation with fallbacks
        ├── capabilityDetectors.ts   # Method detection helpers
        ├── addressEncoder.ts        # SS58 address encoding
        ├── addressValidation.ts     # Address format validation
        ├── amountNormalizer.ts      # Amount conversion (human → Planck)
        ├── amountParser.ts          # Amount parsing utilities
        └── balanceValidator.ts      # Balance validation helpers
```

**Key Classes:**
- **BaseAgent**: Provides common functionality (address validation, balance checks, dry-run)
- **AssetTransferAgent**: Handles DOT/token transfers across chains

**Responsibilities:**
- Validate user input
- Detect runtime capabilities
- Create production-safe extrinsics
- Return standardized AgentResult
- Optionally simulate with Chopsticks (via backend server)

---

### Execution Engine (`lib/dotbot-core/executionEngine/`)

**Purpose**: Execute extrinsics created by agents.

**Structure:**
```
lib/dotbot-core/executionEngine/
├── executioner.ts           # Main execution coordinator
├── executionArray.ts        # Transaction queue management
├── orchestrator.ts          # Execution plan orchestration
├── system.ts                # ExecutionSystem (high-level API)
├── utils.ts                 # Execution utilities
├── types.ts                 # Execution-related types
├── simulation/              # Pre-execution simulation
│   └── executionSimulator.ts
├── signing/                 # Transaction signing
│   └── executionSigner.ts
├── broadcasting/            # Network broadcasting
│   └── executionBroadcaster.ts
└── signers/                 # Signer implementations
    ├── browserSigner.ts     # Browser wallet signer
    ├── keyringSigner.ts     # Keyring signer (CLI/backend)
    └── types.ts             # Signer types
```

**Flow:**
1. **Simulation**: Validate with Chopsticks (optional, via backend server)
   - If enabled: Items start as `'pending'`, simulation runs on backend before signing
   - If disabled: Items start as `'ready'`, execution proceeds directly to signing
2. **Signing**: Get user approval and sign
3. **Broadcasting**: Send to network
4. **Monitoring**: Wait for finalization

**Key Principle**: Executioner is **generic** - it doesn't know about specific agents. It only knows how to:
- Optionally simulate any extrinsic (if simulation enabled)
- Sign any extrinsic
- Broadcast any extrinsic
- Monitor any transaction

**Status Initialization:**
- Items initialize with status based on simulation setting:
  - `'pending'` when simulation enabled (will be simulated first)
  - `'ready'` when simulation disabled (ready for immediate signing)
- This ensures UI correctly reflects execution flow

---

### Services (`lib/dotbot-core/services/`)

**Purpose**: Core infrastructure services.

**Key Services:**
- **RpcManager**: Lives in `lib/dotbot-core/rpcManager/` (RpcManager.ts, healthTracker, factories). Multi-endpoint management with health monitoring, failover, and **network-awareness**. Periodic health checks run every 30 minutes by default (configurable). On API disconnect or error, the cached read API is cleared (`clearReadApiIf`) so the next `getReadApi()` triggers failover to a healthy endpoint.
- **Chopsticks Client**: Client interface for runtime simulation (makes HTTP requests to backend server)
- **SettingsManager**: Centralized settings management with persistence (simulation config, extensible for future settings)
- **SequentialSimulation**: Multi-transaction simulation service (sequential execution on single fork for state tracking, client interface)

**RpcManager Network Features:**
- Network-scoped storage keys (health tracking isolated per network)
- Factory functions for easy network-specific instantiation
- Pre-configured endpoint lists for Polkadot, Kusama, and Westend

---

### Network System (`lib/dotbot-core/prompts/system/knowledge/`)

**Purpose**: Provide network-aware configuration and LLM context for multi-network support.

**Structure:**
```
lib/dotbot-core/prompts/system/knowledge/
├── types.ts                    # Network types and metadata
├── networkUtils.ts             # Network utility functions (20+)
├── index.ts                    # Centralized exports
├── dotKnowledge.ts             # Polkadot-specific information
└── westendKnowledge.ts         # Westend testnet information
```

**Key Types:**
- **Network**: Type-safe union (`'polkadot' | 'kusama' | 'westend'`)
- **NetworkMetadata**: Centralized network configuration (tokens, decimals, SS58, RPC endpoints, colors)
- **NETWORK_CONFIG**: Complete metadata for all supported networks

**Current Support:**
- ✅ Polkadot: Full support (knowledge base + infrastructure)
- ✅ Westend: Full support (knowledge base + infrastructure)
- ⚠️ Kusama: Partial support (infrastructure only, knowledge base TODO)

**Key Functions:**
- `getNetworkMetadata(network)` - Get all configuration for a network
- `detectNetworkFromChainName(chainName)` - Auto-detect network from chain info
- `getNetworkTokenSymbol(network)` - Get native token symbol (DOT/KSM/WND)
- `isTestnet(network)` - Check if network is testnet
- `getRelayChainEndpoints(network)` - Get Relay Chain RPC endpoints
- `getAssetHubEndpoints(network)` - Get Asset Hub RPC endpoints
- `getKnowledgeBaseForNetwork(network)` - Load network-specific knowledge
- `formatKnowledgeBaseForNetwork(network)` - Format knowledge for LLM context

**Responsibilities:**
- Provide type-safe network identifiers
- Centralize network configuration
- Supply network-specific knowledge to LLM
- Enable network detection from chain metadata
- Support future network additions (Kusama, etc.)

**Design Principle**: Networks are first-class concepts with dedicated configuration, not just string identifiers.

---

### Chat System (`lib/dotbot-core/chat/`)

**Purpose**: Manage conversation instances with execution flow tracking and environment isolation.

**Structure:**
```
lib/dotbot-core/chat/
├── chatInstance.ts              # ChatInstance class (conversation + execution state)
├── chatInstanceManager.ts       # Chat lifecycle management
├── types.ts                     # Chat-related types (ConversationItem, etc.)
├── executionState.ts            # Execution state handling
└── sessionManager.ts            # Session helpers

lib/dotbot-core/storage/
└── chatStorage.ts               # Storage abstraction layer
```

**Key Concepts:**

1. **ChatInstance (Class)**
   - Encapsulates a single conversation
   - Bound to an environment (`'mainnet'` | `'testnet'`)
   - Contains temporal message history (`ConversationItem[]`)
   - Manages multiple ExecutionArrays (Map<id, ExecutionArray>)
   - Handles persistence and lifecycle

2. **ConversationItem** (formerly ChatMessage)
   - Union type for all conversation elements:
     - `TextMessage` - User/bot text messages
     - `ExecutionMessage` - Blockchain operations (embeds ExecutionArrayState)
     - `SystemMessage` - System notifications
     - `KnowledgeRequestMessage` / `KnowledgeResponseMessage`
     - `SearchRequestMessage` / `SearchResponseMessage`
   - Enables temporal ordering of text and execution flows

3. **Environment Isolation**
   - `mainnet`: Production environment (Polkadot, Kusama)
   - `testnet`: Testing environment (Westend)
   - Chat instances cannot mix environments
   - Switching environment creates new chat instance

4. **Multiple Execution Flows**
   - Each conversation can have multiple independent ExecutionArrays
   - Each ExecutionArray has unique ID
   - Execution flows appear inline in conversation timeline
   - Can be interacted with independently

**Responsibilities:**
- Maintain conversation history with execution state
- Persist chat instances to storage
- Generate chat titles automatically
- Subscribe to execution updates
- Validate environment/network compatibility

**Design Principle**: Conversations are first-class entities that own their execution state, not just message logs.

---

### Frontend Components (`frontend/src/components/` — in frontend repo)

**Purpose**: React UI components for DotBot interface.

**Key Components:**

1. **Environment Management**
   - `EnvironmentBadge` - Visual indicator for current environment (mainnet/testnet)
   - `EnvironmentSwitch` - Toggle between mainnet and testnet environments
   - Integrated with DotBot's `switchEnvironment()` method

2. **Chat Interface**
   - `ChatHistory` - List of previous conversations with search capability
   - `Message` - Individual message component with avatar, name, date, and content
   - Supports both user and bot messages with proper styling

3. **Execution Flow**
   - `ExecutionFlow` - Visual representation of ExecutionArray
   - Shows transaction steps, status, and progress
   - "Accept & Start" button for user approval
   - Respects simulation setting (shows/hides simulation UI)

4. **Wallet Integration**
   - `WalletModal` - Wallet connection and account management
   - `WalletAccountItem` - Individual account display
   - `WalletAccountsList` - List of available accounts
   - `WalletConnectedState` - Connected wallet state display
   - `WalletEmptyState` - Empty state when no wallet connected

**Hooks:**
- `useDebounce` - Debounces function calls (used for Connect button to prevent rapid clicks)
- `useDebouncedClick` - Specialized hook for debouncing click handlers

**Styling:**
- Theme-aware CSS variables for light/dark mode
- Environment-specific styling (amber for testnet in light mode)
- Message bubble styling with proper border-radius and colors
- Responsive design considerations

**Design Principles:**
- Components are environment-aware
- UI reflects simulation state correctly
- Clear visual separation between mainnet and testnet
- User approval required before execution

---

### Data Management (`lib/dotbot-core/`)

**Purpose**: GDPR-compliant data management and storage abstraction.

**Structure:**
```
lib/dotbot-core/
├── dataManager.ts              # GDPR operations (export, delete, verify)
└── storage/chatStorage.ts       # Storage abstraction
```

**Key Components:**

1. **DataManager**
   - `exportAllData()` - Complete data export (JSON)
   - `exportAndDownload()` - Export with browser download
   - `nukeAllData()` - Complete data deletion (GDPR compliance)
   - `verifyDataCleared()` - Confirm deletion
   - Granular deletion: chat instances, RPC health, preferences, wallet cache

2. **Storage Abstraction (`IChatStorage`)**
   - Interface for chat persistence
   - Implementations:
     - `LocalStorageChatStorage` - Browser localStorage (current default)
     - `ApiChatStorage` - External database (ready for future)
     - `HybridChatStorage` - Offline-first with API sync
   - All operations async (ready for network requests)

3. **STORAGE_KEYS**
   - Centralized storage key enum
   - Keys scoped by data type (chats, RPC, preferences, etc.)
   - Enables complete data discovery and deletion

**Responsibilities:**
- GDPR right to erasure (complete data deletion)
- GDPR right to data portability (export)
- Storage backend abstraction
- Data integrity verification
- Privacy compliance

**Design Principle**: Data management is centralized, auditable, and privacy-first.

---

### ScenarioEngine (`lib/dotbot-core/scenarioEngine/`)

**Purpose**: Testing and evaluation framework for DotBot. Enables systematic testing of prompt handling, security, and functionality through the actual UI.

**Structure:**
```
lib/dotbot-core/scenarioEngine/
├── ScenarioEngine.ts          # Main orchestrator
├── types.ts                   # Core types (Scenario, StepResult, etc.)
├── index.ts                   # Public API exports
├── components/
│   ├── EntityCreator.ts       # Creates test accounts (keypairs, multisigs, proxies)
│   ├── StateAllocator.ts      # Sets up initial state (balances, on-chain, local)
│   ├── ScenarioExecutor.ts    # Executes scenarios
│   └── Evaluator.ts           # Evaluates results against expectations
└── scenarios/
    └── testPrompts.ts         # Pre-built test scenarios
```

**Key Components:**

1. **EntityCreator**
   - Creates deterministic test entities (Alice, Bob, multisigs, proxies)
   - Uses Substrate derivation paths for deterministic addresses
   - Generates keypairs, calculates multisig addresses, creates proxy accounts
   - Mode-aware (synthetic/emulated/live)

2. **StateAllocator**
   - Sets up initial state for scenario execution
   - **Synthetic mode**: TODO (disabled) – would track balances/assets in memory
   - **Emulated mode**: TODO (disabled) – would use Chopsticks to set chain state (requires backend server)
   - **Live mode**: Creates real transactions (with warnings)
   - Integrates with RpcManager for reliable connections
   - Restores chat history from snapshots

3. **ScenarioExecutor**
   - Executes scenarios **through** the DotBot UI (not around it)
   - Emits events that UI components subscribe to
   - Handles prompt injection, background actions, assertions
   - Two-step execution pattern (prepare → user approval → execute)
   - Pluggable and UI-independent (works in console too)

4. **Evaluator**
   - Evaluates scenario results against expectations
   - Generates LLM-consumable logs for analysis
   - Scores scenarios (0-100) with configurable thresholds
   - Provides detailed breakdowns and recommendations
   - Category-specific insights (security alerts, etc.)

**Key Concepts:**

1. **Execution Modes**
   - **Synthetic**: TODO (disabled) – would be fully mocked, no chain interaction
   - **Emulated**: TODO (disabled) – would use Chopsticks via backend server
   - **Live**: Real chain interaction (most realistic, requires testnet)

2. **Scenario Structure**
   - `Scenario`: Complete test definition (steps, expectations, environment)
   - `ScenarioStep`: Individual action (prompt, action, wait, assert)
   - `ScenarioExpectation`: What to verify (response type, content, security)

3. **Event-Driven Architecture**
   - All components emit `ScenarioEngineEvent` for observability
   - Frontend subscribes to events to display progress/logs
   - LLM-consumable logs for automated analysis

**Responsibilities:**
- Create test entities with deterministic addresses
- Set up initial blockchain and local state
- Execute prompts through real DotBot UI
- Evaluate responses against expectations
- Generate detailed evaluation reports

**Design Principle**: ScenarioEngine tests DotBot **through** the UI, not around it. This ensures tests reflect real user experience and catch UI-level issues.

---

## Testing Infrastructure

### OpenAPI-Based Testing

**Purpose**: Ensure backend API implementation matches the OpenAPI specification (base truth).

**Structure:**
```
backend/
├── openapi.yaml                    # API specification (base truth)
├── test-mock-api.sh               # Launch Prism mock server
└── test/
    └── integration/
        └── openapi-test-runner.ts  # OpenAPI test runner
```

**Key Components:**

1. **OpenAPI Specification (`openapi.yaml`)**
   - Single source of truth for all API contracts
   - Defines endpoints, request/response schemas, error codes
   - Used by Prism for mock server generation
   - Validated against actual implementation in tests

2. **Prism Mock Server**
   - Generates realistic mock API based on openapi.yaml
   - Enables frontend development before backend completion
   - Runs on port 8000 (same as real backend)
   - Command: `npm run mock` (from backend/)

3. **OpenAPITestRunner**
   - Validates actual backend implementation against openapi.yaml
   - Tests all endpoints defined in specification
   - Validates request/response schemas using AJV
   - Can test specific endpoints: `npm run test:endpoint /api/health`
   - Run all tests: `npm run test:integration`

**Testing Workflow:**

```
1. Define API contract in openapi.yaml
   ↓
2. Generate mock server with Prism
   ↓
3. Develop frontend against mock
   ↓
4. Implement backend endpoints
   ↓
5. Run OpenAPITestRunner to validate
   ↓
6. Fix discrepancies until all tests pass
```

**Example Test Run:**

```bash
# Test all endpoints
cd backend
npm run test:integration

# Test specific endpoint
npm run test:endpoint /api/health

# Start mock server for development
npm run mock
```

**Benefits:**
- Contract-first API development
- Frontend and backend can develop in parallel
- Automated validation of API compliance
- Self-documenting API specification
- Consistent error responses

**Version Added:** v0.2.0 (January 2026)

---

## Design Decisions

### Decision 1: Explicit Chain Selection for DOT Transfers

**Context:**
- November 2025: DOT balances migrated from Relay Chain → Asset Hub
- Users now have DOT on Asset Hub (primary) and optionally Relay Chain (staking/governance)
- Inferring chain from balance is unreliable

**Decision:**
Asset transfer agent requires explicit `chain` parameter (`'assetHub'` or `'relay'`).

**Rationale:**
1. **User Intent**: User knows which chain they want to use
2. **Predictability**: No surprises from heuristics
3. **Correctness**: Prevents wrong-chain operations
4. **Clarity**: API is explicit and self-documenting

**Alternatives Considered:**
1. ❌ **Balance-based inference**: Check both chains, use one with higher balance
   - Problem: What if user wants to transfer from lower-balance chain?
   - Problem: Extra RPC calls
   - Problem: Confusing behavior
   
2. ❌ **Default to Asset Hub**: Always use Asset Hub unless specified
   - Problem: Doesn't work for Relay Chain staking/governance operations
   - Problem: Still implicit

3. ✅ **Explicit parameter**: Require `chain` in request
   - Clear and predictable
   - No guessing
   - Matches user's mental model

**Consequences:**
- API requires additional parameter (minor inconvenience)
- Frontend must expose chain selection UI
- No ambiguity in behavior
- Future-proof as ecosystem evolves

**Implementation:**
```typescript
// User must specify chain
await agent.transfer({
  sender: address,
  recipient: address,
  amount: '10',
  chain: 'assetHub',  // Required!
  keepAlive: true
});
```

(Updated: January 2026)

---

### Decision 2: Agent Creates Extrinsic (Not Executioner)

**Context:**
- Initial implementation had executioner rebuild extrinsics from agent metadata
- Led to agent-specific rebuild logic in executioner
- Registry mismatches between agent API and executioner API

**Decision:**
Agents must create and return complete, ready-to-sign extrinsics.

**Rationale:**
1. **Separation of Concerns**: Agent encapsulates creation logic
2. **Scalability**: Executioner stays generic, works with any agent
3. **Correctness**: Extrinsic uses correct API registry from start
4. **Simplicity**: Executioner code reduced by 73%

**Alternatives Considered:**
1. ❌ **Metadata approach**: Agent returns metadata, executioner rebuilds
   - Problem: Executioner needs agent-specific logic
   - Problem: Doesn't scale to multiple agents
   - Problem: Registry mismatches
   
2. ✅ **Extrinsic approach**: Agent returns ready-to-sign extrinsic
   - Clean separation
   - Scalable to unlimited agents
   - Correct by construction

**Consequences:**
- Agents must have access to correct API instance (session API)
- Agents are responsible for production-safe extrinsic creation
- Executioner is simple and generic

**Code Comparison:**

Before (Metadata Approach):
```typescript
// Agent (200 lines)
async transfer(params) {
  // Validate
  return { metadata: { amount, recipient, ... } };
}

// Executioner (500 lines of agent-specific logic)
async execute(item) {
  // Create session
  // Rebuild extrinsic from metadata
  // Manual address encoding
  // Manual method selection
  // Registry validation
  // Then: simulate, sign, broadcast
}
```

After (Extrinsic Approach):
```typescript
// Agent (200 lines)
async transfer(params) {
  // Validate
  // Detect capabilities
  // Create production-safe extrinsic
  return { extrinsic: readyToSign };
}

// Executioner (150 lines, generic)
async execute(item) {
  // Extrinsic already perfect!
  // Just: simulate, sign, broadcast
}
```

(Updated: January 2026, see ARCHITECTURE_REVERSION_COMPLETE.md)

---

### Decision 3: Optional Chopsticks Simulation Before Execution

**Context:**
- Users can't predict if transaction will succeed
- Failed transactions waste fees
- Some errors only appear during runtime execution
- Simulation adds latency (1-3 seconds) which may not always be desired
- Chopsticks is a Node.js package that cannot run in the browser

**Decision:**
Simulation is **optional** and can be enabled/disabled. When enabled, all extrinsics are simulated with Chopsticks before signing. When disabled, execution proceeds directly to signing. Execution items initialize with status based on simulation setting (`'pending'` when enabled, `'ready'` when disabled).

**Architecture:**
- **Client-Server Model**: Chopsticks runs exclusively on the backend server (`@dotbot/express`)
- **Client Interface**: `@dotbot/core` provides a client interface that makes HTTP requests to the backend
- **Backend Implementation**: Server handles all Chopsticks setup, chain forking, and simulation execution
- **Benefits**: No frontend bundling issues, better performance, clean separation of concerns

**Rationale:**
1. **Error Prevention**: Catch failures before spending fees (when enabled)
2. **User Confidence**: Show balance changes preview (when enabled)
3. **Better UX**: Explain why transaction would fail (when enabled)
4. **Flexibility**: Can be disabled for speed or when simulation infrastructure unavailable
5. **Status-Aware Initialization**: UI correctly reflects execution flow based on simulation setting
6. **Client-Server Separation**: Chopsticks never touches the browser, avoiding bundling issues

**Alternatives Considered:**
1. ❌ **Always simulate**: Required simulation for all transactions
   - Problem: Adds latency even when not needed
   - Problem: Requires Chopsticks infrastructure always available
   
2. ❌ **No simulation**: Just send transactions and hope
   - Poor UX
   - Wasted fees on failures
   
3. ❌ **RPC dry-run only**: Use `paymentInfo()` or `dryRun()`
   - Doesn't actually execute runtime logic
   - Misses balance/permission issues
   
4. ❌ **Frontend-embedded Chopsticks**: Bundle Chopsticks in frontend
   - Problem: Node.js package cannot run in browser
   - Problem: Causes bundling errors and compatibility issues
   
5. ✅ **Optional Chopsticks simulation (client-server)**: Real runtime execution on backend server (when enabled)
   - Most accurate when enabled
   - Shows actual balance changes when enabled
   - Falls back gracefully if backend server unavailable
   - Can be disabled for speed
   - Status initialization adapts to simulation setting
   - No frontend bundling issues

**Consequences:**
- **When enabled**: Requires backend server running with Chopsticks dependency, adds latency (1-3 seconds), greatly improves UX, reduces failed transactions
- **When disabled**: Faster execution, no simulation infrastructure needed, items start as `'ready'` instead of `'pending'`
- **Status Flow**: Items initialize with `'pending'` status when simulation enabled (will be simulated), `'ready'` when disabled (ready for signing)
- **Backend Dependency**: Backend must have `@acala-network/chopsticks-core` installed and simulation routes mounted

**Implementation:**
```typescript
// Simulation control via SettingsManager (settingsManager.ts)
import { isSimulationEnabled } from './executionEngine/simulation/simulationConfig';

// Status-aware initialization (executionArray.ts, utils.ts)
const initialStatus = isSimulationEnabled() ? 'pending' : 'ready';

// Execution flow (executionSystem.ts, executioner.ts)
if (isSimulationEnabled()) {
  await runSimulation(extrinsic, context, executionArray, item);
} else {
  executionArray.updateStatus(item.id, 'ready');
}

// UI control (SettingsModal.tsx)
import { getSimulationConfig, updateSimulationConfig } from './services/settingsManager';
const config = getSimulationConfig();
updateSimulationConfig({ enabled: true }); // Enable/disable via UI
```

**Settings Management:**
- Settings persist to localStorage via `SettingsManager` singleton
- Default: `enabled: true` (simulation enabled by default)
- UI toggle available in SettingsModal
- All components use `isSimulationEnabled()` to check current state

**Multi-Transaction Simulation:**
For flows with multiple transactions, simulation uses sequential execution on a single fork:
```typescript
// ExecutionSystem automatically detects multi-transaction flows
if (items.length > 1) {
  // Sequential simulation on single fork - each transaction sees state from previous ones
  await this.simulateMultipleItemsSequentially(...);
} else {
  // Single transaction - standard simulation
  await this.simulateItem(...);
}
```

**History:**
- v0.2.2 (January 2026): Refactored to client-server architecture - Chopsticks moved from `@dotbot/core` to `@dotbot/express` (backend only)
- v0.2.0 (January 2026): Made simulation optional with status-aware initialization
- v0.2.1 (January 2026): Added SettingsManager for persistent configuration, UI toggle, sequential multi-transaction simulation
- v0.1.0 (January 2026): Initial implementation (simulation always attempted, frontend-embedded)

---

### Decision 4: Multi-Endpoint RPC Management

**Context:**
- Public RPC endpoints have reliability issues
- Single endpoint can go down or rate-limit
- Users face "connection failed" errors

**Decision:**
Use RpcManager with multiple endpoints, health monitoring, and automatic failover.

**Rationale:**
1. **Reliability**: Automatic failover to healthy endpoints
2. **Performance**: Use fastest available endpoint
3. **User Experience**: Seamless connection handling
4. **Production-Ready**: Handle real-world RPC issues

**Alternatives Considered:**
1. ❌ **Single endpoint**: Hard-code one RPC URL
   - Single point of failure
   - Rate limiting issues
   
2. ❌ **User-provided endpoint**: Let user choose
   - Poor UX
   - Most users don't know good endpoints
   
3. ✅ **Multi-endpoint manager**: Smart endpoint selection
   - Handles failures gracefully
   - Optimal performance
   - Better UX

**Consequences:**
- More complex connection logic
- Health monitoring overhead (minimal; periodic check every 30 minutes by default)
- Significantly improved reliability
- Disconnect/error handlers clear cached API so failover happens on next use

**Implementation:**
```typescript
const manager = new RpcManager([
  'wss://rpc.polkadot.io',
  'wss://polkadot-rpc.dwellir.com',
  'wss://polkadot.api.onfinality.io/public-ws'
]);

const api = await manager.getReadApi();  // Uses best available endpoint
// On api disconnect/error, cached read API is cleared; next getReadApi() fails over
```

**History:**
- v0.2.x (January 2026): Health check interval default 30 minutes; clear cached read API on disconnect/error for failover
- v0.2.0 (January 2026): Initial multi-endpoint decision

---

### Decision 5: Pluggable Signer Architecture

**Context:**
- Browser wallets (Talisman, SubWallet) use injected signers
- Testing requires programmatic signing
- Backend/automation needs different signing methods

**Decision:**
Create Signer interface with multiple implementations.

**Rationale:**
1. **Environment Flexibility**: Works in browser, terminal, backend
2. **Testability**: Mock signers for tests
3. **Extensibility**: Custom signing workflows
4. **Backward Compatibility**: Legacy browser integration still works

**Alternatives Considered:**
1. ❌ **Browser-only**: Hard-code browser wallet integration
   - Can't test without browser
   - Can't automate
   
2. ❌ **Keyring-only**: Use Polkadot-js keyring everywhere
   - Can't use browser wallets
   - Poor security (exposes private keys)
   
3. ✅ **Pluggable signers**: Interface with multiple implementations
   - Works everywhere
   - Testable
   - Extensible

**Consequences:**
- Signer must be passed to executioner
- Each environment needs appropriate signer implementation
- Cleaner architecture

**Implementation:**
```typescript
interface Signer {
  sign(extrinsic: SubmittableExtrinsic, address: string): Promise<Uint8Array>;
}

// Browser
const signer = new BrowserWalletSigner(walletExtension);

// Testing
const signer = new KeyringSigner(keyring.addFromUri('//Alice'));

// Custom
class CustomSigner implements Signer { ... }
```

(Updated: January 2026)

---

### Decision 6: Environment System (Mainnet/Testnet)

**Context:**
- Users need clear separation between production (mainnet) and testing (testnet) environments
- Chat instances should be isolated by environment to prevent accidental cross-environment operations
- UI needs to clearly indicate which environment is active
- Users should be able to switch environments easily
- Chat history should be searchable and filterable by environment

**Decision:**
Implement an environment system with:
1. `Environment` type: `'mainnet' | 'testnet'` (extensible for future environments)
2. Environment-bound chat instances (immutable environment binding)
3. Environment-aware UI components (EnvironmentBadge, EnvironmentSwitch)
4. Chat history with environment filtering
5. Automatic environment validation when switching networks

**Rationale:**
1. **Safety**: Prevents accidental testnet operations on mainnet
2. **Clarity**: Users always know which environment they're using
3. **Isolation**: Chat instances cannot mix environments
4. **UX**: Easy switching between environments with clear visual indicators
5. **Future-Proof**: Extensible to additional environments (devnet, etc.)

**Implementation:**
```typescript
type Environment = 'mainnet' | 'testnet';

// Chat instances bound to environment
class ChatInstance {
  readonly environment: Environment;  // Immutable
  readonly network: Network;          // Mutable within environment
}

// Environment validation
const ENVIRONMENT_NETWORKS: Record<Environment, Network[]> = {
  mainnet: ['polkadot', 'kusama'],
  testnet: ['westend']
};

// UI components
<EnvironmentBadge environment={dotbot.getEnvironment()} />
<EnvironmentSwitch 
  currentEnvironment={dotbot.getEnvironment()}
  onSwitch={async (env) => await dotbot.switchEnvironment(env)}
/>
```

**Consequences:**
- **Breaking**: Chat instances are now environment-bound (cannot change)
- **Feature**: Environment switching creates new chat instance
- **Feature**: Chat history can filter by environment
- **UI**: Clear visual indicators for current environment
- **Safety**: Prevents cross-environment operations

**History:**
- v0.2.0 (PR #44, #45, #46, January 2026): Initial environment system implementation
- v0.1.0: No environment concept (mainnet only)

---

### Decision 7: Multi-Network Architecture

**Context:**
- DotBot initially focused solely on Polkadot mainnet
- Users need testnet (Westend) support for safe experimentation
- Kusama support desired for complete ecosystem coverage
- Different networks have different characteristics (tokens, parachains, DEXes)
- LLM needs network-specific context to provide accurate responses

**Decision:**
Implement a comprehensive multi-network infrastructure with:
1. Type-safe network identifiers (`Network` type)
2. Centralized network metadata (`NETWORK_CONFIG`)
3. Network-aware RPC management
4. Network-specific knowledge bases for LLM context
5. Utility functions for network operations

**Rationale:**

1. **Type Safety**: Union type `'polkadot' | 'kusama' | 'westend'` provides compile-time safety
2. **Centralized Configuration**: Single source of truth for network properties
3. **LLM Context Quality**: Network-specific knowledge improves response accuracy
4. **Maintainability**: Easy to add new networks or update existing ones
5. **User Experience**: Seamless switching between networks with correct context

**Architecture Layers:**

**Layer 1: Type System**
```typescript
// Core network type
export type Network = 'polkadot' | 'kusama' | 'westend';

// Comprehensive network metadata
export interface NetworkMetadata {
  name: string;
  network: Network;
  token: string;
  decimals: number;
  ss58Format: number;
  relayChainEndpoints: string[];
  assetHubEndpoints: string[];
  isTestnet: boolean;
  color: string;
}

// Centralized configuration
export const NETWORK_CONFIG: Record<Network, NetworkMetadata> = {
  polkadot: { name: 'Polkadot', token: 'DOT', decimals: 10, ... },
  kusama: { name: 'Kusama', token: 'KSM', decimals: 12, ... },
  westend: { name: 'Westend', token: 'WND', decimals: 12, isTestnet: true, ... }
};
```

**Layer 2: RPC Management**
- Network-specific RPC managers via factory functions
- Storage isolation per network (health tracking)
- Pre-configured endpoint lists

```typescript
// Factory function for network-specific managers
const managers = createRpcManagersForNetwork('westend');
// Returns: { relayChainManager, assetHubManager }

// Network-specific factories
const relayManager = createWestendRelayChainManager();
const assetHubManager = createWestendAssetHubManager();
```

**Layer 3: Knowledge Base System**
- Separate knowledge files per network (e.g., `dotKnowledge.ts`, `westendKnowledge.ts`)
- Network-specific information (parachains, DEXes, tokens, fees)
- Dynamic loading based on selected network
- Formatted for LLM context injection

```typescript
const knowledge = getKnowledgeBaseForNetwork('westend');
const formatted = formatKnowledgeBaseForNetwork('westend');
// Returns: String formatted for LLM system prompt
```

**Layer 4: DotBot Core Integration**
```typescript
const dotbot = await DotBot.create({
  wallet: account,
  network: 'westend',  // Network parameter
  relayChainManager,
  assetHubManager
});

// DotBot automatically:
// - Uses correct token symbol (WND)
// - Includes Westend knowledge in LLM context
// - Sets testnet flag in system prompt
```

**Alternatives Considered:**

1. ❌ **String-based network IDs without types**
   - Problem: No compile-time safety
   - Problem: Typos cause runtime errors
   - Problem: No IDE autocomplete

2. ❌ **Scattered configuration across codebase**
   - Problem: Hard to maintain
   - Problem: Inconsistencies
   - Problem: Difficult to add new networks

3. ❌ **Single generic knowledge base for all networks**
   - Problem: Bloated LLM context
   - Problem: Inaccurate information (wrong parachains/DEXes)
   - Problem: Confusing responses (mentions Kusama when on Westend)

4. ✅ **Centralized, type-safe, network-specific system**
   - Type safety prevents errors
   - Easy to maintain and extend
   - Optimal LLM context per network
   - Clear separation of concerns

**Consequences:**

✅ **Benefits:**
- Type-safe network handling throughout codebase
- Single source of truth for network configuration
- LLM receives accurate, network-specific context
- Easy to add Kusama or future networks
- Better user experience with correct symbols/balances
- Comprehensive testing (600+ tests)

⚠️ **Trade-offs:**
- Additional abstraction layer (worth it for type safety)
- More test coverage needed per network (already done)
- Knowledge base files need maintenance (but centralized)

**Testing Strategy:**
- 30 tests for network utilities
- 15 tests for multi-network RPC management
- 13 tests for network-aware DotBot core
- All scenarios tested across all networks

**Future Extensions:**

This architecture enables:
1. **Environment-bound chat instances** (mainnet/testnet separation in UI)
2. **Kusama full support** (add `kusamaKnowledge.ts` - infrastructure already complete)
3. **Additional testnets** (Rococo, Paseo) with minimal changes
4. **Network-specific features** (e.g., Kusama canary features)

**Kusama Status:** Infrastructure is complete (RPC endpoints, factory functions, types), but `kusamaKnowledge.ts` needs to be created. Currently falls back to Polkadot knowledge.

**Implementation Files:**
- `lib/dotbot-core/prompts/system/knowledge/types.ts` - Type definitions
- `lib/dotbot-core/prompts/system/knowledge/networkUtils.ts` - Utilities (20+ functions)
- `lib/dotbot-core/prompts/system/knowledge/dotKnowledge.ts` - Polkadot knowledge
- `lib/dotbot-core/prompts/system/knowledge/westendKnowledge.ts` - Westend knowledge
- `lib/dotbot-core/rpcManager/` - Network-aware RPC management (RpcManager.ts, factories, healthTracker)
- `lib/dotbot-core/dotbot.ts` - DotBot class; `lib/dotbot-core/dotbot/create.ts` - Network/config in create args

**Jest Configuration:**
- CRACO setup required for Polkadot.js v14 static class blocks
- Transform patterns configured for `@polkadot` and `@acala-network` packages
- 600+ tests passing across all networks

**Documentation:**
- Complete API reference in `docs/API.md`
- Network utilities documented with examples
- Migration guide for existing integrations

(Added: January 2026)

---

### Decision 8: Chat Instance Architecture

**Context:**
- Initial implementation had execution state (ExecutionArray) as a global singleton in DotBot
- No concept of conversation history or persistence
- Execution flows needed to be part of conversation timeline, not separate
- Testing/production isolation required (mainnet vs testnet)

**Decision:**
Refactor ChatInstance from interface to full class that:
1. Encapsulates conversation history + execution state
2. Is bound to an environment (`'mainnet'` | `'testnet'`)
3. Supports multiple independent ExecutionArrays per conversation
4. Owns its persistence and lifecycle
5. DotBot internalizes ChatInstanceManager (better DX)

**Rationale:**

1. **State Ownership**: Execution state belongs to conversation, not DotBot
2. **Environment Isolation**: Prevents mixing testnet/mainnet operations
3. **Multiple Flows**: Users can have multiple transactions in-progress in one chat
4. **Temporal Ordering**: Execution flows appear inline with messages (user message → plan → ExecutionFlow → result)
5. **Developer Experience**: DotBot users don't need to manage ChatInstanceManager manually

**Key Changes:**

**Before (v0.1.0):**
```typescript
// DotBot owned execution state
class DotBot {
  private currentExecutionArray: ExecutionArray | null;
  
  async chat(message) {
    // ... LLM response
    // Auto-executes immediately
    this.currentExecutionArray = await this.execute(plan);
  }
}

// No conversation history
// No persistence
// No environment isolation
```

**After (v0.2.0):**
```typescript
// ChatInstance owns execution state
class ChatInstance {
  environment: Environment;
  messages: ConversationItem[];  // Mixed: text + executions
  private executionArrays: Map<string, ExecutionArray>;
  
  addExecutionMessage(state: ExecutionArrayState) { ... }
  setExecutionArray(id: string, array: ExecutionArray) { ... }
  onExecutionUpdate(id: string, callback) { ... }
}

// DotBot delegates to ChatInstance
class DotBot {
  private chatManager: ChatInstanceManager;
  public currentChat: ChatInstance | null;
  
  async chat(message) {
    // ... LLM response
    await this.prepareExecution(plan);  // Adds to chat, doesn't execute
    // User clicks "Accept & Start" → startExecution(executionId)
  }
  
  async switchEnvironment(env: Environment) {
    // Creates new ChatInstance for new environment
  }
}
```

**Two-Step Execution Pattern:**
```typescript
// Step 1: Prepare (after LLM response)
await dotbot.prepareExecution(plan);
// → Orchestrates, adds ExecutionMessage to chat
// → UI shows ExecutionFlow for review

// Step 2: Execute (when user approves)
await dotbot.startExecution(executionMessage.executionId);
// → Executes specific flow by ID
```

**Alternatives Considered:**

1. ❌ **Global execution state in DotBot**
   - Can't support multiple flows
   - No environment isolation
   - Doesn't scale to chat history UI

2. ❌ **Separate ExecutionManager**
   - Splits conversation from execution (artificial separation)
   - Hard to maintain temporal ordering
   - Extra complexity for developers

3. ✅ **ChatInstance owns execution**
   - Natural ownership model
   - Temporal ordering built-in
   - Environment isolation automatic
   - Clean developer API

**Consequences:**
- **Breaking**: Removed `onExecutionArrayUpdate()` → use `chat.onExecutionUpdate(id, callback)`
- **Breaking**: Removed `executeWithArrayTracking()` → use `prepareExecution()` + `startExecution(id)`
- **Breaking**: Renamed `ChatMessage` → `ConversationItem` (better reflects mixed content)
- **Breaking**: Renamed `ChatInstance` interface → `ChatInstanceData`
- **Feature**: Multiple execution flows per conversation
- **Feature**: Environment-bound chat instances
- **Feature**: User approval before execution (better UX, safer)
- **DX**: Developers import less, DotBot manages more internally

**Implementation Highlights:**

1. **Unique IDs everywhere:**
   - `ExecutionArray` generates unique ID
   - `ExecutionMessage` stores `executionId`
   - Enables tracking and interaction with specific flows

2. **ConversationItem type:**
   ```typescript
   type ConversationItem = 
     | TextMessage 
     | ExecutionMessage 
     | SystemMessage 
     | KnowledgeRequestMessage 
     | /* ... */;
   ```
   - Union type for all conversation elements
   - UI maps over `conversationItems` and renders appropriately

3. **Storage abstraction ready:**
   - `ChatInstanceManager` uses `IChatStorage` interface
   - Default: `LocalStorageChatStorage`
   - Ready for: `ApiChatStorage` (external DB)

(Added: January 2026)

---

### Decision 9: Storage Abstraction and GDPR Compliance

**Context:**
- Chat instances need persistence (localStorage initially)
- Future requirement: external database for multi-device sync
- We take privacy, data portability seriously
- Storage backend might change (localStorage → API → hybrid)
- Need auditable data management

**Decision:**
Implement:
1. Storage abstraction layer (`IChatStorage` interface)
2. GDPR-compliant `DataManager` class
3. Centralized storage key management (`STORAGE_KEYS` enum)
4. Async-first API (ready for network requests)

**Rationale:**

1. **Future-Proof**: Easy to switch from localStorage to external DB
3. **Testability**: Can mock storage in tests
4. **Auditability**: Centralized data operations
5. **Privacy-First**: Users control their data

**Architecture:**

**Storage Abstraction:**
```typescript
interface IChatStorage {
  loadAll(): Promise<ChatInstanceData[]>;
  load(id: string): Promise<ChatInstanceData | null>;
  save(instance: ChatInstanceData): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  isAvailable(): Promise<boolean>;
  getType(): string;
}

// Implementations
class LocalStorageChatStorage implements IChatStorage { ... }
class ApiChatStorage implements IChatStorage { ... }
class HybridChatStorage implements IChatStorage { ... }

// Factory
const storage = createChatStorage({ 
  type: 'local',  // or 'api', 'hybrid'
  apiUrl: 'https://...'
});
```

**GDPR Operations:**
```typescript
class DataManager {
  // Export all data (right to data portability)
  async exportAllData(): Promise<DataExport> {
    return {
      chatInstances: [...],
      rpcHealth: [...],
      userPreferences: { ... },
      walletCache: { ... },
      metadata: { exportedAt, version }
    };
  }
  
  // Delete all data (right to erasure)
  async nukeAllData(): Promise<DeletionReport> {
    // Deletes ALL storage keys
    // Returns verification report
  }
  
  // Verify complete deletion
  async verifyDataCleared(): Promise<boolean> {
    // Confirms no DotBot data remains
  }
  
  // Granular deletion
  async deleteChatData(): Promise<number>;
  async deleteRpcHealthData(): Promise<number>;
  async deletePreferences(): Promise<boolean>;
  async deleteWalletCache(): Promise<boolean>;
}

// Global convenience
await nukeAllData();
await exportAndDownload('dotbot-data.json');
```

**Centralized Keys:**
```typescript
export const STORAGE_KEYS = {
  CHAT_INSTANCES: 'dotbot_chat_instances',
  RPC_HEALTH_POLKADOT_RELAY: 'rpc_health_polkadot_relay',
  RPC_HEALTH_POLKADOT_ASSETHUB: 'rpc_health_polkadot_assethub',
  // ... all storage keys enumerated
} as const;
```

**Alternatives Considered:**

1. ❌ **Direct localStorage calls throughout codebase**
   - Hard to switch backends
   - No GDPR compliance
   - Can't mock for testing

2. ❌ **Simple wrapper around localStorage**
   - Not async (can't add API later)
   - No interface (can't swap implementations)

3. ✅ **Full abstraction + GDPR module**
   - Future-proof
   - Compliant
   - Testable
   - Professional

**Consequences:**
- **Feature**: All storage operations async (ready for network)
- **Feature**: Complete GDPR compliance
- **Feature**: Easy storage backend switching
- **Feature**: Granular data deletion
- **Complexity**: More abstraction layers
- **Benefit**: Professional-grade data management
- **Benefit**: Users can export/delete all data easily

**GDPR Requirements Met:**
- ✅ Right to erasure (`nukeAllData()`)
- ✅ Right to data portability (`exportAllData()`)
- ✅ Transparent data collection (enumerated keys)
- ✅ Complete deletion verification
- ✅ Granular deletion control

(Added: January 2026)

---

## Data Flow

### Transfer Operation Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. USER INPUT                                               │
│    User: "Send 5 DOT to Alice"                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. AGENT PREPARATION                                        │
│                                                             │
│    AssetTransferAgent.transfer({                           │
│      sender: user.address,                                 │
│      recipient: 'alice-address',                           │
│      amount: '5',                                          │
│      chain: 'assetHub',                                    │
│      keepAlive: true                                       │
│    })                                                      │
│                                                             │
│    ┌─────────────────────────────────────────┐           │
│    │ a) Validate addresses                   │           │
│    │ b) Detect runtime capabilities          │           │
│    │ c) Validate balance + ED                │           │
│    │ d) Create production-safe extrinsic     │           │
│    │ e) Optionally simulate with Chopsticks  │           │
│    │    (via backend server)                 │           │
│    └─────────────────────────────────────────┘           │
│                                                             │
│    Returns: AgentResult {                                  │
│      extrinsic: SubmittableExtrinsic,  ← Ready to sign!  │
│      description: "Transfer 5 DOT to Alice",              │
│      estimatedFee: "100000000",                           │
│    }                                                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. EXECUTION (Executioner)                                  │
│                                                             │
│    executioner.execute(agentResult)                        │
│                                                             │
│    ┌─────────────────────────────────────────┐           │
│    │ a) Simulation (optional, backend)      │           │
│    │    - If enabled:                        │           │
│    │      • HTTP request to backend          │           │
│    │      • Backend runs Chopsticks          │           │
│    │      • Show balance changes              │           │
│    │      • Catch errors early                │           │
│    │    - If disabled:                        │           │
│    │      • Skip simulation                   │           │
│    │      • Status: 'ready'                   │           │
│    └─────────────────────────────────────────┘           │
│                     ↓                                       │
│    ┌─────────────────────────────────────────┐           │
│    │ b) Signing                              │           │
│    │    - Show user transaction details      │           │
│    │    - Request approval                   │           │
│    │    - Sign with wallet                   │           │
│    └─────────────────────────────────────────┘           │
│                     ↓                                       │
│    ┌─────────────────────────────────────────┐           │
│    │ c) Broadcasting                         │           │
│    │    - Submit signed extrinsic to network │           │
│    │    - Get transaction hash               │           │
│    └─────────────────────────────────────────┘           │
│                     ↓                                       │
│    ┌─────────────────────────────────────────┐           │
│    │ d) Monitoring                           │           │
│    │    - Wait for InBlock                   │           │
│    │    - Wait for Finalized                 │           │
│    │    - Extract events                     │           │
│    └─────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. RESULT                                                   │
│                                                             │
│    ExecutionResult {                                        │
│      success: true,                                        │
│      blockHash: "0x...",                                   │
│      txHash: "0x...",                                      │
│      events: [...]                                         │
│    }                                                       │
└─────────────────────────────────────────────────────────────┘
```

### Key Data Structures

**AgentResult** (Agent → Executioner):
```typescript
interface AgentResult {
  description: string;
  extrinsic: SubmittableExtrinsic<'promise'>;
  estimatedFee?: string;
  warnings?: string[];
  metadata?: Record<string, any>;
  resultType: 'extrinsic' | 'data';
  requiresConfirmation: boolean;
  executionType: 'extrinsic' | 'data_fetch';
}
```

**ExecutionResult** (Executioner → User):
```typescript
interface ExecutionResult {
  success: boolean;
  blockHash?: string;
  txHash?: string;
  events?: any[];
  error?: string;
  errorCode?: string;
}
```

### Network-Aware Data Flow

**Network Selection Flow:**
```
1. Application initializes with network parameter ('polkadot', 'kusama', or 'westend')
   ↓
2. Factory creates network-specific RPC managers
   ├─ createRpcManagersForNetwork(network)
   ├─ Returns { relayChainManager, assetHubManager }
   └─ Each manager has network-scoped storage
   ↓
3. DotBot.create() receives network parameter
   ├─ Loads network-specific knowledge base
   ├─ Formats knowledge for LLM context
   └─ Sets network-aware flags (isTestnet, token symbol)
   ↓
4. During chat interactions
   ├─ System prompt includes network-specific knowledge
   ├─ Balance displays use correct token symbol
   └─ Operations use correct RPC endpoints
```

**Network Detection Flow:**
```
Connected to unknown chain
   ↓
detectNetworkFromChainName(chainName)
   ├─ Checks chain metadata
   ├─ Matches against known patterns
   └─ Returns Network type
   ↓
getNetworkMetadata(network)
   └─ Provides all configuration
```

---

## Conventions

### Code Style

1. **TypeScript Strict Mode**: All code uses strict TypeScript
2. **Explicit Types**: No implicit `any` (use `unknown` instead)
3. **Error Handling**: Custom error classes (AgentError, SimulationError, etc.)
4. **Async/Await**: Prefer async/await over Promise chains

### Naming Conventions

1. **Classes**: PascalCase (`AssetTransferAgent`, `Executioner`)
2. **Functions**: camelCase (`buildSafeTransferExtrinsic`, `detectCapabilities`)
3. **Constants**: UPPER_SNAKE_CASE (`MAX_BATCH_SIZE`, `DEFAULT_TIMEOUT`)
4. **Files**: camelCase for utilities, PascalCase for classes

### URL Configuration Conventions

DotBot uses a consistent URL pattern to prevent the "double /api" problem:

**Base URLs (Environment Variables):**
- **Never** include `/api` suffix in base URLs
- Examples: `REACT_APP_API_URL=https://example.com`, `BACKEND_URL=https://example.com`

**API Paths (Application Code):**
- **Always** append `/api` prefix when making API calls
- Examples: `${API_BASE_URL}/api/health`, `${API_BASE_URL}/api/dotbot/chat`

**Rationale:**
- Single source of truth for domain configuration
- Flexibility to change API path prefix if needed
- Clear separation between base URL and API paths
- Prevents double `/api/api` paths in requests

**Configuration Validation:**
- Backend validates URLs at startup
- Production fails fast on invalid configurations (URLs with `/api` suffix)
- Development/staging logs warnings for deprecated formats

### Agent Development

When creating a new agent:

1. **Extend BaseAgent**: Reuse common functionality
2. **Create Extrinsics**: Agent must return ready-to-sign extrinsic
3. **Detect Capabilities**: Use runtime introspection
4. **Handle Errors**: Use AgentError with error codes
5. **Simulation**: Optionally validate with Chopsticks (via backend server)
6. **Document**: JSDoc for all public methods

**Template:**
```typescript
export class MyNewAgent extends BaseAgent {
  getAgentName(): string {
    return 'MyNewAgent';
  }

  async myOperation(params: MyParams): Promise<AgentResult> {
    this.ensureInitialized();
    
    // 1. Validate input
    this.validateAddress(params.address);
    
    // 2. Detect capabilities
    const capabilities = await detectMyCapabilities(this.api);
    
    // 3. Create extrinsic
    const extrinsic = buildMyExtrinsic(this.api, params, capabilities);
    
    // 4. Optional: Dry run
    await this.dryRunExtrinsic(extrinsic, params.address);
    
    // 5. Return result
    return this.createResult(
      'Human-readable description',
      extrinsic,
      { estimatedFee: '...' }
    );
  }
}
```

### Error Handling

**Custom Error Classes:**
```typescript
class AgentError extends Error {
  code: string;
  details?: any;
  
  constructor(message: string, code: string, details?: any) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.details = details;
  }
}
```

**Error Codes:**
- `NOT_INITIALIZED`: Agent not initialized
- `INVALID_ADDRESS`: Address validation failed
- `INSUFFICIENT_BALANCE`: Not enough funds
- `CAPABILITY_NOT_SUPPORTED`: Runtime missing required method
- `SIMULATION_FAILED`: Chopsticks simulation failed (backend server error or unavailable)
- `SIGNING_REJECTED`: User rejected transaction
- `BROADCAST_FAILED`: Network submission failed

---

## Dependencies

### Core Dependencies

**Polkadot.js API** (`@polkadot/api`)
- Purpose: Blockchain interaction
- Why: Industry standard, well-maintained
- Version: ^14.3.1

**Polkadot.js Util** (`@polkadot/util`, `@polkadot/util-crypto`)
- Purpose: Address encoding, BN math, cryptography
- Why: Polkadot-native utilities
- Version: ^14.0.1

### Backend Dependencies

**Chopsticks** (`@acala-network/chopsticks-core`)
- Purpose: Runtime simulation (backend only)
- Location: `@dotbot/express` package only
- Why: Most accurate pre-execution validation
- Note: Not available in `@dotbot/core` (client makes HTTP requests to backend)
- Optional: Falls back gracefully if backend server unavailable

**Express.js** (`express`)
- Purpose: HTTP server and routing
- Why: Industry-standard Node.js web framework
- Version: ^4.18.2

**@dotbot/express**
- Purpose: Express integration layer for DotBot
- Why: Encapsulates routing, middleware, session management, **Chopsticks simulation**
- Location: `lib/dotbot-express` (workspace)
- **Chopsticks Integration**: Contains all Chopsticks simulation logic (server-side only)

**@dotbot/core**
- Purpose: Core blockchain logic (shared with frontend)
- Why: Single source of truth for DotBot functionality
- Location: `lib/dotbot-core` (workspace)

**Pino** (`pino`)
- Purpose: Structured logging
- Why: Fast, low-overhead, production-ready
- Version: ^9.9.4

### Testing & Development Dependencies

**Prism** (`@stoplight/prism-cli`)
- Purpose: OpenAPI mock server
- Why: Generate realistic mocks from openapi.yaml
- Version: ^5.14.2

**TypeScript** (`typescript`)
- Purpose: Type-safe JavaScript
- Why: Type safety across entire stack
- Version: ^5.3.3

**ts-node-dev** (`ts-node-dev`)
- Purpose: Development server with hot reload
- Why: Fast development iteration
- Version: ^2.0.0

**AJV** (`ajv`, `ajv-formats`)
- Purpose: JSON schema validation
- Why: Validate OpenAPI request/response schemas
- Version: ^8.17.1

**Axios** (`axios`)
- Purpose: HTTP client for integration tests
- Why: Reliable, well-documented
- Version: ^1.13.2

### Monorepo Dependencies

**npm workspaces** (built-in)
- Purpose: Monorepo management
- Why: Built into npm, no extra tools needed
- Workspaces: backend, frontend, lib/dotbot-core, lib/dotbot-express

### Design Rationale

1. **Minimal Dependencies**: Only essential libraries
2. **TypeScript Everywhere**: Type safety across frontend, backend, libs
3. **No Framework Lock-in**: Core logic (`@dotbot/core`) is framework-agnostic
4. **Production-Tested**: All dependencies widely used in production
5. **Contract-First**: OpenAPI + Prism ensures API compliance
6. **Monorepo Benefits**: Shared dependencies, atomic changes

---

## Testing Strategy

### Unit Tests

**Agents:**
- Test extrinsic creation
- Mock API responses
- Verify capability detection
- Test error handling

**Execution Engine:**
- Mock agents
- Test simulation flow
- Test signing flow
- Test broadcasting flow

**ScenarioEngine:**
- EntityCreator: Deterministic address generation, multisig calculation
- StateAllocator: Balance/asset allocation, chat history restoration
- ScenarioExecutor: Step execution, event emission, UI callbacks
- Evaluator: Expectation evaluation, scoring, report generation

### Integration Tests

- Real RPC connections
- Chopsticks simulation
- End-to-end transaction flow (on testnet)

### Manual Testing Checklist

- [ ] Single transfer (Relay Chain)
- [ ] Single transfer (Asset Hub)
- [ ] Batch transfer
- [ ] Insufficient balance error
- [ ] Invalid address error
- [ ] Simulation failure
- [ ] User rejection
- [ ] Network failure

---

## Performance Considerations

### RPC Calls Optimization

1. **Connection Reuse**: Single API instance per chain
2. **Capability Caching**: Detect once, reuse
3. **Batch Queries**: Use `api.queryMulti()` when possible

### Memory Management

1. **API Cleanup**: Disconnect when done
2. **Event Listener Cleanup**: Unsubscribe after monitoring
3. **Extrinsic Disposal**: Don't hold references after execution

### User Experience

1. **Optimistic UI**: Show pending state immediately
2. **Background Monitoring**: Don't block UI during finalization
3. **Progress Feedback**: Update user on each execution phase

---

## Future Considerations

### Planned Improvements

1. **Agent Registry**: Dynamic agent discovery and loading
2. **Parallel Execution**: Execute independent operations concurrently
3. **Transaction Batching**: Combine multiple user operations
4. **XCM Support**: Cross-chain transfers
5. **Multi-Signature**: Complex authorization workflows

### Potential Challenges

1. **Runtime Upgrades**: Method deprecations, new features
2. **Chain Diversity**: Different parachains have different capabilities
3. **XCM Complexity**: Cross-chain operations are complex
4. **Performance**: Simulation adds latency

---

### Decision 10: Two-Step Execution Pattern

**Context:**
- Initial implementation auto-executed transactions immediately after LLM response
- Users had no opportunity to review transactions before signing
- Execution state was global in DotBot, preventing multiple concurrent flows
- No way to resume interrupted execution flows

**Decision:**
Implement two-step execution pattern:
1. **Prepare**: `prepareExecution(plan)` - Orchestrates plan, adds ExecutionMessage to chat, shows UI for review
2. **Execute**: `startExecution(executionId)` - Executes when user clicks "Accept & Start"

**Rationale:**
1. **User Safety**: Users can review transactions before signing
2. **Better UX**: Clear separation between planning and execution
3. **Multiple Flows**: Supports multiple independent execution flows per conversation
4. **Resumable**: Interrupted flows can be rebuilt and resumed
5. **State Ownership**: Execution state belongs to ChatInstance, not DotBot

**Implementation:**
```typescript
// Step 1: Prepare (automatic after LLM response)
await dotbot.prepareExecution(plan);
// → Orchestrates ExecutionPlan → ExecutionArray
// → Adds ExecutionMessage to chat timeline
// → UI shows ExecutionFlow component with "Accept & Start" button

// Step 2: Execute (user-triggered)
await dotbot.startExecution(executionMessage.executionId);
// → Executes specific ExecutionArray by ID
// → Updates ExecutionMessage in chat as execution progresses
```

**Breaking Changes:**
- ⚠️ **Removed**: `executeWithArrayTracking()` → use `prepareExecution()` + `startExecution(id)`
- ⚠️ **Removed**: `onExecutionArrayUpdate()` → use `chat.onExecutionUpdate(id, callback)`
- ⚠️ **Removed**: `currentExecutionArray` property → use `chat.getExecutionArray(id)`
- ⚠️ **Changed**: `chat()` no longer auto-executes → returns `executed: false`, user must approve

**Consequences:**
- **Breaking**: Existing code using removed methods must migrate
- **Feature**: User approval required before execution
- **Feature**: Multiple execution flows per conversation
- **Feature**: Execution flows can be resumed after interruption
- **DX**: Cleaner API, better separation of concerns

**History:**
- v0.2.0 (PR #44, #45, January 2026): Two-step execution pattern introduced
- v0.1.0: Auto-execution immediately after LLM response

---

### Decision 11: ScenarioEngine Architecture

**Context:**
- Need systematic testing framework for DotBot's LLM-driven behavior
- Must test through actual UI (not bypass it) to catch real issues
- Need deterministic test entities for reproducible tests
- Want to test across different execution modes (synthetic, emulated, live)
- Need LLM-consumable evaluation logs for automated analysis

**Decision:**
Implement ScenarioEngine as a pluggable testing framework with four core components:
1. **EntityCreator**: Deterministic test account generation
2. **StateAllocator**: Initial state setup (balances, on-chain, local storage)
3. **ScenarioExecutor**: Executes scenarios through DotBot UI via events
4. **Evaluator**: Evaluates results and generates LLM-consumable logs

**Rationale:**
1. **UI Integration**: Testing through UI catches real user experience issues
2. **Deterministic Entities**: Same seed → same addresses (reproducible tests)
3. **Pluggable Design**: Works in browser, console, or CI environments
4. **Event-Driven**: Observable execution for debugging and analysis
5. **LLM-Consumable Logs**: Structured logs enable automated test analysis
6. **Mode Flexibility**: Synthetic for speed, emulated for realism, live for confidence

**Implementation:**
```typescript
// EntityCreator: Deterministic keypair generation
const entityCreator = createEntityCreator('synthetic', {
  seedPrefix: 'test',
  ss58Format: 42, // Westend
});
const alice = await entityCreator.createKeypairEntity('Alice');
// Same seed → same address every time

// StateAllocator: Set up initial state
const allocator = createStateAllocator('emulated', 'westend', {
  entityResolver: (name) => entities.get(name),
  rpcManagerProvider: () => ({ relayChainManager, assetHubManager }),
});
await allocator.allocateBalance('Alice', '100 DOT');

// ScenarioExecutor: Execute through UI
const executor = createScenarioExecutor();
executor.setDependencies({ api, dotbot });
executor.addEventListener((event) => {
  // UI subscribes to events (inject-prompt, log, etc.)
});
await executor.executeScenario(scenario);

// Evaluator: Evaluate results
const evaluator = createEvaluator();
evaluator.addEventListener((event) => {
  // LLM-consumable logs
});
const result = evaluator.evaluate(scenario, stepResults);
```

**Key Design Choices:**

1. **Deterministic Entity Creation**
   - Uses Substrate derivation paths: `//{seedPrefix}/{name}`
   - Same input → same address (critical for reproducible tests)
   - Multisig addresses calculated deterministically from sorted signatories

2. **RPC Manager Integration**
   - StateAllocator uses RpcManager (not direct connections)
   - Leverages health checks, failover, round-robin
   - ExecutionSession locks API instance during transactions

3. **Event-Driven Execution**
   - Executor emits events, UI subscribes
   - No direct UI dependencies (works in console)
   - LLM-consumable logs for automated analysis

4. **Pluggable Dependencies**
   - Executor accepts DotBot instance, API, entity resolvers
   - StateAllocator accepts RPC manager provider
   - Enables testing in any environment

**Alternatives Considered:**

1. ❌ **Separate Test Harness (Bypass UI)**
   - Problem: Doesn't catch UI-level issues
   - Problem: Tests don't reflect real user experience
   - Problem: UI changes break tests even if logic is correct

2. ❌ **Non-Deterministic Entities**
   - Problem: Tests not reproducible
   - Problem: Hard to debug (addresses change each run)
   - Problem: Can't hardcode addresses in scenarios

3. ❌ **Direct API Connections**
   - Problem: Doesn't leverage RPC management infrastructure
   - Problem: No health checks or failover
   - Problem: Duplicates existing functionality

4. ✅ **Event-Driven Through UI with Deterministic Entities**
   - Tests real user experience
   - Reproducible and debuggable
   - Leverages existing infrastructure
   - Pluggable and environment-agnostic

**Consequences:**

✅ **Benefits:**
- Tests reflect real user experience
- Reproducible test results
- LLM-consumable evaluation logs
- Works in multiple environments (browser, console, CI)
- Comprehensive test coverage (unit + integration)

⚠️ **Trade-offs:**
- Requires UI integration (but that's the point - test through UI)
- More complex than simple unit tests (but more valuable)
- Event-driven architecture adds some complexity (but enables observability)

**Testing Strategy:**
- Unit tests for each component (EntityCreator, StateAllocator, ScenarioExecutor, Evaluator)
- Integration tests for end-to-end scenarios (optional, can use unit tests)
- Manual verification scripts (removed - unit tests sufficient)

**History:**
- v0.2.0 (PR #50+, January 2026): Initial ScenarioEngine implementation
  - EntityCreator with deterministic keypair generation
  - StateAllocator with multi-mode support
  - ScenarioExecutor with event-driven UI integration
  - Evaluator with LLM-consumable logging

---

### Decision 12: TypeScript Backend Migration and Monorepo Structure

**Context:**
- Initial backend was Python-based with FastAPI (was not used)
- Frontend was React/TypeScript with separate lib folder
- Code duplication between frontend lib and potential backend usage
- Different languages complicated development workflow
- Agent system was separate (Python-based Fetch.ai agents)

**Decision:**
Migrate to TypeScript backend with monorepo structure:
1. Replace Python backend with Express.js/TypeScript backend
2. Move `@dotbot/core` to project root `lib/` folder
3. Create `@dotbot/express` library for backend Express integration
4. Use npm workspaces for monorepo management
5. Define API contract in `openapi.yaml` as base truth
6. Use Prism for mock server generation
7. Implement OpenAPI-based integration testing

**Rationale:**

1. **Type Safety Across Stack**: TypeScript everywhere (frontend, backend, shared libs)
2. **Code Sharing**: `@dotbot/core` shared between frontend and backend without duplication
3. **Developer Experience**: Single language, consistent tooling, easier debugging
4. **Monorepo Benefits**: 
   - Single dependency management
   - Atomic cross-workspace changes
   - Easier refactoring
   - Better CI/CD
5. **Contract-First API**: OpenAPI spec as single source of truth prevents drift
6. **Testing Infrastructure**: Prism + OpenAPITestRunner ensure compliance

**Implementation:**

**Before (v0.1.0):**
```
DotBot/
├── frontend/
│   ├── src/lib/         # Frontend-only lib
│   └── package.json
├── backend/             # Python/FastAPI
│   ├── main.py
│   └── requirements.txt
└── agents/              # Separate Python agents
```

**After (v0.2.0):**
```
DotBot/                  # Monorepo root
├── package.json         # Workspaces: backend, frontend, lib/*
├── lib/
│   ├── dotbot-core/     # Shared core logic
│   └── dotbot-express/  # Express integration
├── backend/             # TypeScript/Express
│   ├── src/
│   ├── openapi.yaml
│   └── package.json     # Depends on: @dotbot/core, @dotbot/express
└── frontend/            # React/TypeScript
    └── package.json     # Depends on: @dotbot/core
```

**API Structure:**

```typescript
// Shared core (lib/dotbot-core)
export { DotBot } from './dotbot';
export { AssetTransferAgent } from './agents/asset-transfer';
export { AIService } from './services/ai/aiService';

// Express integration (lib/dotbot-express)
export { chatRouter } from './routes/chat';
export { dotbotRouter } from './routes/dotbot';
export { sessionManager } from './sessionManager';

// Backend (backend/src)
import express from 'express';
import { chatRouter, dotbotRouter } from '@dotbot/express';

const app = express();
app.use('/api', chatRouter);
app.use('/api', dotbotRouter);
```

**OpenAPI Contract Example:**

```yaml
# backend/openapi.yaml
paths:
  /api/chat:
    post:
      summary: Send a chat message
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                message: { type: string }
                provider: { type: string, enum: [asi-one, claude] }
      responses:
        '200':
          description: Chat response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ChatResponse'
```

**Alternatives Considered:**

1. ❌ **Keep Python Backend**
   - Problem: Code duplication (Python backend can't use TypeScript lib)
   - Problem: Different dev environments
   - Problem: Type mismatches at API boundary

2. ❌ **Polyrepo (Separate Repositories)**
   - Problem: Dependency management complexity
   - Problem: Hard to make atomic changes across packages
   - Problem: Version synchronization issues

3. ✅ **TypeScript Backend + Monorepo**
   - Type safety across entire stack
   - Code sharing without duplication
   - Unified development environment
   - Atomic cross-package changes

**Consequences:**

✅ **Benefits:**
- Single language (TypeScript) across stack
- Shared `@dotbot/core` logic (no duplication)
- Better type safety (no JSON type mismatches)
- Easier refactoring (changes propagate)
- Consistent developer experience
- OpenAPI ensures API contract compliance
- Prism enables parallel frontend/backend development

⚠️ **Trade-offs:**
- Migration effort (Python → TypeScript)
- Monorepo complexity (workspace management)
- OpenAPI maintenance (must keep in sync)

📊 **Migration Stats:**
- **Deleted**: ~2000 lines Python backend
- **Deleted**: Separate agents/ folder (now in `@dotbot/core`)
- **Added**: `lib/dotbot-express` (~800 lines)
- **Added**: `openapi.yaml` (1100 lines)
- **Added**: OpenAPITestRunner (~400 lines)
- **Added**: Prism integration
- **Refactored**: Frontend to use shared `lib/dotbot-core`

**Testing Infrastructure:**

```bash
# Run mock server (Prism)
npm run mock

# Test specific endpoint
npm run test:endpoint /api/health

# Test all endpoints
npm run test:integration
```

**Future Extensions:**

This architecture enables:
1. **NPM Publishing**: Publish `@dotbot/core` and `@dotbot/express` to npm
2. **Additional Backends**: Other frameworks can use `@dotbot/core` + `@dotbot/express`
3. **Microservices**: Extract workspaces into separate services if needed
4. **Shared Tooling**: ESLint, Prettier, TSConfig across all workspaces

**History:**
- v0.2.0 (PR #60+, January 2026): TypeScript backend migration, monorepo structure
- v0.1.0: Python backend with FastAPI

---

### Decision 13: LLM Output Format Guardrail (ExecutionPlan Reliability)

**Context:**
- The LLM (e.g. ASI-One) sometimes returns prose (e.g. "I've prepared a transaction flow with 1 step...") instead of a JSON ExecutionPlan, so no ExecutionFlow is shown and the user gets incorrect feedback.
- Instruction-tuned models have a strong reflex to explain in prose; prompt instructions alone do not guarantee JSON-only output on every call.

**Decision:**
Use a three-layer approach to maximize ExecutionPlan reliability:

1. **Output Mode Override (prompt)**: At the start of the system prompt, state that when responding with an ExecutionPlan the model is in **JSON MODE** — it is a JSON generator, not an assistant; emitting any prose is a failure. This gives a mode identity and reduces assistant-style reflexes.

2. **Final Line Hard Stop (prompt)**: At the end of the system prompt, add a **FINAL CHECK BEFORE RESPONDING**: "If you are about to generate an ExecutionPlan: STOP. DELETE any prose. OUTPUT ONLY the \`\`\`json block." Models tend to treat final checks seriously.

3. **Code-level safety net (llm.ts)**: In `getLLMResponse()`, after receiving the LLM response, if the response does not start with \`\`\`json and either (a) contains a JSON block later, or (b) looks like command prose (e.g. "I've prepared", "transaction flow", "Review the details below"), retry **once** with an injected system message: "You violated the output format... Return ONLY the JSON ExecutionPlan. NO prose." The retry almost always returns valid JSON. Frontend logs and displays a clear **LLM ERROR** message when no plan is extracted (so users and logs see correct feedback instead of silent failure).

**Rationale:**
- **Prompt layers**: Mode identity and final check reduce format violations without changing APIs.
- **Retry**: Industry-standard for tool-calling systems; handles residual variance when the model still returns prose.
- **Clear errors**: When no plan is extracted, the frontend shows an explicit error (and optional response preview) instead of misleading success or generic failure.

**Consequences:**
- System prompt is slightly longer (mode override + final check); prompt was also cleaned up and trimmed elsewhere.
- One extra LLM call in the retry path when format violation is detected (single retry only).
- Logs include `shouldRetryFormat`, `looksLikeCommandProse` for debugging detection.

**Implementation:**
- `lib/dotbot-core/prompts/system/loader.ts`: Output Mode Override block, FINAL CHECK block, compact rules and examples.
- `lib/dotbot-core/dotbot/llm.ts`: Format check after first response; retry with correction prompt when appropriate; logging of guardrail decision.
- `frontend/src/App.tsx`: When `plan` is missing but response looks like transfer prose, show "❌ LLM ERROR: Model returned prose..." with preview so users and logs see accurate feedback.

**History:**
- v0.2.x (January 2026): Three-layer guardrail (prompt mode + final check + code retry); RpcManager health check 30 min, clear on disconnect; frontend LLM error messaging.

---

## References

- [Polkadot Documentation](https://wiki.polkadot.network/)
- [Polkadot.js API Docs](https://polkadot.js.org/docs/)
- [Chopsticks Documentation](https://github.com/AcalaNetwork/chopsticks)
- [Asset Hub Migration](https://wiki.polkadot.network/docs/learn-dot-asset-hub-migration)

---

**Last Updated**: January 2026

**Maintainers**: This document is updated with every significant architectural change via PR review process.

