# DotBot API Reference

This document provides comprehensive API documentation for integrating DotBot into your application.

## Table of Contents

- [Getting Started](#getting-started)
- [Core Concepts](#core-concepts)
- [Agents API](#agents-api)
- [Execution Engine API](#execution-engine-api)
- [Utilities API](#utilities-api)
- [Examples](#examples)
- [Error Handling](#error-handling)
- [TypeScript Types](#typescript-types)

---

## Getting Started

### Installation

```bash
npm install @polkadot/api @polkadot/util @polkadot/util-crypto
```

### Basic Setup

```typescript
import { ApiPromise, WsProvider } from '@polkadot/api';
import { AssetTransferAgent } from './lib/agents/asset-transfer';
import { Executioner } from './lib/executionEngine';
import { RpcManager } from './lib/rpcManager';

// 1. Create RPC managers (optional but recommended)
const relayManager = new RpcManager([
  'wss://rpc.polkadot.io',
  'wss://polkadot-rpc.dwellir.com',
]);

const assetHubManager = new RpcManager([
  'wss://polkadot-asset-hub-rpc.polkadot.io',
  'wss://sys.ibp.network/statemint',
]);

// 2. Connect to APIs
const relayApi = await relayManager.getReadApi();
const assetHubApi = await assetHubManager.getReadApi();

// 3. Initialize agent
const agent = new AssetTransferAgent();
agent.initialize(
  relayApi,
  assetHubApi,
  null,  // status callback (optional)
  relayManager,
  assetHubManager
);

// 4. Initialize executioner
const executioner = new Executioner();
executioner.initialize(
  relayApi,
  accountInfo,
  signer,
  assetHubApi,
  relayManager,
  assetHubManager
);
```

---

## Core Concepts

### AgentResult

All agents return a standardized result structure:

```typescript
interface AgentResult {
  description: string;              // Human-readable description
  extrinsic: SubmittableExtrinsic; // Ready-to-sign transaction
  estimatedFee?: string;           // Fee in Planck (1 DOT = 10^10 Planck)
  warnings?: string[];             // Important notices for user
  metadata?: Record<string, any>;  // Additional contextual data
  data?: any;                      // For non-extrinsic results
  resultType: 'extrinsic' | 'data' | 'mixed' | 'confirmation';
  requiresConfirmation: boolean;   // Should user confirm?
  executionType: 'extrinsic' | 'data_fetch' | 'validation' | 'user_input';
}
```

### ExecutionResult

After execution completes:

```typescript
interface ExecutionResult {
  success: boolean;
  blockHash?: string;    // Block where transaction was included
  txHash?: string;       // Transaction hash
  events?: any[];        // Blockchain events emitted
  error?: string;        // Error message if failed
  errorCode?: string;    // Machine-readable error code
}
```

---

## Agents API

### BaseAgent

Base class for all agents. Provides common functionality.

#### `initialize()`

Initialize the agent with API instances.

```typescript
initialize(
  api: ApiPromise,
  assetHubApi?: ApiPromise | null,
  onStatusUpdate?: SimulationStatusCallback | null,
  relayChainManager?: RpcManager | null,
  assetHubManager?: RpcManager | null
): void
```

**Parameters:**
- `api` - Polkadot Relay Chain API instance (required)
- `assetHubApi` - Asset Hub API instance (optional but recommended)
- `onStatusUpdate` - Callback for simulation progress updates (optional)
- `relayChainManager` - RPC manager for Relay Chain endpoints (optional)
- `assetHubManager` - RPC manager for Asset Hub endpoints (optional)

**Example:**
```typescript
agent.initialize(
  relayApi,
  assetHubApi,
  (status) => console.log(status.message),
  relayManager,
  assetHubManager
);
```

---

### AssetTransferAgent

Handles DOT and token transfers across the Polkadot ecosystem.

#### `transfer()`

Create a single transfer extrinsic.

```typescript
async transfer(params: TransferParams): Promise<AgentResult>
```

**Parameters:**

```typescript
interface TransferParams {
  sender: string;           // Sender's Polkadot address
  recipient: string;        // Recipient's Polkadot address
  amount: string | number;  // Amount in DOT (e.g., "10.5" or 10.5)
  chain: 'assetHub' | 'relay';  // Target chain (required!)
  keepAlive?: boolean;      // Keep account above ED? (default: true)
  validateBalance?: boolean; // Check sufficient balance? (default: true)
}
```

**Returns:** `Promise<AgentResult>`

**Throws:**
- `AgentError` with code:
  - `NOT_INITIALIZED` - Agent not initialized
  - `INVALID_ADDRESS` - Invalid sender or recipient address
  - `INSUFFICIENT_BALANCE` - Not enough funds
  - `BELOW_EXISTENTIAL_DEPOSIT` - Would leave account below ED
  - `ASSET_HUB_NOT_AVAILABLE` - Asset Hub API not connected

**Example:**
```typescript
const result = await agent.transfer({
  sender: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
  recipient: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
  amount: '10.5',
  chain: 'assetHub',
  keepAlive: true
});

// result.extrinsic is ready to sign!
// result.description is "Transfer 10.5 DOT to 5FHn...4ty"
// result.estimatedFee is in Planck
```

**Important Notes:**
- `chain` parameter is **required** - never inferred from balance
- Amount can be string ("10.5") or number (10.5)
- Address can be any SS58 format (automatically re-encoded for target chain)
- If `keepAlive: true`, validates sender won't go below existential deposit
- Automatically selects best available runtime method (transferKeepAlive → transferAllowDeath → transfer)

---

#### `batchTransfer()`

Create a batch transfer extrinsic (multiple transfers in one transaction).

```typescript
async batchTransfer(params: BatchTransferParams): Promise<AgentResult>
```

**Parameters:**

```typescript
interface BatchTransferParams {
  sender: string;
  transfers: Array<{
    recipient: string;
    amount: string | number;
  }>;
  chain: 'assetHub' | 'relay';
  keepAlive?: boolean;
  validateBalance?: boolean;
}
```

**Returns:** `Promise<AgentResult>` with single `utility.batchAll` extrinsic

**Example:**
```typescript
const result = await agent.batchTransfer({
  sender: senderAddress,
  transfers: [
    { recipient: 'address1', amount: '5' },
    { recipient: 'address2', amount: '3.5' },
    { recipient: 'address3', amount: '1' },
  ],
  chain: 'assetHub',
  keepAlive: true
});

// Single extrinsic with all transfers
// All transfers succeed or all fail (atomic)
```

**Important Notes:**
- Returns a **single** `utility.batchAll` extrinsic
- All transfers execute atomically (all succeed or all fail)
- Total amount + fees validated against sender balance
- Maximum ~100 transfers per batch (Polkadot runtime limit)

---

#### Protected Methods (for custom agents)

**`validateAddress(address: string): ValidationResult`**

Validate a Polkadot address.

```typescript
const validation = this.validateAddress(address);
if (!validation.valid) {
  throw new AgentError(validation.errors.join(', '), 'INVALID_ADDRESS');
}
```

**`getBalance(address: string): Promise<BalanceInfo>`**

Get account balance on Relay Chain.

```typescript
const balance = await this.getBalance(address);
// balance.free, balance.reserved, balance.frozen, balance.available
```

**`getAssetHubBalance(address: string): Promise<BalanceInfo | null>`**

Get account balance on Asset Hub.

```typescript
const balance = await this.getAssetHubBalance(address);
if (!balance) {
  throw new AgentError('Asset Hub not available', 'ASSET_HUB_NOT_AVAILABLE');
}
```

**`getApiForChain(chain: 'assetHub' | 'relay'): Promise<ApiPromise>`**

Get API instance for specific chain (with validation).

```typescript
const api = await this.getApiForChain('assetHub');
// Validates API is actually connected to Asset Hub
```

**`dryRunExtrinsic(api, extrinsic, address, rpcEndpoint?): Promise<DryRunResult>`**

Simulate extrinsic with Chopsticks (optional) or dry-run.

```typescript
const result = await this.dryRunExtrinsic(api, extrinsic, address);
if (!result.success) {
  throw new AgentError(result.error!, 'SIMULATION_FAILED');
}
```

---

## Execution Engine API

### Executioner

Executes extrinsics created by agents.

#### `initialize()`

```typescript
initialize(
  api: ApiPromise,
  account: WalletAccount,
  signer?: Signer,
  assetHubApi?: ApiPromise | null,
  relayChainManager?: RpcManager | null,
  assetHubManager?: RpcManager | null,
  onStatusUpdate?: (status: any) => void
): void
```

**Parameters:**
- `api` - Polkadot Relay Chain API instance
- `account` - User account information
- `signer` - Pluggable signer (BrowserWalletSigner, KeyringSigner, etc.)
- `assetHubApi` - Asset Hub API instance (optional)
- `relayChainManager` - RPC manager for Relay Chain (optional)
- `assetHubManager` - RPC manager for Asset Hub (optional)
- `onStatusUpdate` - Simulation status callback (optional)

**Example:**
```typescript
import { BrowserWalletSigner } from './lib/executionEngine/signers';

const signer = new BrowserWalletSigner(injector);

executioner.initialize(
  relayApi,
  { address: userAddress, name: 'Alice' },
  signer,
  assetHubApi,
  relayManager,
  assetHubManager,
  (status) => console.log(status.phase, status.message)
);
```

---

#### `execute()`

Execute items from an execution array.

```typescript
async execute(
  executionArray: ExecutionArray,
  options?: ExecutionOptions
): Promise<void>
```

**Parameters:**

```typescript
interface ExecutionOptions {
  continueOnError?: boolean;   // Continue if one item fails? (default: false)
  allowBatching?: boolean;     // Batch compatible extrinsics? (default: true)
  timeout?: number;            // Timeout in ms (default: 300000 = 5 min)
  sequential?: boolean;        // Execute sequentially? (default: true)
  autoApprove?: boolean;       // Skip user confirmation? (default: false)
}
```

**Example:**
```typescript
// Create execution array
const executionArray = new ExecutionArray();
executionArray.addItem(agentResult);

// Execute
await executioner.execute(executionArray, {
  continueOnError: false,
  sequential: true,
  autoApprove: false
});

// Check results
const state = executionArray.getState();
console.log('Completed:', state.completedItems);
console.log('Failed:', state.failedItems);
```

---

### ExecutionArray

Manages a queue of operations to execute.

#### `constructor()`

```typescript
const executionArray = new ExecutionArray();
```

#### `addItem()`

Add an item to the execution array.

```typescript
addItem(agentResult: AgentResult, options?: AddItemOptions): ExecutionItem
```

**Example:**
```typescript
const item = executionArray.addItem(agentResult, {
  priority: 'high',
  retryOnFailure: true
});
```

#### `getState()`

Get current execution state.

```typescript
interface ExecutionState {
  totalItems: number;
  completedItems: number;
  failedItems: number;
  pendingItems: number;
  currentIndex: number;
  isExecuting: boolean;
  isPaused: boolean;
}

const state = executionArray.getState();
```

#### `updateStatus()`

Update item status.

```typescript
updateStatus(
  itemId: string,
  status: ExecutionStatus,
  error?: string
): void

// Status: 'pending' | 'ready' | 'simulating' | 'signing' | 
//         'broadcasting' | 'finalized' | 'failed' | 'cancelled'
```

#### `subscribe()`

Subscribe to execution events.

```typescript
const unsubscribe = executionArray.subscribe((state) => {
  console.log('Execution state changed:', state);
});

// Later: unsubscribe()
```

---

## Utilities API

### RpcManager

Manages multiple RPC endpoints with health monitoring and failover.

#### `constructor()`

```typescript
constructor(endpoints: string[], options?: RpcManagerOptions)
```

**Parameters:**
- `endpoints` - Array of WebSocket RPC URLs
- `options.healthCheckInterval` - Health check frequency in ms (default: 60000)
- `options.connectionTimeout` - Connection timeout in ms (default: 10000)
- `options.maxRetries` - Maximum connection retries (default: 3)

**Example:**
```typescript
const manager = new RpcManager(
  [
    'wss://rpc.polkadot.io',
    'wss://polkadot-rpc.dwellir.com',
    'wss://polkadot.api.onfinality.io/public-ws'
  ],
  {
    healthCheckInterval: 60000,
    connectionTimeout: 10000,
    maxRetries: 3
  }
);
```

#### `getReadApi()`

Get API instance for read operations (uses best available endpoint).

```typescript
async getReadApi(): Promise<ApiPromise>
```

**Example:**
```typescript
const api = await manager.getReadApi();
const balance = await api.query.system.account(address);
```

#### `createExecutionSession()`

Create a fresh API instance for transaction execution.

```typescript
async createExecutionSession(): Promise<{ api: ApiPromise, endpoint: string }>
```

**Example:**
```typescript
const session = await manager.createExecutionSession();
// Use session.api for creating extrinsics
// Ensures correct registry
```

#### `getHealthStatus()`

Get health status of all endpoints.

```typescript
interface EndpointHealth {
  endpoint: string;
  healthy: boolean;
  avgResponseTime: number;
  lastCheck: number;
  failureCount: number;
  lastFailure?: number;
}

const healthStatus: EndpointHealth[] = manager.getHealthStatus();
```

#### `getCurrentEndpoint()`

Get currently active endpoint.

```typescript
const endpoint: string = manager.getCurrentEndpoint();
```

#### `disconnect()`

Disconnect all API instances.

```typescript
await manager.disconnect();
```

---

### Transfer Capabilities

Detect runtime capabilities for production-safe transfers.

#### `detectTransferCapabilities()`

```typescript
async function detectTransferCapabilities(
  api: ApiPromise
): Promise<TransferCapabilities>
```

**Returns:**
```typescript
interface TransferCapabilities {
  hasTransferKeepAlive: boolean;
  hasTransferAllowDeath: boolean;
  hasTransferAll: boolean;
  hasTransfer: boolean;
  hasUtilityBatch: boolean;
  hasUtilityBatchAll: boolean;
  hasUtilityForceBatch: boolean;
  existentialDeposit: BN;
  decimals: number;
  ss58Prefix: number;
  chainName: string;
  runtimeVersion: number;
}
```

**Example:**
```typescript
import { detectTransferCapabilities } from './lib/agents/asset-transfer/utils';

const capabilities = await detectTransferCapabilities(api);

if (!capabilities.hasTransferKeepAlive) {
  console.warn('Chain does not support transferKeepAlive, will fallback');
}

console.log('Existential Deposit:', capabilities.existentialDeposit.toString());
```

---

### Safe Extrinsic Builder

Build production-safe extrinsics with automatic fallbacks.

#### `buildSafeTransferExtrinsic()`

```typescript
function buildSafeTransferExtrinsic(
  api: ApiPromise,
  params: SafeTransferParams,
  capabilities: TransferCapabilities
): SafeExtrinsicResult
```

**Parameters:**
```typescript
interface SafeTransferParams {
  sender: string;
  recipient: string;
  amount: string | number | BN;
  keepAlive: boolean;
}

interface SafeExtrinsicResult {
  extrinsic: SubmittableExtrinsic<'promise'>;
  method: 'transferKeepAlive' | 'transferAllowDeath' | 'transfer';
  recipientEncoded: string;
  amountBN: BN;
  warnings: string[];
}
```

**Example:**
```typescript
import { buildSafeTransferExtrinsic } from './lib/agents/asset-transfer/utils';

const result = buildSafeTransferExtrinsic(
  api,
  {
    sender: senderAddress,
    recipient: recipientAddress,
    amount: '10.5',
    keepAlive: true
  },
  capabilities
);

// result.extrinsic is ready to sign
// result.method tells you which method was selected
// result.warnings contains any important notices
```

---

#### `buildSafeBatchExtrinsic()`

```typescript
function buildSafeBatchExtrinsic(
  api: ApiPromise,
  params: SafeBatchTransferParams,
  capabilities: TransferCapabilities
): SafeExtrinsicResult
```

**Parameters:**
```typescript
interface SafeBatchTransferParams {
  sender: string;
  transfers: Array<{
    recipient: string;
    amount: string | number | BN;
  }>;
  keepAlive: boolean;
}
```

**Returns:** Single `utility.batchAll` extrinsic containing all transfers

**Example:**
```typescript
const result = buildSafeBatchExtrinsic(
  api,
  {
    sender: senderAddress,
    transfers: [
      { recipient: 'addr1', amount: '5' },
      { recipient: 'addr2', amount: '3' }
    ],
    keepAlive: true
  },
  capabilities
);
```

---

## Examples

### Complete Transfer Example

```typescript
import { ApiPromise } from '@polkadot/api';
import { AssetTransferAgent } from './lib/agents/asset-transfer';
import { Executioner } from './lib/executionEngine';
import { ExecutionArray } from './lib/executionEngine/executionArray';
import { BrowserWalletSigner } from './lib/executionEngine/signers';
import { RpcManager } from './lib/rpcManager';

async function transferDot() {
  // 1. Setup RPC managers
  const relayManager = new RpcManager(['wss://rpc.polkadot.io']);
  const assetHubManager = new RpcManager(['wss://polkadot-asset-hub-rpc.polkadot.io']);
  
  // 2. Connect to chains
  const relayApi = await relayManager.getReadApi();
  const assetHubApi = await assetHubManager.getReadApi();
  
  // 3. Initialize agent
  const agent = new AssetTransferAgent();
  agent.initialize(
    relayApi,
    assetHubApi,
    (status) => console.log('Status:', status.message),
    relayManager,
    assetHubManager
  );
  
  // 4. Create transfer
  const result = await agent.transfer({
    sender: userAddress,
    recipient: recipientAddress,
    amount: '10',
    chain: 'assetHub',
    keepAlive: true
  });
  
  console.log('Transfer created:', result.description);
  console.log('Estimated fee:', result.estimatedFee);
  
  // 5. Execute
  const executionArray = new ExecutionArray();
  executionArray.addItem(result);
  
  const signer = new BrowserWalletSigner(injector);
  const executioner = new Executioner();
  executioner.initialize(
    relayApi,
    { address: userAddress, name: 'User' },
    signer,
    assetHubApi,
    relayManager,
    assetHubManager
  );
  
  await executioner.execute(executionArray);
  
  // 6. Check result
  const item = executionArray.getItems()[0];
  if (item.result?.success) {
    console.log('Transfer successful!');
    console.log('Block hash:', item.result.blockHash);
    console.log('Tx hash:', item.result.txHash);
  } else {
    console.error('Transfer failed:', item.result?.error);
  }
  
  // 7. Cleanup
  await relayManager.disconnect();
  await assetHubManager.disconnect();
}
```

---

### Batch Transfer Example

```typescript
async function batchTransfer() {
  // Setup (same as above)
  // ...
  
  const result = await agent.batchTransfer({
    sender: userAddress,
    transfers: [
      { recipient: 'addr1', amount: '5' },
      { recipient: 'addr2', amount: '3' },
      { recipient: 'addr3', amount: '2' },
    ],
    chain: 'assetHub',
    keepAlive: true
  });
  
  console.log(result.description);
  // "Batch transfer: 3 transfers totaling 10 DOT"
  
  // Execute (same as above)
  // ...
}
```

---

### Custom Agent Example

```typescript
import { BaseAgent } from './lib/agents/baseAgent';
import { AgentResult, AgentError } from './lib/agents/types';

export class CustomAgent extends BaseAgent {
  getAgentName(): string {
    return 'CustomAgent';
  }
  
  async customOperation(params: CustomParams): Promise<AgentResult> {
    this.ensureInitialized();
    
    try {
      // 1. Validate
      const validation = this.validateAddress(params.address);
      if (!validation.valid) {
        throw new AgentError(
          validation.errors.join(', '),
          'INVALID_ADDRESS'
        );
      }
      
      // 2. Get API
      const api = this.getApi();
      
      // 3. Create extrinsic
      const extrinsic = api.tx.system.remark('Hello from CustomAgent!');
      
      // 4. Optional: Dry run
      const dryRunResult = await this.dryRunExtrinsic(
        api,
        extrinsic,
        params.address
      );
      
      if (!dryRunResult.success) {
        throw new AgentError(
          dryRunResult.error!,
          'DRY_RUN_FAILED'
        );
      }
      
      // 5. Return result
      return this.createResult(
        'Custom operation',
        extrinsic,
        {
          estimatedFee: dryRunResult.estimatedFee,
          warnings: []
        }
      );
    } catch (error) {
      if (error instanceof AgentError) {
        throw error;
      }
      throw new AgentError(
        error instanceof Error ? error.message : 'Unknown error',
        'CUSTOM_OPERATION_FAILED'
      );
    }
  }
}
```

---

### Simulation Status Tracking

```typescript
agent.initialize(
  relayApi,
  assetHubApi,
  (status) => {
    console.log(`[${status.phase}] ${status.message}`);
    
    if (status.progress !== undefined) {
      console.log(`Progress: ${status.progress}%`);
    }
    
    if (status.result) {
      console.log('Simulation result:', status.result);
    }
  }
);
```

**Status phases:**
- `'starting'` - Simulation starting
- `'connecting'` - Connecting to RPC
- `'building'` - Building simulation environment
- `'executing'` - Executing extrinsic
- `'complete'` - Simulation successful
- `'error'` - Simulation failed

---

## Error Handling

### Error Types

**AgentError**
```typescript
class AgentError extends Error {
  code: string;
  details?: any;
}
```

**Common error codes:**
- `NOT_INITIALIZED` - Agent not initialized
- `INVALID_ADDRESS` - Invalid address format
- `INSUFFICIENT_BALANCE` - Not enough funds
- `BELOW_EXISTENTIAL_DEPOSIT` - Would leave account below ED
- `CAPABILITY_NOT_SUPPORTED` - Runtime missing required method
- `SIMULATION_FAILED` - Chopsticks simulation failed
- `ASSET_HUB_NOT_AVAILABLE` - Asset Hub API not connected
- `API_CHAIN_MISMATCH` - API connected to wrong chain

**Example:**
```typescript
try {
  const result = await agent.transfer(params);
} catch (error) {
  if (error instanceof AgentError) {
    switch (error.code) {
      case 'INSUFFICIENT_BALANCE':
        console.error('Not enough DOT:', error.message);
        break;
      case 'INVALID_ADDRESS':
        console.error('Address is invalid:', error.message);
        break;
      default:
        console.error('Agent error:', error.code, error.message);
    }
  } else {
    console.error('Unknown error:', error);
  }
}
```

---

### Validation Errors

```typescript
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const validation = agent.validateAddress(address);
if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
}
if (validation.warnings.length > 0) {
  console.warn('Validation warnings:', validation.warnings);
}
```

---

## TypeScript Types

### Core Types

```typescript
// Agent result
interface AgentResult {
  description: string;
  extrinsic?: SubmittableExtrinsic<'promise'>;
  estimatedFee?: string;
  warnings?: string[];
  metadata?: Record<string, any>;
  data?: any;
  resultType: 'extrinsic' | 'data' | 'mixed' | 'confirmation';
  requiresConfirmation: boolean;
  executionType: 'extrinsic' | 'data_fetch' | 'validation' | 'user_input';
}

// Execution item
interface ExecutionItem {
  id: string;
  index: number;
  agentResult: AgentResult;
  status: ExecutionStatus;
  result?: ExecutionResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

// Execution status
type ExecutionStatus =
  | 'pending'
  | 'ready'
  | 'simulating'
  | 'signing'
  | 'broadcasting'
  | 'finalized'
  | 'failed'
  | 'cancelled';

// Execution result
interface ExecutionResult {
  success: boolean;
  blockHash?: string;
  txHash?: string;
  events?: any[];
  error?: string;
  errorCode?: string;
}

// Balance info
interface BalanceInfo {
  free: string;      // Free balance (Planck)
  reserved: string;  // Reserved balance (Planck)
  frozen: string;    // Frozen balance (Planck)
  available: string; // Available = free - frozen (Planck)
}

// Wallet account
interface WalletAccount {
  address: string;
  name?: string;
  source?: string;
}

// Signer interface
interface Signer {
  sign(
    extrinsic: SubmittableExtrinsic<'promise'>,
    address: string
  ): Promise<Uint8Array>;
}
```

---

## Best Practices

### 1. Always Initialize Agents

```typescript
// ✅ Good
agent.initialize(api, assetHubApi);
const result = await agent.transfer(params);

// ❌ Bad
const result = await agent.transfer(params);
// Throws: NOT_INITIALIZED
```

### 2. Explicit Chain Selection

```typescript
// ✅ Good - Explicit chain
await agent.transfer({
  sender,
  recipient,
  amount: '10',
  chain: 'assetHub'  // Clear intent
});

// ❌ Bad - Would require chain parameter
```

### 3. Handle Errors Gracefully

```typescript
try {
  const result = await agent.transfer(params);
  await executioner.execute(result);
} catch (error) {
  if (error instanceof AgentError) {
    // Show user-friendly message
    showErrorToUser(error.message);
  } else {
    // Log unexpected error
    console.error('Unexpected error:', error);
  }
}
```

### 4. Use RpcManager

```typescript
// ✅ Good - Automatic failover
const manager = new RpcManager([
  'wss://rpc1.example.com',
  'wss://rpc2.example.com'
]);
const api = await manager.getReadApi();

// ❌ Bad - Single point of failure
const api = await ApiPromise.create({
  provider: new WsProvider('wss://rpc1.example.com')
});
```

### 5. Cleanup Resources

```typescript
// Always disconnect when done
try {
  // ... do work ...
} finally {
  await relayManager.disconnect();
  await assetHubManager.disconnect();
}
```

### 6. Validate Before Executing

```typescript
// Agents automatically validate, but you can double-check
const balance = await agent.getBalance(sender);
const required = new BN('10000000000'); // 1 DOT in Planck

if (new BN(balance.available).lt(required)) {
  throw new Error('Insufficient balance');
}
```

---

## Version History

### Current Version (v1.0.0)

**Breaking Changes:**
- Agent must create extrinsics (not just metadata)
- `chain` parameter required for transfers
- Removed balance-based chain inference

**New Features:**
- Production-safe extrinsic building
- Runtime capability detection
- Chopsticks simulation integration
- Pluggable signer architecture
- Multi-endpoint RPC management

**Bug Fixes:**
- Fixed registry mismatches
- Fixed SS58 address encoding
- Fixed existential deposit validation

---

**Last Updated**: January 2026

**Questions?** Check [ARCHITECTURE.md](./ARCHITECTURE.md) for design rationale, or open a GitHub issue.

