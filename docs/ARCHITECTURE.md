# DotBot Architecture

This document explains **why** DotBot is built the way it is. It covers design decisions, architectural patterns, and the rationale behind key choices.

## Table of Contents

- [Core Design Principles](#core-design-principles)
- [Module Structure](#module-structure)
- [Design Decisions](#design-decisions)
- [Data Flow](#data-flow)
- [Conventions](#conventions)
- [Dependencies](#dependencies)

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
- **Simulation**: Chopsticks (optional), can be replaced with dry-run

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

### Agents (`frontend/src/lib/agents/`)

**Purpose**: Create production-safe extrinsics for specific operations.

**Structure:**
```
agents/
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
        └── amountNormalizer.ts      # Amount conversion (human → Planck)
```

**Key Classes:**
- **BaseAgent**: Provides common functionality (address validation, balance checks, dry-run)
- **AssetTransferAgent**: Handles DOT/token transfers across chains

**Responsibilities:**
- Validate user input
- Detect runtime capabilities
- Create production-safe extrinsics
- Return standardized AgentResult
- Optionally dry-run with Chopsticks

---

### Execution Engine (`frontend/src/lib/executionEngine/`)

**Purpose**: Execute extrinsics created by agents.

**Structure:**
```
executionEngine/
├── executioner.ts           # Main execution coordinator
├── executionArray.ts        # Transaction queue management
├── types.ts                 # Execution-related types
├── simulation/              # Pre-execution simulation
│   └── executionSimulator.ts
├── signing/                 # Transaction signing
│   └── executionSigner.ts
└── broadcasting/            # Network broadcasting
    └── executionBroadcaster.ts
```

**Flow:**
1. **Simulation**: Validate with Chopsticks (optional)
2. **Signing**: Get user approval and sign
3. **Broadcasting**: Send to network
4. **Monitoring**: Wait for finalization

**Key Principle**: Executioner is **generic** - it doesn't know about specific agents. It only knows how to:
- Simulate any extrinsic
- Sign any extrinsic
- Broadcast any extrinsic
- Monitor any transaction

---

### Services (`frontend/src/lib/services/`)

**Purpose**: Core infrastructure services.

**Key Services:**
- **RpcManager**: Multi-endpoint management with health monitoring and failover
- **Chopsticks**: Runtime simulation for pre-execution validation

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

### Decision 3: Chopsticks Simulation Before Execution

**Context:**
- Users can't predict if transaction will succeed
- Failed transactions waste fees
- Some errors only appear during runtime execution

**Decision:**
Optionally simulate all extrinsics with Chopsticks before signing.

**Rationale:**
1. **Error Prevention**: Catch failures before spending fees
2. **User Confidence**: Show balance changes preview
3. **Better UX**: Explain why transaction would fail
4. **Optional**: Can be disabled for speed

**Alternatives Considered:**
1. ❌ **No simulation**: Just send transactions and hope
   - Poor UX
   - Wasted fees on failures
   
2. ❌ **RPC dry-run only**: Use `paymentInfo()` or `dryRun()`
   - Doesn't actually execute runtime logic
   - Misses balance/permission issues
   
3. ✅ **Chopsticks simulation**: Real runtime execution locally
   - Most accurate
   - Shows actual balance changes
   - Falls back to dry-run if unavailable

**Consequences:**
- Requires Chopsticks dependency
- Adds latency (1-3 seconds)
- Greatly improves UX
- Reduces failed transactions

**Implementation:**
```typescript
// Automatic simulation
const simulationResult = await simulateTransaction(
  api,
  endpoints,
  extrinsic,
  address
);

if (!simulationResult.success) {
  // Show error before signing
  throw new Error(simulationResult.error);
}
```

(Updated: January 2026)

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
- Health monitoring overhead (minimal)
- Significantly improved reliability

**Implementation:**
```typescript
const manager = new RpcManager([
  'wss://rpc.polkadot.io',
  'wss://polkadot-rpc.dwellir.com',
  'wss://polkadot.api.onfinality.io/public-ws'
]);

const api = await manager.getReadApi();  // Uses best available endpoint
```

(Updated: January 2026)

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
│    │ e) Optionally dry-run with Chopsticks   │           │
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
│    │ a) Simulation (optional)                │           │
│    │    - Chopsticks runtime execution       │           │
│    │    - Show balance changes               │           │
│    │    - Catch errors early                 │           │
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

### Agent Development

When creating a new agent:

1. **Extend BaseAgent**: Reuse common functionality
2. **Create Extrinsics**: Agent must return ready-to-sign extrinsic
3. **Detect Capabilities**: Use runtime introspection
4. **Handle Errors**: Use AgentError with error codes
5. **Dry Run**: Optionally validate with Chopsticks
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
- `SIMULATION_FAILED`: Chopsticks simulation failed
- `SIGNING_REJECTED`: User rejected transaction
- `BROADCAST_FAILED`: Network submission failed

---

## Dependencies

### Core Dependencies

**Polkadot.js API** (`@polkadot/api`)
- Purpose: Blockchain interaction
- Why: Industry standard, well-maintained
- Version: Latest stable

**Polkadot.js Util** (`@polkadot/util`, `@polkadot/util-crypto`)
- Purpose: Address encoding, BN math, cryptography
- Why: Polkadot-native utilities

**Chopsticks** (`@acala-network/chopsticks`)
- Purpose: Runtime simulation
- Why: Most accurate pre-execution validation
- Optional: Falls back to dry-run if unavailable

### Design Rationale

1. **Minimal Dependencies**: Only essential libraries
2. **No Framework Lock-in**: Core logic is framework-agnostic
3. **Production-Tested**: All dependencies widely used in Polkadot ecosystem
4. **Type Safety**: All dependencies have TypeScript support

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

## References

- [Polkadot Documentation](https://wiki.polkadot.network/)
- [Polkadot.js API Docs](https://polkadot.js.org/docs/)
- [Chopsticks Documentation](https://github.com/AcalaNetwork/chopsticks)
- [Asset Hub Migration](https://wiki.polkadot.network/docs/learn-dot-asset-hub-migration)

---

**Last Updated**: January 2026

**Maintainers**: This document is updated with every significant architectural change via PR review process.

