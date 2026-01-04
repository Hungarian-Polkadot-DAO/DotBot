# Address Encoding and Double Popup Fix

## Date
2026-01-04

## Issues Fixed

### Issue 1: Extension Popup Appearing Multiple Times

**Problem:**
- The wallet extension permission popup was appearing multiple times during transaction signing
- This was caused by `web3Enable('DotBot')` being called repeatedly in the `createSignature()` method

**Root Cause:**
- `web3AuthService.ts` was calling `web3Enable()` every time `createSignature()` was invoked
- This triggered a new permission request each time, even though the extensions were already enabled

**Solution:**
- Changed `createSignature()` to use `web3FromAddress()` instead of `web3Enable()`
- `web3FromAddress()` retrieves the injector for an already-connected account without triggering permission popups
- Added `web3FromAddress` to the imports

**Files Changed:**
- `frontend/src/lib/services/web3AuthService.ts`

**Code Change:**
```typescript
// BEFORE (incorrect - triggers popup every time)
const extensions = await web3Enable('DotBot');
const extension = extensions.find((e: any) => e.name === account.source);

// AFTER (correct - uses existing connection)
const injector = await web3FromAddress(account.address);
```

---

### Issue 2: Transaction Failing with `wasm unreachable` Error

**Problem:**
- Transactions were failing with `wasm unreachable` errors during:
  - `TransactionPaymentApi_query_info` (fee estimation)
  - `TaggedTransactionQueue_validate_transaction` (transaction pool validation)
- Both Chopsticks simulation and actual network broadcast were affected

**Root Cause:**
- Address encoding mismatch: addresses need to be encoded in the correct SS58 format for each chain
- Polkadot relay chain uses SS58 prefix 0
- Asset Hub (being a system chain) also uses SS58 prefix 0
- But wallet accounts might be stored with different SS58 formats (e.g., generic format 42)
- The runtime's `TransactionPaymentApi` and transaction validation expect addresses in the correct format

**Solution:**
Implemented proper SS58 address encoding in multiple places:

1. **Extrinsic Rebuilding** (`executioner.ts`):
   - Decode recipient address to raw public key bytes
   - Re-encode using the chain's SS58 format
   - Use re-encoded address when building the extrinsic

2. **Fee Estimation** (`chopsticks.ts`):
   - Encode sender address to chain's SS58 format before calling `paymentInfo()`
   - This prevents `TransactionPaymentApi_query_info` errors

3. **Transaction Signing** (`executioner.ts`):
   - Encode sender address to chain's SS58 format before signing
   - Ensures the signature is created with the correctly formatted address

4. **Simulation** (`executioner.ts`):
   - Encode sender address before passing to Chopsticks simulation
   - Ensures consistent address format throughout simulation

**Files Changed:**
- `frontend/src/lib/executionEngine/executioner.ts`
- `frontend/src/lib/services/simulation/chopsticks.ts`

**Code Pattern:**
```typescript
const { encodeAddress, decodeAddress } = await import('@polkadot/util-crypto');

// Decode to raw public key (works with any SS58 format)
const publicKey = decodeAddress(address);

// Re-encode with chain-specific SS58 format
const ss58Format = api.registry.chainSS58 || 0; // Default to Polkadot (0)
const encodedAddress = encodeAddress(publicKey, ss58Format);

// Use encodedAddress for all operations
```

---

## Technical Details

### SS58 Address Format
- SS58 is Substrate's address format
- Different chains use different prefixes:
  - 0: Polkadot relay chain
  - 0: Asset Hub (Polkadot system chain)
  - 2: Kusama
  - 42: Generic substrate
- Same account (public key) has different string representations on different chains
- Runtime validation expects addresses in the chain's native format

### Why This Matters
1. **Transaction Pool Validation**: The runtime's `validate_transaction` checks if the sender exists and has sufficient balance
2. **Fee Estimation**: `paymentInfo()` needs to look up the sender's account to calculate fees
3. **Signature Verification**: While signatures verify against public keys, the address format must be consistent
4. **Runtime Panics**: Using wrong address format can cause runtime panics (`wasm unreachable`)

---

## Testing

To verify the fixes:

1. **Double Popup Fix**:
   - Connect wallet (should see popup once)
   - Initiate a transaction
   - Approve in UI
   - Should see signing popup only once (not multiple times)

2. **Transaction Success**:
   - Create a transfer on Asset Hub
   - Should pass Chopsticks simulation without `wasm unreachable` errors
   - Fee estimation should succeed
   - Transaction should broadcast and finalize successfully

---

## Related Files
- `frontend/src/lib/services/web3AuthService.ts` - Wallet connection and signing
- `frontend/src/lib/executionEngine/executioner.ts` - Transaction execution
- `frontend/src/lib/services/simulation/chopsticks.ts` - Chopsticks simulation

---

## References
- Polkadot.js Address Format: https://polkadot.js.org/docs/keyring/start/ss58
- Substrate SS58 Registry: https://github.com/paritytech/ss58-registry
- `@polkadot/util-crypto` documentation: https://polkadot.js.org/docs/util-crypto/


