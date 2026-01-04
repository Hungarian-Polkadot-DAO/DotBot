# Next Steps After Agent Rework

## ✅ Completed

1. ✅ Fixed critical architectural bugs in `AssetTransferAgent`
2. ✅ Added dry-run validation infrastructure
3. ✅ Implemented explicit chain selection
4. ✅ Fixed double signing issue
5. ✅ Fixed wrong-chain broadcasting
6. ✅ Build passing with no errors

## 🔄 Immediate Next Steps

### 1. Test the Changes

Try sending DOT again:

```
User: "Send 0.01 DOT to Alice"
```

**Expected Behavior:**
- ✅ Uses Asset Hub by default
- ✅ Checks balance on Asset Hub
- ✅ Dry-run validates the transaction
- ✅ Shows clear error if insufficient balance (with fees breakdown)
- ✅ Only ONE signature popup
- ✅ Transaction broadcasts to correct chain
- ✅ No `wasm unreachable` error

### 2. Update System Prompt (Important!)

The LLM needs to know about the new chain parameter. Add this to your system prompt:

```markdown
## Chain Selection for DOT Transfers

Post Asset Hub migration, DOT exists on BOTH chains:
- **Asset Hub**: Recommended for regular transfers (lower fees, optimized)
- **Relay Chain**: For validator operations, staking, governance

**Default Behavior:**
- DOT transfers default to Asset Hub
- Only specify `chain: 'relay'` for staking/governance operations

**When Generating ExecutionPlan:**
```json
{
  "agentClassName": "AssetTransferAgent",
  "methodName": "transfer",
  "params": {
    "address": "{{userAddress}}",
    "recipient": "{{recipientAddress}}",
    "amount": "{{amount}}",
    "chain": "assetHub"  // ← Default, can be omitted
  }
}
```

**For Relay Chain Operations:**
```json
{
  "params": {
    "chain": "relay"  // ← Explicit for staking/governance
  }
}
```
```

### 3. Test Edge Cases

#### Test A: User Has DOT on Relay Chain Only
```
User: "Send 1 DOT to Alice"
```
**Expected:** Error message suggesting to check Relay Chain or specify `chain: 'relay'`

#### Test B: Explicit Relay Chain Request
```
User: "Send 1 DOT to Alice on Relay Chain"
```
**Expected:** LLM generates `chain: 'relay'` parameter

#### Test C: Batch Transfer
```
User: "Send 0.5 DOT to Alice and 0.3 DOT to Bob"
```
**Expected:** Batch transfer on Asset Hub with dry-run validation

#### Test D: Insufficient Balance with Fees
```
User has: 1.005 DOT on Asset Hub
User: "Send 1 DOT to Alice"
```
**Expected:** Clear error showing available, required, and fee breakdown

### 4. Monitor Console Logs

Look for these new log messages:

```
🎯 Target chain: assetHub
💰 Checking balance on Asset Hub...
🧪 Dry-running extrinsic on Asset Hub...
✅ Dry-run passed on Asset Hub
```

### 5. If Issues Persist

Check these common problems:

**Problem:** Still getting "Insufficient balance" with 0 DOT
- **Check:** Is Asset Hub API actually connected?
- **Fix:** Verify `assetHubApi` is passed correctly in `DotBot.create()`

**Problem:** Still getting `wasm unreachable`
- **Check:** Is the correct API instance being used for signing?
- **Fix:** Verify `metadata.apiInstance` is set and retrieved correctly

**Problem:** Double signing still happening
- **Check:** Is there another place calling `signAndSendTransaction`?
- **Fix:** Search for duplicate signing calls

## 📋 Optional Improvements

### A. Add Chain Balance Checker Agent

Create a new agent that shows balances on BOTH chains:

```typescript
class BalanceCheckerAgent {
  async checkAllChains(address: string) {
    const relayBalance = await this.getBalance(address);
    const assetHubBalance = await this.getAssetHubBalance(address);
    
    return {
      relay: relayBalance,
      assetHub: assetHubBalance,
      recommendation: assetHubBalance.available > 0 ? 'assetHub' : 'relay'
    };
  }
}
```

### B. Add Cross-Chain Transfer Support (XCM)

For users with DOT on wrong chain:

```typescript
class XcmTransferAgent {
  async transferBetweenChains(
    from: 'relay' | 'assetHub',
    to: 'relay' | 'assetHub',
    amount: string
  ) {
    // Implement XCM transfer
  }
}
```

### C. Add Fee Comparison

Show users fee comparison:

```
💰 Transfer Options:
- Asset Hub: 0.001 DOT fee (recommended)
- Relay Chain: 0.01 DOT fee
```

### D. Improve Dry-Run Error Messages

Parse common runtime errors and provide helpful suggestions:

```typescript
if (error.includes('ExistentialDeposit')) {
  return 'Recipient needs minimum 1 DOT to create account';
}
if (error.includes('InsufficientBalance')) {
  return 'Not enough balance including fees';
}
```

## 🐛 Known Limitations

1. **Dry-Run is Basic**: Currently only uses `paymentInfo()`. Could be enhanced with actual runtime simulation (like Mimir's Chopsticks integration).

2. **No XCM Support**: If user has DOT on wrong chain, they need to manually move it. Could add automatic XCM transfer.

3. **Single Asset Type**: Currently DOT-only. Needs extension for other assets (USDT, USDC, etc.).

4. **No Batch Optimization**: Batch transfers don't optimize for existential deposits per recipient.

## 📚 Documentation Created

- `INFO_ONE.md` - Detailed analysis and implementation plan
- `AGENT_REWORK_COMPLETE.md` - Complete summary and migration guide
- `NEXT_STEPS.md` - This file

## 🎯 Success Criteria

The rework is successful if:

- ✅ No more `wasm unreachable` errors
- ✅ Only one signature popup
- ✅ Transactions broadcast to correct chain
- ✅ Clear error messages with chain context
- ✅ Default to Asset Hub for DOT transfers
- ✅ Dry-run catches errors before user sees them

---

**Ready to test!** Try: `"Send 0.01 DOT to Alice"`
