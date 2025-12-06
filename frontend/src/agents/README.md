# Agents (Extrinsic Builders)

These modules create Polkadot extrinsics. They're called "agents"
because:
1. The LLM system prompt treats them as autonomous units
2. Future architecture may migrate to true multi-agent system
3. Conceptually, each is responsible for a domain

**Current**: TypeScript classes using Polkadot.js  
**Future**: Could be AgentVerse agents in Python backend (architecture kept open)

## Structure

Each agent is a TypeScript class that:
- Extends `BaseAgent` for common functionality
- Builds Polkadot extrinsics for specific operations
- Validates parameters and handles errors
- Returns standardized `AgentResult` objects
- Can be called by the LLM through the Execution Array system

## Standardized Agent Interface

All agents follow a standardized structure:

1. **BaseAgent**: Provides common utilities:
   - Address validation
   - Balance checking
   - Fee estimation
   - Amount formatting/parsing
   - Standardized result creation

2. **AgentResult**: Standardized return type:
   - `extrinsic`: The Polkadot extrinsic (if applicable)
   - `description`: Human-readable description
   - `estimatedFee`: Transaction fee estimate
   - `warnings`: Important warnings
   - `metadata`: Additional data
   - `resultType`: 'extrinsic' | 'data' | 'mixed' | 'confirmation'
   - `requiresConfirmation`: Whether user approval is needed
   - `executionType`: For Execution Array system

3. **Error Handling**: All agents use `AgentError` for consistent error reporting

## Agent Registry

All agents are registered in two places:
- `frontend/src/agents/index.ts`: Runtime registry for creating agent instances
- `frontend/src/prompts/system/agents/index.ts`: System prompt registry for LLM

## Adding a New Agent

1. Create a new directory under `frontend/src/agents/` (e.g., `staking/`)
2. Create `types.ts` with parameter interfaces extending `BaseAgentParams`
3. Create `extrinsics/` directory with extrinsic builder functions
4. Implement the agent class extending `BaseAgent`:
   - Implement `getAgentName()` method
   - Implement agent-specific methods (e.g., `transfer()`, `stake()`, etc.)
   - Use `this.createResult()` for standardized return values
   - Use `this.validateAddress()`, `this.getBalance()`, etc. from BaseAgent
5. Export the agent in the directory's `index.ts`
6. Register it in `frontend/src/agents/index.ts`
7. Create agent definition in `frontend/src/prompts/system/agents/[agent-name].ts`
8. Add the definition to `frontend/src/prompts/system/agents/index.ts`

## Example: Asset Transfer Agent

See `asset-transfer/` for a complete example:
- `agent.ts`: Main agent class with `transfer()` and `batchTransfer()` methods
- `types.ts`: Parameter types
- `extrinsics/`: Extrinsic builders for different transfer types
- Registered in both registries
- Full agent definition for system prompt

