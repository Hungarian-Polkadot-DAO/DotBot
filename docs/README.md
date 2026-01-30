# DotBot Documentation

Welcome to DotBot's documentation. This guide will help you understand what DotBot is, how to get started, and where to find detailed information.

## What is DotBot?

DotBot is a ChatGPT-like web application that makes interacting with the Polkadot ecosystem simple and intuitive. Instead of navigating complex dApps and understanding technical details, users can perform blockchain operations through natural language conversations.

**Architecture:** DotBot consists of a React frontend, TypeScript/Express backend, and shared core libraries in a monorepo structure. The backend securely manages AI provider API keys, while the shared `@dotbot/core` library handles blockchain operations for both frontend and backend.

### Core Concept

```
User: "Send 5 DOT to Alice"
↓
DotBot Agent creates the transaction
↓
User reviews and approves
↓
Transaction executes on-chain
```

### Key Principles

1. **Agent-First Design**: Specialized AI agents handle different operations
2. **User Control**: You always control your private keys and approve transactions
3. **Environment Support**: Clear separation between mainnet and testnet environments
4. **Multi-Chain Ready**: Built for Polkadot, Kusama, and parachains
5. **Production-Safe**: Automatic fallbacks and runtime capability detection
6. **Chat History**: Persistent conversation history with search and filtering

## Quick Start

### Prerequisites

- Node.js 18+
- npm 8+ (with workspaces support)
- A Polkadot wallet (Talisman, SubWallet, etc.)
- ASI-One or Claude API key (for backend)
- Basic understanding of Polkadot addresses and tokens

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd DotBot

# Install all workspace dependencies (monorepo)
npm install

# Build shared libraries
npm run build:core

# Terminal 1: Start backend
npm run dev:backend
# Backend runs on http://localhost:8000

# Terminal 2: Start frontend
npm run dev:frontend
# Frontend runs on http://localhost:3000
```

### First Transaction

1. Open http://localhost:3000
2. Connect your Polkadot wallet
3. Select environment (Mainnet or Testnet) using EnvironmentSwitch
4. Type: "Send 1 DOT to [address]"
5. Review the transaction details in ExecutionFlow
6. Click "Accept & Start" to approve
7. Sign in your wallet

That's it! DotBot handles the complexity behind the scenes.

**Note:** Transactions use a two-step pattern: after the LLM suggests a plan, the UI shows an ExecutionFlow; the user clicks "Accept & Start" to approve, then signs in the wallet. RPC connections and the browser wallet signer are **lazy-loaded** on first use (e.g. first `chat()` or `getBalance()`).

## Architecture Overview

DotBot follows a clean, scalable monorepo architecture:

```
┌─────────────────────────────────────────────────────────┐
│                  Frontend (React)                       │
│               ChatGPT-like web interface                │
│         Uses @dotbot/core for blockchain ops            │
└─────────────────────────────────────────────────────────┘
                            ↓ HTTP API
┌─────────────────────────────────────────────────────────┐
│              Backend (TypeScript/Express)               │
│         @dotbot/express routes & middleware             │
│      Secure AI provider API key management              │
│          Session management for DotBot instances        │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│             @dotbot/core (Shared Library)               │
│  DotBot class (dotbot.ts) + dotbot/*.ts logic modules   │
│  Agents: Asset Transfer (others planned)                 │
│  - Validate input, create production-safe extrinsics    │
│  Execution Engine:                                      │
│  - Optional Chopsticks simulation                       │
│  - Wallet signing (lazy-loaded)                         │
│  - Network broadcasting                                 │
│  - Finalization monitoring                              │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                   Polkadot Network                      │
│         (Relay Chain, Asset Hub, Parachains)            │
└─────────────────────────────────────────────────────────┘
```

### Why This Architecture?

1. **Monorepo Benefits**: Shared code, atomic changes, single source of truth
2. **Type Safety**: TypeScript across entire stack (frontend, backend, libs)
3. **Separation of Concerns**: Agents create, executioner executes
4. **Scalability**: Add new agents without modifying execution engine
5. **Testability**: Each component tested independently + integration tests
6. **Security**: API keys stored server-side, never exposed to frontend
7. **Contract-First**: OpenAPI specification ensures API compliance

## Project Structure

```
DotBot/                              # Monorepo root
├── package.json                     # Workspace configuration (4 workspaces)
│
├── lib/                             # Shared libraries
│   ├── dotbot-core/                 # @dotbot/core
│   │   ├── dotbot.ts                # DotBot class (turnkey API)
│   │   ├── dotbot/                  # DotBot logic (create, chat, execution, RPC, LLM)
│   │   │   ├── create.ts, chatHandlers.ts, chatLifecycle.ts
│   │   │   ├── executionPreparation.ts, executionRunner.ts
│   │   │   ├── llm.ts, rpcLifecycle.ts, balanceChain.ts, types.ts
│   │   │
│   │   ├── agents/                  # Specialized agents
│   │   │   ├── asset-transfer/      # DOT/token transfers
│   │   │   ├── governance/          # Voting, delegation
│   │   │   ├── staking/             # Staking operations
│   │   │   └── baseAgent.ts         # Base class for all agents
│   │   │
│   │   ├── executionEngine/         # Transaction execution
│   │   │   ├── executioner.ts       # Main execution coordinator
│   │   │   ├── executionArray.ts    # Transaction queue
│   │   │   ├── simulation/          # Chopsticks simulation
│   │   │   ├── signing/             # Transaction signing
│   │   │   └── broadcasting/        # Network broadcasting
│   │   │
│   │   ├── chat/                    # ChatInstance, ChatInstanceManager
│   │   ├── rpcManager/              # RpcManager, health, factories
│   │   ├── prompts/                 # LLM system prompts
│   │   ├── services/                # AI, logger, simulation
│   │   ├── storage/                 # chatStorage, fileStorage
│   │   ├── scenarioEngine/          # Testing framework
│   │   └── types/                   # TypeScript types
│   │
│   └── dotbot-express/              # @dotbot/express
│       ├── src/
│       │   ├── routes/              # API routes (chat, dotbot, sessions)
│       │   ├── middleware/          # Logging, error handling
│       │   ├── sessionManager.ts    # DotBot session management
│       │   └── utils/               # Utilities (logger)
│       └── package.json
│
├── backend/                         # TypeScript/Express backend
├── frontend/                        # React web application
├── docs/                            # Documentation
│   ├── README.md                    # This file (overview)
│   ├── ARCHITECTURE.md              # Design decisions
│   └── API.md                       # Public API reference
│
└── README.md                        # Project README
```

**Monorepo Workspaces:**
- `backend` - TypeScript/Express backend
- `frontend` - React frontend
- `lib/dotbot-core` - Shared blockchain logic
- `lib/dotbot-express` - Express integration layer

## Available Agents

### Asset Transfer Agent

Handles DOT and token transfers across Polkadot ecosystem.

**Features:**
- Native DOT transfers on Relay Chain and Asset Hub
- Automatic chain detection
- Production-safe with automatic fallbacks
- Batch transfer support
- Keep-alive and allow-death modes

**Example:**
```typescript
const result = await agent.transfer({
  address: 'sender-address',  // From BaseAgentParams
  recipient: 'recipient-address',
  amount: '5',  // 5 DOT
  chain: 'assetHub',
  keepAlive: true
});
```

### More Agents Coming (not yet in AGENT_REGISTRY)

- Asset Swap Agent (DEX integration)
- Governance Agent (voting, delegation; code exists but commented out)
- Staking Agent (bond, nominate, etc.; code exists but commented out)
- Multisig Agent (coordination)

---

## Environment System

DotBot supports multiple environments with clear separation:

- **Mainnet**: Production environment (Polkadot, Kusama)
- **Testnet**: Testing environment (Westend)

**Key Features:**
- Environment-bound chat instances (cannot mix environments)
- Environment switching creates new chat instance
- Chat history filterable by environment
- Clear visual indicators (EnvironmentBadge, EnvironmentSwitch)

---

## Chat History

**NEW** in v0.2.0: Persistent chat history with search capability.

- All conversations saved to localStorage (or external storage)
- Search by title, content, or date
- Filter by environment (mainnet/testnet)
- Load previous conversations
- Auto-generated titles from first message

## Core Features

### 1. Production-Safe Extrinsics

All agents create production-safe extrinsics with:
- Runtime capability detection
- Automatic method fallbacks
- Chain-specific SS58 encoding
- Existential deposit validation

### 2. Optional Chopsticks Simulation

Simulation is **optional and configurable**. When enabled, DotBot simulates transactions using Chopsticks before execution. Configuration is managed via `SettingsManager` and can be toggled in the UI (SettingsModal).

**Configuration:**
- Default: `enabled: true` (simulation enabled by default)
- Settings persist to localStorage
- UI toggle available in SettingsModal
- All components check `isSimulationEnabled()` for current state

**Multi-Transaction Flows:**
For flows with multiple transactions, simulation uses sequential execution on a single fork. Each transaction sees the state changes from previous transactions, ensuring accurate simulation of complex flows (e.g., transfer → stake → vote).

When enabled, DotBot simulates transactions using Chopsticks before execution:
- Real runtime execution
- Balance change preview
- Error detection before signing
- Gas estimation

**When simulation is disabled:**
- Execution proceeds directly to signing (faster)
- Items start with `'ready'` status (ready for signing)
- No simulation infrastructure required

### 3. Multi-Chain Support

Built for the Polkadot ecosystem:
- Polkadot Relay Chain
- Polkadot Asset Hub (post-migration DOT location)
- Kusama
- Extensible to any parachain

### 4. Flexible Signing

Pluggable signer architecture:
- Browser wallet (Talisman, SubWallet, etc.)
- Keyring signer (for testing)
- Custom signers (for automation)

### 5. Robust RPC Management

Smart endpoint management:
- Multiple endpoint fallbacks
- Health monitoring
- Automatic failover
- Response time tracking

### 6. ScenarioEngine Testing Framework

**NEW** in v0.2.0: Systematic testing framework for DotBot:
- Deterministic test entity creation
- Execution modes: live (synthetic and emulated currently disabled)
- UI-integrated testing (tests through actual UI)
- LLM-consumable evaluation logs
- Comprehensive test scenarios (happy-path, adversarial, jailbreak, etc.)

## Environment Modes

### Development

**Full Stack (Frontend + Backend):**
```bash
# Terminal 1: Backend
npm run dev:backend

# Terminal 2: Frontend
npm run dev:frontend
```

**Frontend Only (Mock API):**
```bash
# Terminal 1: Mock API server (Prism)
cd backend
npm run mock

# Terminal 2: Frontend
cd frontend
npm start
```

- Hot reload enabled
- Development tooling active
- OpenAPI mock server for parallel development

### Production

```bash
# Build all workspaces
npm run build

# Start backend
cd backend
npm start

# Serve frontend build
cd frontend
npm run preview
```

- Optimized bundles
- Production endpoints
- Error tracking

### Testing

**Unit Tests:**
```bash
npm test --workspace=@dotbot/core
npm test --workspace=backend
npm test --workspace=frontend
```

**Integration Tests (OpenAPI):**
```bash
cd backend
npm run test:integration           # Test all endpoints
npm run test:endpoint /api/health  # Test specific endpoint
```

## Common Use Cases

### Single Transfer (Low-Level)

```typescript
import { AssetTransferAgent, ExecutionSystem } from '@dotbot/core';

const agent = new AssetTransferAgent();
agent.initialize(api, assetHubApi, null, relayChainManager, assetHubManager);

const result = await agent.transfer({
  address: accountAddress,
  recipient: 'recipient-address',
  amount: '10.5',
  chain: 'assetHub',
  keepAlive: true
});

// Execute via ExecutionSystem / executioner (see API.md)
```

### Batch Transfer (Low-Level)

```typescript
const result = await agent.batchTransfer({
  address: accountAddress,
  transfers: [
    { recipient: 'address1', amount: '5' },
    { recipient: 'address2', amount: '3' },
  ],
  keepAlive: true
});

// Execute via ExecutionSystem / executioner
```

## Next Steps

- **[Architecture Guide](./ARCHITECTURE.md)** - Understand design decisions
- **[API Reference](./API.md)** - Integrate DotBot into your application
- **[Contributing](../README.md#contributing)** - Help improve DotBot

## Getting Help

- **GitHub Issues**: Report bugs and request features
- **GitHub Discussions**: Ask questions and share ideas
- **Documentation**: Start here, then explore ARCHITECTURE.md and API.md

## Key Concepts

### Agent Result

Every agent returns a standardized result:

```typescript
interface AgentResult {
  description: string;              // Human-readable description
  extrinsic: SubmittableExtrinsic; // Ready-to-sign transaction
  estimatedFee?: string;           // Fee in Planck
  warnings?: string[];             // Important notices
  metadata?: Record<string, any>;  // Additional data
  resultType: 'extrinsic' | 'data';
  requiresConfirmation: boolean;
  executionType: 'extrinsic' | 'data_fetch';
}
```

### Execution Flow (v0.2.0)

1. **LLM Phase**: User message → LLM generates ExecutionPlan
2. **Preparation Phase**: `prepareExecution()` orchestrates plan, adds ExecutionMessage to chat
3. **Review Phase**: UI shows ExecutionFlow component, user reviews transaction details
4. **Approval Phase**: User clicks "Accept & Start" → `startExecution()` called
5. **Simulation Phase**: Optionally validates with Chopsticks (if simulation enabled)
6. **Signing Phase**: User approves and signs in wallet
7. **Broadcasting Phase**: Sends signed transaction to network
8. **Monitoring Phase**: Waits for finalization, updates ExecutionMessage in chat

**Note:** Execution now requires explicit user approval (two-step pattern: prepare → approve → execute).

### Error Handling

DotBot provides detailed error information:
- `AgentError`: Problems during extrinsic creation
- `SimulationError`: Chopsticks simulation failures
- `SigningError`: User rejection or wallet issues
- `BroadcastingError`: Network or transaction failures

## Post-Migration DOT Behavior

**Important**: As of November 2025, DOT's primary location is Asset Hub (not Relay Chain).

- **Asset Hub**: Primary DOT location for user operations
- **Relay Chain**: Minimal DOT for staking/governance
- **Same-chain transfers**: Use `balances.transferKeepAlive` (no XCM)
- **Cross-chain transfers**: Use XCM with Asset Hub as reserve

DotBot handles this complexity automatically.

## Performance Considerations

- **RPC Endpoint Selection**: DotBot uses the fastest healthy endpoint
- **Simulation Caching**: Results cached when possible
- **Batch Transactions**: Multiple operations in single transaction
- **Connection Pooling**: Reuses API connections

## Security

- **No Key Custody**: Private keys never leave your wallet
- **User Approval**: All transactions require explicit approval
- **Simulation First**: Catch errors before signing
- **Auditable**: All operations are transparent

## License

MIT License - See [LICENSE](../LICENSE) for details

