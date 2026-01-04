# CRITICAL FIX: Sender Address Must NOT Be Re-Encoded

## The Bug

The sender address was being re-encoded to match the target chain's SS58 prefix:

```typescript
// ❌ WRONG - Was doing this:
const senderPublicKey = decodeAddress(params.address);
const senderAddress = encodeAddress(senderPublicKey, capabilities.ss58Prefix);
```

### What This Caused

```
Wallet address:    "5FRPxqwZaqh5uoYBD8U5VYpEYmhZYyKjVnRe5JBVyyzVMxqk"
                           ↓ (re-encoded to SS58 = 0)
Extrinsic built with: "14Mh7BCdScxZMLYhAmX5dhePQPhDFGssaHA8EbArY521YRd5"
                           ↓
Wallet signs with:    "5FRPxqwZaqh5uoYBD8U5VYpEYmhZYyKjVnRe5JBVyyzVMxqk"
                           ↓
❌ SIGNATURE MISMATCH!
                           ↓
Runtime validation: wasm trap: unreachable instruction
```

## Why This Is Wrong

**The sender address MUST match the wallet's address format exactly** because:

1. **Wallet extensions sign with the original address**
2. **Signature validation checks**: signature + message + **address**
3. **If the address in the extrinsic doesn't match the signing address** → signature invalid
4. **Runtime panics** with `TaggedTransactionQueue_validate_transaction` error

## The Fix

```typescript
// ✅ CORRECT - Do this instead:
const { decodeAddress } = await import('@polkadot/util-crypto');

// Validate address is valid (but DON'T re-encode it!)
try {
  decodeAddress(params.address);
} catch (error) {
  throw new AgentError('Invalid sender address');
}

// Use sender address exactly as provided by wallet
const senderAddress = params.address;
```

## Key Insight

**Balance queries work with ANY valid encoding of the same public key!**

```typescript
// These are the SAME account (same public key):
"5FRPxqwZaqh5uoYBD8U5VYpEYmhZYyKjVnRe5JBVyyzVMxqk"  // Generic Substrate (SS58 = 42)
"14Mh7BCdScxZMLYhAmX5dhePQPhDFGssaHA8EbArY521YRd5"  // Polkadot (SS58 = 0)

// Balance query works with EITHER:
await api.query.system.account("5FRPxqwZ..."); // ✅ Works
await api.query.system.account("14Mh7BCd..."); // ✅ Works (same balance)
```

**But signatures MUST use the exact address format from the wallet!**

## Recipient vs Sender

| Address | Re-encode? | Why |
|---------|------------|-----|
| **Sender** | ❌ **NO** | Must match wallet format for signature validation |
| **Recipient** | ✅ **YES** | Can be any format, gets re-encoded by `safeExtrinsicBuilder` |

## Before vs After

### Before (BROKEN)

```typescript
// Sender re-encoded
const senderAddress = encodeAddress(
  decodeAddress(params.address), 
  capabilities.ss58Prefix
);

// Extrinsic built with re-encoded sender
const extrinsic = api.tx.balances.transferKeepAlive(recipient, amount);

// Wallet signs with ORIGINAL address
await extrinsic.signAndSend(params.address); // ← Mismatch!

// ❌ Result: Signature validation fails
```

### After (FIXED)

```typescript
// Sender used as-is from wallet
const senderAddress = params.address;

// Extrinsic built with ORIGINAL sender address
const extrinsic = api.tx.balances.transferKeepAlive(recipient, amount);

// Wallet signs with SAME address
await extrinsic.signAndSend(params.address); // ← Match!

// ✅ Result: Signature validation passes
```

## Logs Showing The Fix

### Before (showing re-encoding):
```
[AssetTransferAgent] 🔄 Sender address re-encoded: 
  original: "5FRPxqwZaqh5uoYBD8U5VYpEYmhZYyKjVnRe5JBVyyzVMxqk"
  encoded: "14Mh7BCdScxZMLYhAmX5dhePQPhDFGssaHA8EbArY521YRd5"
```

### After (no re-encoding):
```
[AssetTransferAgent] ✅ Sender address is valid: {
  address: "5FRPxqwZaqh5uoYBD8U5VYpEYmhZYyKjVnRe5JBVyyzVMxqk",
  note: "Using address as-is from wallet (signature must match)"
}
```

## What About Balance Queries?

**Balance queries still work!** Substrate's account storage uses the **public key**, not the SS58-encoded address. The SS58 format is just a display/input format.

```typescript
// All these query the SAME account:
await api.query.system.account("5FRPxqwZ..."); // Generic format
await api.query.system.account("14Mh7BCd..."); // Polkadot format
await api.query.system.account("CUre1vj...");  // Kusama format

// They all decode to the same public key internally
```

## Summary

1. ✅ **Sender address**: Use exactly as from wallet (no re-encoding)
2. ✅ **Recipient address**: Can be re-encoded (handled by `safeExtrinsicBuilder`)
3. ✅ **Balance queries**: Work with any format (same public key)
4. ✅ **Signature validation**: Requires exact address match

**The transfer should now work!** 🎉

