# DotBot API Reference

This document provides comprehensive API documentation for integrating DotBot into your application.

## Table of Contents

- [Getting Started](#getting-started)
- [Backend API](#backend-api) ← NEW in v0.2.0
- [OpenAPI Specification](#openapi-specification) ← NEW in v0.2.0
- [Integration Testing](#integration-testing) ← NEW in v0.2.0
- [Core Concepts](#core-concepts)
- [Multi-Network Configuration](#multi-network-configuration)
- [DotBot Core Multi-Network Support](#dotbot-core-multi-network-support)
- [ChatInstance API](#chatinstance-api)
- [Storage API](#storage-api)
- [DataManager API](#datamanager-api)
- [Agents API](#agents-api)
- [Execution Engine API](#execution-engine-api)
- [Utilities API](#utilities-api)
- [Examples](#examples)
- [Error Handling](#error-handling)
- [TypeScript Types](#typescript-types)

---

## Getting Started

### Installation

#### Monorepo Setup (Recommended)

```bash
# Clone repository
git clone <repository-url>
cd DotBot

# Install all workspaces
npm install

# Build shared libraries
npm run build:core

# Start backend (Terminal 1)
npm run dev:backend

# Start frontend (Terminal 2)
npm run dev:frontend
```

**Monorepo Structure:**
```
DotBot/
├── package.json         # Workspace root (4 workspaces)
├── lib/
│   ├── dotbot-core/     # Shared blockchain logic
│   └── dotbot-express/  # Express integration
├── backend/             # TypeScript/Express backend
└── frontend/            # React frontend
```

#### Standalone Installation (Advanced)

If using DotBot libraries in your own project:

```bash
npm install @polkadot/api @polkadot/util @polkadot/util-crypto
```

**Note:** In v0.2.0, `@dotbot/core` and `@dotbot/express` are workspace packages. Future versions will publish to npm for standalone installation.

### Basic Setup

**Recommended: Use DotBot (High-Level API)**

```typescript
import { DotBot, createRpcManagersForNetwork } from '@dotbot/core';
import type { Network } from '@dotbot/core';

// 1. Select network
const network: Network = 'polkadot'; // or 'kusama', 'westend'

// 2. Create network-specific RPC managers
const { relayChainManager, assetHubManager } = createRpcManagersForNetwork(network);

// 3. Initialize DotBot (handles everything)
const dotbot = await DotBot.create({
  wallet: injectedAccount,  // From browser wallet
  network,
  relayChainManager,
  assetHubManager,
  onSigningRequest: (request) => {
    // Handle transaction signing
    console.log('Please sign:', request.description);
  }
});

// 4. Use natural language! (RPC and signer are lazy-loaded on first chat/getBalance)
const result = await dotbot.chat("Send 5 DOT to Alice", {
  llm: async (message, systemPrompt, context) => {
    // Call your LLM service (OpenAI, ASI-One, etc.); context.conversationHistory available
    return await llmService.chat(message, systemPrompt);
  }
});

console.log(result.response);  // Text or execution plan; result.executed is false until user approves
```

**Why DotBot?**
- 🎯 Natural language interface - just chat!
- 🤖 Handles agents, orchestration, and execution automatically
- 🔐 Manages signing requests and user confirmations
- 📊 Provides execution status updates
- ✨ Network-aware (correct tokens, knowledge, etc.)

---

### Advanced Setup (Low-Level API)

If you need fine-grained control over agents and execution:

```typescript
import { ApiPromise } from '@polkadot/api';
import { AssetTransferAgent, ExecutionSystem, createRpcManagersForNetwork } from '@dotbot/core';
import type { Network } from '@dotbot/core';

// 1. Select network
const network: Network = 'polkadot'; // or 'kusama', 'westend'

// 2. Create network-specific RPC managers
const { relayChainManager, assetHubManager } = createRpcManagersForNetwork(network);

// 3. Connect to APIs
const relayApi = await relayChainManager.getReadApi();
const assetHubApi = await assetHubManager.getReadApi();

// 4. Initialize agent manually
const agent = new AssetTransferAgent();
agent.initialize(
  relayApi,
  assetHubApi,
  null,  // status callback (optional)
  relayChainManager,
  assetHubManager
);

// 5. Use ExecutionSystem for orchestration + execution (or use DotBot for turnkey)
const executionSystem = new ExecutionSystem();
// ... initialize executionSystem with api, account, signer, assetHubApi, managers

// 6. Use agents directly (TransferParams uses address from BaseAgentParams)
const result = await agent.transfer({
  address: accountInfo.address,
  recipient: 'alice-address',
  amount: '5',
  chain: 'assetHub'
});

// 7. Execute via ExecutionSystem / Executioner (see executionEngine exports)
```

**When to use Low-Level API:**
- Building custom integrations
- Need specific agent behavior
- Bypassing natural language layer
- Custom execution workflows

### Network Configuration

DotBot has multi-network infrastructure:

| Network | Token | Decimals | Type | Status | Use Case |
|---------|-------|----------|------|--------|----------|
| Polkadot | DOT | 10 | Mainnet | ✅ **Full Support** | Production operations |
| Westend | WND | 12 | Testnet | ✅ **Full Support** | Safe testing |
| Kusama | KSM | 12 | Canary | ⚠️ **Partial** | Kusama ecosystem (coming soon) |

**Status Legend:**
- ✅ **Full Support**: Complete knowledge base + RPC infrastructure
- ⚠️ **Partial**: RPC infrastructure only (uses Polkadot knowledge as fallback)

**Kusama Note:** Infrastructure is ready (RPC endpoints, factory functions), but Kusama-specific knowledge base is not yet implemented. Operations will work but LLM context will use Polkadot information (may mention wrong parachains/DEXes).

**Version Added:** v0.2.0 (January 2026)

---

## Backend API

**NEW** in v0.2.0: DotBot backend provides REST API endpoints for AI chat and blockchain operations.

### Architecture

```
Frontend ←HTTP→ Backend (Express.js) ←→ @dotbot/core ←→ Polkadot Network
                    ↓
              AI Providers (ASI-One, Claude)
```

**Key Benefits:**
- **Secure API Key Management**: AI provider keys stored server-side
- **Session Management**: Persistent DotBot instances across requests
- **Unified Interface**: Single API for chat + blockchain operations

### Base URL

```
Development: http://localhost:8000
Production: https://api.dotbot.example.com
```

### Authentication

Currently no authentication required for local development. Production deployments should implement appropriate auth mechanisms.

---

### Health Endpoints

#### `GET /hello`

Simple hello world endpoint.

**Response:**
```json
{
  "message": "Hello World",
  "service": "DotBot Backend",
  "version": "0.1.0"
}
```

---

#### `GET /api/health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-14T12:00:00.000Z"
}
```

---

#### `GET /api/status`

Detailed status information.

**Response:**
```json
{
  "status": "ok",
  "uptime": 3600,
  "memory": {
    "used": 150000000,
    "total": 500000000
  },
  "timestamp": "2026-01-14T12:00:00.000Z"
}
```

---

### Chat Endpoints

#### `POST /api/chat`

Simple AI chat endpoint (no blockchain operations).

**Request:**
```json
{
  "message": "What is Polkadot?",
  "provider": "asi-one",
  "conversationHistory": [
    { "role": "user", "content": "Previous message" },
    { "role": "assistant", "content": "Previous response" }
  ]
}
```

**Parameters:**
- `message` (string, required): User's message
- `provider` (string, optional): AI provider (`asi-one` or `claude`). Default: `asi-one`
- `conversationHistory` (array, optional): Previous conversation context

**Response:**
```json
{
  "response": "Polkadot is a multi-chain platform...",
  "provider": "asi-one",
  "timestamp": "2026-01-14T12:00:00.000Z"
}
```

**Example:**
```typescript
const response = await fetch('http://localhost:8000/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'What is Polkadot?',
    provider: 'asi-one'
  })
});

const data = await response.json();
console.log(data.response);
```

---

### DotBot Endpoints

Full DotBot functionality with blockchain operations.

#### `POST /api/dotbot/initialize`

Initialize a new DotBot session.

**Request:**
```json
{
  "wallet": {
    "address": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
    "name": "Alice",
    "source": "polkadot-js"
  },
  "network": "westend",
  "environment": "testnet"
}
```

**Parameters:**
- `wallet` (object, required): Wallet account information
- `network` (string, optional): Network identifier. Default: `'polkadot'`
- `environment` (string, optional): Environment (`'mainnet'` | `'testnet'`). Auto-detected from network

**Response:**
```json
{
  "sessionId": "session_1234567890_abc",
  "wallet": {
    "address": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
    "name": "Alice"
  },
  "network": "westend",
  "environment": "testnet"
}
```

---

#### `POST /api/dotbot/chat`

Send a message to DotBot (with blockchain operations support).

**Request:**
```json
{
  "sessionId": "session_1234567890_abc",
  "message": "Send 2 DOT to Bob",
  "provider": "asi-one"
}
```

**Parameters:**
- `sessionId` (string, required): Session ID from `/initialize`
- `message` (string, required): User's message
- `provider` (string, optional): AI provider. Default: `'asi-one'`

**Response:**
```json
{
  "response": "I've prepared a transfer of 2 DOT to Bob...",
  "plan": {
    "operations": [
      {
        "agent": "AssetTransferAgent",
        "action": "transfer",
        "params": {
          "recipient": "Bob",
          "amount": "2",
          "chain": "assetHub"
        }
      }
    ]
  },
  "executed": false,
  "conversationItems": [...]
}
```

---

#### `POST /api/dotbot/execute`

Execute a prepared transaction (after user approval).

**Request:**
```json
{
  "sessionId": "session_1234567890_abc",
  "executionId": "exec_1234567890_xyz"
}
```

**Parameters:**
- `sessionId` (string, required): Session ID
- `executionId` (string, required): Execution ID from chat response

**Response:**
```json
{
  "status": "completed",
  "result": {
    "success": true,
    "txHash": "0x1234...",
    "blockHash": "0x5678..."
  }
}
```

---

#### `GET /api/dotbot/session/:sessionId`

Get session details.

**Response:**
```json
{
  "sessionId": "session_1234567890_abc",
  "wallet": { "address": "...", "name": "Alice" },
  "network": "westend",
  "environment": "testnet",
  "chatId": "chat_1234567890_xyz",
  "createdAt": "2026-01-14T12:00:00.000Z"
}
```

---

#### `GET /api/dotbot/history/:sessionId`

Get conversation history for a session.

**Response:**
```json
{
  "sessionId": "session_1234567890_abc",
  "messages": [
    {
      "type": "user",
      "content": "Send 2 DOT to Bob",
      "timestamp": 1705233600000
    },
    {
      "type": "bot",
      "content": "I've prepared a transfer...",
      "timestamp": 1705233601000
    }
  ]
}
```

---

#### `DELETE /api/dotbot/session/:sessionId`

Delete a session and clean up resources.

**Response:**
```json
{
  "success": true,
  "message": "Session deleted successfully"
}
```

---

### Simulation Endpoints

**NEW** in v0.2.2: Backend simulation endpoints for Chopsticks integration.

#### `POST /api/simulation/simulate`

Simulate a single transaction using Chopsticks.

**Request:**
```json
{
  "rpcEndpoints": ["wss://rpc.polkadot.io"],
  "extrinsicHex": "0x...",
  "senderAddress": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
  "blockHash": "0x...",
  "buildBlockMode": "Batch"
}
```

**Parameters:**
- `rpcEndpoints` (string[], required): RPC endpoints to use for simulation
- `extrinsicHex` (string, required): Extrinsic method call hex
- `senderAddress` (string, required): Sender's address
- `blockHash` (string, optional): Block hash to fork from (default: latest finalized)
- `buildBlockMode` (string, optional): `"Batch"` or `"Instant"` (default: `"Batch"`)

**Response:**
```json
{
  "success": true,
  "estimatedFee": "1000000000",
  "balanceChanges": [
    {
      "address": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
      "value": "100000000000",
      "change": "send"
    }
  ],
  "events": [...]
}
```

---

#### `POST /api/simulation/simulate-sequential`

Simulate multiple transactions sequentially on a single fork.

**Request:**
```json
{
  "rpcEndpoints": ["wss://rpc.polkadot.io"],
  "items": [
    {
      "extrinsicHex": "0x...",
      "description": "Transfer 5 DOT",
      "senderAddress": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
    }
  ],
  "buildBlockMode": "Instant"
}
```

**Parameters:**
- `rpcEndpoints` (string[], required): RPC endpoints
- `items` (array, required): Array of transactions to simulate sequentially
- `buildBlockMode` (string, optional): `"Batch"` or `"Instant"` (default: `"Instant"`)

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "index": 0,
      "description": "Transfer 5 DOT",
      "result": {
        "success": true,
        "estimatedFee": "1000000000",
        "balanceChanges": [...],
        "events": [...]
      }
    }
  ],
  "totalFee": "1000000000"
}
```

**Note:** These endpoints are used internally by `@dotbot/core` client. Frontend code should use the high-level simulation functions, not call these endpoints directly.

**Version Added:** v0.2.2 (January 2026)

---

### Error Responses

All endpoints return consistent error format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": { ... }
}
```

**Common Error Codes:**
- `SESSION_NOT_FOUND` - Session ID not found
- `INVALID_REQUEST` - Request validation failed
- `AI_PROVIDER_ERROR` - AI provider returned error
- `BLOCKCHAIN_ERROR` - Blockchain operation failed
- `INTERNAL_ERROR` - Server internal error

**HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request (validation error)
- `404` - Not Found (session/resource not found)
- `500` - Internal Server Error

---

### Client Example

Complete TypeScript client example:

```typescript
class DotBotClient {
  constructor(private baseUrl: string) {}

  async initialize(wallet: WalletAccount, network?: Network) {
    const response = await fetch(`${this.baseUrl}/api/dotbot/initialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, network })
    });
    const data = await response.json();
    return data.sessionId;
  }

  async chat(sessionId: string, message: string) {
    const response = await fetch(`${this.baseUrl}/api/dotbot/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message })
    });
    return await response.json();
  }

  async execute(sessionId: string, executionId: string) {
    const response = await fetch(`${this.baseUrl}/api/dotbot/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, executionId })
    });
    return await response.json();
  }
}

// Usage
const client = new DotBotClient('http://localhost:8000');

const sessionId = await client.initialize({
  address: userAddress,
  name: 'Alice',
  source: 'polkadot-js'
}, 'westend');

const chatResult = await client.chat(sessionId, 'Send 2 DOT to Bob');
console.log(chatResult.response);

if (chatResult.plan && userApproved) {
  const execResult = await client.execute(sessionId, chatResult.executionId);
  console.log('Transaction:', execResult.result.txHash);
}
```

**Version Added:** v0.2.0 (January 2026)

---

## OpenAPI Specification

**NEW** in v0.2.0: Complete API contract defined in `backend/openapi.yaml`.

### Overview

The OpenAPI specification (`openapi.yaml`) serves as the **single source of truth** for the DotBot backend API:

- **Contract-First Development**: API contract defined before implementation
- **Automated Validation**: Tests validate implementation against spec
- **Mock Server Generation**: Prism generates realistic mocks
- **Documentation**: Self-documenting API

### Location

```
backend/openapi.yaml
```

### Specification Structure

```yaml
openapi: 3.0.3
info:
  title: DotBot Backend API
  version: 0.1.0
  description: AI-powered Polkadot blockchain operations

servers:
  - url: http://localhost:8000
    description: Local development
  - url: https://api.dotbot.example.com
    description: Production

tags:
  - Health      # Health check endpoints
  - Chat        # Simple AI chat
  - DotBot      # Full DotBot functionality
  - Sessions    # Session management
  - Execution   # Transaction execution

paths:
  /api/health: ...
  /api/chat: ...
  /api/dotbot/initialize: ...
  /api/dotbot/chat: ...
  # ... (full spec in openapi.yaml)

components:
  schemas:
    ChatRequest: ...
    ChatResponse: ...
    ExecutionPlan: ...
    # ... (see openapi.yaml)
```

### Using the Specification

#### Generate Mock Server

```bash
cd backend
npm run mock

# Mock server runs on http://localhost:8000
# Responds with realistic data based on openapi.yaml
```

#### View Documentation

1. **Swagger UI**: Paste `openapi.yaml` into https://editor.swagger.io
2. **Redoc**: Use Redoc to generate beautiful docs
3. **Postman**: Import `openapi.yaml` into Postman

#### Generate Client SDKs

```bash
# Generate TypeScript client
npx openapi-generator-cli generate \
  -i backend/openapi.yaml \
  -g typescript-axios \
  -o generated/typescript-client

# Generate Python client
npx openapi-generator-cli generate \
  -i backend/openapi.yaml \
  -g python \
  -o generated/python-client
```

### Maintaining the Specification

**When adding new endpoints:**

1. Define endpoint in `openapi.yaml` first
2. Generate mock with Prism
3. Develop frontend against mock
4. Implement backend endpoint
5. Run integration tests to validate

**Schema Validation:**

All request/response schemas are validated using AJV:
- Request bodies validated against `requestBody` schema
- Responses validated against `responses` schema
- Automatic error on schema mismatch

**Example Schema:**

```yaml
components:
  schemas:
    ChatRequest:
      type: object
      required:
        - message
      properties:
        message:
          type: string
          description: User's message
        provider:
          type: string
          enum: [asi-one, claude]
          default: asi-one
        conversationHistory:
          type: array
          items:
            $ref: '#/components/schemas/ConversationMessage'
```

**Version Added:** v0.2.0 (January 2026)

---

## Integration Testing

**NEW** in v0.2.0: OpenAPI-based integration testing ensures API compliance.

### Overview

DotBot uses **OpenAPITestRunner** to validate backend implementation against `openapi.yaml`:

- Loads OpenAPI specification
- Tests all defined endpoints
- Validates request/response schemas
- Reports schema mismatches

### Test Runner

**Location:** `backend/test/integration/openapi-test-runner.ts`

**Features:**
- AJV-based schema validation
- Detailed error reporting
- Specific endpoint testing
- Full API coverage testing

### Running Tests

#### Test All Endpoints

```bash
cd backend
npm run test:integration
```

**Output:**
```
Testing endpoint: GET /hello
✓ GET /hello passed

Testing endpoint: GET /api/health
✓ GET /api/health passed

Testing endpoint: POST /api/chat
✓ POST /api/chat passed

All 12 tests passed!
```

#### Test Specific Endpoint

```bash
npm run test:endpoint /api/health
```

**Output:**
```
Testing specific endpoint: GET /api/health
✓ Response validation passed
✓ Schema validation passed
Test passed!
```

#### Watch Mode

```bash
# Terminal 1: Start backend
npm run dev

# Terminal 2: Run tests on file change
npm run test:integration -- --watch
```

### Test Configuration

Tests require backend to be running:

```bash
# Terminal 1: Start backend
cd backend
npm run dev

# Terminal 2: Run tests
npm run test:integration
```

### Schema Validation

All responses are validated against OpenAPI schemas:

```typescript
// Example validation
const response = await axios.get('http://localhost:8000/api/health');

// Validate against schema
const schema = openApiSpec.paths['/api/health'].get.responses['200'].content['application/json'].schema;
const valid = ajv.validate(schema, response.data);

if (!valid) {
  console.error('Schema mismatch:', ajv.errors);
  throw new Error('Response does not match schema');
}
```

### Error Reporting

Detailed errors when validation fails:

```
✗ POST /api/chat failed
  Schema validation error:
    - data.response should be string (got: number)
    - data.provider is required but missing
  
  Expected:
    { response: string, provider: string, timestamp: string }
  
  Received:
    { response: 123, timestamp: "2026-01-14T12:00:00Z" }
```

### Mock Server Testing

Test frontend against mock before backend is ready:

```bash
# Terminal 1: Start mock server
cd backend
npm run mock

# Terminal 2: Start frontend
cd frontend
npm start

# Frontend connects to mock server (same URL as real backend)
```

**Mock Benefits:**
- Realistic responses based on OpenAPI examples
- No backend implementation required
- Consistent test data
- Fast development iteration

### Continuous Integration

Integration tests run in CI pipeline:

```yaml
# .github/workflows/test.yml
- name: Start backend
  run: npm run dev --workspace=backend &
  
- name: Wait for backend
  run: npx wait-on http://localhost:8000/api/health
  
- name: Run integration tests
  run: npm run test:integration --workspace=backend
```

**Version Added:** v0.2.0 (January 2026)

---

## Core Concepts

### AgentResult

All agents return a standardized result structure:

```typescript
interface AgentResult {
  description: string;              // Human-readable description
  extrinsic: SubmittableExtrinsic; // Ready-to-sign transaction
  estimatedFee?: string;           // Fee in Planck (1 DOT = 10^10 Planck)
  warnings?: string[];             // Important notices for user
  metadata?: Record<string, any>;  // Additional contextual data
  data?: any;                      // For non-extrinsic results
  resultType: 'extrinsic' | 'data' | 'mixed' | 'confirmation';
  requiresConfirmation: boolean;   // Should user confirm?
  executionType: 'extrinsic' | 'data_fetch' | 'validation' | 'user_input';
}
```

### ExecutionResult

After execution completes:

```typescript
interface ExecutionResult {
  success: boolean;
  blockHash?: string;    // Block where transaction was included
  txHash?: string;       // Transaction hash
  events?: any[];        // Blockchain events emitted
  error?: string;        // Error message if failed
  errorCode?: string;    // Machine-readable error code
}
```

---

## Multi-Network Configuration

### Network Type

```typescript
type Network = 'polkadot' | 'kusama' | 'westend';
```

Type-safe network identifier used throughout DotBot.

**Note:** Kusama type is included for infrastructure purposes, but full support (knowledge base) is not yet implemented. See [Network Configuration](#network-configuration) for details.

---

### Network Metadata

```typescript
interface NetworkMetadata {
  name: string;               // Display name
  network: Network;           // Network identifier
  token: string;              // Native token symbol
  decimals: number;           // Token decimals
  ss58Format: number;         // Address format
  relayChainEndpoints: string[];  // Relay Chain RPC endpoints
  assetHubEndpoints: string[];    // Asset Hub RPC endpoints
  isTestnet: boolean;         // Testnet flag
  color: string;              // UI color (hex)
}
```

Complete configuration for a network.

**Example:**
```typescript
import { NETWORK_CONFIG } from './lib/prompts/system/knowledge';

const polkadotConfig = NETWORK_CONFIG.polkadot;
console.log(polkadotConfig.token);  // 'DOT'
console.log(polkadotConfig.decimals);  // 10
console.log(polkadotConfig.isTestnet);  // false
```

---

### Multi-Network Factory Functions

#### `createRpcManagersForNetwork()`

Create network-specific RPC managers with pre-configured endpoints.

```typescript
function createRpcManagersForNetwork(
  network: Network
): {
  relayChainManager: RpcManager;
  assetHubManager: RpcManager;
}
```

**Parameters:**
- `network` (Network): Network identifier ('polkadot', 'kusama', or 'westend')

**Returns:**
- Object containing:
  - `relayChainManager`: RpcManager for Relay Chain
  - `assetHubManager`: RpcManager for Asset Hub

**Example:**
```typescript
// Create managers for Westend testnet
const { relayChainManager, assetHubManager } = createRpcManagersForNetwork('westend');

// Managers come pre-configured with best endpoints
const relayApi = await relayChainManager.getReadApi();
const assetHubApi = await assetHubManager.getReadApi();
```

**Storage Isolation:**
Each network uses separate localStorage keys for health tracking:
- Polkadot: `dotbot_rpc_health_polkadot_relay`, `dotbot_rpc_health_polkadot_assethub`
- Kusama: `dotbot_rpc_health_kusama_relay`, `dotbot_rpc_health_kusama_assethub`
- Westend: `dotbot_rpc_health_westend_relay`, `dotbot_rpc_health_westend_assethub`

**Version Added:** v0.2.0 (January 2026)

---

#### Network-Specific Factory Functions

Create RPC managers for individual chains:

```typescript
// Polkadot
function createPolkadotRelayChainManager(): RpcManager
function createPolkadotAssetHubManager(): RpcManager

// Kusama
function createKusamaRelayChainManager(): RpcManager
function createKusamaAssetHubManager(): RpcManager

// Westend
function createWestendRelayChainManager(): RpcManager
function createWestendAssetHubManager(): RpcManager
```

**Example:**
```typescript
import {
  createWestendRelayChainManager,
  createWestendAssetHubManager
} from '@dotbot/core';

const relayManager = createWestendRelayChainManager();
const assetHubManager = createWestendAssetHubManager();

const relayApi = await relayManager.getReadApi();
```

**Use Case:** When you only need one chain or want fine-grained control.

**Version Added:** v0.2.0 (January 2026)

---

### Network Utilities

Comprehensive set of utility functions for network operations.

#### `getNetworkMetadata()`

Get complete configuration for a network.

```typescript
function getNetworkMetadata(network: Network): NetworkMetadata
```

**Example:**
```typescript
import { getNetworkMetadata } from './lib/prompts/system/knowledge';

const metadata = getNetworkMetadata('westend');
console.log(metadata.token);  // 'WND'
console.log(metadata.decimals);  // 12
console.log(metadata.isTestnet);  // true
```

---

#### `detectNetworkFromChainName()`

Auto-detect network from chain metadata.

```typescript
function detectNetworkFromChainName(
  chainName: string
): Network | null
```

**Example:**
```typescript
import { detectNetworkFromChainName } from './lib/prompts/system/knowledge';

const api = await ApiPromise.create({ provider: wsProvider });
const chainName = (await api.rpc.system.chain()).toString();

const network = detectNetworkFromChainName(chainName);
// Returns: 'polkadot', 'kusama', 'westend', or null
```

---

#### `getNetworkTokenSymbol()`

Get native token symbol for a network.

```typescript
function getNetworkTokenSymbol(network: Network): string
```

**Example:**
```typescript
getNetworkTokenSymbol('polkadot');  // 'DOT'
getNetworkTokenSymbol('kusama');    // 'KSM'
getNetworkTokenSymbol('westend');   // 'WND'
```

---

#### `getNetworkDecimals()`

Get token decimals for a network.

```typescript
function getNetworkDecimals(network: Network): number
```

**Example:**
```typescript
getNetworkDecimals('polkadot');  // 10
getNetworkDecimals('westend');   // 12
```

---

#### `isTestnet()`

Check if a network is a testnet.

```typescript
function isTestnet(network: Network): boolean
```

**Example:**
```typescript
isTestnet('polkadot');  // false
isTestnet('westend');   // true
```

---

#### `getRelayChainEndpoints()`

Get Relay Chain RPC endpoints for a network.

```typescript
function getRelayChainEndpoints(network: Network): string[]
```

**Returns:** Array of WebSocket RPC URLs, ordered by reliability.

---

#### `getAssetHubEndpoints()`

Get Asset Hub RPC endpoints for a network.

```typescript
function getAssetHubEndpoints(network: Network): string[]
```

**Returns:** Array of WebSocket RPC URLs, ordered by reliability.

---

#### Additional Utilities

```typescript
// Network validation
function isValidNetwork(network: string): network is Network
function validateNetwork(network: Network): void  // throws if invalid

// Network comparison
function isSameNetwork(a: Network | string, b: Network | string): boolean

// Network display
function getNetworkDisplayName(network: Network): string
function getNetworkDescription(network: Network): string

// Address encoding
function getNetworkSS58Format(network: Network): number
function formatAddressForNetwork(address: string, network: Network): string

// Knowledge base
function getKnowledgeBaseForNetwork(network: Network): PolkadotKnowledge
function formatKnowledgeBaseForNetwork(network: Network): string
```

**Full documentation:** See `lib/dotbot-core/prompts/system/knowledge/networkUtils.ts`

**Version Added:** v0.2.0 (January 2026)

---

### DotBot Core Multi-Network Support

#### `DotBot.create()`

**UPDATED** in v0.2.0 to support network parameter and chat management:

```typescript
interface DotBotConfig {
  wallet: InjectedAccountWithMeta;
  network?: Network;  // ← NEW in v0.2.0
  relayChainManager?: RpcManager;  // Optional if using network param
  assetHubManager?: RpcManager;    // Optional if using network param
  onSigningRequest?: (request: SigningRequest) => void;
  onBatchSigningRequest?: (request: BatchSigningRequest) => void;
  onSimulationStatus?: (status: SimulationStatus) => void;
  disableChatPersistence?: boolean;  // ← NEW in v0.2.0
}

static async create(config: DotBotConfig): Promise<DotBot>
```

**Parameters:**
- `network` (Network, optional): Network identifier. Default: `'polkadot'`. *Added in v0.2.0*
- `relayChainManager` (RpcManager, optional): Now optional - auto-created if `network` provided. *Updated in v0.2.0*
- `assetHubManager` (RpcManager, optional): Now optional - auto-created if `network` provided. *Updated in v0.2.0*
- `disableChatPersistence` (boolean, optional): Disable chat history persistence. Default: `false`. *Added in v0.2.0*

**Behavior Changes in v0.2.0:**
- System prompt includes network-specific knowledge
- Balance displays use correct token symbol (DOT/KSM/WND)
- Testnet flag set automatically for Westend
- Network can be detected from connected chain if not specified
- **Automatically creates and manages ChatInstances** (no manual ChatInstanceManager needed)
- **Chat history persisted to localStorage by default** (disable with `disableChatPersistence: true`)
- **Execution requires user approval** (two-step: prepare → user clicks "Accept & Start" → execute)

**Example (v0.2.0+):**
```typescript
// Explicit network specification (recommended)
const managers = createRpcManagersForNetwork('westend');

const dotbot = await DotBot.create({
  wallet: account,
  network: 'westend',  // NEW parameter
  relayChainManager: managers.relayChainManager,
  assetHubManager: managers.assetHubManager,
  onSigningRequest: (request) => handleSigning(request)
});

// DotBot automatically:
// - Loads Westend knowledge base
// - Uses WND as token symbol
// - Sets isTestnet = true in context
```

**Example (backward compatible - defaults to Polkadot):**
```typescript
const dotbot = await DotBot.create({
  wallet: account,
  relayChainManager,  // Uses Polkadot endpoints
  assetHubManager
  // network parameter omitted → defaults to 'polkadot'
});
```

**Breaking Changes:** None - fully backward compatible

**Version History:**
- v0.2.0 (January 2026): Added `network` parameter with default 'polkadot'
- v0.1.0: Initial implementation

---

#### `DotBot.getNetwork()`

**NEW** in v0.2.0: Get the current network.

```typescript
getNetwork(): Network
```

**Returns:** Current network identifier

**Example:**
```typescript
const network = dotbot.getNetwork();
console.log(network);  // 'westend'

if (dotbot.getNetwork() === 'westend') {
  console.log('Running on testnet - safe to experiment!');
}
```

**Version Added:** v0.2.0 (January 2026)

---

#### `DotBot.chat()`

Main conversational interface. Handles LLM interaction and execution planning.

```typescript
async chat(message: string, options?: ChatOptions): Promise<ChatResult>

interface ChatOptions {
  llm?: LLMFunction;
  systemPrompt?: string;
  conversationHistory?: ConversationMessage[];
}

interface ChatResult {
  response: string;
  plan?: ExecutionPlan;
  executed: boolean;
  success: boolean;
  completed: number;
  failed: number;
}
```

**Parameters:**
- `message` (string): User's natural language message
- `options.llm` (LLMFunction, optional): Custom LLM function. If not provided, uses configured LLM
- `options.systemPrompt` (string, optional): Override system prompt
- `options.conversationHistory` (ConversationMessage[], optional): Custom history (for testing)

**Returns:**
- `response` (string): Bot's response or execution result
- `plan` (ExecutionPlan, optional): Extracted execution plan if found
- `executed` (boolean): Whether execution occurred (v0.2.0: always false until user approves)
- `success` (boolean): Whether operation succeeded
- `completed` (number): Number of completed operations
- `failed` (number): Number of failed operations

**Behavior (v0.2.0):**
1. Saves user message to chat history
2. Gets LLM response with network-specific context (system prompt includes Output Mode Override and Final Check for JSON-only ExecutionPlan)
3. **Format guardrail**: If the LLM returns prose instead of a JSON ExecutionPlan (e.g. "I've prepared a transaction flow..."), `getLLMResponse` detects it and retries once with a correction prompt asking for JSON only. If no plan is extracted after that, the frontend shows a clear "❌ LLM ERROR" message with a response preview so logs and users see accurate feedback.
4. Extracts ExecutionPlan if present
5. If plan found: **Prepares** execution (orchestrates, adds to chat) - **does NOT auto-execute**
6. Returns result with `executed: false` (user must approve via UI)
7. User clicks "Accept & Start" → UI calls `dotbot.startExecution(executionId)`

**Example:**
```typescript
const result = await dotbot.chat("Send 2 DOT to Alice", {
  llm: async (message, systemPrompt) => {
    return await openai.chat(message, systemPrompt);
  }
});

console.log(result.response);  
// "I've prepared a transaction flow with 1 step. Review the details below..."

// ExecutionFlow shown in UI for user approval
// User clicks "Accept & Start" → startExecution() called
```

**Breaking Changes:**
- ⚠️ v0.2.0: No longer auto-executes. Returns `executed: false`. User must approve via `startExecution()`.

**Migration:**
```typescript
// OLD (v0.1.0) - Auto-execution
const result = await dotbot.chat("Send 2 DOT");
// Execution happened automatically

// NEW (v0.2.0) - Two-step
const result = await dotbot.chat("Send 2 DOT");
// result.executed = false
// UI shows ExecutionFlow with "Accept & Start" button
// User clicks → dotbot.startExecution(executionId)
```

**Version History:**
- v0.2.0 (PR #44, #45, January 2026): Changed to two-step execution (prepare, then user approves)
- v0.1.0: Initial implementation (auto-executed immediately)

---

#### `DotBot.prepareExecution()`

**NEW** in v0.2.0: Prepare execution plan (orchestrates and adds to chat, but does NOT execute).

```typescript
private async prepareExecution(plan: ExecutionPlan): Promise<void>
```

**Note:** This is called automatically by `chat()` when an ExecutionPlan is detected. You typically don't call this directly.

**Behavior:**
1. Orchestrates ExecutionPlan → calls agents → creates ExecutionArray
2. Adds ExecutionMessage to chat timeline
3. UI shows ExecutionFlow component for user review
4. Does NOT execute - waits for user approval

**Version Added:** v0.2.0 (PR #44, January 2026)

---

#### `DotBot.startExecution()`

**NEW** in v0.2.0: Execute a prepared execution plan after user approval.

```typescript
async startExecution(
  executionId: string, 
  options?: ExecutionOptions
): Promise<void>
```

**Parameters:**
- `executionId` (string): Unique ID from `ExecutionMessage.executionId`
- `options` (ExecutionOptions, optional): Execution options (e.g., `autoApprove`)

**Behavior:**
- If execution was interrupted, rebuilds ExecutionArray from ExecutionPlan
- Restores state from saved ExecutionArrayState (preserves progress)
- Executes the ExecutionArray
- Updates ExecutionMessage in chat as execution progresses

**Usage:**
```typescript
// After chat() prepares execution
const messages = dotbot.currentChat.getDisplayMessages();
const executionMessage = messages.find(m => m.type === 'execution');

// User clicks "Accept & Start" in UI
await dotbot.startExecution(executionMessage.executionId);
```

**Throws:**
- Error if no active chat
- Error if executionId not found
- Error if execution rebuild fails

**Version Added:** v0.2.0 (PR #44, January 2026)

---

#### `DotBot.switchEnvironment()`

**NEW** in v0.2.0: Switch between mainnet and testnet environments.

```typescript
async switchEnvironment(
  environment: Environment, 
  network?: Network
): Promise<void>

type Environment = 'mainnet' | 'testnet';
```

**Parameters:**
- `environment` ('mainnet' | 'testnet'): Target environment
- `network` (Network, optional): Specific network. Auto-selected if not provided:
  - `mainnet` → `'polkadot'`
  - `testnet` → `'westend'`

**Behavior:**
- Validates network/environment compatibility
- Creates new RPC managers for target network
- Reconnects APIs
- **Creates new ChatInstance** (previous chat remains in history)

**Example:**
```typescript
// Switch to testnet
await dotbot.switchEnvironment('testnet');  // Uses Westend

// Or specify network explicitly
await dotbot.switchEnvironment('mainnet', 'kusama');
```

**Version Added:** v0.2.0 (January 2026)

---

#### `DotBot.clearHistory()`

**NEW** in v0.2.0: Start a new chat in the current environment.

```typescript
async clearHistory(): Promise<void>
```

**Behavior:**
- Creates new ChatInstance in current environment
- Previous chat remains in storage (accessible via ChatInstanceManager)

**Example:**
```typescript
await dotbot.clearHistory();
console.log('Started fresh chat:', dotbot.currentChat.id);
```

**Version Added:** v0.2.0 (January 2026)

---

#### `DotBot.getEnvironment()`

**NEW** in v0.2.0: Get current environment.

```typescript
getEnvironment(): Environment
```

**Returns:** Current environment (`'mainnet'` or `'testnet'`)

**Example:**
```typescript
if (dotbot.getEnvironment() === 'testnet') {
  console.log('⚠️ Using testnet - safe to experiment!');
}
```

**Version Added:** v0.2.0 (January 2026)

---

#### `DotBot.getChatManager()`

**NEW** in v0.2.0: Access ChatInstanceManager for advanced usage.

```typescript
getChatManager(): ChatInstanceManager
```

**Returns:** Internal ChatInstanceManager instance

**Usage (advanced):**
```typescript
const manager = dotbot.getChatManager();

// Query all chats
const allChats = await manager.loadInstances();

// Query by environment
const testnetChats = manager.getInstancesByEnvironment('testnet');

// Delete specific chat
await manager.deleteInstance('chat-id-123');
```

**Version Added:** v0.2.0 (January 2026)

---

#### `DotBot.currentChat`

**NEW** in v0.2.0: Access current chat instance.

```typescript
public currentChat: ChatInstance | null
```

**Usage:**
```typescript
// Get conversation items (messages + execution flows)
const items = dotbot.currentChat?.getDisplayMessages() || [];

// Subscribe to execution updates
dotbot.currentChat?.onExecutionUpdate(executionId, (state) => {
  console.log('Execution progress:', state);
});

// Get execution arrays
const execution = dotbot.currentChat?.getExecutionArray(executionId);
```

**See:** ChatInstance API for full details

**Version Added:** v0.2.0 (January 2026)

---

#### `DotBot.getAllMessages()`

Get all conversation items (messages + execution flows) from current chat.

```typescript
getAllMessages(): ConversationItem[]
```

**Returns:** Array of all conversation items (TextMessage, ExecutionMessage, SystemMessage, etc.)

**Example:**
```typescript
const messages = dotbot.getAllMessages();
messages.forEach(item => {
  if (item.type === 'text') {
    console.log(item.content);
  } else if (item.type === 'execution') {
    console.log('Execution flow:', item.executionId);
  }
});
```

**Version Added:** v0.2.0 (January 2026)

---

#### `DotBot.getHistory()`

Get conversation history for LLM context (text messages only).

```typescript
getHistory(): ConversationMessage[]
```

**Returns:** Array of conversation messages in LLM format (role + content)

**Note:** This is different from `getAllMessages()` - it only returns text messages in LLM format, not execution flows.

**Example:**
```typescript
const history = dotbot.getHistory();
// Pass to LLM for context
const response = await llm.chat(message, { history });
```

**Version Added:** v0.2.0 (January 2026)

---

#### `DotBot.getExecutionArrayState()`

Get current execution array state (if any).

```typescript
getExecutionArrayState(): ExecutionArrayState | null
```

**Returns:** Current execution state or `null` if no active execution

**Example:**
```typescript
const state = dotbot.getExecutionArrayState();
if (state) {
  console.log(`Execution: ${state.items.length} items, ${state.items.filter(i => i.status === 'completed').length} completed`);
}
```

**Version Added:** v0.2.0 (January 2026)

---

#### `DotBot.getRpcHealth()`

Get RPC endpoint health status for both Relay Chain and Asset Hub.

```typescript
getRpcHealth(): {
  relayChain: {
    current: string;
    endpoints: HealthStatus[];
  };
  assetHub: {
    current: string;
    endpoints: HealthStatus[];
  };
}
```

**Returns:** Health status for all endpoints

**Example:**
```typescript
const health = dotbot.getRpcHealth();
console.log('Relay Chain:', health.relayChain.current);
console.log('Asset Hub:', health.assetHub.current);
```

**Version Added:** v0.2.0 (January 2026)

---

#### `DotBot.getConnectedEndpoints()`

Get currently connected RPC endpoints.

```typescript
getConnectedEndpoints(): {
  relayChain: string;
  assetHub: string | null;
}
```

**Returns:** Currently active endpoints

**Example:**
```typescript
const endpoints = dotbot.getConnectedEndpoints();
console.log('Relay Chain:', endpoints.relayChain);
console.log('Asset Hub:', endpoints.assetHub || 'Not connected');
```

**Version Added:** v0.2.0 (January 2026)

---

#### `DotBot.getBalance()`

Get account balance from both Relay Chain and Asset Hub.

```typescript
getBalance(): Promise<{
  relayChain: {
    free: string;
    reserved: string;
    frozen: string;
  };
  assetHub: {
    free: string;
    reserved: string;
    frozen: string;
  } | null;
  total: string;
}>
```

**Returns:** Balance information for current wallet account

**Example:**
```typescript
const balance = await dotbot.getBalance();
console.log('Total balance:', balance.total);
console.log('Relay Chain free:', balance.relayChain.free);
if (balance.assetHub) {
  console.log('Asset Hub free:', balance.assetHub.free);
}
```

**Version Added:** v0.2.0 (January 2026)

---

#### `DotBot.getChainInfo()`

Get chain information (name and version).

```typescript
getChainInfo(): Promise<{
  chain: string;
  version: string;
}>
```

**Returns:** Chain name and version

**Example:**
```typescript
const info = await dotbot.getChainInfo();
console.log(`Connected to ${info.chain} (${info.version})`);
```

**Version Added:** v0.2.0 (January 2026)

---

#### `DotBot.getApi()`

Get Polkadot API instance (for advanced usage).

```typescript
getApi(): ApiPromise
```

**Returns:** Relay Chain ApiPromise instance

**Example:**
```typescript
const api = dotbot.getApi();
const balance = await api.query.system.account(address);
```

**Version Added:** v0.2.0 (January 2026)

---

#### `DotBot.getAssetHubApi()`

Get Asset Hub API instance (for advanced usage).

```typescript
getAssetHubApi(): ApiPromise | null
```

**Returns:** Asset Hub ApiPromise instance or `null` if not connected

**Example:**
```typescript
const assetHubApi = dotbot.getAssetHubApi();
if (assetHubApi) {
  const balance = await assetHubApi.query.system.account(address);
}
```

**Version Added:** v0.2.0 (January 2026)

---

#### `DotBot.getWallet()`

Get current wallet account.

```typescript
getWallet(): WalletAccount
```

**Returns:** Current wallet account

**Example:**
```typescript
const wallet = dotbot.getWallet();
console.log('Address:', wallet.address);
console.log('Source:', wallet.source);
```

**Version Added:** v0.2.0 (January 2026)

---

#### `DotBot.loadChatInstance()`

Load a specific chat instance by ID. Switches environment/network if needed.

```typescript
async loadChatInstance(chatId: string): Promise<void>
```

**Parameters:**
- `chatId` (string): Chat instance ID to load

**Behavior:**
- Loads chat instance from storage
- Switches environment/network if needed
- Reconnects APIs for new network
- Restores chat state

**Throws:**
- Error if chat instance not found

**Example:**
```typescript
// Load a previous chat
await dotbot.loadChatInstance('chat_1234567890_abc');
console.log('Loaded chat:', dotbot.currentChat?.id);
```

**Version Added:** v0.2.0 (January 2026)

---

#### `DotBot.disconnect()`

Disconnect all API connections and cleanup.

```typescript
async disconnect(): Promise<void>
```

**Behavior:**
- Disconnects Relay Chain API
- Disconnects Asset Hub API (if connected)
- Cleans up resources

**Example:**
```typescript
// Cleanup when done
await dotbot.disconnect();
```

**Version Added:** v0.2.0 (January 2026)

---

## ChatInstance API

**NEW** in v0.2.0: Class for managing individual chat conversations.

### Overview

`ChatInstance` encapsulates a single conversation with its execution state. Each instance is bound to an environment (`'mainnet'` | `'testnet'`) and contains a temporal sequence of conversation items (messages and execution flows).

```typescript
class ChatInstance {
  readonly id: string;
  readonly environment: Environment;
  readonly network: Network;
  readonly walletAddress: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  
  // Core methods
  async addUserMessage(content: string): Promise<TextMessage>;
  async addBotMessage(content: string): Promise<TextMessage>;
  async addExecutionMessage(state: ExecutionArrayState): Promise<ExecutionMessage>;
  async updateExecutionMessage(id: string, updates: Partial<ExecutionMessage>): Promise<void>;
  
  getDisplayMessages(): ConversationItem[];
  
  setExecutionArray(executionId: string, executionArray: ExecutionArray): void;
  getExecutionArray(executionId: string): ExecutionArray | undefined;
  getAllExecutionArrays(): Map<string, ExecutionArray>;
  
  onExecutionUpdate(executionId: string, callback: (state: ExecutionArrayState) => void): () => void;
  
  get executionState(): ExecutionArrayState | null;
  get isPlanExecuting(): boolean;
  get executionProgress(): { current: number; total: number };
  // ... other convenience getters
}
```

### `ChatInstance.create()`

Create a new chat instance.

```typescript
static async create(
  params: CreateChatInstanceParams,
  manager: ChatInstanceManager,
  persist: boolean = true
): Promise<ChatInstance>

interface CreateChatInstanceParams {
  environment: Environment;
  network: Network;
  walletAddress: string;
  title?: string;
}
```

**Parameters:**
- `environment` ('mainnet' | 'testnet'): Environment for this chat
- `network` (Network): Network ('polkadot', 'kusama', 'westend')
- `walletAddress` (string): User's wallet address
- `title` (string, optional): Chat title (auto-generated if not provided)

**Example:**
```typescript
const chat = await ChatInstance.create(
  {
    environment: 'testnet',
    network: 'westend',
    walletAddress: account.address,
    title: 'Testing transfers'
  },
  chatManager
);
```

---

### `ChatInstance.addUserMessage()`

Add user message to conversation.

```typescript
async addUserMessage(content: string): Promise<TextMessage>
```

---

### `ChatInstance.addExecutionMessage()`

Add execution flow to conversation.

```typescript
async addExecutionMessage(state: ExecutionArrayState): Promise<ExecutionMessage>
```

**Parameters:**
- `state` (ExecutionArrayState): Execution array state with unique `id`

**Returns:** Created ExecutionMessage with `executionId` matching `state.id`

---

### `ChatInstance.getDisplayMessages()`

Get all conversation items in temporal order.

```typescript
getDisplayMessages(): ConversationItem[]

type ConversationItem = 
  | TextMessage 
  | ExecutionMessage 
  | SystemMessage 
  | KnowledgeRequestMessage
  | KnowledgeResponseMessage
  | SearchRequestMessage
  | SearchResponseMessage;
```

**Returns:** Array of all conversation items (text messages, execution flows, etc.) in chronological order

**Usage:**
```typescript
const items = chat.getDisplayMessages();

items.forEach(item => {
  switch (item.type) {
    case 'user':
    case 'bot':
      console.log(`${item.type}: ${item.content}`);
      break;
    case 'execution':
      console.log(`Execution flow: ${item.executionId}`);
      break;
  }
});
```

---

### `ChatInstance.setExecutionArray()`

Add or update an execution array.

```typescript
setExecutionArray(executionId: string, executionArray: ExecutionArray): void
```

**Usage:**
```typescript
const executionArray = new ExecutionArray();
chat.setExecutionArray(executionArray.getId(), executionArray);
```

---

### `ChatInstance.onExecutionUpdate()`

Subscribe to execution state changes for a specific execution.

```typescript
onExecutionUpdate(
  executionId: string, 
  callback: (state: ExecutionArrayState) => void
): () => void
```

**Parameters:**
- `executionId` (string): Unique execution ID
- `callback` (function): Called when execution state changes

**Returns:** Unsubscribe function

**Example:**
```typescript
const unsubscribe = chat.onExecutionUpdate(executionId, (state) => {
  console.log(`Progress: ${state.completedItems}/${state.totalItems}`);
});

// Later: unsubscribe
unsubscribe();
```

---

### Convenience Properties

```typescript
// Current execution state (most recent)
readonly executionState: ExecutionArrayState | null;

// Is any execution currently running
readonly isPlanExecuting: boolean;

// Execution progress
readonly executionProgress: { current: number; total: number };

// Execution statistics
readonly planLength: number;
readonly completedItems: number;
readonly failedItems: number;
readonly cancelledItems: number;
```

---

## Storage API

**NEW** in v0.2.0: Storage abstraction for chat persistence.

### IChatStorage Interface

```typescript
interface IChatStorage {
  loadAll(): Promise<ChatInstanceData[]>;
  load(id: string): Promise<ChatInstanceData | null>;
  save(instance: ChatInstanceData): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  isAvailable(): Promise<boolean>;
  getType(): string;
}
```

### Implementations

#### LocalStorageChatStorage

Default implementation using browser localStorage.

```typescript
const storage = new LocalStorageChatStorage();
const chats = await storage.loadAll();
```

#### ApiChatStorage

External database storage (ready for future implementation).

```typescript
const storage = new ApiChatStorage({
  apiUrl: 'https://api.example.com',
  apiKey: 'your-key'
});
```

#### HybridChatStorage

Offline-first with API sync.

```typescript
const storage = new HybridChatStorage({
  local: new LocalStorageChatStorage(),
  api: new ApiChatStorage({ /* ... */ })
});
```

### Factory Function

```typescript
function createChatStorage(config: ChatStorageConfig): IChatStorage

interface ChatStorageConfig {
  type: 'local' | 'api' | 'hybrid';
  apiUrl?: string;
  apiKey?: string;
  syncInterval?: number;
}
```

**Example:**
```typescript
const storage = createChatStorage({ 
  type: 'local'  // Simple localStorage
});

const storage = createChatStorage({
  type: 'api',
  apiUrl: 'https://api.dotbot.app',
  apiKey: process.env.API_KEY
});
```

---

## DataManager API

**NEW** in v0.2.0: GDPR-compliant data management.

### Overview

`DataManager` provides centralized operations for user data management, including export, deletion, and verification.

```typescript
class DataManager {
  async exportAllData(): Promise<DataExport>;
  async importData(data: DataExport): Promise<void>;
  async deleteAllData(): Promise<DeletionReport>;
  
  // Granular deletion
  async deleteChatData(): Promise<number>;
  async deleteRpcHealthData(): Promise<number>;
  async deletePreferences(): Promise<boolean>;
  async deleteWalletCache(): Promise<boolean>;
  
  async verifyDataCleared(): Promise<boolean>;
  async getStorageInfo(): Promise<StorageInfo>;
}
```

### Global Functions

Convenience functions for common operations:

```typescript
// Export all data
const data = await exportAllData();

// Export and download as file
await exportAndDownload('my-dotbot-data.json');

// Delete all data (GDPR right to erasure)
const report = await nukeAllData();
console.log(`Deleted ${report.totalDeleted} items`);

// Verify deletion
const isClean = await verifyDataCleared();

// Get storage info
const info = await getStorageInfo();
console.log(`Total storage: ${info.totalSize} bytes`);
```

### `exportAllData()`

Export all user data (GDPR right to data portability).

```typescript
async exportAllData(): Promise<DataExport>

interface DataExport {
  chatInstances: ChatInstanceData[];
  rpcHealth: Array<{ key: string; value: any }>;
  userPreferences: Record<string, any>;
  walletCache: Record<string, any>;
  metadata: {
    exportedAt: number;
    version: string;
  };
}
```

**Example:**
```typescript
const data = await exportAllData();
console.log(`Exported ${data.chatInstances.length} chats`);
console.log(JSON.stringify(data, null, 2));
```

---

### `exportAndDownload()`

Export data and trigger browser download.

```typescript
async exportAndDownload(filename: string = 'dotbot-data.json'): Promise<void>
```

**Example:**
```typescript
await exportAndDownload('my-data-backup.json');
// Browser downloads file automatically
```

---

### `nukeAllData()`

Delete all DotBot data (GDPR right to erasure).

```typescript
async nukeAllData(): Promise<DeletionReport>

interface DeletionReport {
  chatInstances: number;
  rpcHealth: number;
  userPreferences: boolean;
  walletCache: boolean;
  unknownKeys: number;
  totalDeleted: number;
}
```

**Example:**
```typescript
const report = await nukeAllData();
console.log('Deletion report:', report);

// Verify complete deletion
const isClean = await verifyDataCleared();
console.log('All data deleted:', isClean);
```

---

### `verifyDataCleared()`

Verify that no DotBot data remains in storage.

```typescript
async verifyDataCleared(): Promise<boolean>
```

**Returns:** `true` if no DotBot data found, `false` otherwise

---

### `getStorageInfo()`

Get detailed storage information.

```typescript
async getStorageInfo(): Promise<StorageInfo>

interface StorageInfo {
  chatInstances: { count: number; size: number };
  rpcHealth: { count: number; size: number };
  preferences: { exists: boolean; size: number };
  walletCache: { exists: boolean; size: number };
  totalSize: number;
  totalKeys: number;
}
```

**Example:**
```typescript
const info = await getStorageInfo();
console.log(`${info.chatInstances.count} chats using ${info.chatInstances.size} bytes`);
console.log(`Total: ${info.totalSize} bytes across ${info.totalKeys} keys`);
```

---

### Storage Keys

All storage keys are centralized in the `STORAGE_KEYS` enum:

```typescript
export const STORAGE_KEYS = {
  CHAT_INSTANCES: 'dotbot_chat_instances',
  RPC_HEALTH_POLKADOT_RELAY: 'rpc_health_polkadot_relay',
  RPC_HEALTH_POLKADOT_ASSETHUB: 'rpc_health_polkadot_assethub',
  RPC_HEALTH_WESTEND_RELAY: 'rpc_health_westend_relay',
  RPC_HEALTH_WESTEND_ASSETHUB: 'rpc_health_westend_assethub',
  RPC_HEALTH_KUSAMA_RELAY: 'rpc_health_kusama_relay',
  RPC_HEALTH_KUSAMA_ASSETHUB: 'rpc_health_kusama_assethub',
  USER_PREFERENCES: 'dotbot_user_preferences',
  WALLET_CACHE: 'dotbot_wallet_cache',
  ANALYTICS_CONSENT: 'dotbot_analytics_consent',
} as const;
```

---

## Agents API

### BaseAgent

Base class for all agents. Provides common functionality.

#### `initialize()`

Initialize the agent with API instances.

```typescript
initialize(
  api: ApiPromise,
  assetHubApi?: ApiPromise | null,
  onStatusUpdate?: SimulationStatusCallback | null,
  relayChainManager?: RpcManager | null,
  assetHubManager?: RpcManager | null
): void
```

**Parameters:**
- `api` - Polkadot Relay Chain API instance (required)
- `assetHubApi` - Asset Hub API instance (optional but recommended)
- `onStatusUpdate` - Callback for simulation progress updates (optional)
- `relayChainManager` - RPC manager for Relay Chain endpoints (optional)
- `assetHubManager` - RPC manager for Asset Hub endpoints (optional)

**Example:**
```typescript
agent.initialize(
  relayApi,
  assetHubApi,
  (status) => console.log(status.message),
  relayManager,
  assetHubManager
);
```

---

### AssetTransferAgent

Handles DOT and token transfers across the Polkadot ecosystem.

#### `transfer()`

Create a single transfer extrinsic.

```typescript
async transfer(params: TransferParams): Promise<AgentResult>
```

**Parameters:**

```typescript
interface TransferParams extends BaseAgentParams {
  address: string;          // Sender's Polkadot address (from BaseAgentParams)
  recipient: string;        // Recipient's Polkadot address
  amount: string | number;  // Amount in DOT (e.g., "10.5" or 10.5)
  chain?: 'assetHub' | 'relay';  // Target chain (default: 'assetHub')
  keepAlive?: boolean;      // Keep account above ED? (default: false)
  validateBalance?: boolean; // Check sufficient balance? (default: true)
}
```

**Returns:** `Promise<AgentResult>`

**Throws:**
- `AgentError` with code:
  - `NOT_INITIALIZED` - Agent not initialized
  - `INVALID_ADDRESS` - Invalid sender or recipient address
  - `INSUFFICIENT_BALANCE` - Not enough funds
  - `BELOW_EXISTENTIAL_DEPOSIT` - Would leave account below ED
  - `ASSET_HUB_NOT_AVAILABLE` - Asset Hub API not connected

**Example:**
```typescript
const result = await agent.transfer({
  address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
  recipient: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
  amount: '10.5',
  chain: 'assetHub',
  keepAlive: true
});

// result.extrinsic is ready to sign!
// result.description is "Transfer 10.5 DOT to 5FHn...4ty"
// result.estimatedFee is in Planck
```

**Important Notes:**
- `address` is the sender (from BaseAgentParams); `chain` is required for explicit chain selection - never inferred from balance
- Amount can be string ("10.5") or number (10.5)
- Address can be any SS58 format (automatically re-encoded for target chain)
- If `keepAlive: true`, validates sender won't go below existential deposit
- Automatically selects best available runtime method (transferKeepAlive → transferAllowDeath → transfer)

---

#### `batchTransfer()`

Create a batch transfer extrinsic (multiple transfers in one transaction).

```typescript
async batchTransfer(params: BatchTransferParams): Promise<AgentResult>
```

**Parameters:**

```typescript
interface BatchTransferParams extends BaseAgentParams {
  address: string;          // Sender's Polkadot address (from BaseAgentParams)
  transfers: Array<{
    recipient: string;
    amount: string | number;
  }>;
  chain?: 'assetHub' | 'relay';
  keepAlive?: boolean;
  validateBalance?: boolean;
}
```

**Returns:** `Promise<AgentResult>` with single `utility.batchAll` extrinsic

**Example:**
```typescript
const result = await agent.batchTransfer({
  address: senderAddress,
  transfers: [
    { recipient: 'address1', amount: '5' },
    { recipient: 'address2', amount: '3.5' },
    { recipient: 'address3', amount: '1' },
  ],
  chain: 'assetHub',
  keepAlive: true
});

// Single extrinsic with all transfers
// All transfers succeed or all fail (atomic)
```

**Important Notes:**
- Returns a **single** `utility.batchAll` extrinsic
- All transfers execute atomically (all succeed or all fail)
- Total amount + fees validated against sender balance
- Maximum ~100 transfers per batch (Polkadot runtime limit)

---

#### Protected Methods (for custom agents)

**`validateAddress(address: string): ValidationResult`**

Validate a Polkadot address.

```typescript
const validation = this.validateAddress(address);
if (!validation.valid) {
  throw new AgentError(validation.errors.join(', '), 'INVALID_ADDRESS');
}
```

**`getBalance(address: string): Promise<BalanceInfo>`**

Get account balance on Relay Chain.

```typescript
const balance = await this.getBalance(address);
// balance.free, balance.reserved, balance.frozen, balance.available
```

**`getAssetHubBalance(address: string): Promise<BalanceInfo | null>`**

Get account balance on Asset Hub.

```typescript
const balance = await this.getAssetHubBalance(address);
if (!balance) {
  throw new AgentError('Asset Hub not available', 'ASSET_HUB_NOT_AVAILABLE');
}
```

**`getApiForChain(chain: 'assetHub' | 'relay'): Promise<ApiPromise>`**

Get API instance for specific chain (with validation).

```typescript
const api = await this.getApiForChain('assetHub');
// Validates API is actually connected to Asset Hub
```

**`dryRunExtrinsic(api, extrinsic, address, rpcEndpoint?): Promise<DryRunResult>`**

Simulate extrinsic with Chopsticks via backend server (optional) or dry-run.

**Note:** Chopsticks simulation requires the backend server to be running. The client makes HTTP requests to `/api/simulation` endpoints.

```typescript
const result = await this.dryRunExtrinsic(api, extrinsic, address);
if (!result.success) {
  throw new AgentError(result.error!, 'SIMULATION_FAILED');
}
```

---

## Execution Engine API

### Executioner

Executes extrinsics created by agents.

#### `initialize()`

```typescript
initialize(
  api: ApiPromise,
  account: WalletAccount,
  signer?: Signer,
  assetHubApi?: ApiPromise | null,
  relayChainManager?: RpcManager | null,
  assetHubManager?: RpcManager | null,
  onStatusUpdate?: (status: any) => void
): void
```

**Parameters:**
- `api` - Polkadot Relay Chain API instance
- `account` - User account information
- `signer` - Pluggable signer (BrowserWalletSigner, KeyringSigner, etc.)
- `assetHubApi` - Asset Hub API instance (optional)
- `relayChainManager` - RPC manager for Relay Chain (optional)
- `assetHubManager` - RPC manager for Asset Hub (optional)
- `onStatusUpdate` - Simulation status callback (optional)

**Example:**
```typescript
import { BrowserWalletSigner } from './lib/executionEngine/signers';

const signer = new BrowserWalletSigner(injector);

executioner.initialize(
  relayApi,
  { address: userAddress, name: 'Alice' },
  signer,
  assetHubApi,
  relayManager,
  assetHubManager,
  (status) => console.log(status.phase, status.message)
);
```

---

#### `execute()`

Execute items from an execution array.

```typescript
async execute(
  executionArray: ExecutionArray,
  options?: ExecutionOptions
): Promise<void>
```

**Parameters:**

```typescript
interface ExecutionOptions {
  continueOnError?: boolean;   // Continue if one item fails? (default: false)
  allowBatching?: boolean;     // Batch compatible extrinsics? (default: true)
  timeout?: number;            // Timeout in ms (default: 300000 = 5 min)
  sequential?: boolean;        // Execute sequentially? (default: true)
  autoApprove?: boolean;       // Skip user confirmation? (default: false)
}
```

**Example:**
```typescript
// Create execution array
const executionArray = new ExecutionArray();
executionArray.addItem(agentResult);

// Execute
await executioner.execute(executionArray, {
  continueOnError: false,
  sequential: true,
  autoApprove: false
});

// Check results
const state = executionArray.getState();
console.log('Completed:', state.completedItems);
console.log('Failed:', state.failedItems);
```

---

### ExecutionArray

Manages a queue of operations to execute.

#### `constructor()`

```typescript
const executionArray = new ExecutionArray();
```

#### `addItem()`

Add an item to the execution array.

```typescript
addItem(agentResult: AgentResult, options?: AddItemOptions): ExecutionItem
```

**Example:**
```typescript
const item = executionArray.addItem(agentResult, {
  priority: 'high',
  retryOnFailure: true
});
```

#### `getState()`

Get current execution state.

```typescript
interface ExecutionState {
  totalItems: number;
  completedItems: number;
  failedItems: number;
  pendingItems: number;
  currentIndex: number;
  isExecuting: boolean;
  isPaused: boolean;
}

const state = executionArray.getState();
```

#### `updateStatus()`

Update item status.

```typescript
updateStatus(
  itemId: string,
  status: ExecutionStatus,
  error?: string
): void

// Status: 'pending' | 'ready' | 'simulating' | 'signing' | 
//         'broadcasting' | 'finalized' | 'failed' | 'cancelled'
```

#### `subscribe()`

Subscribe to execution events.

```typescript
const unsubscribe = executionArray.subscribe((state) => {
  console.log('Execution state changed:', state);
});

// Later: unsubscribe()
```

---

## Settings Management API

### Simulation Configuration

Control transaction simulation behavior via `SettingsManager`. Settings persist to localStorage.

**Important:** Simulation requires the backend server to be running with Chopsticks support. The client (`@dotbot/core`) makes HTTP requests to `/api/simulation` endpoints on the backend server (`@dotbot/express`).

**Import:**
```typescript
import { 
  getSimulationConfig,
  updateSimulationConfig,
  isSimulationEnabled,
  enableSimulation,
  disableSimulation,
  resetSimulationConfig
} from './lib/services/settingsManager';
// Or convenience re-export:
import { ... } from './lib/executionEngine/simulation/simulationConfig';
```

#### `getSimulationConfig()`

Get current simulation configuration.

```typescript
function getSimulationConfig(): SimulationConfig
```

**Returns:**
```typescript
interface SimulationConfig {
  enabled: boolean;      // Whether simulation is enabled
  timeout: number;        // Simulation timeout (ms)
  skipOnFailure?: boolean;      // Skip simulation if it fails (future)
  allowIgnoreResults?: boolean; // Allow ignoring results (future)
  useChopsticks?: boolean;      // Use Chopsticks vs dry-run (via backend server)
}
```

**Example:**
```typescript
const config = getSimulationConfig();
console.log(config.enabled); // true
```

#### `isSimulationEnabled()`

Check if simulation is currently enabled.

```typescript
function isSimulationEnabled(): boolean
```

**Example:**
```typescript
if (isSimulationEnabled()) {
  // Simulation will run
} else {
  // Skip simulation, proceed to signing
}
```

#### `updateSimulationConfig()`

Update simulation configuration.

```typescript
function updateSimulationConfig(updates: Partial<SimulationConfig>): void
```

**Example:**
```typescript
// Enable simulation
updateSimulationConfig({ enabled: true });

// Disable simulation
updateSimulationConfig({ enabled: false });

// Change timeout
updateSimulationConfig({ timeout: 60000 });
```

#### `enableSimulation()` / `disableSimulation()`

Convenience methods for enabling/disabling simulation.

```typescript
function enableSimulation(): void
function disableSimulation(): void
```

**Example:**
```typescript
enableSimulation();  // Same as updateSimulationConfig({ enabled: true })
disableSimulation(); // Same as updateSimulationConfig({ enabled: false })
```

**Default:** `enabled: true` (simulation enabled by default)

**Persistence:** Settings are automatically saved to localStorage and persist across sessions.

**UI Control:** SettingsModal provides a toggle for simulation enable/disable.

**Version Added:** v0.2.1 (January 2026)

---

## Utilities API

### RpcManager

Manages multiple RPC endpoints with health monitoring and failover.

#### `constructor()`

```typescript
constructor(
  endpoints: string[],
  options?: RpcManagerOptions,
  storageKey?: string  // ← NEW in v0.2.0
)
```

**Parameters:**
- `endpoints` (string[]): Array of WebSocket RPC URLs
- `options` (RpcManagerOptions, optional): Configuration options
  - `healthCheckInterval` (number): Health check frequency in ms (default: 1800000, i.e. 30 minutes)
  - `connectionTimeout` (number): Connection timeout in ms (default: 10000)
  - `maxRetries` (number): Maximum connection retries (default: 3)
- `storageKey` (string, optional): localStorage key for health data. Default: 'dotbot_rpc_health'. *Added in v0.2.0*

**Network-Aware Usage:**

Instead of manually creating RpcManagers, use factory functions for automatic network configuration:

```typescript
// ✅ RECOMMENDED: Use factory for network-specific configuration
const { relayChainManager, assetHubManager } = createRpcManagersForNetwork('westend');
// Storage keys automatically set:
// - 'dotbot_rpc_health_westend_relay'
// - 'dotbot_rpc_health_westend_assethub'

// ⚠️ MANUAL: Only if you need custom endpoints
const customManager = new RpcManager(
  ['wss://custom-endpoint.com'],
  { healthCheckInterval: 1800000 },  // 30 minutes (default)
  'dotbot_rpc_health_custom'  // Provide unique key
);
```

**Storage Isolation:**

Each network uses separate storage keys to prevent health data conflicts:
- Polkadot Relay: `dotbot_rpc_health_polkadot_relay`
- Polkadot Asset Hub: `dotbot_rpc_health_polkadot_assethub`
- Kusama Relay: `dotbot_rpc_health_kusama_relay`
- Kusama Asset Hub: `dotbot_rpc_health_kusama_assethub`
- Westend Relay: `dotbot_rpc_health_westend_relay`
- Westend Asset Hub: `dotbot_rpc_health_westend_assethub`

**Version History:**
- v0.2.x (January 2026): Default `healthCheckInterval` changed to 30 minutes (1800000 ms); cached read API cleared on disconnect/error for failover
- v0.2.0 (January 2026): Added `storageKey` parameter for network isolation
- v0.1.0: Initial implementation

**Example:**
```typescript
const manager = new RpcManager(
  [
    'wss://rpc.polkadot.io',
    'wss://polkadot-rpc.dwellir.com',
    'wss://polkadot.api.onfinality.io/public-ws'
  ],
  {
    healthCheckInterval: 1800000,  // 30 minutes (default)
    connectionTimeout: 10000,
    maxRetries: 3
  },
  'dotbot_rpc_health_polkadot_relay'  // Unique storage key
);
```

#### `getReadApi()`

Get API instance for read operations (uses best available endpoint). Includes retry logic for transient failures. After disconnect or error, the cached read API is cleared so the next call triggers failover. A short stability delay (e.g. 150ms) is used before considering a connection stable.

```typescript
async getReadApi(): Promise<ApiPromise>
```

**Example:**
```typescript
const api = await manager.getReadApi();
const balance = await api.query.system.account(address);
```

#### `createExecutionSession()`

Create a fresh API instance for transaction execution.

```typescript
async createExecutionSession(): Promise<{ api: ApiPromise, endpoint: string }>
```

**Example:**
```typescript
const session = await manager.createExecutionSession();
// Use session.api for creating extrinsics
// Ensures correct registry
```

#### `getHealthStatus()`

Get health status of all endpoints.

```typescript
interface EndpointHealth {
  endpoint: string;
  healthy: boolean;
  avgResponseTime: number;
  lastCheck: number;
  failureCount: number;
  lastFailure?: number;
}

const healthStatus: EndpointHealth[] = manager.getHealthStatus();
```

#### `getCurrentEndpoint()`

Get currently active endpoint.

```typescript
const endpoint: string = manager.getCurrentEndpoint();
```

#### `disconnect()`

Disconnect all API instances.

```typescript
await manager.disconnect();
```

---

### Transfer Capabilities

Detect runtime capabilities for production-safe transfers.

#### `detectTransferCapabilities()`

```typescript
async function detectTransferCapabilities(
  api: ApiPromise
): Promise<TransferCapabilities>
```

**Returns:**
```typescript
interface TransferCapabilities {
  hasTransferKeepAlive: boolean;
  hasTransferAllowDeath: boolean;
  hasTransferAll: boolean;
  hasTransfer: boolean;
  hasUtilityBatch: boolean;
  hasUtilityBatchAll: boolean;
  hasUtilityForceBatch: boolean;
  existentialDeposit: BN;
  decimals: number;
  ss58Prefix: number;
  chainName: string;
  runtimeVersion: number;
}
```

**Example:**
```typescript
import { detectTransferCapabilities } from '@dotbot/core';

const capabilities = await detectTransferCapabilities(api);

if (!capabilities.hasTransferKeepAlive) {
  console.warn('Chain does not support transferKeepAlive, will fallback');
}

console.log('Existential Deposit:', capabilities.existentialDeposit.toString());
```

---

### Safe Extrinsic Builder

Build production-safe extrinsics with automatic fallbacks.

#### `buildSafeTransferExtrinsic()`

```typescript
function buildSafeTransferExtrinsic(
  api: ApiPromise,
  params: SafeTransferParams,
  capabilities: TransferCapabilities
): SafeExtrinsicResult
```

**Parameters:**
```typescript
interface SafeTransferParams {
  recipient: string;
  amount: string | number | BN;
  keepAlive?: boolean;
}

interface SafeExtrinsicResult {
  extrinsic: SubmittableExtrinsic<'promise'>;
  method: 'transferKeepAlive' | 'transferAllowDeath' | 'transfer';
  recipientEncoded: string;
  amountBN: BN;
  warnings: string[];
}
```

**Example:**
```typescript
import { buildSafeTransferExtrinsic } from '@dotbot/core';

const result = buildSafeTransferExtrinsic(
  api,
  {
    recipient: recipientAddress,
    amount: '10.5',
    keepAlive: true
  },
  capabilities
);

// result.extrinsic is ready to sign
// result.method tells you which method was selected
// result.warnings contains any important notices
```

---

#### `buildSafeBatchExtrinsic()`

```typescript
function buildSafeBatchExtrinsic(
  api: ApiPromise,
  params: SafeBatchTransferParams,
  capabilities: TransferCapabilities
): SafeExtrinsicResult
```

**Parameters:**
- `api`: Polkadot API instance
- `transfers`: Array of `{ recipient: string; amount: string | number | BN }`
- `capabilities`: TransferCapabilities from detectTransferCapabilities
- `useAtomicBatch` (optional, default true): Use utility.batchAll

**Returns:** SafeExtrinsicResult with single `utility.batchAll` extrinsic

**Example:**
```typescript
const result = buildSafeBatchExtrinsic(
  api,
  [
    { recipient: 'addr1', amount: '5' },
    { recipient: 'addr2', amount: '3' }
  ],
  capabilities,
  true
);
```

---

## ScenarioEngine API

**NEW** in v0.2.0: Testing and evaluation framework for DotBot. **Enhanced** with expression system and load-time validation.

### Overview

ScenarioEngine enables systematic testing of DotBot's LLM-driven behavior through the actual UI. It provides:

- **EntityCreator**: Creates deterministic test accounts
- **StateAllocator**: Sets up initial state (balances, on-chain, local storage)
- **ScenarioExecutor**: Executes scenarios through DotBot UI
- **Evaluator**: Evaluates results and generates LLM-consumable logs (uses ExpressionEvaluator for comparison/logical operators)
- **ExpressionEvaluator**: Evaluates comparison operators in expectations (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `between`, `matches`, `in`, `notIn`)
- **ExpressionValidator**: Validates expectations at scenario load time (circular references, nesting depth, invalid operators); integrated into `runScenario()` so invalid scenarios fail before execution

**Expression System:** Expectations support comparison operators in `expectedParams` (e.g. `amount: { gte: '0.1', lte: '10' }`) and logical operators (`all`, `any`, `not`, `when`/`then`/`else`). Existing scenarios remain valid (backward compatible). See `xx_scenario_engine/EXPRESSION_SYSTEM_EXAMPLES.md` and `QUICK_REFERENCE.md` for 20+ examples.

**Execution Modes:**
- `'synthetic'`: Fully mocked (fastest, for unit tests)
- `'emulated'`: Uses Chopsticks for realistic simulation (requires backend server, currently disabled)
- `'live'`: Real chain interaction (requires testnet)

---

### ScenarioEngine

Main orchestrator that coordinates all components.

```typescript
import { ScenarioEngine } from './lib/scenarioEngine';

const engine = new ScenarioEngine();
await engine.initialize();
```

#### `ScenarioEngine.initialize()`

Initialize the engine and all components.

```typescript
async initialize(): Promise<void>
```

**Example:**
```typescript
const engine = new ScenarioEngine();
await engine.initialize();
```

**Version Added:** v0.2.0 (January 2026)

---

#### `ScenarioEngine.runScenario()`

Run a single scenario.

```typescript
async runScenario(scenario: Scenario): Promise<ScenarioResult>
```

**Parameters:**
- `scenario` (Scenario): Complete scenario definition

**Returns:**
- `ScenarioResult`: Result with evaluation, score, and recommendations

**Validation:** Before execution, all scenario expectations are validated by ExpressionValidator (circular refs, max nesting depth, invalid comparison operators). Invalid scenarios throw with clear errors; warnings (e.g. type mismatches) are logged.

**Example:**
```typescript
const scenario: Scenario = {
  id: 'test-001',
  name: 'Happy Path Transfer',
  description: 'Basic transfer test',
  category: 'happy-path',
  steps: [
    { type: 'prompt', input: 'Send 5 DOT to Alice' }
  ],
  expectations: [
    { responseType: 'execution' },
    { shouldContain: ['transfer', 'Alice'] }
    // Expression system: e.g. { expectedParams: { amount: { between: ['0.1', '10'] } } }
  ]
};

const result = await engine.runScenario(scenario);
console.log(`Score: ${result.evaluation.score}/100`);
```

**Version Added:** v0.2.0 (January 2026). Expression system and ExpressionValidator: February 2026.

---

### EntityCreator

Creates deterministic test entities (keypairs, multisigs, proxies).

```typescript
import { createEntityCreator } from './lib/scenarioEngine';

const entityCreator = createEntityCreator('synthetic', {
  seedPrefix: 'test',
  ss58Format: 42, // Westend
});
```

#### `createEntityCreator()`

Factory function to create an EntityCreator instance.

```typescript
function createEntityCreator(
  mode: ScenarioMode,
  options?: Partial<EntityCreatorConfig>
): EntityCreator
```

**Parameters:**
- `mode` (ScenarioMode): Execution mode ('synthetic' | 'emulated' | 'live')
- `options.seedPrefix` (string, optional): Prefix for derivation paths. Default: 'scenario'
- `options.ss58Format` (number, optional): SS58 address format. Default: 42 (Substrate)

**Returns:**
- `EntityCreator`: Entity creator instance

**Example:**
```typescript
const entityCreator = createEntityCreator('synthetic', {
  seedPrefix: 'test',
  ss58Format: 42,
});

// Create deterministic keypair
const alice = await entityCreator.createKeypairEntity('Alice');
console.log(alice.address); // Same address every time

// Create multisig
const multisig = await entityCreator.createMultisigEntity('MyMultisig', {
  signatories: ['Alice', 'Bob'],
  threshold: 2,
});
```

**Version Added:** v0.2.0 (January 2026)

---

#### `EntityCreator.createKeypairEntity()`

Create a deterministic keypair entity.

```typescript
async createKeypairEntity(name: string): Promise<TestEntity>
```

**Parameters:**
- `name` (string): Entity name (used in derivation path)

**Returns:**
- `TestEntity`: Entity with address, keypair, mnemonic

**Note:** Same name + seedPrefix → same address (deterministic)

**Version Added:** v0.2.0 (January 2026)

---

#### `EntityCreator.createMultisigEntity()`

Create a deterministic multisig entity.

```typescript
async createMultisigEntity(
  name: string,
  config: { signatories: string[]; threshold: number }
): Promise<TestEntity>
```

**Parameters:**
- `name` (string): Entity name
- `config.signatories` (string[]): Signatory entity names
- `config.threshold` (number): Required signatures

**Returns:**
- `TestEntity`: Multisig entity with calculated address

**Version Added:** v0.2.0 (January 2026)

---

### StateAllocator

Sets up initial state for scenario execution.

```typescript
import { createStateAllocator } from './lib/scenarioEngine';

const allocator = createStateAllocator('emulated', 'westend', {
  entityResolver: (name) => entities.get(name),
  rpcManagerProvider: () => ({ relayChainManager, assetHubManager }),
});
```

#### `createStateAllocator()`

Factory function to create a StateAllocator instance.

```typescript
function createStateAllocator(
  mode: ScenarioMode,
  chain: ScenarioChain,
  config: StateAllocatorConfig
): StateAllocator
```

**Parameters:**
- `mode` (ScenarioMode): Execution mode
- `chain` (ScenarioChain): Target chain ('polkadot' | 'kusama' | 'westend' | 'asset-hub-polkadot' | 'asset-hub-westend')
- `config.entityResolver` (function): Resolves entity by name
- `config.rpcManagerProvider` (function, optional): Provides RPC managers for live/emulated modes

**Returns:**
- `StateAllocator`: State allocator instance

**Example:**
```typescript
const allocator = createStateAllocator('emulated', 'westend', {
  entityResolver: (name) => {
    if (name === 'Alice') return aliceEntity;
    if (name === 'Bob') return bobEntity;
    return undefined;
  },
  rpcManagerProvider: () => ({
    relayChainManager: westendRelayManager,
    assetHubManager: westendAssetHubManager,
  }),
});

await allocator.initialize();
await allocator.allocateBalance('Alice', '100 DOT');
await allocator.allocateLocalState({
  'chat-snapshot-123': JSON.stringify(chatSnapshot),
});
```

**Version Added:** v0.2.0 (January 2026)

---

#### `StateAllocator.allocateBalance()`

Allocate balance to an entity.

```typescript
async allocateBalance(
  entityName: string,
  amount: string
): Promise<AllocationResult>
```

**Parameters:**
- `entityName` (string): Entity name
- `amount` (string): Amount (e.g., '100 DOT', '50 WND')

**Returns:**
- `AllocationResult`: Result with success status, warnings, errors

**Mode Behavior:**
- **Synthetic**: Tracks in memory
- **Emulated**: Sets via Chopsticks `setStorage()` (requires backend server, currently disabled)
- **Live**: Creates real transfer transaction

**Version Added:** v0.2.0 (January 2026)

---

#### `StateAllocator.allocateLocalState()`

Set localStorage items.

```typescript
async allocateLocalState(
  items: Record<string, string>
): Promise<AllocationResult>
```

**Parameters:**
- `items` (Record<string, string>): Key-value pairs for localStorage

**Example:**
```typescript
await allocator.allocateLocalState({
  'chat-snapshot-123': JSON.stringify({
    chatId: '123',
    environment: 'testnet',
    messages: [...],
  }),
});
```

**Version Added:** v0.2.0 (January 2026)

---

### ScenarioExecutor

Executes scenarios through DotBot UI.

```typescript
import { createScenarioExecutor } from './lib/scenarioEngine';

const executor = createScenarioExecutor();
executor.setDependencies({
  api: relayApi,
  assetHubApi: assetHubApi,
  dotbot: dotbotInstance,
  getEntityAddress: (name) => entities.get(name)?.address,
});
```

#### `createScenarioExecutor()`

Factory function to create a ScenarioExecutor instance.

```typescript
function createScenarioExecutor(
  config?: Partial<ExecutorConfig>
): ScenarioExecutor
```

**Returns:**
- `ScenarioExecutor`: Executor instance

**Version Added:** v0.2.0 (January 2026)

---

#### `ScenarioExecutor.executeScenario()`

Execute a complete scenario.

```typescript
async executeScenario(scenario: Scenario): Promise<StepResult[]>
```

**Parameters:**
- `scenario` (Scenario): Scenario to execute

**Returns:**
- `StepResult[]`: Results for each step

**Events Emitted:**
- `inject-prompt`: When injecting prompt into UI
- `log`: Progress logs
- `step-complete`: When step completes

**Example:**
```typescript
executor.addEventListener((event) => {
  if (event.type === 'inject-prompt') {
    // Inject prompt into UI textarea
    const textarea = document.querySelector('textarea');
    textarea.value = event.prompt;
    textarea.dispatchEvent(new Event('input'));
  }
});

const results = await executor.executeScenario(scenario);
```

**Version Added:** v0.2.0 (January 2026)

---

### Evaluator

Evaluates scenario results against expectations.

```typescript
import { createEvaluator } from './lib/scenarioEngine';

const evaluator = createEvaluator({
  strictMode: false, // 70% threshold
});
```

#### `createEvaluator()`

Factory function to create an Evaluator instance.

```typescript
function createEvaluator(
  config?: Partial<EvaluatorConfig>
): Evaluator
```

**Parameters:**
- `config.strictMode` (boolean, optional): If true, requires 100% pass. Default: false (70% threshold)

**Returns:**
- `Evaluator`: Evaluator instance

**Version Added:** v0.2.0 (January 2026)

---

#### `Evaluator.evaluate()`

Evaluate scenario results.

```typescript
evaluate(
  scenario: Scenario,
  stepResults: StepResult[]
): EvaluationResult
```

**Parameters:**
- `scenario` (Scenario): Scenario definition
- `stepResults` (StepResult[]): Step execution results

**Returns:**
- `EvaluationResult`: Evaluation with score, expectations met, recommendations

**Events Emitted:**
- `log`: LLM-consumable evaluation logs (summary, breakdown, recommendations)

**Example:**
```typescript
evaluator.addEventListener((event) => {
  if (event.type === 'log') {
    console.log(event.message); // LLM-consumable format
  }
});

const result = evaluator.evaluate(scenario, stepResults);
console.log(`Score: ${result.score}/100`);
console.log(`Passed: ${result.passed}`);
```

**Version Added:** v0.2.0 (January 2026)

---

#### `Evaluator.generateReport()`

Generate detailed evaluation report.

```typescript
generateReport(
  scenario: Scenario,
  stepResults: StepResult[]
): EvaluationReport
```

**Returns:**
- `EvaluationReport`: Complete report with performance metrics, raw data

**Version Added:** v0.2.0 (January 2026)

---

### Scenario Types

#### `Scenario`

Complete test scenario definition.

```typescript
interface Scenario {
  id: string;
  name: string;
  description: string;
  category: ScenarioCategory;
  tags?: string[];
  environment?: ScenarioEnvironment; // Optional
  steps: ScenarioStep[];
  expectations: ScenarioExpectation[];
}
```

**Scenario Categories:**
- `'happy-path'`: Basic functionality
- `'adversarial'`: Prompt injection tests
- `'jailbreak'`: Advanced manipulation
- `'ambiguity'`: Clarification handling
- `'edge-case'`: Runtime limits
- `'context-awareness'`: Conversation context
- `'knowledge-base'`: Domain knowledge
- `'stress'`: Performance tests
- `'multi-step'`: Complex flows

**Version Added:** v0.2.0 (January 2026)

---

#### `ScenarioStep`

Individual step in a scenario.

```typescript
type ScenarioStep =
  | { type: 'prompt'; input: string; delayBefore?: number }
  | { type: 'action'; action: ScenarioAction }
  | { type: 'wait'; duration: number }
  | { type: 'assert'; assertion: ScenarioAssertion };
```

**Version Added:** v0.2.0 (January 2026)

---

#### `ScenarioExpectation`

What to verify in the response.

```typescript
interface ScenarioExpectation {
  responseType?: 'execution' | 'error' | 'clarification';
  shouldContain?: string[];
  shouldNotContain?: string[];
  shouldMention?: string[];
  shouldAskFor?: string[];
  shouldWarn?: string[];
  shouldReject?: boolean;
  expectedAgent?: string;
  customValidator?: string; // JavaScript code
  description?: string;
}
```

**Version Added:** v0.2.0 (January 2026)

---

## Examples

### Complete Transfer Example

```typescript
import { ApiPromise } from '@polkadot/api';
import { AssetTransferAgent } from '@dotbot/core';
import { Executioner } from './lib/executionEngine';
import { ExecutionArray } from './lib/executionEngine/executionArray';
import { BrowserWalletSigner } from './lib/executionEngine/signers';
import { RpcManager } from '@dotbot/core';

async function transferDot() {
  // 1. Setup RPC managers
  const relayManager = new RpcManager(['wss://rpc.polkadot.io']);
  const assetHubManager = new RpcManager(['wss://polkadot-asset-hub-rpc.polkadot.io']);
  
  // 2. Connect to chains
  const relayApi = await relayManager.getReadApi();
  const assetHubApi = await assetHubManager.getReadApi();
  
  // 3. Initialize agent
  const agent = new AssetTransferAgent();
  agent.initialize(
    relayApi,
    assetHubApi,
    (status) => console.log('Status:', status.message),
    relayManager,
    assetHubManager
  );
  
  // 4. Create transfer
  const result = await agent.transfer({
    address: userAddress,
    recipient: recipientAddress,
    amount: '10',
    chain: 'assetHub',
    keepAlive: true
  });
  
  console.log('Transfer created:', result.description);
  console.log('Estimated fee:', result.estimatedFee);
  
  // 5. Execute
  const executionArray = new ExecutionArray();
  executionArray.addItem(result);
  
  const signer = new BrowserWalletSigner(injector);
  const executioner = new Executioner();
  executioner.initialize(
    relayApi,
    { address: userAddress, name: 'User' },
    signer,
    assetHubApi,
    relayManager,
    assetHubManager
  );
  
  await executioner.execute(executionArray);
  
  // 6. Check result
  const item = executionArray.getItems()[0];
  if (item.result?.success) {
    console.log('Transfer successful!');
    console.log('Block hash:', item.result.blockHash);
    console.log('Tx hash:', item.result.txHash);
  } else {
    console.error('Transfer failed:', item.result?.error);
  }
  
  // 7. Cleanup
  await relayManager.disconnect();
  await assetHubManager.disconnect();
}
```

---

### Batch Transfer Example

```typescript
async function batchTransfer() {
  // Setup (same as above)
  // ...
  
  const result = await agent.batchTransfer({
    address: userAddress,
    transfers: [
      { recipient: 'addr1', amount: '5' },
      { recipient: 'addr2', amount: '3' },
      { recipient: 'addr3', amount: '2' },
    ],
    chain: 'assetHub',
    keepAlive: true
  });
  
  console.log(result.description);
  // "Batch transfer: 3 transfers totaling 10 DOT"
  
  // Execute (same as above)
  // ...
}
```

---

### Custom Agent Example

```typescript
import { BaseAgent } from '@dotbot/core';
import type { AgentResult } from '@dotbot/core';
// For AgentError when building agents inside the repo: import { AgentError } from './agents/types';

export class CustomAgent extends BaseAgent {
  getAgentName(): string {
    return 'CustomAgent';
  }
  
  async customOperation(params: CustomParams): Promise<AgentResult> {
    this.ensureInitialized();
    
    try {
      // 1. Validate
      const validation = this.validateAddress(params.address);
      if (!validation.valid) {
        throw new Error(validation.errors.join(', '));
      }
      
      // 2. Get API
      const api = this.getApi();
      
      // 3. Create extrinsic
      const extrinsic = api.tx.system.remark('Hello from CustomAgent!');
      
      // 4. Optional: Simulate (via backend server)
      const dryRunResult = await this.dryRunExtrinsic(
        api,
        extrinsic,
        params.address
      );
      
      if (!dryRunResult.success) {
        throw new Error(dryRunResult.error ?? 'Dry run failed');
      }
      
      // 5. Return result
      return this.createResult(
        'Custom operation',
        extrinsic,
        {
          estimatedFee: dryRunResult.estimatedFee,
          warnings: []
        }
      );
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error(error instanceof Error ? error.message : 'Unknown error');
    }
  }
}
```

---

### Simulation Configuration

Simulation can be enabled/disabled via `SettingsManager`. Configuration persists to localStorage.

**Backend Requirement:** Simulation requires the backend server (`@dotbot/express`) to be running with Chopsticks support. The client makes HTTP requests to `/api/simulation` endpoints.

**API:**
```typescript
import { 
  getSimulationConfig, 
  updateSimulationConfig, 
  isSimulationEnabled,
  enableSimulation,
  disableSimulation
} from './lib/services/settingsManager';
// Or convenience re-export:
// import { ... } from './lib/executionEngine/simulation/simulationConfig';

// Check if simulation is enabled
const enabled = isSimulationEnabled(); // boolean

// Get full config
const config = getSimulationConfig();
// { enabled: true, timeout: 120000 }

// Update config
updateSimulationConfig({ enabled: false });

// Convenience methods
enableSimulation();
disableSimulation();
```

**Default:** `enabled: true` (simulation enabled by default)

**UI Control:** SettingsModal provides toggle for simulation enable/disable.

**Version Added:** v0.2.1 (January 2026)

---

### Simulation Status Tracking

**Note:** Simulation is optional and requires the backend server to be running. Status callbacks are only invoked when simulation is enabled. Use `isSimulationEnabled()` to check current state. If the backend server is unavailable, simulation will fail gracefully with an error message.

```typescript
agent.initialize(
  relayApi,
  assetHubApi,
  (status) => {
    // Only called when simulation is enabled
    console.log(`[${status.phase}] ${status.message}`);
    
    if (status.progress !== undefined) {
      console.log(`Progress: ${status.progress}%`);
    }
    
    if (status.result) {
      console.log('Simulation result:', status.result);
    }
  }
);
```

**Status phases:**
- `'starting'` - Simulation starting
- `'initializing'` - Connecting to simulation server (backend)
- `'forking'` - Getting current blockchain state
- `'executing'` - Simulating transaction on backend server
- `'complete'` - Simulation successful
- `'error'` - Simulation failed (backend error or unavailable)

**When simulation is disabled:**
- Status callback is never invoked
- Execution items start with `'ready'` status (not `'pending'`)
- Execution proceeds directly to signing phase

---

## Error Handling

### Error Types

**AgentError**
```typescript
class AgentError extends Error {
  code: string;
  details?: any;
}
```

**Common error codes:**
- `NOT_INITIALIZED` - Agent not initialized
- `INVALID_ADDRESS` - Invalid address format
- `INSUFFICIENT_BALANCE` - Not enough funds
- `BELOW_EXISTENTIAL_DEPOSIT` - Would leave account below ED
- `CAPABILITY_NOT_SUPPORTED` - Runtime missing required method
- `SIMULATION_FAILED` - Chopsticks simulation failed (backend server error or unavailable)
- `ASSET_HUB_NOT_AVAILABLE` - Asset Hub API not connected
- `API_CHAIN_MISMATCH` - API connected to wrong chain

**Example:**
```typescript
try {
  const result = await agent.transfer(params);
} catch (error) {
  if (error instanceof AgentError) {
    switch (error.code) {
      case 'INSUFFICIENT_BALANCE':
        console.error('Not enough DOT:', error.message);
        break;
      case 'INVALID_ADDRESS':
        console.error('Address is invalid:', error.message);
        break;
      default:
        console.error('Agent error:', error.code, error.message);
    }
  } else {
    console.error('Unknown error:', error);
  }
}
```

---

### Validation Errors

```typescript
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const validation = agent.validateAddress(address);
if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
}
if (validation.warnings.length > 0) {
  console.warn('Validation warnings:', validation.warnings);
}
```

---

## TypeScript Types

### Core Types

```typescript
// Agent result
interface AgentResult {
  description: string;
  extrinsic?: SubmittableExtrinsic<'promise'>;
  estimatedFee?: string;
  warnings?: string[];
  metadata?: Record<string, any>;
  data?: any;
  resultType: 'extrinsic' | 'data' | 'mixed' | 'confirmation';
  requiresConfirmation: boolean;
  executionType: 'extrinsic' | 'data_fetch' | 'validation' | 'user_input';
}

// Execution item
interface ExecutionItem {
  id: string;
  index: number;
  agentResult: AgentResult;
  status: ExecutionStatus;
  result?: ExecutionResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

// Execution status
type ExecutionStatus =
  | 'pending'      // Waiting for simulation (only when simulation enabled)
  | 'ready'        // Ready for signing (initial status when simulation disabled, or after simulation passes)
  | 'executing'    // Currently executing
  | 'signing'      // User is signing transaction
  | 'broadcasting' // Transaction being broadcast to network
  | 'in_block'     // Transaction included in block
  | 'finalized'    // Transaction finalized
  | 'completed'    // Operation completed successfully
  | 'failed'       // Operation failed
  | 'cancelled';   // User cancelled operation

// Note: Initial status depends on simulation setting:
// - When simulation enabled: Items start as 'pending' (will be simulated)
// - When simulation disabled: Items start as 'ready' (ready for signing)

// Execution result
interface ExecutionResult {
  success: boolean;
  blockHash?: string;
  txHash?: string;
  events?: any[];
  error?: string;
  errorCode?: string;
}

// Balance info
interface BalanceInfo {
  free: string;      // Free balance (Planck)
  reserved: string;  // Reserved balance (Planck)
  frozen: string;    // Frozen balance (Planck)
  available: string; // Available = free - frozen (Planck)
}

// Wallet account
interface WalletAccount {
  address: string;
  name?: string;
  source?: string;
}

// Signer interface
interface Signer {
  sign(
    extrinsic: SubmittableExtrinsic<'promise'>,
    address: string
  ): Promise<Uint8Array>;
}
```

---

## Best Practices

### 1. Always Initialize Agents

```typescript
// ✅ Good
agent.initialize(api, assetHubApi);
const result = await agent.transfer(params);

// ❌ Bad
const result = await agent.transfer(params);
// Throws: NOT_INITIALIZED
```

### 2. Explicit Chain Selection

```typescript
// ✅ Good - Explicit chain
await agent.transfer({
  address,  // sender (from BaseAgentParams)
  recipient,
  amount: '10',
  chain: 'assetHub'  // Clear intent
});

// ❌ Bad - Would require chain parameter
```

### 3. Handle Errors Gracefully

```typescript
try {
  const result = await agent.transfer(params);
  await executioner.execute(result);
} catch (error) {
  if (error instanceof AgentError) {
    // Show user-friendly message
    showErrorToUser(error.message);
  } else {
    // Log unexpected error
    console.error('Unexpected error:', error);
  }
}
```

### 4. Use RpcManager

```typescript
// ✅ Good - Automatic failover
const manager = new RpcManager([
  'wss://rpc1.example.com',
  'wss://rpc2.example.com'
]);
const api = await manager.getReadApi();

// ❌ Bad - Single point of failure
const api = await ApiPromise.create({
  provider: new WsProvider('wss://rpc1.example.com')
});
```

### 5. Cleanup Resources

```typescript
// Always disconnect when done
try {
  // ... do work ...
} finally {
  await relayManager.disconnect();
  await assetHubManager.disconnect();
}
```

### 6. Validate Before Executing

```typescript
// Agents automatically validate, but you can double-check
const balance = await agent.getBalance(sender);
const required = new BN('10000000000'); // 1 DOT in Planck

if (new BN(balance.available).lt(required)) {
  throw new Error('Insufficient balance');
}
```

---

## Breaking Changes

### v0.2.0 (January 2026)

**⚠️ IMPORTANT:** These changes require code updates. See migration guide below.

**Removed Methods:**
- ⚠️ **`DotBot.executeWithArrayTracking(plan, options)`** - Removed in v0.2.0
  - **Replacement**: Use `prepareExecution(plan)` + `startExecution(executionId)` instead
  - **Reason**: Two-step execution pattern provides better UX and safety
  
- ⚠️ **`DotBot.onExecutionArrayUpdate(callback)`** - Removed in v0.2.0
  - **Replacement**: Use `dotbot.currentChat.onExecutionUpdate(executionId, callback)` instead
  - **Reason**: Execution state now belongs to ChatInstance, not DotBot
  
- ⚠️ **`DotBot.currentExecutionArray`** (property) - Removed in v0.2.0
  - **Replacement**: Use `dotbot.currentChat.getExecutionArray(executionId)` instead
  - **Reason**: Multiple execution flows per conversation, each with unique ID

**Changed Behavior:**
- ⚠️ **`DotBot.chat()`** - No longer auto-executes. Returns `executed: false`. User must approve via `startExecution()`.
- ⚠️ **Type Renames:**
  - `ChatMessage` → `ConversationItem` (union type for all conversation elements)
  - `ChatInstance` (interface) → `ChatInstanceData` (data structure)
  - `ChatInstance` is now a class (not an interface)

**Migration Guide:**

**Before (v0.1.0):**
```typescript
// Auto-execution
const result = await dotbot.chat("Send 2 DOT to Alice");
// Execution happens automatically

// Execution tracking
dotbot.onExecutionArrayUpdate((state) => {
  console.log('Progress:', state);
});

// Access execution
const array = dotbot.currentExecutionArray;
```

**After (v0.2.0):**
```typescript
// Two-step execution
const result = await dotbot.chat("Send 2 DOT to Alice");
// result.executed = false (user must approve)

// Get execution message
const messages = dotbot.currentChat.getDisplayMessages();
const execMessage = messages.find(m => m.type === 'execution');

// User clicks "Accept & Start" → execute
await dotbot.startExecution(execMessage.executionId);

// Execution tracking
dotbot.currentChat.onExecutionUpdate(execMessage.executionId, (state) => {
  console.log('Progress:', state);
});

// Access execution
const array = dotbot.currentChat.getExecutionArray(execMessage.executionId);
```

---

## Version History

### v0.2.0 (January 2026)

**Breaking Changes:**
- Removed `executeWithArrayTracking()`, `onExecutionArrayUpdate()`, `currentExecutionArray`
- `chat()` no longer auto-executes (requires user approval)
- Type renames: `ChatMessage` → `ConversationItem`, `ChatInstance` interface → `ChatInstanceData`

**New Features:**
- Environment system (mainnet/testnet) with environment-bound chat instances
- Two-step execution pattern (`prepareExecution()` + `startExecution()`)
- ChatInstance class with full lifecycle management
- ChatInstanceManager for CRUD operations
- DataManager for GDPR compliance
- Storage abstraction layer (IChatStorage)
- Optional simulation with status-aware initialization
- UI components: EnvironmentBadge, EnvironmentSwitch, ChatHistory
- useDebounce hook for Connect button
- Message component with avatar, name, date structure
- Multiple execution flows per conversation
- Execution flow rebuild and resume capability
- ScenarioEngine testing framework (EntityCreator, StateAllocator, ScenarioExecutor, Evaluator)

**Improvements:**
- Better developer UX (DotBot manages ChatInstanceManager internally)
- Clearer separation of concerns
- Environment isolation prevents cross-environment operations
- User approval required before execution (safer)

### v0.1.0 (January 2026)

**Breaking Changes:**
- Agent must create extrinsics (not just metadata)
- `chain` parameter required for transfers
- Removed balance-based chain inference

**New Features:**
- Production-safe extrinsic building
- Runtime capability detection
- Chopsticks simulation integration (frontend-embedded)
- Pluggable signer architecture
- Multi-endpoint RPC management

**Bug Fixes:**
- Fixed registry mismatches
- Fixed SS58 address encoding
- Fixed existential deposit validation

---

### v0.2.1 (January 2026)

**New Features:**
- SettingsManager for centralized configuration management
- Simulation configuration with UI toggle (SettingsModal)
- Sequential multi-transaction simulation (transactions see state from previous transactions)
- ExecutionFlow appears immediately when ExecutionMessage is added (before simulation)

**Improvements:**
- All components use `isSimulationEnabled()` for consistent simulation state checking
- Settings persist across sessions via localStorage
- Better multi-transaction flow support with state tracking

---

### v0.2.2 (January 2026)

**Architecture Changes:**
- ⚠️ **Chopsticks moved to backend**: Refactored from frontend-embedded to client-server architecture
- **Removed**: `@acala-network/chopsticks-core` dependency from `@dotbot/core`
- **Added**: `@acala-network/chopsticks-core` dependency to `@dotbot/express`
- **Client Interface**: `@dotbot/core` now provides client interface that makes HTTP requests to backend
- **Backend Implementation**: All Chopsticks simulation logic moved to `@dotbot/express` server

**Benefits:**
- No frontend bundling issues (Chopsticks never touches the browser)
- Clean separation of concerns (client vs server)
- Better performance (server handles heavy simulation workloads)
- Easier maintenance (all Chopsticks code in one place)

**Breaking Changes:**
- ⚠️ **Backend server required**: Simulation now requires backend server (`@dotbot/express`) to be running
- ⚠️ **Emulated mode disabled**: StateAllocator emulated mode temporarily disabled (requires server-side implementation)

**New Backend Endpoints:**
- `POST /api/simulation/simulate` - Single transaction simulation
- `POST /api/simulation/simulate-sequential` - Sequential multi-transaction simulation

**Migration:**
- No code changes required for frontend users
- Backend must have `@acala-network/chopsticks-core` installed
- Backend must mount simulation routes at `/api/simulation`

---

**Last Updated**: January 2026

**Questions?** Check [ARCHITECTURE.md](./ARCHITECTURE.md) for design rationale, or open a GitHub issue.

