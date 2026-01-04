# Critical Architecture Issues & Solutions

## Problem Summary

The current `AssetTransferAgent` has fundamental design flaws that cause `wasm unreachable` errors and incorrect chain selection.

## Critical Bugs Identified

### 1. ❌ Chain Selection Based on Balance (WRONG!)

**Current (Wrong):**
```typescript
const { balance, chain } = await this.getDotBalance(address);
// Decides chain based on where money is
```

**Why Wrong:**
- Post-migration, DOT exists on BOTH chains
- These are independent ledgers
- Presence of balance ≠ correct execution location
- Silent fallback changes economic semantics

**Correct Model:**
```
User Intent → Chain → API → Extrinsic
```

NOT:
```
Balance → Chain → Extrinsic  ❌
```

### 2. ❌ No Dry-Run/Simulation Before Returning

**Current:** Return extrinsic that has never been validated
**Result:** Runtime panics (`wasm unreachable`)

**Must Do:**
- Call `api.call.transactionPaymentApi.queryInfo()` for fee validation
- Use runtime simulation/dry-run
- Convert runtime panic → agent error BEFORE returning to user

### 3. ❌ Fee Validation on Wrong Chain

**Current:**
```typescript
const estimatedFee = await this.estimateFee(extrinsic, address);
```

**Problem:**
- Estimates on one chain
- Might submit on different chain
- Fee estimation depends on: call, signed extensions, runtime, chain

### 4. ❌ Unsafe API Fallback

**Current:**
```typescript
const api = chain === 'assetHub' && this.assetHubApi 
  ? this.assetHubApi 
  : this.getApi();  // ❌ Silent fallback
```

**Problem:** Changes economic semantics without user consent

**Should Be:** Hard error or explicit confirmation

### 5. ❌ Batch Transfers Ignore Asset Hub

**Current:**
```typescript
const api = this.getApi();  // Always relay chain!
```

Forces Relay Chain even if all funds on Asset Hub.

## Mimir's Approach (Reference)

From TxSubmit examples:

```typescript
// 1. Build extrinsic
// 2. Simulate BEFORE returning
const { success, error } = await simulate(api, wsUrls, call, account);

// 3. Only return if simulation passes
if (!success) {
  throw new AgentError(error);
}
```

**Key Takeaways:**
- Always simulate before returning extrinsic
- Fail early with clear errors
- Never return doomed extrinsics

## Correct Architecture

### Chain Selection Rules

**For DOT Transfers:**

1. **Default:** Asset Hub (post-migration recommendation)
2. **Fallback:** Relay Chain (only if explicitly specified or Asset Hub unavailable with user consent)
3. **Validation:** Check balance on SELECTED chain, not infer chain from balance

### Extrinsic Creation Flow

```typescript
1. Determine Chain (from user intent, NOT balance)
   ↓
2. Get API for that chain
   ↓
3. Check balance on THAT chain
   ↓
4. Create extrinsic with THAT API
   ↓
5. Dry-run/Simulate on THAT API
   ↓
6. Estimate fees on THAT API
   ↓
7. Final validation (balance + fees)
   ↓
8. Return if all checks pass
```

### Balance Validation (Correct)

```typescript
// 1. Check on the SAME chain as extrinsic
const balance = await getBalanceOnChain(chain, address);

// 2. Validate: amount + fees + existential deposit
const required = amount + estimatedFee + existentialDeposit;
if (balance.available < required) {
  throw new AgentError('Insufficient balance including fees');
}
```

## Implementation Plan

### Phase 1: Add Dry-Run Support

```typescript
interface DryRunResult {
  success: boolean;
  error?: string;
  estimatedFee: string;
  wouldSucceed: boolean;
}

async function dryRunExtrinsic(
  api: ApiPromise,
  extrinsic: SubmittableExtrinsic,
  address: string
): Promise<DryRunResult>
```

### Phase 2: Explicit Chain Parameter

```typescript
interface TransferParams {
  address: string;
  recipient: string;
  amount: string;
  chain: 'relay' | 'assetHub';  // ✅ EXPLICIT
  keepAlive?: boolean;
  validateBalance?: boolean;
}
```

### Phase 3: Rework Agent Logic

```typescript
async transfer(params: TransferParams): Promise<AgentResult> {
  // 1. Get API for SPECIFIED chain
  const api = this.getApiForChain(params.chain);
  
  // 2. Validate balance on THAT chain
  const balance = await this.getBalanceOnChain(params.chain, params.address);
  
  // 3. Create extrinsic
  const extrinsic = this.createTransferExtrinsic(api, ...);
  
  // 4. DRY-RUN (critical!)
  const dryRun = await this.dryRunExtrinsic(api, extrinsic, params.address);
  if (!dryRun.success) {
    throw new AgentError(dryRun.error);
  }
  
  // 5. Final validation (amount + fees)
  await this.validateTotalCost(balance, params.amount, dryRun.estimatedFee);
  
  // 6. Return validated extrinsic
  return this.createResult(description, extrinsic, {
    estimatedFee: dryRun.estimatedFee,
    chain: params.chain,
    apiInstance: api,
  });
}
```

### Phase 4: LLM Prompt Updates

The system prompt must tell the LLM:

```markdown
**Chain Selection for DOT Transfers:**

Post Asset Hub migration, DOT exists on BOTH chains:
- Asset Hub: Recommended for regular transfers (lower fees, optimized)
- Relay Chain: For validator operations, staking, governance

**Default: Use Asset Hub for DOT transfers**

When generating ExecutionPlan, always specify:
- chain: 'assetHub' (default for DOT transfers)
- chain: 'relay' (only for staking/governance)

Check balance on the SPECIFIED chain, not both.
```

## Testing Requirements

### Test 1: Asset Hub Transfer
```
User has: 10 DOT on Asset Hub, 0 on Relay
Request: "Send 1 DOT to Alice" (defaults to Asset Hub)
Expected: ✅ Success
```

### Test 2: Relay Chain Transfer
```
User has: 0 DOT on Asset Hub, 10 on Relay
Request: "Send 1 DOT to Alice via Relay Chain"
Expected: ✅ Success (explicit chain specified)
```

### Test 3: Insufficient Balance Detection
```
User has: 0.5 DOT on Asset Hub
Request: "Send 1 DOT to Alice"
Expected: ❌ "Insufficient balance on Asset Hub. Available: 0.5 DOT, Required: 1.01 DOT (including fees)"
```

### Test 4: Dry-Run Catches Runtime Error
```
User has: Balance but invalid recipient/state
Expected: ❌ Agent error BEFORE showing to user (not runtime panic)
```

## References

- Mimir TxSubmit: Uses `simulate()` for pre-flight checks
- Polkadot.js: `api.call.transactionPaymentApi.queryInfo()` for fee estimation
- Runtime validation: Always dry-run before user sees extrinsic

## Migration Notes

### Breaking Changes
- `TransferParams` now requires `chain` parameter
- Balance checking no longer infers chain
- Extrinsics fail early if dry-run fails

### Backward Compatibility
- Can default `chain: 'assetHub'` for DOT transfers
- Provide clear error messages for users
- Guide users to move DOT to recommended chain

## Status

- [x] Issues identified
- [ ] Dry-run infrastructure added
- [ ] Agent logic reworked
- [ ] System prompt updated
- [ ] Tests passing

