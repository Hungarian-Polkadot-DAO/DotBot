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
- Builds Polkadot extrinsics for specific operations
- Validates parameters
- Returns extrinsic objects ready for signing
- Can be called by the LLM through the Execution Array system

## Agent Registry

All agents are registered in `index.ts` and exposed to the system prompt
generator, which makes them available to the LLM.

## Adding a New Agent

1. Create a new directory under `frontend/src/agents/`
2. Implement the agent class extending `BaseAgent` (optional)
3. Create extrinsic builder functions in `extrinsics/`
4. Export the agent in the directory's `index.ts`
5. Register it in `frontend/src/agents/index.ts`
6. Add agent definition to `frontend/src/prompts/system/agents/`

