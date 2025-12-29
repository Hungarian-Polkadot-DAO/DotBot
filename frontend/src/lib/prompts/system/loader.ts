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
    prompt += `**Balance**: ${context.balance.total} ${context.balance.symbol}\n`;
    prompt += `  - Free: ${context.balance.free}\n`;
    if (context.balance.reserved !== '0') {
      prompt += `  - Reserved: ${context.balance.reserved}\n`;
    }
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
  // ⚠️ START WITH JSON REQUIREMENT - Make it the FIRST thing the LLM sees
  let prompt = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️⚠️⚠️ CRITICAL INSTRUCTION - READ FIRST ⚠️⚠️⚠️
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

YOU ARE AN EXECUTION PLAN GENERATOR, NOT A CHAT BOT.

FOR BLOCKCHAIN OPERATIONS: OUTPUT **ONLY JSON ExecutionPlan**. NO TEXT.

❌ WRONG: "Acknowledged! You've confirmed..."
❌ WRONG: "I've re-submitted the transaction..."
✅ CORRECT: Return ONLY the JSON ExecutionPlan (format shown below)

The UI handles all confirmations and explanations.
Your job: Generate JSON execution plans.

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
  prompt += `\n\n## Important Guidelines

- Always construct Execution Arrays for operations that require blockchain interaction
- Request missing required parameters before building the execution array
- Explain what will happen before asking for user confirmation
- Handle errors gracefully and provide helpful error messages
- If you're unsure about a parameter or operation, ask the user for clarification
- Prioritize user safety and security in all operations

---

## ⚠️⚠️⚠️ CRITICAL: Response Format ⚠️⚠️⚠️

**READ THIS CAREFULLY - THIS IS THE MOST IMPORTANT INSTRUCTION:**

When the user requests a blockchain operation (transfer, swap, stake, etc.):
1. **DO NOT write explanatory text**
2. **DO NOT ask for confirmation in text**
3. **DO NOT provide conversational responses**
4. **ONLY return a JSON ExecutionPlan**

**YOUR ENTIRE RESPONSE MUST BE THIS JSON STRUCTURE AND NOTHING ELSE:**

\`\`\`json
{
  "id": "exec_<unique_id>",
  "originalRequest": "<user's request>",
  "steps": [
    {
      "id": "step_1",
      "stepNumber": 1,
      "agentClassName": "<AgentClass>",
      "functionName": "<functionName>",
      "parameters": { ... },
      "executionType": "extrinsic",
      "status": "pending",
      "description": "<human readable description>",
      "requiresConfirmation": true,
      "createdAt": <timestamp>
    }
  ],
  "status": "pending",
  "requiresApproval": true,
  "createdAt": <timestamp>
}
\`\`\`

**EXAMPLES OF WHAT TO DO:**

User: "Send 2 DOT to Alice"
Your response: (ONLY the JSON, nothing else)
\`\`\`json
{
  "id": "exec_123",
  "originalRequest": "Send 2 DOT to Alice",
  "steps": [...],
  "status": "pending",
  "requiresApproval": true,
  "createdAt": 1234567890
}
\`\`\`

User: "Confirm send" (confirming a previous operation)
Your response: (ONLY the JSON, nothing else)
\`\`\`json
{
  "id": "exec_124",
  "originalRequest": "Confirm send",
  "steps": [...],
  "status": "pending",
  "requiresApproval": true,
  "createdAt": 1234567890
}
\`\`\`

**EXAMPLES OF WHAT NOT TO DO:**

❌ WRONG: "Acknowledged! You've confirmed: ✅ Send 2 DOT..."
❌ WRONG: "I've re-submitted the transaction — please check your wallet..."
❌ WRONG: Any text explanation or conversational response

**FINAL REMINDER:**
- Conversational responses = ❌ WRONG
- JSON ExecutionPlan = ✅ CORRECT
- If the user is requesting a blockchain operation, respond with ONLY JSON
- The UI will handle confirmations and explanations - you don't need to`;

  return prompt;
}

/**
 * Build system prompt synchronously
 * 
 * @param context Optional system context to include
 * @returns Complete system prompt string
 */
export function buildSystemPromptSync(context?: SystemContext): string {
  let prompt = BASE_SYSTEM_PROMPT;
  
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
  prompt += `\n\n## Important Guidelines

- Always construct Execution Arrays for operations that require blockchain interaction
- Request missing required parameters before building the execution array
- Explain what will happen before asking for user confirmation
- Handle errors gracefully and provide helpful error messages
- If you're unsure about a parameter or operation, ask the user for clarification
- Prioritize user safety and security in all operations

## CRITICAL: Response Format

**YOU MUST ALWAYS RETURN A JSON ExecutionPlan** for operations that require blockchain interaction.

Your response MUST include a JSON code block with the ExecutionPlan structure:

\`\`\`json
{
  "id": "exec_<unique_id>",
  "originalRequest": "<user's request>",
  "steps": [
    {
      "id": "step_1",
      "stepNumber": 1,
      "agentClassName": "<AgentClass>",
      "functionName": "<functionName>",
      "parameters": { ... },
      "executionType": "extrinsic",
      "status": "pending",
      "description": "<human readable description>",
      "requiresConfirmation": true,
      "createdAt": <timestamp>
    }
  ],
  "status": "pending",
  "requiresApproval": true,
  "createdAt": <timestamp>
}
\`\`\`

If the user's request doesn't require blockchain interaction (e.g., just asking a question), you can respond with text only.
But for ANY operation that needs to be executed (transfers, swaps, staking, etc.), you MUST return the JSON ExecutionPlan.`;

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

