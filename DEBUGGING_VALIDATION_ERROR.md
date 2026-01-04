# Debugging `TaggedTransactionQueue_validate_transaction` Error

## Error Message
```
RpcError: 1002: Verification Error: Runtime error: Execution failed: 
Execution aborted due to trap: wasm trap: wasm `unreachable` instruction executed
WASM backtrace:
    2: 0x781e77 - asset_hub_polkadot_runtime.wasm!TaggedTransactionQueue_validate_transaction
```

## What This Means

This error occurs during **transaction validation** (before execution). The runtime encountered an `unreachable!()` instruction, which means a critical invariant was violated.

## Post-Migration Context (November 4, 2025)

✅ **CORRECT Facts**:
- DOT **IS** native to Asset Hub now (balances were migrated)
- `balances.transfer` and `balances.transferKeepAlive` work normally on Asset Hub
- DOT is no longer on Relay Chain for most users
- Both methods are valid for Asset Hub DOT transfers

❌ **WRONG**:
- DOT is NOT a "reserve asset" requiring XCM for same-chain transfers
- `transferAllowDeath` is NOT forbidden (but transferKeepAlive is safer)

## Root Causes (in order of likelihood)

### 1. Account Doesn't Exist on Asset Hub ⚠️ **MOST LIKELY**

**What happens**: After migration, your account might have had balance on Relay Chain but never interacted with Asset Hub.

**Check Added**:
```typescript
// agent.ts - Step 5.1
const accountExists = availableBN.gt(new BN(0)) || new BN(nonce).gt(new BN(0));

if (!accountExists) {
  throw new AgentError(
    'Account does not exist on Asset Hub. ' +
    'You need to receive DOT on Asset Hub before you can send.'
  );
}
```

**What logs show**:
```
[AssetTransferAgent] ✅ STEP 5.1: Balance retrieved: {
  free: "0.0000000000 DOT",
  nonce: "0"
}
[AssetTransferAgent] ❌ Account does not exist on Asset Hub!
```

**Solution**: Receive some DOT on Asset Hub first (from another account or exchange)

---

### 2. Sender Address Format Wrong

**What happens**: Address format doesn't match chain's SS58 prefix.

**Check Added**:
```typescript
// agent.ts - Step 5.0
const { encodeAddress, decodeAddress } = await import('@polkadot/util-crypto');
const senderPublicKey = decodeAddress(params.address);
const senderAddress = encodeAddress(senderPublicKey, capabilities.ss58Prefix);
```

**What logs show**:
```
[AssetTransferAgent] 🔄 Sender address re-encoded: {
  original: "CUre1vj...",  // Kusama format (SS58 = 2)
  encoded: "5FRPxqwZ...",  // Polkadot format (SS58 = 0)
  ss58Prefix: 0
}
```

**Solution**: Address is now automatically re-encoded

---

### 3. Existential Deposit Violation

**What happens**: Transfer would leave account below ED (0.01 DOT on Asset Hub).

**Check Added**:
```typescript
// agent.ts - Step 5.3
const edBN = new BN(capabilities.existentialDeposit); // 100000000 = 0.01 DOT
const balanceAfterTransfer = availableBN.sub(amountBN).sub(estimatedFeeBN);

if (balanceAfterTransfer.lt(edBN) && balanceAfterTransfer.gt(new BN(0))) {
  warnings.push(
    'Account reaping risk! Balance after transfer would be below ED. ' +
    'Account may be reaped. Consider using keepAlive=true or transferring less.'
  );
}
```

**What logs show**:
```
[AssetTransferAgent] ⚠️  STEP 5.3: Account reaping risk detected!
Balance after: 0.0050000000 DOT (below ED: 0.0100000000 DOT)
```

**Solution**: 
- Use `keepAlive: true` to prevent reaping
- Transfer less to keep balance above ED
- Transfer everything (exactly 0 is OK with transferAllowDeath)

---

### 4. Insufficient Balance

**What happens**: Not enough balance to cover transfer + fees.

**Check Added**:
```typescript
// agent.ts - Step 5.2
const totalRequired = amountBN.add(estimatedFeeBN);

if (availableBN.lt(totalRequired)) {
  throw new AgentError(
    `Insufficient balance. Available: ${available}, Required: ${required}`
  );
}
```

**What logs show**:
```
[AssetTransferAgent] ✅ STEP 5.2: Sufficient balance confirmed
```

---

### 5. Wrong Chain Connection

**What happens**: Connected to Relay Chain instead of Asset Hub.

**Check Added**:
```typescript
// baseAgent.ts - getApiForChain()
const isAssetHub = 
  runtimeChain.toLowerCase().includes('asset') ||
  runtimeChain.toLowerCase().includes('statemint');

if (chain === 'assetHub' && !isAssetHub) {
  throw new AgentError('API is not connected to Asset Hub!');
}
```

**What logs show**:
```
[BaseAgent] Chain validation: {
  requested: "assetHub",
  runtimeChain: "Polkadot Asset Hub",
  specName: "statemint",
  isAssetHub: true
}
```

---

## Diagnostic Logs to Check

When the error occurs, look for these log entries (in order):

### 1. Sender Address Encoding
```
[AssetTransferAgent] 🔐 STEP 5.0: Encoding sender address for target chain...
[AssetTransferAgent] ✅ Sender address format matches chain
```

### 2. Account Existence
```
[AssetTransferAgent] ✅ STEP 5.1: Account exists on Asset Hub
```
❌ **If you see**: `Account does not exist` → **This is your problem!**

### 3. Balance Check
```
[AssetTransferAgent] ✅ STEP 5.1: Balance retrieved: {
  free: "1.0000000000 DOT",
  nonce: "5"
}
```
Check if `free > 0` and `nonce > 0`

### 4. Sufficient Balance
```
[AssetTransferAgent] ✅ STEP 5.2: Sufficient balance confirmed
```

### 5. Account Reaping Risk
```
[AssetTransferAgent] ✅ STEP 5.3: No account reaping risk
```
⚠️ **If you see**: `Account reaping risk detected` → Use `keepAlive: true`

### 6. Extrinsic Details
```
[AssetTransferAgent] 🔍 Extrinsic details for validation: {
  sender: "5FRPxqwZ...",
  recipient: "12dZDawZ...",
  amount: "10000000000",
  method: "balances.transferKeepAlive"
}
```

---

## Test Commands

### Check if Account Exists on Asset Hub
```typescript
const balance = await api.query.system.account(yourAddress);
console.log('Account info:', {
  free: balance.data.free.toString(),
  reserved: balance.data.reserved.toString(),
  frozen: balance.data.frozen.toString(),
  nonce: balance.nonce.toString()
});

// If free === "0" AND nonce === "0" → Account doesn't exist!
```

### Validate Address Format
```typescript
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';

const publicKey = decodeAddress(address);
const assetHubAddress = encodeAddress(publicKey, 0); // SS58 = 0 for Polkadot/Asset Hub

console.log('Address for Asset Hub:', assetHubAddress);
```

### Check Existential Deposit
```typescript
const ED = new BN('100000000'); // 0.01 DOT in Planck
const balance = new BN(accountInfo.data.free.toString());
const amount = new BN('10000000000'); // 1 DOT
const fee = new BN('200000000'); // 0.02 DOT estimated

const remaining = balance.sub(amount).sub(fee);

console.log({
  balance: balance.toString(),
  amount: amount.toString(),
  fee: fee.toString(),
  remaining: remaining.toString(),
  ED: ED.toString(),
  wouldBeReaped: remaining.lt(ED) && remaining.gt(new BN(0))
});
```

---

## Solutions

### Solution 1: Account Doesn't Exist on Asset Hub

**Problem**: Account has no balance and no transactions on Asset Hub yet.

**Fix**: 
1. Receive DOT on Asset Hub first (from exchange, another account, or bridge)
2. OR check if you have balance on Relay Chain and need to migrate

### Solution 2: Wrong Address Format

**Already Fixed**: Agent now automatically re-encodes addresses to match target chain

### Solution 3: Existential Deposit Violation

**Problem**: Transfer would leave account below 0.01 DOT but not at 0.

**Fix**: Use `keepAlive: true` in transfer params
```typescript
await agent.transfer({
  address: sender,
  recipient: recipient,
  amount: '0.01',
  chain: 'assetHub',
  keepAlive: true, // ← Add this
});
```

### Solution 4: Insufficient Balance

**Problem**: Not enough DOT to cover transfer + fees.

**Fix**: Transfer a smaller amount or add more DOT to your account

### Solution 5: Wrong Chain

**Problem**: Connected to Relay Chain instead of Asset Hub.

**Fix**: Ensure you're using Asset Hub endpoints:
```
wss://polkadot-asset-hub-rpc.polkadot.io
```

---

## Summary

The validation error **most likely** means:
1. ⚠️ **Account doesn't exist on Asset Hub yet** (no balance, no nonce)
2. Address format was wrong (now fixed automatically)
3. Transfer violates ED rules

**Check the logs** for:
```
❌ Account does not exist on Asset Hub!
```

If you see this, you need to **receive DOT on Asset Hub first** before you can send.

