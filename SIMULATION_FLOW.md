# Simulation & Transaction Flow Documentation

This document provides a detailed explanation of how transaction simulation and execution works in DotBot, designed for LLM understanding.

## Table of Contents

1. [High-Level Flow Overview](#high-level-flow-overview)
2. [Entry Point: User Interaction](#entry-point-user-interaction)
3. [Orchestration Phase](#orchestration-phase)
4. [Agent Execution Phase](#agent-execution-phase)
5. [Simulation Phase](#simulation-phase)
6. [Error Analysis & Retry Logic](#error-analysis--retry-logic)
7. [Transaction Execution Phase](#transaction-execution-phase)
8. [Key Classes & Files](#key-classes--files)
9. [Data Structures](#data-structures)
10. [Important Variables](#important-variables)

---

## High-Level Flow Overview

```
User Request (Chat)
    ↓
LLM generates ExecutionPlan (JSON with steps)
    ↓
ExecutionOrchestrator.orchestrate()
    ↓
For each ExecutionStep:
    ├─> ExecutionOrchestrator.executeStep()
    │   └─> AssetTransferAgent.transfer()
    │       ├─> Address validation & SS58 conversion
    │       ├─> dryRunWithRetry() [RETRY LOGIC]
    │       │   ├─> dryRunExtrinsic() [SIMULATION]
    │       │   │   ├─> Chopsticks simulation (preferred)
    │       │   │   └─> paymentInfo fallback
    │       │   ├─> analyzeError() [ERROR ANALYSIS]
    │       │   └─> getRetryStrategy() [RETRY DECISION]
    │       ├─> Balance validation
    │       └─> Return AgentResult (with extrinsic)
    │
    └─> ExecutionArray.add(agentResult)
    ↓
Executioner.execute()
    ├─> User approval (ExecutionFlow UI)
    ├─> Sign transaction (wallet)
    ├─> Broadcast transaction
    └─> Monitor for completion
```

---

## Entry Point: User Interaction

**File**: `frontend/src/App.tsx`

User sends a message like "Send 0.01 DOT to Alice" through the chat interface.

**Flow**:
1. `ChatInterface` component captures user input
2. `DotBot.sendMessage()` is called
3. LLM (via `callLLM()`) generates an `ExecutionPlan` (JSON structure)

**ExecutionPlan Structure**:
```typescript
interface ExecutionPlan {
  id: string;
  steps: ExecutionStep[];
}

interface ExecutionStep {
  id: string;
  agentClassName: string;  // e.g., "AssetTransferAgent"
  functionName: string;     // e.g., "transfer"
  parameters: {
    address: string;
    recipient: string;
    amount: string;
    chain?: 'assetHub' | 'relay';
    keepAlive?: boolean;
  };
}
```

**File**: `frontend/src/lib/prompts/system/execution/types.ts`

---

## Orchestration Phase

**File**: `frontend/src/lib/executionEngine/orchestrator.ts`

**Class**: `ExecutionOrchestrator`

### Initialization

**Method**: `ExecutionOrchestrator.initialize(api, assetHubApi?, onStatusUpdate?)`

**Variables**:
- `this.api: ApiPromise | null` - Relay Chain API instance
- `this.assetHubApi: ApiPromise | null` - Asset Hub API instance (optional)
- `this.onStatusUpdate: SimulationStatusCallback | null` - Status callback for UI updates
- `this.agentInstances: Map<string, BaseAgent>` - Cached agent instances

### Orchestration Process

**Method**: `ExecutionOrchestrator.orchestrate(plan: ExecutionPlan, options?: OrchestrationOptions)`

**Flow**:
1. **Validation** (if `validateFirst === true`):
   - Calls `validateSteps()` to check all steps are valid
   - Verifies agents exist in registry
   - Checks parameters are present

2. **Step Processing Loop**:
   ```typescript
   for (let i = 0; i < plan.steps.length; i++) {
     const step = plan.steps[i];
     const agentResult = await this.executeStep(step);
     executionArray.add(agentResult);
   }
   ```

3. **Returns**: `OrchestrationResult` with populated `ExecutionArray`

### Executing Individual Steps

**Method**: `ExecutionOrchestrator.executeStep(step: ExecutionStep): Promise<AgentResult>`

**Flow**:
1. **Get Agent Instance**:
   ```typescript
   const agent = this.getAgentInstance(step.agentClassName);
   ```
   - Checks cache (`this.agentInstances`)
   - If not cached, creates via `createAgent(className)`
   - Initializes agent: `agent.initialize(this.api, this.assetHubApi, this.onStatusUpdate)`

2. **Call Agent Function**:
   ```typescript
   const paramsWithCallback = {
     ...step.parameters,
     onSimulationStatus: this.onStatusUpdate || undefined,
   };
   const result = await agent[step.functionName](paramsWithCallback);
   ```

3. **Returns**: `AgentResult` with extrinsic ready for execution

**Key Method**: `getAgentInstance(agentClassName: string): BaseAgent`
- Creates agent instances on-demand
- Caches instances for reuse
- Ensures proper initialization with APIs

---

## Agent Execution Phase

**File**: `frontend/src/lib/agents/asset-transfer/agent.ts`

**Class**: `AssetTransferAgent extends BaseAgent`

### Transfer Method

**Method**: `AssetTransferAgent.transfer(params: TransferParams): Promise<AgentResult>`

**Parameters**:
```typescript
interface TransferParams {
  address: string;           // Sender address
  recipient: string;          // Recipient address
  amount: string;            // Amount in DOT (e.g., "0.01")
  chain?: 'assetHub' | 'relay';
  keepAlive?: boolean;
  validateBalance?: boolean;
  onSimulationStatus?: SimulationStatusCallback;
}
```

**Step-by-Step Flow**:

#### Step 1: Address Validation & SS58 Conversion
```typescript
this.validateTransferAddresses(params.address, params.recipient);
const senderAddress = this.ensurePolkadotAddress(params.address);
const recipientAddress = this.ensurePolkadotAddress(params.recipient);
```

**Methods**:
- `validateTransferAddresses()` - Validates both addresses are valid SS58 format
- `ensurePolkadotAddress()` - Converts address to SS58 format with Polkadot prefix (0)

**File**: `frontend/src/lib/agents/baseAgent.ts`
- `BaseAgent.ensurePolkadotAddress(address: string): string`
  - Uses `decodeAddress()` and `encodeAddress(decoded, 0)` to ensure Polkadot format

#### Step 2: Amount Parsing
```typescript
const amountBN = this.parseAndValidateAmount(params.amount);
const keepAlive = params.keepAlive === true;
```

**Method**: `parseAndValidateAmount(amount: string): BN`
- Converts string to `BN` (BigNumber)
- Validates amount is positive and non-zero

#### Step 3: Robust Simulation with Retry Logic

**Method**: `dryRunWithRetry(params, extrinsicCreator)`

**Parameters**:
```typescript
{
  address: string;           // SS58-formatted sender address
  chain?: 'assetHub' | 'relay';
  keepAlive?: boolean;
  recipient: string;         // SS58-formatted recipient address
  amount: BN;
  onStatusUpdate?: SimulationStatusCallback;
}
```

**Retry Loop** (max 5 attempts):
```typescript
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  // 1. Get API for current chain
  const api = this.getApiForChain(currentChain);
  
  // 2. Create extrinsic
  const extrinsic = extrinsicCreator(api, currentKeepAlive);
  
  // 3. Run simulation
  const dryRun = await this.dryRunExtrinsic(api, extrinsic, senderAddress, rpcEndpoint);
  
  // 4. Check result
  if (dryRun.success) {
    return { dryRun, api, extrinsic, chainName, keepAlive, attemptLog };
  }
  
  // 5. Analyze error
  const errorAnalysis = analyzeError(dryRun.error);
  
  // 6. Get retry strategy
  const retryStrategy = getRetryStrategy(errorAnalysis, attempt, currentChain, currentKeepAlive);
  
  // 7. Apply adjustments (chain switch, keepAlive toggle, etc.)
}
```

**Key Variables**:
- `currentChain: 'assetHub' | 'relay'` - Current chain being tried
- `currentKeepAlive: boolean` - Current keepAlive setting
- `triedCombinations: Set<string>` - Tracks tried combinations to avoid duplicates
- `attemptLog: string[]` - User-friendly log of attempts

**Status Updates**:
```typescript
if (statusCallback) {
  statusCallback({
    phase: 'validating' | 'simulating' | 'analyzing' | 'retrying' | 'complete',
    message: string,
    attempt: number,
    maxAttempts: number,
    chain: string,
    adjustments?: string[],
  });
}
```

#### Step 4: Balance Validation
```typescript
const targetChain = chainName === 'Asset Hub' ? 'assetHub' : 'relay';
const balance = await this.getBalanceOnChain(targetChain, senderAddress);

const estimatedFeeBN = new BN(dryRun.estimatedFee);
const totalRequired = amountBN.add(estimatedFeeBN);
const availableBN = new BN(balance.available);

if (availableBN.lt(totalRequired)) {
  throw new AgentError('Insufficient balance...');
}
```

**Method**: `getBalanceOnChain(chain: 'assetHub' | 'relay', address: string)`
- Gets balance from the specific chain API
- Returns `BalanceInfo` with `free`, `reserved`, `frozen`, `available`

#### Step 5: Return AgentResult
```typescript
return this.createResult(
  description,              // Human-readable description
  extrinsic,                // SubmittableExtrinsic ready to sign
  {
    estimatedFee: dryRun.estimatedFee,
    warnings: warnings,
    metadata: {
      amount: amountBN.toString(),
      recipient: recipientAddress,
      sender: senderAddress,
      keepAlive: finalKeepAlive,
      chain: chainName,
      attemptLog: attemptLog.join('\n'),
      apiInstance: api,     // CRITICAL: Store API instance!
    },
  }
);
```

**Important**: The `apiInstance` is stored in metadata because the extrinsic MUST be signed and broadcast using the same API instance that created it.

---

## Simulation Phase

**File**: `frontend/src/lib/agents/baseAgent.ts`

**Method**: `BaseAgent.dryRunExtrinsic(api, extrinsic, address, rpcEndpoint?): Promise<DryRunResult>`

### Chopsticks Simulation (Preferred)

**Flow**:
1. **Lazy Import**:
   ```typescript
   const { simulateTransaction, isChopsticksAvailable } = await import('../../services/simulation');
   ```

2. **Check Availability**:
   ```typescript
   if (await isChopsticksAvailable()) {
     // Use Chopsticks
   }
   ```

3. **Call Simulation**:
   ```typescript
   const rpc = rpcEndpoint || this.extractRpcEndpoint(api);
   const result = await simulateTransaction(api, rpc, extrinsic, address);
   ```

**File**: `frontend/src/services/simulation/chopsticks.ts`

**Function**: `simulateTransaction(api, rpcEndpoints, extrinsic, senderAddress): Promise<SimulationResult>`

**Detailed Flow**:

1. **Import Chopsticks**:
   ```typescript
   const { BuildBlockMode, setup } = await import('@acala-network/chopsticks-core');
   ```

2. **Create Database**:
   ```typescript
   const dbName = `dotbot-sim-cache:${api.genesisHash.toHex()}`;
   const storage = new ChopsticksDatabase(dbName);
   ```
   - Uses IndexedDB for caching chain state
   - **File**: `frontend/src/services/simulation/database.ts`
   - **Class**: `ChopsticksDatabase`

3. **Get Current Block**:
   ```typescript
   const blockHash = await api.rpc.chain.getBlockHash();
   ```

4. **Fork Chain**:
   ```typescript
   const chain = await setup({
     endpoint: Array.isArray(rpcEndpoints) ? rpcEndpoints : [rpcEndpoints],
     block: blockHash.toHex(),
     buildBlockMode: BuildBlockMode.Batch,
     mockSignatureHost: true,  // Skip signature validation
     db: storage,
   });
   ```

5. **Dry-Run Extrinsic**:
   ```typescript
   const { outcome, storageDiff } = await chain.dryRunExtrinsic(
     {
       call: extrinsic.method.toHex(),  // Extrinsic call data
       address: senderAddress,          // Sender address
     },
     blockHash.toHex()
   );
   ```

6. **Parse Results**:
   ```typescript
   const balanceDeltas = await computeBalanceDeltas(api, senderAddress, storageDiff);
   const { succeeded, failureReason } = parseOutcome(api, outcome);
   ```

7. **Estimate Fee**:
   ```typescript
   const feeInfo = await extrinsic.paymentInfo(senderAddress);
   const fee = feeInfo.partialFee.toString();
   ```

8. **Cleanup**:
   ```typescript
   await storage.deleteBlock(blockHash.toHex());
   await storage.close();
   await chain.close();
   ```

9. **Return Result**:
   ```typescript
   return {
     success: succeeded,
     error: failureReason,
     estimatedFee: fee,
     balanceChanges: balanceDeltas,
     events: [],
   };
   ```

### PaymentInfo Fallback

If Chopsticks is unavailable:
```typescript
const paymentInfo = await extrinsic.paymentInfo(address);
return {
  success: true,
  estimatedFee: paymentInfo.partialFee.toString(),
  wouldSucceed: true,
  validationMethod: 'paymentInfo',
  runtimeInfo: {
    weight: paymentInfo.weight.toString(),
    class: paymentInfo.class.toString(),
    validated: false,  // Note: paymentInfo doesn't validate runtime execution
  },
};
```

**Limitation**: `paymentInfo` only validates structure, not actual runtime execution. It won't catch `wasm unreachable` errors.

---

## Error Analysis & Retry Logic

**File**: `frontend/src/lib/agents/errorAnalyzer.ts`

### Error Classification

**Function**: `analyzeError(error: Error | string): ErrorAnalysis`

**Categories**:

1. **USER_ERROR** (Don't Retry):
   - Insufficient balance
   - Invalid address
   - Existential deposit violation
   - Invalid amount

2. **CONFIGURATION_ERROR** (Retry with Correction):
   - `wasm unreachable` → Wrong chain or invalid call
   - `NoProviders` → Account doesn't exist on chain
   - `Asset not found` → Wrong chain
   - `Call not found` → Wrong chain or wrong method
   - `InvalidTransaction` → Wrong chain or parameters

3. **NETWORK_ERROR** (Retry Same Config):
   - Connection errors
   - Timeout errors
   - RPC errors

4. **UNKNOWN_ERROR** (Try Once More):
   - Unclassified errors

### Retry Strategy

**Function**: `getRetryStrategy(analysis, attemptNumber, currentChain, currentKeepAlive): RetryStrategy | null`

**Logic**:
- Analyzes specific error patterns
- Suggests targeted fixes (NOT random combinations)
- Examples:
  - `wasm unreachable` → `tryAlternateChain: true`
  - `NoProviders` on Asset Hub → `tryAlternateChain: true` (switch to Relay)
  - Network error → Retry same config

**Returns**:
```typescript
interface RetryStrategy {
  tryAlternateChain?: boolean;
  tryDifferentEndpoint?: boolean;
  tryKeepAlive?: boolean;
  adjustParameters?: Record<string, any>;
}
```

**Important**: The retry logic is **targeted**, not random. It only tries what the error suggests.

---

## Transaction Execution Phase

**File**: `frontend/src/lib/executionEngine/executioner.ts`

**Class**: `Executioner`

### Initialization

**Method**: `Executioner.initialize(api, account, signer?)`

**Variables**:
- `this.api: ApiPromise | null` - Default API (usually Relay Chain)
- `this.account: WalletAccount | null` - User's wallet account
- `this.signer: Signer | null` - Pluggable signer (BrowserWalletSigner, etc.)

### Execution Process

**Method**: `Executioner.execute(executionArray: ExecutionArray, options?: ExecutionOptions)`

**Flow**:
1. **Iterate through ExecutionArray**:
   ```typescript
   for (const item of executionArray.getItems()) {
     if (item.agentResult.extrinsic) {
       await this.executeExtrinsic(executionArray, item, timeout, autoApprove);
     }
   }
   ```

2. **Execute Individual Extrinsic**:
   ```typescript
   private async executeExtrinsic(executionArray, item, timeout, autoApprove) {
     const extrinsic = item.agentResult.extrinsic!;
     
     // CRITICAL: Get the API instance that created this extrinsic
     const apiForExtrinsic = (item.agentResult.metadata?.apiInstance as ApiPromise) || this.api;
     
     // Sign transaction
     const signedExtrinsic = await this.signTransaction(extrinsic, this.account.address, apiForExtrinsic);
     
     // Broadcast and monitor
     const result = await this.broadcastAndMonitor(signedExtrinsic, timeout, apiForExtrinsic, true);
   }
   ```

**Critical Point**: The `apiInstance` stored in `AgentResult.metadata` MUST be used for signing and broadcasting. Using the wrong API instance causes `wasm unreachable` errors.

3. **Signing**:
   ```typescript
   private async signTransaction(extrinsic, address, api): Promise<SubmittableExtrinsic> {
     const injector = await web3FromAddress(address);
     return extrinsic.signAsync(address, { signer: injector.signer });
   }
   ```

4. **Broadcasting**:
   ```typescript
   private async broadcastAndMonitor(extrinsic, timeout, apiToUse, alreadySigned) {
     const api = apiToUse || this.api;
     
     const sendMethod = alreadySigned 
       ? extrinsic.send 
       : (cb) => this.signAndSendTransaction(extrinsic, address, cb);
     
     return new Promise((resolve, reject) => {
       sendMethod((result) => {
         this.handleTransactionResult(result, api, extrinsic, timeoutHandle, resolve);
       });
     });
   }
   ```

5. **Monitoring**:
   - Waits for transaction to be included in a block
   - Checks for success/failure events
   - Handles timeouts

---

## Key Classes & Files

### Core Classes

1. **ExecutionOrchestrator**
   - **File**: `frontend/src/lib/executionEngine/orchestrator.ts`
   - **Purpose**: Converts LLM ExecutionPlan into ExecutionArray
   - **Key Methods**:
     - `orchestrate(plan, options)` - Main orchestration method
     - `executeStep(step)` - Executes single step
     - `getAgentInstance(className)` - Gets/caches agent instances

2. **AssetTransferAgent**
   - **File**: `frontend/src/lib/agents/asset-transfer/agent.ts`
   - **Purpose**: Handles DOT/token transfers
   - **Key Methods**:
     - `transfer(params)` - Main transfer method
     - `dryRunWithRetry(params, extrinsicCreator)` - Retry logic
     - `createTransferExtrinsic(api, recipient, amount, keepAlive)` - Creates extrinsic

3. **BaseAgent**
   - **File**: `frontend/src/lib/agents/baseAgent.ts`
   - **Purpose**: Base class for all agents
   - **Key Methods**:
     - `dryRunExtrinsic(api, extrinsic, address, rpcEndpoint)` - Simulation
     - `ensurePolkadotAddress(address)` - SS58 conversion
     - `getBalanceOnChain(chain, address)` - Balance queries

4. **Executioner**
   - **File**: `frontend/src/lib/executionEngine/executioner.ts`
   - **Purpose**: Executes transactions (signing, broadcasting, monitoring)
   - **Key Methods**:
     - `execute(executionArray, options)` - Main execution method
     - `executeExtrinsic(executionArray, item, timeout, autoApprove)` - Executes single extrinsic
     - `broadcastAndMonitor(extrinsic, timeout, apiToUse, alreadySigned)` - Broadcasting

5. **ErrorAnalyzer**
   - **File**: `frontend/src/lib/agents/errorAnalyzer.ts`
   - **Purpose**: Error classification and retry strategy
   - **Key Functions**:
     - `analyzeError(error)` - Classifies errors
     - `getRetryStrategy(analysis, attempt, chain, keepAlive)` - Determines retry strategy

### Simulation Services

1. **Chopsticks Simulation**
   - **File**: `frontend/src/services/simulation/chopsticks.ts`
   - **Function**: `simulateTransaction(api, rpcEndpoints, extrinsic, senderAddress)`
   - **Purpose**: Fork-based transaction simulation

2. **ChopsticksDatabase**
   - **File**: `frontend/src/services/simulation/database.ts`
   - **Class**: `ChopsticksDatabase`
   - **Purpose**: IndexedDB storage for chain state caching

---

## Data Structures

### ExecutionPlan
```typescript
interface ExecutionPlan {
  id: string;
  steps: ExecutionStep[];
}

interface ExecutionStep {
  id: string;
  agentClassName: string;      // "AssetTransferAgent"
  functionName: string;         // "transfer"
  parameters: Record<string, any>;
}
```

**File**: `frontend/src/lib/prompts/system/execution/types.ts`

### AgentResult
```typescript
interface AgentResult {
  extrinsic?: SubmittableExtrinsic<'promise'>;
  description: string;
  estimatedFee?: string;
  warnings?: string[];
  metadata?: {
    amount?: string;
    recipient?: string;
    sender?: string;
    chain?: string;
    keepAlive?: boolean;
    apiInstance?: ApiPromise;  // CRITICAL!
    attemptLog?: string;
  };
  resultType: 'extrinsic' | 'data' | 'mixed' | 'confirmation';
  requiresConfirmation: boolean;
  executionType: 'extrinsic' | 'data_fetch' | 'validation' | 'user_input';
}
```

**File**: `frontend/src/lib/agents/types.ts`

### DryRunResult
```typescript
interface DryRunResult {
  success: boolean;
  error?: string;
  estimatedFee: string;
  wouldSucceed: boolean;
  validationMethod?: 'chopsticks' | 'paymentInfo';
  runtimeInfo?: Record<string, any>;
  balanceChanges?: Array<{
    value: string;
    change: 'send' | 'receive';
  }>;
}
```

**File**: `frontend/src/lib/agents/types.ts`

### ErrorAnalysis
```typescript
interface ErrorAnalysis {
  category: 'USER_ERROR' | 'CONFIGURATION_ERROR' | 'NETWORK_ERROR' | 'UNKNOWN_ERROR';
  shouldRetry: boolean;
  suggestedFix?: string;
  userMessage: string;
  technicalDetails: string;
}
```

**File**: `frontend/src/lib/agents/errorAnalyzer.ts`

### RetryStrategy
```typescript
interface RetryStrategy {
  tryAlternateChain?: boolean;
  tryDifferentEndpoint?: boolean;
  tryKeepAlive?: boolean;
  adjustParameters?: Record<string, any>;
}
```

**File**: `frontend/src/lib/agents/errorAnalyzer.ts`

### SimulationResult
```typescript
interface SimulationResult {
  success: boolean;
  error: string | null;
  estimatedFee: string;
  balanceChanges: Array<{
    value: BN;
    change: 'send' | 'receive';
  }>;
  events: any[];
}
```

**File**: `frontend/src/services/simulation/chopsticks.ts`

---

## Important Variables

### Chain Selection
- `currentChain: 'assetHub' | 'relay'` - Current chain being tried
- `params.chain?: 'assetHub' | 'relay'` - User-specified chain (defaults to 'assetHub')
- `this.api: ApiPromise` - Relay Chain API instance
- `this.assetHubApi: ApiPromise | null` - Asset Hub API instance

### Address Formatting
- `senderAddress: string` - SS58-formatted sender address (Polkadot prefix 0)
- `recipientAddress: string` - SS58-formatted recipient address (Polkadot prefix 0)
- `params.address: string` - Original address (may be any SS58 format)
- `params.recipient: string` - Original recipient address

### Retry Logic
- `maxAttempts: number = 5` - Maximum retry attempts
- `attempt: number` - Current attempt number (1-5)
- `triedCombinations: Set<string>` - Tracks tried chain+keepAlive combinations
- `attemptLog: string[]` - User-friendly log of attempts
- `lastError: ErrorAnalysis | null` - Last error analysis

### Simulation
- `dryRun: DryRunResult` - Result from simulation
- `rpcEndpoint: string | string[]` - RPC endpoints for Chopsticks
- `blockHash: HexString` - Current block hash for forking
- `storage: ChopsticksDatabase` - IndexedDB storage for caching

### Transaction Execution
- `apiForExtrinsic: ApiPromise` - API instance that created the extrinsic (CRITICAL!)
- `signedExtrinsic: SubmittableExtrinsic` - Signed extrinsic ready to broadcast
- `alreadySigned: boolean` - Whether extrinsic is already signed (prevents double signing)

---

## Critical Design Decisions

### 1. API Instance Consistency
**Problem**: Extrinsics created with one API instance must be signed/broadcast with the same instance.

**Solution**: Store `apiInstance` in `AgentResult.metadata` and use it in `Executioner`.

**Code**:
```typescript
// In AssetTransferAgent.transfer()
metadata: {
  apiInstance: api,  // Store the API that created the extrinsic
}

// In Executioner.executeExtrinsic()
const apiForExtrinsic = (item.agentResult.metadata?.apiInstance as ApiPromise) || this.api;
```

### 2. SS58 Address Format
**Problem**: Addresses may be in different SS58 formats (Kusama, Polkadot, etc.).

**Solution**: Convert all addresses to Polkadot format (prefix 0) before use.

**Code**:
```typescript
const senderAddress = this.ensurePolkadotAddress(params.address);
const recipientAddress = this.ensurePolkadotAddress(params.recipient);
```

### 3. Targeted Retry Logic
**Problem**: Randomly trying combinations is inefficient and may modify user intent.

**Solution**: Analyze errors and suggest targeted fixes based on error patterns.

**Code**:
```typescript
if (errorLower.includes('wasm unreachable')) {
  strategy.tryAlternateChain = true;  // Only try alternate chain
}
```

### 4. Chopsticks Simulation
**Problem**: `paymentInfo` doesn't catch runtime errors like `wasm unreachable`.

**Solution**: Use Chopsticks for real runtime simulation, fallback to `paymentInfo` if unavailable.

**Code**:
```typescript
if (await isChopsticksAvailable()) {
  // Real runtime simulation
} else {
  // Structure validation only
}
```

---

## Summary

The simulation and transaction flow in DotBot follows this pattern:

1. **User Request** → LLM generates ExecutionPlan
2. **Orchestration** → ExecutionOrchestrator converts plan to ExecutionArray
3. **Agent Execution** → AssetTransferAgent validates and simulates
4. **Simulation** → Chopsticks (or paymentInfo) validates transaction
5. **Error Analysis** → Targeted retry logic based on error patterns
6. **Transaction Execution** → Executioner signs and broadcasts using correct API

Key principles:
- **API Consistency**: Always use the same API instance for create/sign/broadcast
- **SS58 Format**: Convert all addresses to Polkadot format
- **Targeted Retries**: Analyze errors and fix specific issues
- **Real Simulation**: Use Chopsticks for runtime validation when available

This architecture ensures robust transaction validation while preserving user intent and providing clear feedback throughout the process.



