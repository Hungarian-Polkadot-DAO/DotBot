/**
 * System Prompt Loader
 * 
 * This module loads and assembles the complete system prompt
 * from all the modular components.
 */

import { BASE_SYSTEM_PROMPT } from './base';
import { buildAgentRegistry } from './agents';
import { EXECUTION_ARRAY_INSTRUCTIONS } from './execution/instructions';
import { SystemContext } from './context/types';
import { createVersionedPrompt } from './version';
import { formatPolkadotKnowledgeBase } from './knowledge/dotKnowledge';
import { formatKnowledgeBaseForNetwork } from './knowledge';
import { getNetworkDecimals } from './knowledge/networkUtils';
import { isSimulationEnabled } from '../../executionEngine/simulation/simulationConfig';

/**
 * Format agent definitions for inclusion in system prompt
 */
function formatAgentDefinitions(): string {
  const registry = buildAgentRegistry();
  
  if (registry.agents.length === 0) {
    return '\n## Available Agents\n\nNo agents are currently registered.';
  }
  
  let prompt = '\n## Available Agents\n\n';
  
  // Add temporary limitation note when only AssetTransferAgent is available
  if (registry.agents.length === 1 && registry.agents[0].className === 'AssetTransferAgent') {
    prompt += `> **Current Capabilities (Temporary)**: At this time, only the **AssetTransferAgent** is available for blockchain operations. This agent handles asset transfers on **Asset Hub** (the primary location for DOT after Polkadot 2.0 migration). Additional agents for staking, governance, and other operations will be available in future updates.\n\n`;
  }
  
  registry.agents.forEach(agent => {
    prompt += `### ${agent.displayName} (${agent.className})\n\n`;
    prompt += `**Purpose**: ${agent.purpose}\n\n`;
    prompt += `**Description**: ${agent.description}\n\n`;
    
    if (agent.useCases.length > 0) {
      prompt += `**Use Cases**:\n`;
      agent.useCases.forEach(useCase => {
        prompt += `- ${useCase}\n`;
      });
      prompt += '\n';
    }
    
    if (agent.prerequisites && agent.prerequisites.length > 0) {
      prompt += `**Prerequisites**:\n`;
      agent.prerequisites.forEach(prereq => {
        prompt += `- ${prereq}\n`;
      });
      prompt += '\n';
    }
    
    if (agent.limitations && agent.limitations.length > 0) {
      prompt += `**Limitations**:\n`;
      agent.limitations.forEach(limitation => {
        prompt += `- ⚠️ ${limitation}\n`;
      });
      prompt += '\n';
    }
    
    if (agent.dependencies && agent.dependencies.length > 0) {
      prompt += `**Dependencies**: Requires ${agent.dependencies.join(', ')}\n\n`;
    }
    
    if (agent.compatibleAgents && agent.compatibleAgents.length > 0) {
      prompt += `**Works well with**: ${agent.compatibleAgents.join(', ')}\n\n`;
    }
    
    if (agent.categories && agent.categories.length > 0) {
      prompt += `**Categories**: ${agent.categories.join(', ')}\n\n`;
    }
    
    prompt += `**Available Functions**:\n\n`;
    
    agent.functions.forEach(fn => {
      prompt += `#### ${fn.name}()\n\n`;
      prompt += `${fn.description}\n\n`;
      
      if (fn.detailedDescription) {
        prompt += `${fn.detailedDescription}\n\n`;
      }
      
      if (fn.parameters.length > 0) {
        prompt += `**Parameters**:\n`;
        fn.parameters.forEach(param => {
          const required = param.required ? '(required)' : '(optional)';
          prompt += `- \`${param.name}\` (${param.type}) ${required}: ${param.description}\n`;
          if (param.examples && param.examples.length > 0) {
            prompt += `  Examples: ${param.examples.join(', ')}\n`;
          }
          if (param.constraints) {
            prompt += `  Constraints: ${param.constraints}\n`;
          }
        });
        prompt += '\n';
      }
      
      prompt += `**Returns**: ${fn.returns.type} - ${fn.returns.description}\n\n`;
      
      if (fn.requiresConfirmation) {
        prompt += `⚠️ **Requires user confirmation before execution**\n\n`;
      }
      
      if (fn.examples && fn.examples.length > 0) {
        prompt += `**Examples**:\n`;
        fn.examples.forEach(example => {
          prompt += `- ${example}\n`;
        });
        prompt += '\n';
      }
      
      if (fn.relatedFunctions && fn.relatedFunctions.length > 0) {
        prompt += `**Related Functions**: ${fn.relatedFunctions.join(', ')}\n\n`;
      }
    });
    
    prompt += '\n---\n\n';
  });
  
  return prompt;
}

/**
 * Convert Planck to human-readable format with correct decimals
 * 
 * CRITICAL: Different networks have different decimals:
 * - Polkadot: 10 decimals (DOT)
 * - Kusama: 12 decimals (KSM)
 * - Westend: 12 decimals (WND)
 * - Asset Hub (all networks): Uses the network's native token decimals
 * 
 * @param planck Balance in Planck (as string or number)
 * @param decimals Number of decimals for the token (default: 10 for DOT)
 * @param tokenSymbol Optional token symbol for display
 * @returns Balance as a formatted string
 */
function formatPlanckToDot(planck: string | number, decimals = 10, _tokenSymbol?: string): string {
  // Convert planck to BigInt (works for both string and number)
  const planckBigInt = BigInt(planck);
  
  // Calculate divisor: 10^decimals
  // Use a more compatible approach for BigInt exponentiation
  let divisor = BigInt(1);
  for (let i = 0; i < decimals; i++) {
    divisor = divisor * BigInt(10);
  }
  
  // Convert to human-readable format
  const whole = planckBigInt / divisor;
  const remainder = planckBigInt % divisor;
  
  // Format with appropriate decimal places (remove trailing zeros)
  const decimalPart = remainder.toString().padStart(decimals, '0');
  const significantDecimals = decimalPart.replace(/0+$/, '');
  
  if (significantDecimals) {
    return `${whole}.${significantDecimals}`;
  }
  return whole.toString();
}

/**
 * Format context information for inclusion in system prompt
 */
function formatContext(context?: SystemContext): string {
  if (!context) {
    return '\n## Current Context\n\nNo context information available.';
  }
  
  let prompt = '\n## Current Context\n\n';
  
  // Wallet context
  if (context.wallet.isConnected && context.wallet.address) {
    prompt += `**Wallet**: Connected (${context.wallet.address})\n`;
    if (context.wallet.provider) {
      prompt += `**Provider**: ${context.wallet.provider}\n`;
    }
  } else {
    prompt += `**Wallet**: Not connected\n`;
  }
  
  // Network context
  prompt += `**Network**: ${context.network.network}\n`;
  
  // Balance context
  if (context.balance) {
    // Get decimals from context (from API registry) or fallback to network defaults
    // Prefer API registry values as they're always correct for the actual chain
    const relayChainDecimals = context.network.relayChainDecimals ?? getNetworkDecimals(context.network.network);
    const assetHubDecimals = context.network.assetHubDecimals ?? relayChainDecimals;
    
    // Convert total balance from Planck to native token units (use relay chain decimals for total)
    const totalDot = formatPlanckToDot(context.balance.total, relayChainDecimals);
    prompt += `**Total Balance**: ${totalDot} ${context.balance.symbol}\n\n`;
    
    // Relay Chain balance (convert from Planck to native token units)
    prompt += `**Relay Chain** (${context.network.rpcEndpoint || 'Connected'}):\n`;
    const relayFreeDot = formatPlanckToDot(context.balance.relayChain.free, relayChainDecimals);
    prompt += `  - Free: ${relayFreeDot} ${context.balance.symbol}\n`;
    if (context.balance.relayChain.reserved !== '0') {
      const relayReservedDot = formatPlanckToDot(context.balance.relayChain.reserved, relayChainDecimals);
      prompt += `  - Reserved: ${relayReservedDot} ${context.balance.symbol}\n`;
    }
    
    // Asset Hub balance (convert from Planck to native token units)
    // Use Asset Hub decimals if available (may differ from relay chain)
    if (context.balance.assetHub) {
      prompt += `\n**Asset Hub** (Connected):\n`;
      const assetHubFreeDot = formatPlanckToDot(context.balance.assetHub.free, assetHubDecimals);
      prompt += `  - Free: ${assetHubFreeDot} ${context.balance.symbol}\n`;
      if (context.balance.assetHub.reserved !== '0') {
        const assetHubReservedDot = formatPlanckToDot(context.balance.assetHub.reserved, assetHubDecimals);
        prompt += `  - Reserved: ${assetHubReservedDot} ${context.balance.symbol}\n`;
      }
    } else {
      prompt += `\n**Asset Hub**: Not connected (balance not available)\n`;
    }
    
    prompt += `\n**CRITICAL**: All balance values above are in ${context.balance.symbol} denomination. NEVER show Planck values to users.\n`;
    prompt += `**CRITICAL**: When displaying balances to users, ALWAYS use ${context.balance.symbol} (not Planck). Example: "12.5 ${context.balance.symbol}" not raw Planck values.\n`;
    prompt += `\n**TRANSFERS DEFAULT TO ASSET HUB.**\n`;
    prompt += `- Unless the user explicitly says "on Relay Chain" or "relay", assume Asset Hub.\n`;
    prompt += `- Asset Hub transfers use Asset Hub balance for fees (Relay Chain balance is NOT needed).\n`;
    prompt += `- Do NOT refuse a transfer or say "insufficient Relay Chain balance" when the user has Asset Hub balance. Generate the ExecutionPlan with targetChain: "assetHub".\n`;
    prompt += `- Only use Relay Chain (targetChain: "relay") if the user explicitly requests it. Do not infer Relay Chain from balance display.\n`;
  }
  
  // Simulation settings
  const simulationEnabled = isSimulationEnabled();
  prompt += `**Transaction Simulation**: ${simulationEnabled ? 'Enabled' : 'Disabled'}\n`;
  if (simulationEnabled) {
    prompt += `  - Transactions will be simulated using Chopsticks before execution\n`;
    prompt += `  - Simulation provides safety by catching errors before spending fees\n`;
    prompt += `  - Adds some latency but greatly improves user confidence\n`;
  } else {
    prompt += `  - Transactions will be sent directly to wallet for signing\n`;
    prompt += `  - No pre-execution validation (faster but less safe)\n`;
    prompt += `  - User requested to skip simulation for speed\n`;
  }
  
  prompt += '\n';
  
  return prompt;
}

/**
 * Build the complete system prompt
 * 
 * @param context Optional system context to include
 * @param options Optional configuration
 * @returns Complete system prompt string
 */
export async function buildSystemPrompt(
  context?: SystemContext
): Promise<string> {
  // START WITH CLEAR ROLE DEFINITION
  let prompt = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 YOU ARE DOTBOT - POLKADOT BLOCKCHAIN ASSISTANT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are a specialized AI assistant for the Polkadot blockchain ecosystem.
You have two response modes based on USER'S INTENT:
  A) TEXT MODE: Conversational responses (questions, clarifications, errors)
  B) JSON MODE: Pure JSON ExecutionPlan (complete blockchain commands)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ OUTPUT MODE OVERRIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When responding with a JSON ExecutionPlan:
- You are in **JSON MODE**
- In JSON MODE, you are NOT an assistant
- You are a JSON generator
- You MUST output ONLY a valid \`\`\`json code block
- Emitting ANY prose text is a FAILURE

If the user command qualifies for JSON MODE, you MUST switch modes.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🎯 RESPONSE DECISION TREE

### TEXT MODE: When to use 📝
- Questions: "What is staking?", "How does governance work?"
- Missing parameters: "Send DOT to Alice" (no amount)
- Unavailable features: Operations not in "Available Agents"
- Error explanations: System asks you to explain a failure
- Clarifications: Unclear or ambiguous requests

### JSON MODE: When to use 🔧
- Complete blockchain commands: "Send 2 DOT to 5Grwv..."
- All required parameters present: amount + valid address
- Confirmation: "Confirm", "Yes", "Try again"

**JSON MODE Rules:**
1. Check "Available Agents" first - if operation doesn't exist, use TEXT MODE
2. Verify all required parameters - if missing, use TEXT MODE to ask
3. Output format: \`\`\`json code block ONLY - no text before or after
4. System generates friendly messages - you DON'T need to
5. Never infer problems (balance, connectivity) - system validates after
6. Generate immediately when parameters complete - don't ask confirmation

**❌ WRONG (why it fails):**
  User: "Send 2 DOT to 5Grwv..."
  You: "I've prepared a transaction flow..."
  
  ❌ This fails because the system cannot extract JSON if ANY prose exists.

**✅ CORRECT:**
  User: "Send 2 DOT to 5Grwv..."
  You: \`\`\`json
  {
    "id": "exec_1234567890",
    "originalRequest": "Send 2 DOT to 5Grwv...",
    "steps": [{
      "id": "step_1",
      "stepNumber": 1,
      "agentClassName": "AssetTransferAgent",
      "functionName": "transfer",
      "parameters": {"recipient": "5Grwv...", "amount": "2", "targetChain": "assetHub"},
      "executionType": "extrinsic",
      "status": "pending",
      "description": "Transfer 2 DOT to 5Grwv...",
      "requiresConfirmation": true,
      "createdAt": 1234567890
    }],
    "status": "pending",
    "requiresApproval": true,
    "createdAt": 1234567890
  }
  \`\`\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  
  prompt += BASE_SYSTEM_PROMPT;
  
  // Add context information
  prompt += formatContext(context);
  
  // Add Knowledge Base (network-specific)
  if (context?.network?.network) {
    prompt += formatKnowledgeBaseForNetwork(context.network.network);
  } else {
  prompt += formatPolkadotKnowledgeBase();
  }
  
  // Add agent definitions
  prompt += formatAgentDefinitions();
  
  // Add execution array instructions
  prompt += '\n';
  prompt += EXECUTION_ARRAY_INSTRUCTIONS;
  
  // Add final instructions
  prompt += `\n\n## 🔧 ExecutionPlan JSON Structure

\`\`\`json
{
  "id": "exec_<timestamp_ms>",
  "originalRequest": "<user request>",
  "steps": [{
    "id": "step_1",
    "stepNumber": 1,
    "agentClassName": "<AgentClassName>",
    "functionName": "<functionName>",
    "parameters": {"amount": "2", "recipient": "5Grwv..."},
    "executionType": "extrinsic",
    "status": "pending",
    "description": "Human-readable description",
    "requiresConfirmation": true,
    "createdAt": <timestamp_ms>
  }],
  "status": "pending",
  "requiresApproval": true,
  "createdAt": <timestamp_ms>
}
\`\`\`

**Key fields:**
- \`id\`: "exec_" + current timestamp (ms)
- \`agentClassName\`: Exact name from Available Agents
- \`parameters.amount\`: Human-readable (e.g., "2", not "2000000000000")
- \`executionType\`: "extrinsic" (transactions), "data_fetch" (queries), "validation" (checks)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 FINAL CHECK BEFORE RESPONDING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If you are about to generate an ExecutionPlan:
  STOP.
  DELETE any prose.
  OUTPUT ONLY the \`\`\`json block.

Mode check:
- TEXT MODE → questions, missing params, errors, unavailable features
- JSON MODE → complete commands with all required parameters

Remember: In JSON MODE, you are a JSON generator, NOT an assistant.`;

  return prompt;
}

/**
 * Build system prompt synchronously
 * 
 * @param context Optional system context to include
 * @returns Complete system prompt string
 */
export function buildSystemPromptSync(context?: SystemContext): string {
  // START WITH CLEAR ROLE DEFINITION
  let prompt = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 YOU ARE DOTBOT - POLKADOT BLOCKCHAIN ASSISTANT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are a specialized AI assistant for the Polkadot blockchain ecosystem.
You have two response modes based on USER'S INTENT:
  A) TEXT MODE: Conversational responses (questions, clarifications, errors)
  B) JSON MODE: Pure JSON ExecutionPlan (complete blockchain commands)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ OUTPUT MODE OVERRIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When responding with a JSON ExecutionPlan:
- You are in **JSON MODE**
- In JSON MODE, you are NOT an assistant
- You are a JSON generator
- You MUST output ONLY a valid \`\`\`json code block
- Emitting ANY prose text is a FAILURE

If the user command qualifies for JSON MODE, you MUST switch modes.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🎯 RESPONSE DECISION TREE

### TEXT MODE: When to use 📝
- Questions: "What is staking?", "How does governance work?"
- Missing parameters: "Send DOT to Alice" (no amount)
- Unavailable features: Operations not in "Available Agents"
- Error explanations: System asks you to explain a failure
- Clarifications: Unclear or ambiguous requests

### JSON MODE: When to use 🔧
- Complete blockchain commands: "Send 2 DOT to 5Grwv..."
- All required parameters present: amount + valid address
- Confirmation: "Confirm", "Yes", "Try again"

**JSON MODE Rules:**
1. Check "Available Agents" first - if operation doesn't exist, use TEXT MODE
2. Verify all required parameters - if missing, use TEXT MODE to ask
3. Output format: \`\`\`json code block ONLY - no text before or after
4. System generates friendly messages - you DON'T need to
5. Never infer problems (balance, connectivity) - system validates after
6. Generate immediately when parameters complete - don't ask confirmation

**❌ WRONG (why it fails):**
  User: "Send 2 DOT to 5Grwv..."
  You: "I've prepared a transaction flow..."
  
  ❌ This fails because the system cannot extract JSON if ANY prose exists.

**✅ CORRECT:**
  User: "Send 2 DOT to 5Grwv..."
  You: \`\`\`json
  {
    "id": "exec_1234567890",
    "originalRequest": "Send 2 DOT to 5Grwv...",
    "steps": [{
      "id": "step_1",
      "stepNumber": 1,
      "agentClassName": "AssetTransferAgent",
      "functionName": "transfer",
      "parameters": {"recipient": "5Grwv...", "amount": "2", "targetChain": "assetHub"},
      "executionType": "extrinsic",
      "status": "pending",
      "description": "Transfer 2 DOT to 5Grwv...",
      "requiresConfirmation": true,
      "createdAt": 1234567890
    }],
    "status": "pending",
    "requiresApproval": true,
    "createdAt": 1234567890
  }
  \`\`\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  
  prompt += BASE_SYSTEM_PROMPT;
  
  // Add context information
  prompt += formatContext(context);
  
  // Add Polkadot Knowledge Base
  prompt += formatPolkadotKnowledgeBase();
  
  // Add agent definitions
  prompt += formatAgentDefinitions();
  
  // Add execution array instructions
  prompt += '\n';
  prompt += EXECUTION_ARRAY_INSTRUCTIONS;
  
  // Add final instructions
  prompt += `\n\n## 🔧 ExecutionPlan JSON Structure

\`\`\`json
{
  "id": "exec_<timestamp_ms>",
  "originalRequest": "<user request>",
  "steps": [{
    "id": "step_1",
    "stepNumber": 1,
    "agentClassName": "<AgentClassName>",
    "functionName": "<functionName>",
    "parameters": {"amount": "2", "recipient": "5Grwv...", "targetChain": "assetHub"},
    "executionType": "extrinsic",
    "status": "pending",
    "description": "Human-readable description",
    "requiresConfirmation": true,
    "createdAt": <timestamp_ms>
  }],
  "status": "pending",
  "requiresApproval": true,
  "createdAt": <timestamp_ms>
}
\`\`\`

**Key fields:**
- \`id\`: "exec_" + current timestamp (ms)
- \`agentClassName\`: Exact name from Available Agents
- \`parameters.amount\`: Human-readable (e.g., "2", not "2000000000000")
- \`parameters.targetChain\`: Use **"assetHub"** for transfers (default). Use "relay" only if user explicitly requests Relay Chain.
- \`executionType\`: "extrinsic" (transactions), "data_fetch" (queries), "validation" (checks)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 FINAL CHECK BEFORE RESPONDING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If you are about to generate an ExecutionPlan:
  STOP.
  DELETE any prose.
  OUTPUT ONLY the \`\`\`json block.

Mode check:
- TEXT MODE → questions, missing params, errors, unavailable features
- JSON MODE → complete commands with all required parameters

Remember: In JSON MODE, you are a JSON generator, NOT an assistant.`;
  
  return prompt;
}

/**
 * Get system prompt with minimal context (for testing or default state)
 */
export function getDefaultSystemPrompt(): string {
  return buildSystemPromptSync();
}

/**
 * Build a versioned system prompt
 * 
 * @param context Optional system context to include
 * @returns Versioned prompt object
 */
export async function buildVersionedSystemPrompt(
  context?: SystemContext
) {
  const prompt = await buildSystemPrompt(context);
  
  return createVersionedPrompt(prompt, context ? {
    walletConnected: context.wallet.isConnected,
    network: context.network.network,
    hasBalance: !!context.balance,
  } : undefined);
}

