# Testing Simulation & Transaction Fixes

## Quick Verification Checklist

### 1. Check Chopsticks Installation

Open browser console and run:
```javascript
// This should be done in the app context
import('@acala-network/chopsticks-core')
  .then(() => console.log('✓ Chopsticks available'))
  .catch(() => console.log('✗ Chopsticks NOT available'));
```

**Expected**: `✓ Chopsticks available`

### 2. Test Basic Transfer

**Steps**:
1. Open the app
2. Connect wallet with test account (that has some DOT)
3. Send message: "Send 0.01 DOT to Alice"
4. Open browser console (F12)
5. Watch for logs

**Expected Console Output**:
```
[Simulation] Using Chopsticks for runtime validation
[Chopsticks] Starting transaction simulation...
[Chopsticks] Forking chain at block: 0x...
[Chopsticks] Using RPC endpoints: [...]
[Chopsticks] Fork created, running dry-run...
[Chopsticks] Dry-run complete, analyzing outcome...
[Chopsticks] Outcome: SUCCESS
[Simulation] ✓ Chopsticks validation passed
```

**If Chopsticks is NOT available**:
```
[Simulation] Chopsticks not available, falling back to paymentInfo
[Simulation] ⚠ Using paymentInfo only - runtime execution NOT validated!
```

**What to Check**:
- No silent failures
- Clear indication of which validation method is used
- Warning message if paymentInfo is used

### 3. Test Invalid Transaction (Insufficient Balance)

**Steps**:
1. Connect wallet with account that has 0.001 DOT (very low balance)
2. Try to send: "Send 10 DOT to Alice"
3. Watch console

**Expected Behavior**:
- Simulation should catch insufficient balance
- Error should be detected as `USER_ERROR`
- Should NOT retry (it's a user error, not configuration error)
- Clear error message shown to user

**Expected Logs**:
```
[Transfer] Validating on Asset Hub...
[Simulation] Using Chopsticks for runtime validation
[Chopsticks] Outcome: FAILURE balances.InsufficientBalance
[Simulation] ✗ Chopsticks validation failed: balances.InsufficientBalance
```

### 4. Test Wrong Chain Scenario (Forced)

This tests the retry logic when wrong chain is used.

**Manual Test** (requires code modification):
1. Temporarily modify `AssetTransferAgent.transfer()` to force `chain: 'relay'`
2. Try transfer: "Send 0.01 DOT to Alice"
3. Watch console for retry behavior

**Expected Behavior**:
- First attempt on Relay Chain fails
- Error analyzer detects configuration error
- Retry strategy suggests alternate chain
- Second attempt on Asset Hub succeeds

**Expected Logs**:
```
Attempt 1: Validating on Relay Chain...
[Chopsticks] Outcome: FAILURE InvalidTransaction: ...
[Transfer] Adjusting: switching to Asset Hub
Attempt 2: Validating on Asset Hub...
[Chopsticks] Outcome: SUCCESS
```

### 5. Test Transaction Execution

**Steps**:
1. Send: "Send 0.01 DOT to Alice"
2. Wait for simulation to complete
3. Approve transaction in wallet
4. Watch console

**Expected Execution Logs**:
```
[Executioner] Executing extrinsic: {...}
[Executioner] Requesting user approval...
[Executioner] User approved transaction
[Executioner] Signing transaction...
[Executioner] Transaction signed successfully
[Executioner] Broadcasting transaction...
[Executioner] Broadcasting with API: custom
[Executioner] Sending pre-signed transaction...
[Executioner] Transaction included in block: 0x...
[Executioner] Transaction finalized in block: 0x...
[Executioner] ✓ Transaction succeeded
[Executioner] Events: X
```

**What to Verify**:
- All steps are logged
- No errors thrown
- Transaction succeeds on-chain
- Proper API instance used (`custom` means correct API was used)

### 6. Test Failed Transaction (After Approval)

**Setup**: Create a scenario where transaction fails after approval (e.g., balance consumed by another tx)

**Steps**:
1. Have two browser windows with same account
2. Window 1: Start transfer of 0.5 DOT
3. Window 2: While approval pending, send ALL balance elsewhere
4. Window 1: Approve the transaction
5. Watch console

**Expected Behavior**:
- Transaction gets signed
- Broadcast succeeds
- But transaction fails in block
- Error is properly extracted and shown

**Expected Logs**:
```
[Executioner] Transaction finalized in block: 0x...
[Executioner] ✗ Extrinsic failed: {...}
[Executioner] Error details: balances.InsufficientBalance: Balance too low...
```

## Common Issues and Solutions

### Issue 1: "Chopsticks not available"

**Symptoms**:
```
[Simulation] Chopsticks not available, falling back to paymentInfo
```

**Check**:
```bash
cd frontend
npm list @acala-network/chopsticks-core
```

**Fix**:
```bash
npm install @acala-network/chopsticks-core
```

### Issue 2: Chopsticks times out

**Symptoms**:
```
[Chopsticks] Starting transaction simulation...
[Chopsticks] Forking chain at block: 0x...
[Error after long wait]
```

**Possible Causes**:
- RPC endpoint is slow or rate-limiting
- Chain state is too large to fork
- Network issues

**Debug**:
- Check RPC endpoints in `getRpcEndpointForChain()`
- Try different RPC endpoint
- Check browser Network tab for failed requests

### Issue 3: "wasm unreachable" error

**Symptoms**:
```
[Chopsticks] Outcome: FAILURE wasm unreachable
```

**Meaning**: Wrong chain or wrong call for that chain

**Expected Behavior**:
- Retry logic should automatically try alternate chain
- Should see: `[Transfer] Adjusting: switching to [other chain]`

**If NOT retrying**:
- Error analyzer might not be detecting it correctly
- Check error pattern in `errorAnalyzer.ts`

### Issue 4: Transaction fails but simulation passed (paymentInfo)

**Symptoms**:
- Transaction validated with ⚠️ warning
- Transaction fails on execution

**Explanation**: paymentInfo doesn't validate runtime execution

**Prevention**:
- Ensure Chopsticks is working
- If Chopsticks unavailable, understand the risk

## Automated Test Script

Create a test file `test-simulation.ts`:

```typescript
import { ApiPromise, WsProvider } from '@polkadot/api';
import { simulateTransaction, isChopsticksAvailable } from './services/simulation';

async function testSimulation() {
  console.log('1. Checking Chopsticks availability...');
  const available = await isChopsticksAvailable();
  console.log(`   Result: ${available ? '✓ Available' : '✗ Not available'}`);
  
  if (!available) {
    console.log('   Install: npm install @acala-network/chopsticks-core');
    return;
  }
  
  console.log('\n2. Connecting to Asset Hub...');
  const provider = new WsProvider('wss://polkadot-asset-hub-rpc.polkadot.io');
  const api = await ApiPromise.create({ provider });
  console.log('   ✓ Connected');
  
  console.log('\n3. Creating test transaction...');
  const recipient = '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg'; // Alice
  const amount = '10000000000'; // 0.01 DOT
  const extrinsic = api.tx.balances.transferKeepAlive(recipient, amount);
  console.log('   ✓ Extrinsic created');
  
  console.log('\n4. Running simulation...');
  const sender = '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg';
  const result = await simulateTransaction(
    api,
    'wss://polkadot-asset-hub-rpc.polkadot.io',
    extrinsic,
    sender
  );
  
  console.log('\n5. Results:');
  console.log('   Success:', result.success);
  console.log('   Error:', result.error);
  console.log('   Estimated Fee:', result.estimatedFee);
  console.log('   Balance Changes:', result.balanceChanges.length);
  
  await api.disconnect();
  console.log('\n✓ Test complete');
}

testSimulation().catch(console.error);
```

**Run**:
```bash
cd frontend
npx ts-node test-simulation.ts
```

## Success Criteria

✅ **Chopsticks Integration**:
- Chopsticks loads without errors
- Simulation runs and returns results
- Errors are properly caught and returned

✅ **Validation**:
- Successful transactions pass simulation
- Failed transactions are caught by simulation
- Wrong chain is detected and retried

✅ **Error Handling**:
- All errors are logged (no silent failures)
- User errors fail fast without retry
- Configuration errors trigger retry

✅ **Transaction Execution**:
- Signed transactions broadcast correctly
- Transaction status is monitored
- Success/failure is properly detected and reported

✅ **User Experience**:
- Clear warnings when paymentInfo is used
- Detailed error messages
- Transaction status visible in UI

## Debugging Tips

### Enable Verbose Logging

All logs use console.log/warn/error with prefixes:
- `[Simulation]` - Validation method selection
- `[Chopsticks]` - Chopsticks simulation steps
- `[Transfer]` - Transfer agent retry logic
- `[Executioner]` - Transaction execution

**Filter in Chrome DevTools**:
- Click "Filter" icon
- Enter: `Simulation|Chopsticks|Transfer|Executioner`

### Check Network Requests

If Chopsticks fails:
1. Open Network tab in DevTools
2. Filter by "WS" (WebSocket)
3. Check RPC calls to Polkadot/Asset Hub
4. Look for errors or timeouts

### Inspect State

At any point during execution:
```javascript
// In console
executionArray.getState()  // Check execution state
api.isConnected           // Check API connection
```

## Next Steps After Testing

1. ✅ Verify all tests pass
2. ✅ Confirm Chopsticks is working
3. ✅ Check that errors are caught properly
4. ✅ Validate retry logic works
5. ✅ Test real transactions on testnet
6. ✅ Monitor production logs for issues

## Questions?

If you encounter issues not covered here:
1. Check browser console for error logs
2. Review `SIMULATION_FIX_SUMMARY.md` for architecture details
3. Check `SIMULATION_FLOW.md` for detailed flow documentation



