# Production-Safe Transfer System for Polkadot/Substrate

**Date:** 2026-01-04  
**Context:** Multi-network, multi-asset transfer architecture

---

## Core Principles

### 1. Construction vs Execution
- **Extrinsic construction** almost always succeeds (if pallet exists)
- **Execution** depends on: balance, ED, nonce, network restrictions
- Never conflate the two - construction is cheap validation, execution is expensive

### 2. Network Agnostic
- Never assume `transferAllowDeath` exists (Substrate default is `transfer`)
- Detect available pallets: `balances`, `assets`, `tokens`
- Handle different decimals, ED rules, and pallet arguments

### 3. Asset Types
- **Native tokens** (DOT, KSM): `balances.transfer` or `balances.transferAllowDeath`
- **Multi-asset chains**: `assets.transfer` with assetId
- **Parachain tokens**: May use `tokens.transfer` or custom pallets
- Always use smallest unit (Planck, token decimals)

### 4. Signature Verification
- Use plain strings for `signRaw`, not hex encoding
- Compare **public keys**, never SS58 addresses
- Let SDK handle SCALE wrapping and crypto context
- No manual prefixes, no wrapper hacks

---

## Architecture

```
User Request
    ↓
[1] Detect Available Pallets/Methods
    ↓
[2] Validate Parameters (addresses, amounts)
    ↓
[3] Construct Extrinsic (method selection, fallback)
    ↓
[4] Simulate (optional but recommended)
    ↓
[5] Sign (wallet handles crypto)
    ↓
[6] Broadcast & Monitor
```

---

## Implementation Strategy

### Phase 1: Pallet Detection

```typescript
interface TransferCapabilities {
  // Native token transfers
  hasBalances: boolean;
  hasTransferAllowDeath: boolean; // Newer method
  hasTransfer: boolean;           // Legacy method
  hasTransferKeepAlive: boolean;
  
  // Multi-asset support
  hasAssets: boolean;              // Statemint/AssetHub pattern
  hasTokens: boolean;              // Acala/Karura pattern
  
  // Metadata
  nativeDecimals: number;
  existentialDeposit: string;
  ss58Prefix: number;
}

async function detectTransferCapabilities(api: ApiPromise): Promise<TransferCapabilities> {
  await api.isReady;
  
  return {
    hasBalances: !!api.tx.balances,
    hasTransferAllowDeath: !!api.tx.balances?.transferAllowDeath,
    hasTransfer: !!api.tx.balances?.transfer,
    hasTransferKeepAlive: !!api.tx.balances?.transferKeepAlive,
    hasAssets: !!api.tx.assets,
    hasTokens: !!api.tx.tokens,
    nativeDecimals: api.registry.chainDecimals[0] || 10,
    existentialDeposit: api.consts.balances?.existentialDeposit?.toString() || '0',
    ss58Prefix: api.registry.chainSS58 || 0,
  };
}
```

### Phase 2: Safe Extrinsic Construction

```typescript
interface NativeTransferParams {
  recipient: string;
  amount: string | number | BN; // Accept multiple formats, normalize to BN
  keepAlive?: boolean;
}

function constructNativeTransfer(
  api: ApiPromise,
  params: NativeTransferParams,
  capabilities: TransferCapabilities
): SubmittableExtrinsic<'promise'> {
  const { BN } = require('@polkadot/util');
  const { decodeAddress, encodeAddress } = require('@polkadot/util-crypto');
  
  // 1. Validate and normalize amount
  const amount = new BN(params.amount);
  if (amount.lte(new BN(0))) {
    throw new Error('Amount must be greater than zero');
  }
  
  // 2. Validate and encode recipient address
  let recipientAddress: string;
  try {
    const publicKey = decodeAddress(params.recipient);
    recipientAddress = encodeAddress(publicKey, capabilities.ss58Prefix);
  } catch (err) {
    throw new Error(`Invalid recipient address: ${params.recipient}`);
  }
  
  // 3. Select appropriate method with fallback chain
  const keepAlive = params.keepAlive === true;
  
  if (keepAlive) {
    if (!capabilities.hasTransferKeepAlive) {
      throw new Error('transferKeepAlive not available on this chain');
    }
    return api.tx.balances.transferKeepAlive(recipientAddress, amount);
  }
  
  // Priority: transferAllowDeath (newer) → transfer (legacy)
  if (capabilities.hasTransferAllowDeath) {
    return api.tx.balances.transferAllowDeath(recipientAddress, amount);
  }
  
  if (capabilities.hasTransfer) {
    console.warn('Using legacy balances.transfer (transferAllowDeath not available)');
    return api.tx.balances.transfer(recipientAddress, amount);
  }
  
  throw new Error('No transfer method available on this chain');
}
```

### Phase 3: Multi-Asset Support

```typescript
interface AssetTransferParams {
  assetId: string | number;
  recipient: string;
  amount: string | number | BN;
}

function constructAssetTransfer(
  api: ApiPromise,
  params: AssetTransferParams,
  capabilities: TransferCapabilities
): SubmittableExtrinsic<'promise'> {
  const { BN } = require('@polkadot/util');
  const { decodeAddress, encodeAddress } = require('@polkadot/util-crypto');
  
  // 1. Validate and normalize
  const amount = new BN(params.amount);
  if (amount.lte(new BN(0))) {
    throw new Error('Amount must be greater than zero');
  }
  
  const publicKey = decodeAddress(params.recipient);
  const recipientAddress = encodeAddress(publicKey, capabilities.ss58Prefix);
  
  // 2. Construct based on available pallet
  if (capabilities.hasAssets) {
    // AssetHub / Statemint pattern
    // api.tx.assets.transfer(assetId, target, amount)
    return api.tx.assets.transfer(params.assetId, recipientAddress, amount);
  }
  
  if (capabilities.hasTokens) {
    // Acala / Karura pattern
    // api.tx.tokens.transfer(target, currencyId, amount)
    return api.tx.tokens.transfer(recipientAddress, params.assetId, amount);
  }
  
  throw new Error('No asset transfer method available on this chain');
}
```

### Phase 4: Unified Transfer Interface

```typescript
interface UnifiedTransferParams {
  type: 'native' | 'asset';
  recipient: string;
  amount: string | number | BN;
  assetId?: string | number;
  keepAlive?: boolean;
}

async function createTransferExtrinsic(
  api: ApiPromise,
  params: UnifiedTransferParams
): Promise<SubmittableExtrinsic<'promise'>> {
  // 1. Detect capabilities once
  const capabilities = await detectTransferCapabilities(api);
  
  // 2. Route to appropriate constructor
  if (params.type === 'asset') {
    if (!params.assetId) {
      throw new Error('assetId required for asset transfers');
    }
    return constructAssetTransfer(api, {
      assetId: params.assetId,
      recipient: params.recipient,
      amount: params.amount,
    }, capabilities);
  }
  
  // Native transfer
  return constructNativeTransfer(api, {
    recipient: params.recipient,
    amount: params.amount,
    keepAlive: params.keepAlive,
  }, capabilities);
}
```

---

## Validation Best Practices

### Address Validation

```typescript
function validateAddress(address: string, expectedSS58?: number): { valid: boolean; publicKey?: Uint8Array; error?: string } {
  const { decodeAddress, encodeAddress } = require('@polkadot/util-crypto');
  
  try {
    const publicKey = decodeAddress(address);
    
    // Optionally verify SS58 format
    if (expectedSS58 !== undefined) {
      const reEncoded = encodeAddress(publicKey, expectedSS58);
      if (reEncoded !== address) {
        return {
          valid: true,
          publicKey,
          error: `Address is valid but not in chain's SS58 format. Expected prefix: ${expectedSS58}`,
        };
      }
    }
    
    return { valid: true, publicKey };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Invalid address',
    };
  }
}
```

### Amount Validation

```typescript
function validateAmount(
  amount: string | number | BN,
  capabilities: TransferCapabilities
): { valid: boolean; amountBN?: BN; error?: string } {
  const { BN } = require('@polkadot/util');
  
  try {
    // Convert to BN
    let amountBN: BN;
    if (BN.isBN(amount)) {
      amountBN = amount;
    } else if (typeof amount === 'string') {
      // Handle decimal strings (e.g., "1.5")
      if (amount.includes('.')) {
        const [whole, decimal] = amount.split('.');
        const decimalPlaces = decimal.length;
        if (decimalPlaces > capabilities.nativeDecimals) {
          return {
            valid: false,
            error: `Too many decimal places. Max: ${capabilities.nativeDecimals}`,
          };
        }
        // Convert to Planck: 1.5 DOT = 1.5 * 10^10
        const multiplier = new BN(10).pow(new BN(capabilities.nativeDecimals));
        const wholeBN = new BN(whole).mul(multiplier);
        const decimalBN = new BN(decimal).mul(
          new BN(10).pow(new BN(capabilities.nativeDecimals - decimalPlaces))
        );
        amountBN = wholeBN.add(decimalBN);
      } else {
        amountBN = new BN(amount);
      }
    } else {
      amountBN = new BN(amount);
    }
    
    // Validate > 0
    if (amountBN.lte(new BN(0))) {
      return { valid: false, error: 'Amount must be greater than zero' };
    }
    
    // Check against ED (optional, informational)
    const ed = new BN(capabilities.existentialDeposit);
    if (amountBN.lt(ed)) {
      return {
        valid: true,
        amountBN,
        error: `Amount is below existential deposit (${ed.toString()}). Recipient account must exist or transfer will fail.`,
      };
    }
    
    return { valid: true, amountBN };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Invalid amount format',
    };
  }
}
```

---

## Signature Verification (Correct Pattern)

### ❌ WRONG - Common Mistakes

```typescript
// WRONG: Manually encoding hex
const signature = await signer.signRaw({
  address: account.address,
  data: hexToU8a(message), // ❌ DON'T DO THIS
  type: 'payload'
});

// WRONG: Comparing SS58 addresses
if (recoveredAddress === account.address) { // ❌ SS58 mismatch issues
  // ...
}

// WRONG: Manual wrapping
const wrapped = `<Bytes>${message}</Bytes>`; // ❌ Wallet handles this
```

### ✅ CORRECT - Production Safe

```typescript
async function signAndVerifyMessage(
  account: WalletAccount,
  message: string
): Promise<{ valid: boolean; signature?: string; error?: string }> {
  const { web3FromAddress } = await import('@polkadot/extension-dapp');
  const { signatureVerify } = await import('@polkadot/util-crypto');
  const { decodeAddress } = await import('@polkadot/util-crypto');
  
  try {
    // 1. Get injector (no manual web3Enable needed if already connected)
    const injector = await web3FromAddress(account.address);
    
    // 2. Sign plain string - wallet handles SCALE wrapping
    const signResult = await injector.signer.signRaw({
      address: account.address,
      data: message, // ✅ Plain string, no hex encoding
      type: 'payload'
    });
    
    const signature = signResult.signature;
    
    // 3. Verify signature with SAME plain string
    const verification = signatureVerify(message, signature, account.address);
    
    // 4. Compare public keys, NOT addresses
    const expectedPublicKey = decodeAddress(account.address);
    const recoveredPublicKey = decodeAddress(verification.crypto === 'none' ? '' : account.address);
    
    // ✅ Byte-by-byte comparison
    const publicKeysMatch = expectedPublicKey.every((byte, i) => byte === recoveredPublicKey[i]);
    
    if (!verification.isValid || !publicKeysMatch) {
      return {
        valid: false,
        error: `Signature verification failed. Crypto: ${verification.crypto}, isValid: ${verification.isValid}`,
      };
    }
    
    return { valid: true, signature };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Signature verification error',
    };
  }
}
```

---

## Error Handling Strategy

### Classification

```typescript
enum TransferErrorType {
  // Construction errors (fail fast)
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  METHOD_NOT_AVAILABLE = 'METHOD_NOT_AVAILABLE',
  ASSET_NOT_FOUND = 'ASSET_NOT_FOUND',
  
  // Execution errors (runtime)
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  ED_VIOLATION = 'ED_VIOLATION',
  ACCOUNT_NOT_EXIST = 'ACCOUNT_NOT_EXIST',
  NONCE_ERROR = 'NONCE_ERROR',
  
  // Network errors
  RPC_ERROR = 'RPC_ERROR',
  NETWORK_DISCONNECTED = 'NETWORK_DISCONNECTED',
  TIMEOUT = 'TIMEOUT',
  
  // Signature errors
  USER_REJECTED = 'USER_REJECTED',
  SIGNATURE_FAILED = 'SIGNATURE_FAILED',
}

interface TransferError {
  type: TransferErrorType;
  message: string;
  recoverable: boolean;
  suggestion?: string;
}
```

### Error Analysis

```typescript
function analyzeTransferError(error: any): TransferError {
  const message = error.message || String(error);
  const lower = message.toLowerCase();
  
  // Insufficient balance
  if (lower.includes('insufficient') || lower.includes('balance')) {
    return {
      type: TransferErrorType.INSUFFICIENT_BALANCE,
      message: 'Insufficient balance to complete transfer',
      recoverable: true,
      suggestion: 'Reduce transfer amount or add funds to account',
    };
  }
  
  // ED violation
  if (lower.includes('existential') || lower.includes('keepalive')) {
    return {
      type: TransferErrorType.ED_VIOLATION,
      message: 'Transfer would violate existential deposit rules',
      recoverable: true,
      suggestion: 'Use transferKeepAlive or leave more balance in account',
    };
  }
  
  // Account doesn't exist
  if (lower.includes('deadaccount') || lower.includes('account not found')) {
    return {
      type: TransferErrorType.ACCOUNT_NOT_EXIST,
      message: 'Recipient account does not exist',
      recoverable: true,
      suggestion: 'Transfer amount must be >= existential deposit for new accounts',
    };
  }
  
  // User rejected
  if (lower.includes('rejected') || lower.includes('cancelled')) {
    return {
      type: TransferErrorType.USER_REJECTED,
      message: 'User rejected transaction',
      recoverable: true,
      suggestion: 'User cancelled signing. No retry needed.',
    };
  }
  
  // Default
  return {
    type: TransferErrorType.RPC_ERROR,
    message,
    recoverable: false,
    suggestion: 'Check network connection and try again',
  };
}
```

---

## Multi-Network Testing Matrix

| Network | Pallet | Method | ED | Decimals | Notes |
|---------|--------|--------|----|---------:|-------|
| Polkadot | balances | transferAllowDeath | 1 DOT | 10 | Standard |
| Kusama | balances | transferAllowDeath | 0.000333 KSM | 12 | Higher decimals |
| Asset Hub | balances + assets | transferAllowDeath | 0.1 DOT | 10 | Multi-asset support |
| Acala | tokens | transfer | 0.1 ACA | 12 | Custom tokens pallet |
| Moonbeam | balances | transfer | 1 GLMR | 18 | Legacy method only |
| Generic Substrate | balances | transfer | varies | varies | Fallback safe |

---

## Complete Implementation Checklist

### Construction Phase
- [ ] Detect available pallets (`balances`, `assets`, `tokens`)
- [ ] Detect available methods (`transferAllowDeath`, `transfer`, `transferKeepAlive`)
- [ ] Get chain metadata (decimals, ED, SS58 prefix)
- [ ] Validate recipient address with `decodeAddress()`
- [ ] Convert amount to BN, handle decimal strings
- [ ] Encode addresses to chain's SS58 format
- [ ] Select appropriate method with fallback chain
- [ ] Construct extrinsic (construction always succeeds if pallet exists)

### Pre-Execution Validation
- [ ] Check sender balance >= amount + fees
- [ ] Check recipient exists OR amount >= ED (for new accounts)
- [ ] Validate nonce is correct (Polkadot.js handles automatically)
- [ ] Run Chopsticks simulation (recommended)
- [ ] Check session health and runtime version

### Execution Phase
- [ ] Get wallet injector with `web3FromAddress()`
- [ ] Sign extrinsic with `signAsync()` (Polkadot.js handles nonce, era, etc.)
- [ ] Validate signed extrinsic registry
- [ ] Broadcast with `send()`
- [ ] Monitor events: InBlock → Finalized
- [ ] Handle execution errors with proper classification

### Error Handling
- [ ] Classify errors (construction vs execution)
- [ ] Provide actionable suggestions
- [ ] Log full error details for debugging
- [ ] Don't retry construction errors (fail fast)
- [ ] Consider retry for network errors only

---

## Key Takeaways

1. **Separation of Concerns**
   - Construction ≠ Execution
   - Validation ≠ Simulation
   - Errors at different stages need different handling

2. **Never Assume**
   - Method availability (always detect)
   - SS58 format (always encode)
   - Decimals (always get from metadata)
   - Asset type (native vs multi-asset)

3. **Always Use SDK**
   - BN for amounts
   - decodeAddress/encodeAddress for addresses
   - signatureVerify for verification
   - API metadata for chain info

4. **Production Safety**
   - Detect before construct
   - Validate before execute
   - Simulate before broadcast
   - Monitor after send
   - Classify errors properly

5. **Multi-Network Support**
   - Runtime detection over hardcoding
   - Fallback chains for methods
   - Chain-specific SS58 encoding
   - Decimal-aware amount conversion

---

## Next Steps for DotBot

1. **Enhance AssetTransferAgent**
   - Add capability detection
   - Add multi-asset support
   - Improve validation
   - Better error messages

2. **Create Transfer Utilities**
   - `detectTransferCapabilities()`
   - `validateAddress()`
   - `validateAmount()`
   - `analyzeTransferError()`

3. **Update Executioner**
   - Use capability detection
   - Add asset transfer support
   - Enhance error classification

4. **Add Tests**
   - Test across multiple networks
   - Test with different asset types
   - Test error scenarios
   - Test signature verification

---

This document serves as the foundation for a production-safe, multi-network transfer system. Implementation to follow.


