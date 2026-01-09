# DotBot Documentation

Welcome to DotBot's documentation. This guide will help you understand what DotBot is, how to get started, and where to find detailed information.

## What is DotBot?

DotBot is a ChatGPT-like web application that makes interacting with the Polkadot ecosystem simple and intuitive. Instead of navigating complex dApps and understanding technical details, users can perform blockchain operations through natural language conversations.

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
- A Polkadot wallet (Talisman, SubWallet, etc.)
- Basic understanding of Polkadot addresses and tokens

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd DotBot

# Install frontend dependencies
cd frontend
npm install

# Start development server
npm start
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

**Note:** Transactions now require explicit user approval before execution (two-step pattern).

## Architecture Overview

DotBot follows a clean, scalable architecture:

```
┌─────────────────────────────────────────────────────────┐
│                      User Interface                       │
│              (ChatGPT-like web application)              │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                    Specialized Agents                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │Asset Transfer│  │  Asset Swap  │  │  Governance  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                           │
│  Each agent:                                             │
│  - Validates user input                                  │
│  - Creates production-safe extrinsics                    │
│  - Returns ready-to-sign transactions                    │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                    Execution Engine                       │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Simulator   │→ │    Signer    │→ │ Broadcaster  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                           │
│  - Optionally simulates with Chopsticks (if enabled)     │
│  - Signs with user's wallet                              │
│  - Broadcasts to network                                 │
│  - Monitors for finalization                             │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                   Polkadot Network                        │
│         (Relay Chain, Asset Hub, Parachains)             │
└─────────────────────────────────────────────────────────┘
```

### Why This Architecture?

1. **Separation of Concerns**: Agents create, executioner executes
2. **Scalability**: Add new agents without modifying execution engine
3. **Testability**: Each component can be tested independently
4. **Flexibility**: Agents work with any execution environment

## Project Structure

```
DotBot/
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── agents/              # Specialized agents
│   │   │   │   ├── asset-transfer/  # DOT/token transfers
│   │   │   │   ├── baseAgent.ts     # Base class for all agents
│   │   │   │   └── types.ts         # Agent interfaces
│   │   │   │
│   │   │   ├── executionEngine/     # Transaction execution
│   │   │   │   ├── executioner.ts   # Main execution coordinator
│   │   │   │   ├── executionArray.ts # Transaction queue
│   │   │   │   ├── simulation/      # Chopsticks simulation
│   │   │   │   ├── signing/         # Transaction signing
│   │   │   │   └── broadcasting/    # Network broadcasting
│   │   │   │
│   │   │   ├── services/            # Core services
│   │   │   │   ├── rpcManager.ts    # Multi-endpoint RPC management
│   │   │   │   └── simulation/      # Chopsticks integration
│   │   │   │
│   │   │   ├── scenarioEngine/      # Testing framework
│   │   │   │   ├── components/      # EntityCreator, StateAllocator, etc.
│   │   │   │   └── scenarios/       # Test scenarios
│   │   │   │
│   │   │   └── types/               # TypeScript types
│   │   │
│   │   └── components/              # React UI components
│   │
│   └── package.json
│
├── docs/                            # Documentation
│   ├── README.md                    # This file (overview)
│   ├── ARCHITECTURE.md              # Design decisions
│   └── API.md                       # Public API reference
│
└── README.md                        # Project README
```

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
  sender: 'sender-address',
  recipient: 'recipient-address',
  amount: '5',  // 5 DOT
  keepAlive: true
});
```

### More Agents Coming

- Asset Swap Agent (DEX integration)
- Governance Agent (voting, delegation)
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

Simulation is **optional**. When enabled, DotBot simulates transactions using Chopsticks before execution:
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
- Multi-mode execution (synthetic, emulated, live)
- UI-integrated testing (tests through actual UI)
- LLM-consumable evaluation logs
- Comprehensive test scenarios (happy-path, adversarial, jailbreak, etc.)

## Environment Modes

### Development

```bash
cd frontend
npm start
```

- Hot reload enabled
- Development tooling active
- Local storage for state

### Production

```bash
cd frontend
npm run build
npm run preview
```

- Optimized bundle
- Production endpoints
- Error tracking

## Common Use Cases

### Single Transfer

```typescript
import { AssetTransferAgent } from './lib/agents/asset-transfer';

const agent = new AssetTransferAgent();
agent.initialize(api, assetHubApi);

const result = await agent.transfer({
  sender: accountAddress,
  recipient: 'recipient-address',
  amount: '10.5',
  keepAlive: true
});

// Execute with executioner
await executioner.executeExtrinsic(result);
```

### Batch Transfer

```typescript
const result = await agent.batchTransfer({
  sender: accountAddress,
  transfers: [
    { recipient: 'address1', amount: '5' },
    { recipient: 'address2', amount: '3' },
  ],
  keepAlive: true
});

// Single transaction for both transfers
await executioner.executeExtrinsic(result);
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

