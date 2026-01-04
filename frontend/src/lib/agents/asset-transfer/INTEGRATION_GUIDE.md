# Production-Safe Transfer Integration Guide

## Architecture Overview

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Agent     │────────▶│ Executioner  │────────▶│   Network   │
│ (Validate)  │         │  (Rebuild)   │         │  (Execute)  │
└─────────────┘         └──────────────┘         └─────────────┘
      │                        │
      │                        │
      ▼                        ▼
┌─────────────────────────────────────────────────────────────┐
│           Production-Safe Transfer Utilities                │
│                                                             │
│  • detectTransferCapabilities()  - Runtime detection       │
│  • buildSafeTransferExtrinsic()  - Fallback construction   │
│  • validateExistentialDeposit()  - ED validation          │
└─────────────────────────────────────────────────────────────┘
```

## Integration Strategy

### Phase 1: Executioner Integration (CRITICAL - DO THIS FIRST)

The executioner rebuilds extrinsics and MUST use production-safe methods.

**Location**: `frontend/src/lib/executionEngine/executioner.ts`

**Changes Needed**:

1. **Import utilities**:
```typescript
import { 
  detectTransferCapabilities, 
  TransferCapabilities 
} from '../agents/asset-transfer/utils/transferCapabilities';
import { 
  buildSafeTransferExtrinsic 
} from '../agents/asset-transfer/utils/safeExtrinsicBuilder';
```

2. **Detect capabilities once per session**:
```typescript
// In executeExtrinsic() after creating session
const capabilities = await detectTransferCapabilities(apiForExtrinsic);
```

3. **Replace manual extrinsic building with safe builder**:
```typescript
// BEFORE (current - line 466-479):
if (keepAlive) {
  extrinsic = apiForExtrinsic.tx.balances.transferKeepAlive(recipientAddress, amount);
} else {
  if (apiForExtrinsic.tx.balances.transferAllowDeath) {
    extrinsic = apiForExtrinsic.tx.balances.transferAllowDeath(recipientAddress, amount);
  } else if (apiForExtrinsic.tx.balances.transfer) {
    extrinsic = apiForExtrinsic.tx.balances.transfer(recipientAddress, amount);
  } else {
    throw new Error('No suitable transfer method available');
  }
}

// AFTER (production-safe):
const result = buildSafeTransferExtrinsic(
  apiForExtrinsic,
  {
    recipient: metadata.recipient,
    amount: metadata.amount, // Already a string
    keepAlive: metadata.keepAlive,
  },
  capabilities
);

extrinsic = result.extrinsic;

// Log warnings
if (result.warnings.length > 0) {
  console.warn('[Executioner] Transfer construction warnings:', result.warnings);
}

// Log method used
console.log('[Executioner] Using transfer method:', result.method);
```

4. **Update batch rebuilding similarly**:
```typescript
// Replace manual batch building (line 871-909) with:
import { buildSafeBatchExtrinsic } from '../agents/asset-transfer/utils/safeExtrinsicBuilder';

const result = buildSafeBatchExtrinsic(
  apiForBatch,
  metadata.transfers,
  capabilities,
  true // useAtomicBatch
);

const batchExtrinsic = result.extrinsic;
```

**Benefits**:
- ✅ Automatic fallback from `transferAllowDeath` → `transfer`
- ✅ Proper SS58 address encoding (already done, but consolidated)
- ✅ BN conversion (already done, but consolidated)
- ✅ ED validation with warnings
- ✅ Method detection logging
- ✅ Works across all Substrate chains

---

### Phase 2: Agent Enhancement (OPTIONAL - BETTER USER FEEDBACK)

The agent validates parameters and returns metadata. It can OPTIONALLY use capability detection for early warnings.

**Location**: `frontend/src/lib/agents/asset-transfer/agent.ts`

**Changes** (Optional but recommended):

1. **Add capability caching**:
```typescript
export class AssetTransferAgent extends BaseAgent {
  private capabilitiesCache: Map<string, TransferCapabilities> = new Map();
  
  // ... existing code
}
```

2. **Detect capabilities early** (in `transfer()` method):
```typescript
// After line 87 (balance check)
const api = await this.getApiForChain(targetChain);
const capabilities = await detectTransferCapabilities(api);

// Validate minimum capabilities
try {
  validateMinimumCapabilities(capabilities);
} catch (error) {
  throw new AgentError(
    error instanceof Error ? error.message : String(error),
    'INSUFFICIENT_CAPABILITIES'
  );
}

// Check if keepAlive is supported
if (finalKeepAlive && !capabilities.hasTransferKeepAlive) {
  warnings.push(
    `⚠️ transferKeepAlive not available on ${chainName}. ` +
    `Will use ${capabilities.hasTransferAllowDeath ? 'transferAllowDeath' : 'transfer'} instead.`
  );
}

// Add chain-specific warnings
warnings.push(
  `Using ${capabilities.specName} v${capabilities.specVersion}: ` +
  `${capabilities.nativeTokenSymbol} (${capabilities.nativeDecimals} decimals)`
);
```

3. **Enhanced ED validation**:
```typescript
// Replace line 91-108 with:
const edCheck = validateExistentialDeposit(amountBN, capabilities);
if (!edCheck.valid && edCheck.warning) {
  warnings.push(edCheck.warning);
}
```

**Benefits**:
- ✅ Earlier error detection (before execution)
- ✅ Better user feedback (method availability warnings)
- ✅ Chain-specific ED warnings

---

### Phase 3: Deprecate Old Builders (CLEANUP)

Once executioner uses safe builders, the old extrinsic builders are redundant.

**Files to Update/Remove**:
- ❌ `extrinsics/transfer.ts` - Replace with safe builder
- ❌ `extrinsics/transferKeepAlive.ts` - Replace with safe builder
- ❌ `extrinsics/batchTransfer.ts` - Replace with safe builder

**OR** Update them to use safe builder internally:
```typescript
// extrinsics/transfer.ts - Updated version
import { buildSafeTransferExtrinsic } from '../utils/safeExtrinsicBuilder';
import { detectTransferCapabilities } from '../utils/transferCapabilities';

export async function createTransferExtrinsic(
  api: ApiPromise,
  params: TransferExtrinsicParams
): Promise<SubmittableExtrinsic<'promise'>> {
  const capabilities = await detectTransferCapabilities(api);
  const result = buildSafeTransferExtrinsic(api, params, capabilities);
  return result.extrinsic;
}
```

---

## Testing Strategy

### Test Matrix

| Chain | Method | Test Case | Expected Behavior |
|-------|--------|-----------|-------------------|
| Polkadot | transferAllowDeath | Standard transfer | ✅ Use transferAllowDeath |
| Polkadot | transferKeepAlive | keepAlive=true | ✅ Use transferKeepAlive |
| Legacy Chain | transfer only | Standard transfer | ✅ Fallback to transfer with warning |
| Asset Hub | transferAllowDeath | Multi-asset | ✅ Detect assets pallet |
| Moonbeam | transfer only | GLMR transfer | ✅ Use transfer (18 decimals) |
| Kusama | transferAllowDeath | KSM transfer | ✅ 12 decimals, smaller ED |

### Test Procedure

1. **Capability Detection**:
```typescript
const api = await ApiPromise.create({ provider });
const caps = await detectTransferCapabilities(api);
console.log('Capabilities:', caps);
```

2. **Safe Construction**:
```typescript
const result = buildSafeTransferExtrinsic(
  api,
  { recipient: '...', amount: '1000000000', keepAlive: false },
  caps
);
console.log('Method:', result.method);
console.log('Warnings:', result.warnings);
```

3. **Execution** (via executioner):
```typescript
// Should work automatically with new safe builder
```

---

## Error Handling

### Construction Errors (Agent + Executioner)
- `INSUFFICIENT_CAPABILITIES` - Chain doesn't support transfers
- `METHOD_NOT_AVAILABLE` - Requested method (e.g., transferKeepAlive) not on chain
- `INVALID_ADDRESS` - Address decode failed
- `INVALID_AMOUNT` - Amount format invalid

### Execution Errors (Network)
- `INSUFFICIENT_BALANCE` - Not enough balance
- `ED_VIOLATION` - Below existential deposit
- `ACCOUNT_NOT_EXIST` - Recipient doesn't exist and amount < ED

### Warnings (Non-blocking)
- Legacy method fallback
- ED validation warnings
- keepAlive method unavailability

---

## Migration Checklist

### Phase 1: Critical (Executioner)
- [ ] Add utility imports to executioner
- [ ] Add capability detection in `executeExtrinsic()`
- [ ] Replace manual extrinsic building with `buildSafeTransferExtrinsic()`
- [ ] Replace batch building with `buildSafeBatchExtrinsic()`
- [ ] Test on Polkadot/Asset Hub
- [ ] Test on legacy chains (if available)

### Phase 2: Enhancement (Agent)
- [ ] Add capability detection to agent
- [ ] Add early capability validation
- [ ] Enhanced ED warnings
- [ ] Chain-specific method warnings
- [ ] Test user feedback

### Phase 3: Cleanup
- [ ] Update or remove old extrinsic builders
- [ ] Remove redundant fallback code
- [ ] Update tests
- [ ] Update documentation

---

## Key Benefits

1. **Multi-Network Compatibility**: Works on Polkadot, Kusama, parachains, legacy chains
2. **Automatic Fallbacks**: `transferAllowDeath` → `transfer` seamlessly
3. **Proper Address Encoding**: SS58 format per chain (fixes wasm unreachable)
4. **Type Safety**: BN for amounts, validated decimals
5. **ED Awareness**: Warns about existential deposit violations
6. **Better Errors**: Construction errors with context and suggestions
7. **Future-Proof**: Easy to add multi-asset support later

---

## Next: Multi-Asset Support

Once basic transfers work reliably, add:
1. Asset detection (`api.tx.assets`, `api.tx.tokens`)
2. Asset metadata queries (decimals, symbol, ED)
3. Asset transfer methods
4. Asset-specific validation

This is Phase 4 - implement after Phase 1-3 stable.


