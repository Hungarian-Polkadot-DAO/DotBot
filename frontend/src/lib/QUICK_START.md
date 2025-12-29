# 🚀 Quick Start Guide

## For Frontend Developers

This library handles **everything** automatically. You just need 4 lines of setup and 1 line to execute.

---

## Installation

```bash
npm install @dotbot/lib
# or
yarn add @dotbot/lib
```

---

## Basic Usage (Browser)

```typescript
import { ExecutionSystem, BrowserWalletSigner } from '@dotbot/lib';
import { ApiPromise, WsProvider } from '@polkadot/api';

// 1. Create API connection
const api = await ApiPromise.create({
  provider: new WsProvider('wss://rpc.polkadot.io')
});

// 2. Get user account (from wallet)
const account = {
  address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
  name: 'My Account',
  source: 'polkadot-js'
};

// 3. Setup execution system (ONE TIME)
const system = new ExecutionSystem();
const signer = new BrowserWalletSigner();

system.initialize(api, account, signer);
system.setSigningHandler((request) => {
  // Show your signing modal
  showSigningModal({
    description: request.description,
    fee: request.estimatedFee,
    warnings: request.warnings,
    onApprove: () => request.resolve(true),
    onReject: () => request.resolve(false)
  });
});

// 4. Execute LLM plans (EVERY REQUEST)
const userMessage = "Send 5 DOT to Alice";
const llmResponse = await callLLM(userMessage); // Your LLM call
await system.execute(llmResponse); // That's it! ✅
```

---

## With LLM Feedback (Recommended)

Let the LLM narrate what's happening:

```typescript
await system.execute(llmResponse, {}, {
  onPreparingStep: (desc, current, total) => {
    // Send to LLM: "Preparing step 1 of 3: Transfer 5 DOT..."
    updateLLMMessage(`Preparing step ${current}/${total}: ${desc}`);
  },
  onExecutingStep: (desc, status) => {
    // Send to LLM: "Transfer 5 DOT... (signing)"
    updateLLMMessage(`${desc} (${status})`);
  },
  onError: (error) => {
    // Send to LLM: "Error: Insufficient balance"
    updateLLMMessage(`Error: ${error}`);
  },
  onComplete: (success, completed, failed) => {
    // Send to LLM: "✅ Completed! 3 successful, 0 failed"
    updateLLMMessage(`✅ Done! ${completed} successful, ${failed} failed`);
  }
});
```

---

## Terminal/CLI Usage

```typescript
import { ExecutionSystem, KeyringSigner } from '@dotbot/lib';
import { ApiPromise, WsProvider } from '@polkadot/api';

const api = await ApiPromise.create({
  provider: new WsProvider('wss://rpc.polkadot.io')
});

// Use KeyringSigner for CLI
const signer = KeyringSigner.fromMnemonic(
  'your twelve word seed phrase goes here for signing transactions'
);

const account = {
  address: signer.getAddress(),
  name: 'CLI Account'
};

const system = new ExecutionSystem();
system.initialize(api, account, signer);

// Execute - auto-signs (no user interaction)
await system.execute(llmPlan);
```

---

## What Gets Handled Automatically

✅ **Agent Calling** - LLM specifies agent, system calls it  
✅ **Extrinsic Creation** - Agents create blockchain transactions  
✅ **Queue Management** - ExecutionArray manages operation order  
✅ **User Signing** - Modal shown, waits for approval  
✅ **Broadcasting** - Transaction sent to blockchain  
✅ **Monitoring** - Tracks until finalization  
✅ **Status Updates** - Real-time progress callbacks  
✅ **Error Handling** - Caught and reported  

**You don't need to do ANY of this manually!**

---

## LLM Output Format

Your LLM should return JSON in this format:

```json
{
  "id": "exec-123",
  "originalRequest": "Send 5 DOT to Bob",
  "steps": [
    {
      "id": "step-1",
      "stepNumber": 1,
      "agentClassName": "AssetTransferAgent",
      "functionName": "transfer",
      "parameters": {
        "address": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
        "recipient": "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty",
        "amount": "5"
      },
      "executionType": "extrinsic",
      "status": "pending",
      "description": "Transfer 5 DOT to Bob",
      "requiresConfirmation": true,
      "createdAt": 1234567890
    }
  ],
  "status": "pending",
  "requiresApproval": true,
  "createdAt": 1234567890
}
```

The system reads this and **automatically**:
1. Finds `AssetTransferAgent` in registry
2. Creates agent instance
3. Calls `agent.transfer(parameters)`
4. Agent creates extrinsic
5. Shows signing modal
6. Broadcasts transaction
7. Monitors finalization

---

## Available Agents

Currently available:
- **AssetTransferAgent** - Transfer DOT/tokens
  - `transfer()` - Basic transfer
  - `batchTransfer()` - Multiple transfers at once

More agents coming:
- StakingAgent - Staking operations
- GovernanceAgent - Voting and proposals
- And more...

---

## Environment Support

✅ **Browser** - Uses wallet extensions (Polkadot.js, Talisman, etc.)  
✅ **Terminal/CLI** - Uses local keyring (seed phrase)  
✅ **Backend** - Same as CLI (environment variables)  
✅ **Tests** - Same as CLI (test accounts like `//Alice`)  

Same code works everywhere!

---

## Error Handling

All errors are caught and passed to your callbacks:

```typescript
await system.execute(llmPlan, {}, {
  onError: (error) => {
    console.error('Execution error:', error);
    // Show error to user
    // LLM can explain what went wrong
  }
});
```

Common errors:
- Insufficient balance
- Invalid address
- User rejected transaction
- Network issues
- Transaction failed

---

## TypeScript Types

All components are fully typed:

```typescript
import type {
  ExecutionArrayPlan,   // LLM output
  ExecutionStep,        // Individual step
  ExecutionItem,        // Runtime queue item
  ExecutionResult,      // Transaction result
  AgentResult,          // What agents return
  SigningRequest,       // Signing modal data
  Signer,               // Signer interface
} from '@dotbot/lib';
```

---

## Advanced: Custom Signer

Implement the `Signer` interface for custom signing (hardware wallets, HSM, etc.):

```typescript
import { Signer } from '@dotbot/lib';

class MyCustomSigner implements Signer {
  async signExtrinsic(extrinsic, address) {
    // Your custom signing logic
    return signedExtrinsic;
  }
  
  async requestApproval(request) {
    // Your custom approval logic
    return true;
  }
  
  getType() {
    return 'custom';
  }
}

const signer = new MyCustomSigner();
system.initialize(api, account, signer);
```

---

## Need Help?

- **Architecture:** See `/lib/executionEngine/ARCHITECTURE.md`
- **Usage Examples:** See `/lib/executionEngine/USAGE.md`
- **Integration Test:** See `/lib/executionEngine/INTEGRATION_TEST.md`
- **Full Verification:** See `/lib/FINAL_CONNECTION_SUMMARY.md`

---

## Summary

**Minimal frontend code:**
```typescript
// Setup (once)
const system = new ExecutionSystem();
system.initialize(api, account, signer);
system.setSigningHandler(showModal);

// Execute (every request)
await system.execute(llmPlan);
```

**That's it!** The system handles everything else automatically. 🎉

