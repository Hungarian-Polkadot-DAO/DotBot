# Mimir vs Our Implementation - Comparison

## Summary

**Core Logic:** ✅ **SAME** - We use the same Chopsticks API and approach
**Database:** ✅ **IDENTICAL** - Same IndexedDB implementation
**Missing Features:** ⚠️ **HTML Diff Generation** - We don't generate visual reports
**API Differences:** ⚠️ **Different Input Types** - We use `SubmittableExtrinsic`, Mimir uses `IMethod`

## Detailed Comparison

### 1. Main Simulation Function

#### Mimir's `simulate()` (lines 75-183)
```typescript
export async function simulate(
  api: ApiPromise,
  rpc: string | string[],
  call: IMethod,              // ← Just the method
  address: string,
): Promise<{
  success: boolean;
  error: string | null;
  html: string;              // ← HTML diff report
  balanceChanges: { value: BN; change: 'send' | 'receive' }[];
}>
```

#### Our `simulateTransaction()` (lines 39-168)
```typescript
export async function simulateTransaction(
  api: ApiPromise,
  rpc: string | string[],
  extrinsic: SubmittableExtrinsic<'promise'>,  // ← Full extrinsic
  address: string
): Promise<SimulationResult> {
  // Returns: { success, error, estimatedFee, balanceChanges, events }
  // Missing: html (HTML diff report)
}
```

**Key Differences:**
- ✅ **Input:** Mimir uses `IMethod` (just the call), we use `SubmittableExtrinsic` (full extrinsic)
- ❌ **Output:** Mimir returns `html` for visual diff, we don't
- ✅ **Output:** We add `estimatedFee` and `events`, Mimir doesn't

### 2. Database Implementation

#### Mimir's `IdbDatabase` (db.ts)
```typescript
export class IdbDatabase implements Database {
  // ... exact same implementation
}
```

#### Our `ChopsticksDatabase` (database.ts)
```typescript
export class ChopsticksDatabase implements Database {
  // ... IDENTICAL implementation, just different class name
}
```

**Status:** ✅ **IDENTICAL** - Same code, different name

### 3. Missing Features (Mimir Has, We Don't)

#### ❌ HTML Diff Generation

**Mimir has:**
```typescript
// Lines 39-60: decodeStorageDiff()
export const decodeStorageDiff = async (
  block: Block,
  diff: [HexString, HexString | null][],
) => {
  const [{ decodeBlockStorageDiff }, diffPatcher] = await Promise.all([
    import('@acala-network/chopsticks-core'),
    getDiffPatcher(),
  ]);

  const [oldState, newState] = await decodeBlockStorageDiff(block, diff);
  const oldStateWithoutEvents: any = cloneDeep(oldState);
  
  if (oldStateWithoutEvents.system?.events) {
    oldStateWithoutEvents.system.events = [];
  }

  return {
    oldState,
    newState,
    delta: diffPatcher.diff(oldStateWithoutEvents, newState),
  };
};

// Lines 62-73: generateHtmlDiff()
export const generateHtmlDiff = async (
  block: Block,
  diff: [HexString, HexString | null][],
) => {
  const { oldState, delta } = await decodeStorageDiff(block, diff);
  const htmlTemplate = simulateTemplate;  // ← HTML template

  return template(htmlTemplate)({
    left: JSON.stringify(oldState),
    delta: JSON.stringify(delta),
  });
};
```

**We don't have:**
- `decodeStorageDiff()` function
- `generateHtmlDiff()` function
- `simulateTemplate` (HTML template)
- `getDiffPatcher()` (lazy-loaded jsondiffpatch)

**Why it matters:**
- Mimir can show users a visual diff of state changes
- We can only show success/failure, not the detailed changes

### 4. Balance Changes Parsing

#### Mimir (lines 115-145)
```typescript
const balanceChanges: { value: BN; change: 'send' | 'receive' }[] = [];

try {
  for (const diff of storageDiff) {
    if (diff[0] === storageKey) {
      const accountInfo = api.createType('FrameSystemAccountInfo', diff[1]);
      const prevAccountInfo = await api.query.system.account(address);

      const prevTotalBalance = prevAccountInfo.data.free.add(
        prevAccountInfo.data.reserved
      );
      const totalBalance = accountInfo.data.free.add(
        accountInfo.data.reserved
      );

      if (totalBalance.gt(prevTotalBalance)) {
        balanceChanges.push({
          change: 'receive',
          value: totalBalance.sub(prevTotalBalance),
        });
      } else if (totalBalance.lt(prevTotalBalance)) {
        balanceChanges.push({
          change: 'send',
          value: prevTotalBalance.sub(totalBalance),
        });
      }
    }
  }
} catch {
  /* Empty */
}
```

#### Ours (lines 173-217)
```typescript
async function parseBalanceChanges(
  api: ApiPromise,
  address: string,
  storageDiff: [HexString, HexString | null][]
): Promise<Array<{ value: BN; change: 'send' | 'receive' }>> {
  // ... EXACT SAME LOGIC, just extracted to separate function
}
```

**Status:** ✅ **SAME LOGIC** - We just extracted it to a helper function

### 5. Error Parsing

#### Mimir (lines 149-176)
```typescript
let success = false;
let error: string | null = null;

if (outcome.isOk) {
  const ok = outcome.asOk;

  if (ok.isOk) {
    success = true;
  } else {
    const err = ok.asErr;

    if (err.isModule) {
      const { docs, name, section } = api.registry.findMetaError(err.asModule);
      error = `${section}.${name} Error:\n ${docs.join(', ')}`;  // ← Different format
    } else if (err.isToken) {
      error = `TokenError: ${err.asToken.type}`;
    } else {
      error = `Error: ${err.type}`;
    }
  }
} else {
  const err = outcome.asErr;
  error = `InvalidTransaction: ${err.type}`;
}
```

#### Ours (lines 98-132)
```typescript
if (outcome.isOk) {
  const ok = outcome.asOk;
  
  if (ok.isOk) {
    success = true;
    console.log('✅ Transaction would succeed!');
  } else {
    const err = ok.asErr;
    
    if (err.isModule) {
      const { docs, name, section } = api.registry.findMetaError(err.asModule);
      error = `${section}.${name}: ${docs.join(', ')}`;  // ← Slightly different format
      console.error('❌ Module error:', error);
    } else if (err.isToken) {
      error = `TokenError: ${err.asToken.type}`;
      console.error('❌ Token error:', error);
    } else {
      error = `DispatchError: ${err.type}`;
      console.error('❌ Dispatch error:', error);
    }
  }
} else {
  const err = outcome.asErr;
  error = `InvalidTransaction: ${err.type}`;
  console.error('❌ Invalid transaction:', error);
}
```

**Status:** ✅ **SAME LOGIC** - Just different formatting and we add console logs

### 6. Fee Estimation

#### Mimir
- ❌ **Doesn't estimate fees** in the simulation function
- Probably does it elsewhere

#### Ours
```typescript
// Get fee estimate
let estimatedFee = '0';
try {
  const paymentInfo = await extrinsic.paymentInfo(address);
  estimatedFee = paymentInfo.partialFee.toString();
} catch (feeError) {
  console.warn('⚠️ Could not estimate fee:', feeError);
}
```

**Status:** ✅ **We add this** - Mimir doesn't include it in simulation

## What We're Using

### ✅ Same Core Libraries
- `@acala-network/chopsticks-core` - Same version
- `idb` - Same IndexedDB wrapper
- `jsondiffpatch` - Mimir uses it, we installed it but don't use it yet
- `diff-match-patch` - Mimir uses it, we installed it but don't use it yet
- `lodash-es` - Mimir uses it, we installed it but don't use it yet

### ✅ Same Approach
1. Create fork at current block
2. Execute `chain.dryRunExtrinsic()`
3. Parse outcome and storage diff
4. Extract balance changes
5. Cleanup

### ❌ Missing Features
1. **HTML Diff Generation** - Visual state change reports
2. **State Diff Decoding** - Detailed before/after state
3. **Template System** - HTML template for reports

## Should We Add Missing Features?

### Option 1: Add HTML Diff (Like Mimir)

**Pros:**
- Users can see detailed state changes
- Better debugging experience
- More transparency

**Cons:**
- Adds complexity
- Requires template file
- Larger bundle size (jsondiffpatch is ~50KB)

**Code needed:**
```typescript
// Add decodeStorageDiff() function
// Add generateHtmlDiff() function
// Add HTML template (or use Mimir's)
// Return html in SimulationResult
```

### Option 2: Keep It Simple (Current)

**Pros:**
- Simpler codebase
- Smaller bundle
- Faster execution
- We have fee estimation (Mimir doesn't)

**Cons:**
- No visual diff reports
- Less detailed state information

## Recommendation

**For now:** Keep it simple ✅

**Reasons:**
1. We have the **core functionality** (real simulation) ✅
2. We add **fee estimation** (Mimir doesn't) ✅
3. HTML diff is **nice-to-have**, not essential
4. We can add it later if needed

**If we want HTML diff later:**
- Copy `decodeStorageDiff()` from Mimir
- Copy `generateHtmlDiff()` from Mimir
- Get the HTML template from Mimir
- Add `html` to our return type

## Summary Table

| Feature | Mimir | Ours | Status |
|---------|-------|------|--------|
| **Core Simulation** | ✅ | ✅ | Same |
| **Database** | ✅ | ✅ | Identical |
| **Balance Changes** | ✅ | ✅ | Same logic |
| **Error Parsing** | ✅ | ✅ | Same logic |
| **HTML Diff** | ✅ | ❌ | Missing |
| **Fee Estimation** | ❌ | ✅ | We add this |
| **Input Type** | `IMethod` | `SubmittableExtrinsic` | Different |
| **Events** | ❌ | ✅ | We add this |

## Conclusion

**We're using the same core code and approach**, just:
- Different input type (extrinsic vs method)
- Missing HTML diff generation
- Adding fee estimation and events

**The simulation itself is identical** - we fork the chain, execute the transaction, and parse results the same way Mimir does.

**We can add HTML diff later if needed**, but the core functionality is complete and working.

