# Dynamic Imports (`import()`) Collection

This file contains all dynamic imports found in the codebase using the pattern `import(`.

## Core Library Imports

### 1. `lib/dotbot-core/services/simulation/database.ts`
**Line 57**
```typescript
idbModule = await import('idb');
```
**Context:** Lazy loading of IndexedDB library for browser storage
**Purpose:** Conditional import - only load idb when needed
**Function:** `getIdbModule()`

---

### 2. `lib/dotbot-core/services/web3AuthService.ts`
**Line 12**
```typescript
return await import('@polkadot/extension-dapp');
```
**Context:** Dynamic import - only loads in browser
**Purpose:** Browser-only Web3 extension functionality
**Function:** `getWeb3Extension()`

---

### 3. `lib/dotbot-core/executionEngine/signing/executionSigner.ts`
**Line 20**
```typescript
const { web3FromAddress } = await import('@polkadot/extension-dapp');
```
**Context:** Dynamic import - only loads in browser
**Purpose:** Get Web3 extension signer for address
**Function:** `getWeb3FromAddress(address: string)`

**Line 146**
```typescript
const { encodeAddress, decodeAddress } = await import('@polkadot/util-crypto');
```
**Context:** Lazy loading of Polkadot crypto utilities
**Purpose:** Encode/decode addresses for chain-specific formats
**Function:** `encodeAddressForChain(address: string, ss58Format: number)`

---

### 4. `lib/dotbot-core/executionEngine/signers/browserSigner.ts`
**Line 19**
```typescript
const { web3FromAddress } = await import('@polkadot/extension-dapp');
```
**Context:** Dynamic import - only loads in browser
**Purpose:** Browser wallet signer functionality
**Function:** `getWeb3FromAddress(address: string)`

---

### 5. `lib/dotbot-core/agents/asset-transfer/utils/addressValidation.ts`
**Line 91**
```typescript
const { decodeAddress } = await import('@polkadot/util-crypto');
```
**Context:** Lazy loading of Polkadot crypto utilities
**Purpose:** Validate sender address for signing compatibility
**Function:** `validateSenderAddressForSigning(address: string)`

---

## Agent Imports

### 6. `lib/dotbot-core/agents/baseAgent.ts`
**Line 265-267**
```typescript
const { simulateTransaction, isChopsticksAvailable } = await import(
  '../services/simulation'
);
```
**Context:** Lazy loading of simulation services
**Purpose:** Try Chopsticks simulation first (real runtime execution)
**Function:** Inside `executeTransaction()` method

---

## Execution Engine Imports

### 7. `lib/dotbot-core/executionEngine/system.ts`
**Line 387**
```typescript
const { isChopsticksAvailable, simulateSequentialTransactions } = await import('../services/simulation');
```
**Context:** Lazy loading of simulation services
**Purpose:** Check if Chopsticks is available for batch simulation
**Function:** Inside `executeBatch()` method

**Line 668**
```typescript
const { runSimulation } = await import('./simulation/executionSimulator');
```
**Context:** Lazy loading of execution simulator
**Purpose:** Run simulation with proper session endpoint for metadata consistency
**Function:** Inside `executeTransaction()` method

---

## Express Routes Imports

### 8. `lib/dotbot-express/src/routes/simulationRoutes.ts`
**Line 177**
```typescript
const { encodeAddress, decodeAddress } = await import('@polkadot/util-crypto');
```
**Context:** Lazy loading of Polkadot crypto utilities
**Purpose:** Calculate fee by encoding sender address
**Function:** Inside `POST /simulate` route handler

**Line 343**
```typescript
const { encodeAddress, decodeAddress } = await import('@polkadot/util-crypto');
```
**Context:** Lazy loading of Polkadot crypto utilities
**Purpose:** Calculate fee for batch simulation
**Function:** Inside `POST /simulate-batch` route handler

---

## Summary by Package

### `@polkadot/extension-dapp` (Browser-only)
- `lib/dotbot-core/services/web3AuthService.ts:12`
- `lib/dotbot-core/executionEngine/signing/executionSigner.ts:20`
- `lib/dotbot-core/executionEngine/signers/browserSigner.ts:19`

**Total: 3 imports**
**Purpose:** Web3 wallet extension functionality (browser environment only)

---

### `@polkadot/util-crypto`
- `lib/dotbot-core/executionEngine/signing/executionSigner.ts:146`
- `lib/dotbot-core/agents/asset-transfer/utils/addressValidation.ts:91`
- `lib/dotbot-express/src/routes/simulationRoutes.ts:177`
- `lib/dotbot-express/src/routes/simulationRoutes.ts:343`

**Total: 4 imports**
**Purpose:** Address encoding/decoding utilities

---

### `idb`
- `lib/dotbot-core/services/simulation/database.ts:57`

**Total: 1 import**
**Purpose:** IndexedDB library for browser storage

---

### Internal Module Imports
- `lib/dotbot-core/agents/baseAgent.ts:265` → `../services/simulation`
- `lib/dotbot-core/executionEngine/system.ts:387` → `../services/simulation`
- `lib/dotbot-core/executionEngine/system.ts:668` → `./simulation/executionSimulator`

**Total: 3 imports**
**Purpose:** Lazy loading of simulation services and execution simulator

---

## Patterns Identified

1. **Browser-only imports**: `@polkadot/extension-dapp` - wrapped in `isBrowser()` checks
2. **Lazy loading for performance**: Simulation services loaded only when needed
3. **Code splitting**: Heavy dependencies loaded dynamically
4. **Conditional imports**: `idb` only loaded when IndexedDB is needed

## Total Count

**12 dynamic imports** (excluding type imports and script files)
