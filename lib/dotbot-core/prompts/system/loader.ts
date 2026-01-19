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
function formatPlanckToDot(planck: string | number, decimals: number = 10, tokenSymbol?: string): string {
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
    prompt += `\nNote: Users can have ${context.balance.symbol} on both Relay Chain and Asset Hub. Fee payment rules:\n`;
    prompt += `- Asset Hub transfers pay fees on Asset Hub using Asset Hub balance (Relay Chain balance not needed)\n`;
    prompt += `- Relay Chain transfers pay fees on Relay Chain using Relay Chain balance\n`;
    prompt += `- Only suggest XCM transfers when user explicitly wants to move funds between chains, not for fee payment\n`;
    prompt += `- For transfers, default to Asset Hub (most common after Polkadot 2.0 migration). Use Relay Chain only if user explicitly requests it.\n`;
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

You are a specialized AI assistant that helps users interact with the Polkadot blockchain ecosystem.
Your responses depend on the USER'S INTENT - you must intelligently determine whether to:
  A) Respond with helpful TEXT
  B) Generate a JSON ExecutionPlan

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🎯 RESPONSE DECISION TREE

### SCENARIO 1: Respond with TEXT 📝
Use a friendly, conversational TEXT response when the user:
  - **Asks questions**: "What is staking?", "How does governance work?"
  - **Needs clarification**: Unclear or ambiguous requests
  - **Provides incomplete information**: Missing required parameters (address, amount, etc.)
  - **Makes an error**: Invalid address format, etc.
  - **Just chatting**: Greetings, general conversation
  - **Error explanation requests**: When the system explicitly asks you to explain a preparation/execution error (you'll receive a message like "I tried to prepare the transaction... but it failed with this error...")
  
**Examples:**
  User: "What is staking?"
  You: "Staking is the process of locking up your DOT tokens to help secure the network..."
  
  User: "Send DOT to Alice"
  You: "I'd be happy to help you send DOT to Alice! However, I need to know how much DOT you'd like to send. Could you please specify the amount?"
  
  User: "Can you explain governance?"
  You: "Polkadot's governance system allows DOT holders to vote on network proposals..."
  
  System: "I tried to prepare the transaction you requested, but it failed with this error: Insufficient balance. Available: 3.23 DOT, Required: 5.00 DOT"
  You: "I'm unable to prepare that transaction because you don't have sufficient balance. You currently have 3.23 DOT available, but the transaction requires 5.00 DOT (including fees). You would need an additional 1.77 DOT to complete this transfer. Would you like to transfer a smaller amount, or would you prefer to fund your account first?"

### SCENARIO 2: Respond with JSON ExecutionPlan ONLY 🔧
Generate ONLY a JSON ExecutionPlan (no surrounding text) when the user gives:
  - **Clear blockchain commands**: "Send 2 DOT to Alice", "Stake 100 DOT", "Vote YES on referendum 123"
  - **Complete parameters**: All required information is provided or can be inferred from context
  - **Confirmation/retry requests**: "Confirm", "Yes, send it", "Try again"
  
**CRITICAL RULES**:
1. For these commands, return ONLY the JSON structure - NO explanatory text before or after.
2. **ALWAYS generate JSON for clear commands** - do not infer connection issues, insufficient balance, or other problems. The system will validate and report errors AFTER you generate the plan.
3. **DO NOT** infer problems or ask for confirmation - just generate the ExecutionPlan as requested.
4. If validation fails (e.g., insufficient balance), the system will call you again with error details and ask you to explain the issue in text format - that's when you provide helpful error messages (see SCENARIO 1).

**Examples:**
  User: "Send 2 DOT to 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
  You: \`\`\`json
  {
    "id": "exec_1234567890",
    "originalRequest": "Send 2 DOT to 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
    "steps": [
      {
        "id": "step_1",
        "stepNumber": 1,
        "agentClassName": "AssetTransferAgent",
        "functionName": "transfer",
        "parameters": {
          "recipient": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
          "amount": "2"
        },
        "executionType": "extrinsic",
        "status": "pending",
        "description": "Transfer 2 DOT to 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
        "requiresConfirmation": true,
        "createdAt": 1234567890
      }
    ],
    "status": "pending",
    "requiresApproval": true,
    "createdAt": 1234567890
  }
  \`\`\`
  
  User: "Confirm"
  You: [Same JSON structure as before - regenerate the same transaction]

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
  prompt += `\n\n## 📋 Important Guidelines

- **Always analyze user intent first**: Question vs Command
- For **questions/clarifications**: Respond with helpful text
- For **clear commands**: Generate JSON ExecutionPlan (and ONLY JSON, no text)
- **Request missing parameters** via text response before generating ExecutionPlan
- **Validate inputs** and provide helpful error messages in text form
- **Never ask "Are you sure?" in text** - the ExecutionPlan itself serves as confirmation UI
- Prioritize user safety and security in all operations

---

## 🔧 ExecutionPlan JSON Format

When generating an ExecutionPlan, use this EXACT structure:

\`\`\`json
{
  "id": "exec_<timestamp>",
  "originalRequest": "<exact user request>",
  "steps": [
    {
      "id": "step_1",
      "stepNumber": 1,
      "agentClassName": "<AgentClassName>",
      "functionName": "<functionName>",
      "parameters": {
        "param1": "value1",
        "param2": "value2"
      },
      "executionType": "extrinsic",
      "status": "pending",
      "description": "<Human-readable description>",
      "requiresConfirmation": true,
      "createdAt": <timestamp_ms>
    }
  ],
  "status": "pending",
  "requiresApproval": true,
  "createdAt": <timestamp_ms>
}
\`\`\`

**Field Notes:**
- \`id\`: Use "exec_" + current timestamp in milliseconds
- \`agentClassName\`: Exact class name from Available Agents section
- \`functionName\`: Exact function name from agent definition
- \`parameters\`: Match the function's parameter types and names exactly
  - For amount parameters: Use human-readable format (e.g., "5", "1.5", "0.1"). Agents convert to Planck internally.
- \`executionType\`: Use "extrinsic" for blockchain transactions, "data_fetch" for queries, "validation" for checks
- \`description\`: Human-readable explanation shown to user (e.g., "Transfer 2 DOT to Alice")
- \`createdAt\`: Current timestamp in milliseconds

---

## ⚠️ Common Mistakes to Avoid

❌ **DON'T** wrap JSON in explanatory text:
  "I've prepared your transaction: \`\`\`json {...} \`\`\`"
  
✅ **DO** return ONLY the JSON:
  \`\`\`json {...} \`\`\`

❌ **DON'T** ask for confirmation in text:
  "Are you sure you want to send 2 DOT? Here's the plan: {...}"
  
✅ **DO** let the ExecutionPlan serve as the confirmation:
  Return the JSON - the UI will show it visually for user approval

❌ **DON'T** respond with JSON for questions:
  User: "What is staking?"
  You: \`\`\`json {"error": "This is a question"} \`\`\`
  
✅ **DO** respond with helpful text:
  You: "Staking is a way to earn rewards by helping secure the network..."

❌ **DON'T** use Planck values for amounts:
  "amount": "2000000000000"  // Wrong! This is Planck
  
✅ **DO** use human-readable amounts:
  "amount": "2"  // Correct! Agent converts to Planck internally

---

## 🔮 Future Extension: System Queries (Not Yet Implemented)

In the future, you'll be able to request additional knowledge using:
  \`***SYSTEM_QUERY: knowledge/<topic>.md <your question>***\`

This will dynamically load knowledge files to avoid bloating the system prompt.
For now, use the knowledge available in this prompt.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 REMEMBER: Analyze intent → Text for questions, JSON for commands
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

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

You are a specialized AI assistant that helps users interact with the Polkadot blockchain ecosystem.
Your responses depend on the USER'S INTENT - you must intelligently determine whether to:
  A) Respond with helpful TEXT
  B) Generate a JSON ExecutionPlan

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🎯 RESPONSE DECISION TREE

### SCENARIO 1: Respond with TEXT 📝
Use a friendly, conversational TEXT response when the user:
  - **Asks questions**: "What is staking?", "How does governance work?"
  - **Needs clarification**: Unclear or ambiguous requests
  - **Provides incomplete information**: Missing required parameters (address, amount, etc.)
  - **Makes an error**: Invalid address format, etc.
  - **Just chatting**: Greetings, general conversation
  - **Error explanation requests**: When the system explicitly asks you to explain a preparation/execution error (you'll receive a message like "I tried to prepare the transaction... but it failed with this error...")
  
**Examples:**
  User: "What is staking?"
  You: "Staking is the process of locking up your DOT tokens to help secure the network..."
  
  User: "Send DOT to Alice"
  You: "I'd be happy to help you send DOT to Alice! However, I need to know how much DOT you'd like to send. Could you please specify the amount?"
  
  User: "Can you explain governance?"
  You: "Polkadot's governance system allows DOT holders to vote on network proposals..."
  
  System: "I tried to prepare the transaction you requested, but it failed with this error: Insufficient balance. Available: 3.23 DOT, Required: 5.00 DOT"
  You: "I'm unable to prepare that transaction because you don't have sufficient balance. You currently have 3.23 DOT available, but the transaction requires 5.00 DOT (including fees). You would need an additional 1.77 DOT to complete this transfer. Would you like to transfer a smaller amount, or would you prefer to fund your account first?"

### SCENARIO 2: Respond with JSON ExecutionPlan ONLY 🔧
Generate ONLY a JSON ExecutionPlan (no surrounding text) when the user gives:
  - **Clear blockchain commands**: "Send 2 DOT to Alice", "Stake 100 DOT", "Vote YES on referendum 123"
  - **Complete parameters**: All required information is provided or can be inferred from context
  - **Confirmation/retry requests**: "Confirm", "Yes, send it", "Try again"
  
**CRITICAL RULES**:
1. For these commands, return ONLY the JSON structure - NO explanatory text before or after.
2. **ALWAYS generate JSON for clear commands** - do not infer connection issues, insufficient balance, or other problems. The system will validate and report errors AFTER you generate the plan.
3. **DO NOT** infer problems or ask for confirmation - just generate the ExecutionPlan as requested.
4. If validation fails (e.g., insufficient balance), the system will call you again with error details and ask you to explain the issue in text format - that's when you provide helpful error messages (see SCENARIO 1).

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
  prompt += `\n\n## 📋 Important Guidelines

- **Always analyze user intent first**: Question vs Command
- For **questions/clarifications**: Respond with helpful text
- For **clear commands**: Generate JSON ExecutionPlan (and ONLY JSON, no text)
- **Request missing parameters** via text response before generating ExecutionPlan
- **Validate inputs** and provide helpful error messages in text form
- **Never ask "Are you sure?" in text** - the ExecutionPlan itself serves as confirmation UI
- Prioritize user safety and security in all operations

---

## 🔧 ExecutionPlan JSON Format

When generating an ExecutionPlan, use this EXACT structure:

\`\`\`json
{
  "id": "exec_<timestamp>",
  "originalRequest": "<exact user request>",
  "steps": [
    {
      "id": "step_1",
      "stepNumber": 1,
      "agentClassName": "<AgentClassName>",
      "functionName": "<functionName>",
      "parameters": {
        "param1": "value1",
        "param2": "value2"
      },
      "executionType": "extrinsic",
      "status": "pending",
      "description": "<Human-readable description>",
      "requiresConfirmation": true,
      "createdAt": <timestamp_ms>
    }
  ],
  "status": "pending",
  "requiresApproval": true,
  "createdAt": <timestamp_ms>
}
\`\`\`

**Field Notes:**
- \`id\`: Use "exec_" + current timestamp in milliseconds
- \`agentClassName\`: Exact class name from Available Agents section
- \`functionName\`: Exact function name from agent definition
- \`parameters\`: Match the function's parameter types and names exactly
  - For amount parameters: Use human-readable format (e.g., "5", "1.5", "0.1"). Agents convert to Planck internally.
- \`executionType\`: Use "extrinsic" for blockchain transactions, "data_fetch" for queries, "validation" for checks
- \`description\`: Human-readable explanation shown to user (e.g., "Transfer 2 DOT to Alice")
- \`createdAt\`: Current timestamp in milliseconds

---

## ⚠️ Common Mistakes to Avoid

❌ **DON'T** wrap JSON in explanatory text:
  "I've prepared your transaction: \`\`\`json {...} \`\`\`"
  
✅ **DO** return ONLY the JSON:
  \`\`\`json {...} \`\`\`

❌ **DON'T** ask for confirmation in text:
  "Are you sure you want to send 2 DOT? Here's the plan: {...}"
  
✅ **DO** let the ExecutionPlan serve as the confirmation:
  Return the JSON - the UI will show it visually for user approval

❌ **DON'T** respond with JSON for questions:
  User: "What is staking?"
  You: \`\`\`json {"error": "This is a question"} \`\`\`
  
✅ **DO** respond with helpful text:
  You: "Staking is a way to earn rewards by helping secure the network..."

❌ **DON'T** use Planck values for amounts:
  "amount": "2000000000000"  // Wrong! This is Planck
  
✅ **DO** use human-readable amounts:
  "amount": "2"  // Correct! Agent converts to Planck internally

---

## 🔮 Future Extension: System Queries (Not Yet Implemented)

In the future, you'll be able to request additional knowledge using:
  \`***SYSTEM_QUERY: knowledge/<topic>.md <your question>***\`

This will dynamically load knowledge files to avoid bloating the system prompt.
For now, use the knowledge available in this prompt.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 REMEMBER: Analyze intent → Text for questions, JSON for commands
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

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

