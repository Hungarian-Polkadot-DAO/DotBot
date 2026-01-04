# Robust Transaction Simulation with Retry Logic

## Overview

The `AssetTransferAgent` now features a robust transaction simulation system inspired by Mimir's approach, with intelligent error analysis and automatic retry mechanisms.

## Key Features

### 1. **Error Classification System**

Errors are automatically classified into categories:

```typescript
- USER_ERROR           // User input issues → Don't retry
- CONFIGURATION_ERROR  // Wrong chain/API → Retry with correction
- NETWORK_ERROR        // Temporary issues → Retry
- UNKNOWN_ERROR        // Unknown → Try once more
```

### 2. **Intelligent Retry Logic**

```
Attempt 1: Try specified chain (default: Asset Hub)
    ↓
  Error? → Analyze error category
    ↓
  USER_ERROR? → Fail immediately with clear message
    ↓
  CONFIGURATION_ERROR? → Try alternate chain
    ↓
Attempt 2: Try alternate chain
    ↓
  Error? → Analyze again
    ↓
Attempt 3: Final retry if needed
    ↓
Success or fail with detailed log
```

### 3. **User Error Detection (Fail Fast)**

These errors are detected immediately and **don't trigger retries**:

- ❌ Insufficient balance
- ❌ Invalid address
- ❌ Below existential deposit
- ❌ Invalid amount

### 4. **Configuration Error Detection (Retry with Correction)**

These errors trigger **automatic chain switching**:

- 🔄 Unknown asset (try alternate chain)
- 🔄 Call not found (try alternate chain)
- 🔄 WASM unreachable (try alternate chain)
- 🔄 Provider/consumer issues (try Relay Chain)

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    User Request                              │
│              "Send 0.01 DOT to Alice"                        │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│              Step 1: Validate User Input                     │
│   • Check addresses (sender, recipient)                      │
│   • Validate amount (> 0, valid format)                      │
│   • Parse parameters                                         │
└─────────────────────────────────────────────────────────────┘
                           ↓
              ┌────────────────────────┐
              │   Valid?               │
              └────────────────────────┘
                   ↓ No        Yes ↓
            ┌──────────┐              ↓
            │ FAIL     │    ┌─────────────────────────────────┐
            │ User     │    │ Step 2: Robust Simulation       │
            │ Error    │    │ with Retry Logic                │
            └──────────┘    └─────────────────────────────────┘
                                        ↓
                            ┌───────────────────────────────────┐
                            │ Attempt 1: Asset Hub (default)    │
                            │ • Get API                         │
                            │ • Create extrinsic                │
                            │ • Dry-run (paymentInfo)           │
                            └───────────────────────────────────┘
                                        ↓
                            ┌───────────────────────────────────┐
                            │ Success?                          │
                            └───────────────────────────────────┘
                              ↓ No              Yes ↓
                    ┌─────────────────┐              ↓
                    │ Analyze Error   │              ↓
                    │ Category        │              ↓
                    └─────────────────┘              ↓
                              ↓                      ↓
              ┌───────────────────────────────┐     ↓
              │ USER_ERROR?                   │     ↓
              │ (insufficient balance, etc.)  │     ↓
              └───────────────────────────────┘     ↓
                  ↓ Yes         No ↓                ↓
            ┌──────────┐          ↓                 ↓
            │ FAIL     │          ↓                 ↓
            │ Don't    │          ↓                 ↓
            │ Retry    │          ↓                 ↓
            └──────────┘          ↓                 ↓
                              ┌───────────────────────────────┐
                              │ CONFIGURATION_ERROR?          │
                              │ (wasm unreachable, etc.)      │
                              └───────────────────────────────┘
                                  ↓ Yes         No ↓
                    ┌───────────────────────────────────┐
                    │ Attempt 2: Relay Chain            │
                    │ • Switch chain                    │
                    │ • Get API                         │
                    │ • Create extrinsic                │
                    │ • Dry-run                         │
                    └───────────────────────────────────┘
                                  ↓
                    ┌───────────────────────────────────┐
                    │ Success?                          │
                    └───────────────────────────────────┘
                      ↓ No              Yes ↓
            ┌─────────────────┐              ↓
            │ Attempt 3       │              ↓
            │ (if applicable) │              ↓
            └─────────────────┘              ↓
                      ↓                      ↓
            ┌─────────────────┐              ↓
            │ FAIL            │              ↓
            │ All attempts    │              ↓
            │ exhausted       │              ↓
            └─────────────────┘              ↓
                                             ↓
                            ┌───────────────────────────────────┐
                            │ Step 3: Check Balance             │
                            │ • Get balance on successful chain │
                            │ • Validate amount + fees          │
                            └───────────────────────────────────┘
                                             ↓
                            ┌───────────────────────────────────┐
                            │ Sufficient?                       │
                            └───────────────────────────────────┘
                              ↓ No              Yes ↓
                    ┌─────────────────┐              ↓
                    │ FAIL            │              ↓
                    │ Insufficient    │              ↓
                    │ Balance         │              ↓
                    └─────────────────┘              ↓
                                             ┌───────────────────────────────────┐
                                             │ Step 4: Return Success            │
                                             │ • Validated extrinsic             │
                                             │ • Correct API instance            │
                                             │ • Estimated fees                  │
                                             │ • Attempt log                     │
                                             └───────────────────────────────────┘
```

## Example Scenarios

### Scenario 1: Asset Hub Success (1 Attempt)

```
User: "Send 0.01 DOT to Alice"

🔄 Attempt 1/3: Trying Asset Hub...
🧪 Dry-running on Asset Hub...
✅ Success on Asset Hub

Result: Transaction ready on Asset Hub (1 attempt)
```

### Scenario 2: Configuration Error → Auto-Switch (2 Attempts)

```
User: "Send 0.01 DOT to Alice"

🔄 Attempt 1/3: Trying Asset Hub...
🧪 Dry-running on Asset Hub...
❌ Failed: wasm unreachable
📊 Error category: CONFIGURATION_ERROR
🔄 Switching from assetHub to relay

🔄 Attempt 2/3: Trying Relay Chain...
🧪 Dry-running on Relay Chain...
✅ Success on Relay Chain

Result: Transaction ready on Relay Chain (2 attempts)
Warning: "ℹ️ Required 2 attempt(s) to find correct chain"
```

### Scenario 3: User Error → Fail Fast (No Retry)

```
User: "Send 100 DOT to Alice" (but only has 1 DOT)

🔄 Attempt 1/3: Trying Asset Hub...
🧪 Dry-running on Asset Hub...
❌ Failed: Insufficient balance
📊 Error category: USER_ERROR
🚫 User error detected - not retrying

Result: ❌ Insufficient balance for this transaction including fees
(No retries attempted)
```

### Scenario 4: Unknown Error → Try Once More (2 Attempts)

```
User: "Send 0.01 DOT to Alice"

🔄 Attempt 1/3: Trying Asset Hub...
🧪 Dry-running on Asset Hub...
❌ Failed: Unknown RPC error
📊 Error category: UNKNOWN_ERROR
🔄 Switching from assetHub to relay

🔄 Attempt 2/3: Trying Relay Chain...
🧪 Dry-running on Relay Chain...
✅ Success on Relay Chain

Result: Transaction ready on Relay Chain (2 attempts)
```

## Error Categories in Detail

### USER_ERROR (Don't Retry)

**Detected Patterns:**
- `insufficient balance`
- `invalid address`
- `existential deposit`
- `invalid amount`

**User Message:**
```
❌ Insufficient balance for this transaction including fees

Technical details: InsufficientBalance: Account balance too low
```

**Action:** Fail immediately, provide clear instructions

---

### CONFIGURATION_ERROR (Retry with Correction)

**Detected Patterns:**
- `wasm unreachable`
- `unknown asset`
- `call not found`
- `noproviders`

**User Message:**
```
🔄 Runtime validation failed - possibly wrong chain

Trying alternate chain...
```

**Action:** Switch to alternate chain and retry

---

### NETWORK_ERROR (Retry Same)

**Detected Patterns:**
- `network`
- `timeout`
- `connection`
- `rpc error`

**User Message:**
```
🔄 Network connection issue

Retrying...
```

**Action:** Retry same operation

---

### UNKNOWN_ERROR (Try Once More)

**Detected Patterns:**
- Everything else

**User Message:**
```
⚠️ Unexpected error occurred

Trying alternate chain...
```

**Action:** Try alternate chain once

## Implementation Details

### Core Components

#### 1. Error Analyzer (`errorAnalyzer.ts`)

```typescript
export function analyzeError(error: Error | string): ErrorAnalysis {
  // Classify error into category
  // Return analysis with retry strategy
}

export function getRetryStrategy(
  analysis: ErrorAnalysis,
  attemptNumber: number,
  currentChain: 'assetHub' | 'relay'
): RetryStrategy | null {
  // Determine if should retry
  // Return strategy (alternate chain, same chain, etc.)
}
```

#### 2. Retry Logic (`AssetTransferAgent.dryRunWithRetry()`)

```typescript
private async dryRunWithRetry(
  params: { address: string; chain?: 'assetHub' | 'relay' },
  extrinsicCreator: (api: ApiPromise) => SubmittableExtrinsic
): Promise<{
  dryRun: DryRunResult;
  api: ApiPromise;
  extrinsic: SubmittableExtrinsic;
  chainName: string;
  attemptLog: string[];
}> {
  // Max 3 attempts
  // Analyze errors
  // Apply retry strategies
  // Return successful result or throw
}
```

#### 3. Integration in `transfer()` and `batchTransfer()`

```typescript
// Old (simple):
const api = this.getApiForChain(targetChain);
const extrinsic = this.createTransferExtrinsic(api, ...);
const dryRun = await this.dryRunExtrinsic(api, extrinsic, address);

// New (robust):
const { dryRun, api, extrinsic, chainName, attemptLog } = 
  await this.dryRunWithRetry(
    { address, chain },
    (api) => this.createTransferExtrinsic(api, ...)
  );
```

## Console Output Example

```
💸 AssetTransferAgent.transfer() called with params:
  sender: 5FRPxqwZ...
  recipient: 12dZDawZ...
  amount: 0.01
  chain: assetHub (default)

🚀 Starting robust simulation with retry logic...

🔄 Attempt 1/3: Trying Asset Hub...
🧪 Dry-running on Asset Hub...
❌ Failed: 1002: Verification Error: wasm unreachable
📊 Error category: CONFIGURATION_ERROR
🔄 Switching from assetHub to relay

🔄 Attempt 2/3: Trying Relay Chain...
🧪 Dry-running on Relay Chain...
✅ Success on Relay Chain

✅ Simulation successful!
📋 Attempt log:
🔄 Attempt 1/3: Trying Asset Hub...
❌ Failed: 1002: Verification Error: wasm unreachable
📊 Error category: CONFIGURATION_ERROR
🔄 Switching from assetHub to relay
🔄 Attempt 2/3: Trying Relay Chain...
✅ Success on Relay Chain

💰 Checking balance on Relay Chain...

✅ Transfer preparation complete
```

## Benefits

### 1. **Better User Experience**
- Clear, actionable error messages
- Automatic problem resolution
- No manual chain switching needed

### 2. **Robustness**
- Handles chain mismatches automatically
- Recovers from temporary network issues
- Validates before user sees transaction

### 3. **Transparency**
- Full attempt log available
- Clear indication of which chain was used
- Warnings if multiple attempts were needed

### 4. **Efficiency**
- Fails fast on user errors (no wasted retries)
- Smart retry strategies (not blind retries)
- Max 3 attempts (prevents infinite loops)

## Testing

### Test Case 1: Normal Flow
```typescript
// User has DOT on Asset Hub
await agent.transfer({
  address: userAddress,
  recipient: aliceAddress,
  amount: '0.01',
});

// Expected: 1 attempt, success on Asset Hub
```

### Test Case 2: Chain Mismatch
```typescript
// User has DOT on Relay Chain only
await agent.transfer({
  address: userAddress,
  recipient: aliceAddress,
  amount: '0.01',
  // Defaults to Asset Hub
});

// Expected: 2 attempts
// - Attempt 1: Asset Hub fails (wasm unreachable)
// - Attempt 2: Relay Chain succeeds
```

### Test Case 3: User Error
```typescript
// User has insufficient balance
await agent.transfer({
  address: userAddress,
  recipient: aliceAddress,
  amount: '100', // Too much
});

// Expected: 1 attempt, immediate failure
// Error: "Insufficient balance for this transaction including fees"
```

### Test Case 4: Invalid Address
```typescript
// Invalid recipient
await agent.transfer({
  address: userAddress,
  recipient: 'invalid',
  amount: '0.01',
});

// Expected: 0 attempts (caught in validation)
// Error: "Invalid recipient address provided"
```

## Future Enhancements

### 1. **Advanced Simulation**
- Integrate Chopsticks for full runtime simulation
- Simulate state changes before execution
- Detect more edge cases

### 2. **XCM Integration**
- Automatic cross-chain transfers
- If DOT on wrong chain, offer to move it
- Handle multi-hop transfers

### 3. **Fee Optimization**
- Compare fees across chains
- Suggest cheapest option
- Batch optimization

### 4. **Machine Learning**
- Learn from past errors
- Predict best chain based on user history
- Optimize retry strategies

## Comparison with Mimir

### Similarities
- ✅ Pre-flight validation
- ✅ Error detection before user sees transaction
- ✅ Clear error messages

### Our Enhancements
- ✅ Automatic retry with chain switching
- ✅ Error classification (user vs system)
- ✅ Detailed attempt logging
- ✅ Smart retry strategies (not just retry same)

### Mimir's Advantages
- Chopsticks integration (full runtime simulation)
- HTML report generation
- ~30s deep simulation

### Our Advantages
- Faster (paymentInfo-based)
- Automatic problem resolution
- No user interaction needed for retries

---

**Status:** ✅ Implemented and tested
**Build:** ✅ 446.66 kB (+1.42 kB)
**Performance:** Fast (< 1s for most cases)

