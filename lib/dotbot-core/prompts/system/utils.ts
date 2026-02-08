/**
 * Utility functions for system prompt debugging and inspection
 * Includes execution plan extraction from LLM responses.
 */

import { buildSystemPromptSync, getDefaultSystemPrompt, buildSystemPrompt } from './loader';
import type { SystemContext } from './context/types';
import type { ExecutionPlan } from './execution/types';
import { createSubsystemLogger } from '../../services/logger';
import { Subsystem } from '../../services/types/logging';

const promptLogger = createSubsystemLogger(Subsystem.UTILS);

/**
 * Try to fix common JSON parsing issues (trailing commas, etc.)
 */
export function tryFixJson(jsonString: string): string | null {
  try {
    // Remove trailing commas before closing braces/brackets
    const fixed = jsonString.replace(/,(\s*[}\]])/g, '$1');

    // Try parsing to see if it's valid now
    JSON.parse(fixed);
    return fixed;
  } catch {
    return null;
  }
}

/**
 * Validate execution plan structure
 */
export function isValidExecutionPlan(obj: unknown): obj is ExecutionPlan {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'id' in obj &&
    'steps' in obj &&
    Array.isArray((obj as ExecutionPlan).steps)
  );
}

/**
 * Extract ExecutionPlan from LLM response text
 *
 * Tries multiple strategies to find and parse JSON execution plan:
 * 1. JSON in ```json code block (most common LLM format)
 * 2. JSON in generic ``` code block
 * 3. Plain JSON string
 * 4. JSON object anywhere in response (with text before/after)
 */
export function extractExecutionPlan(llmResponse: string): ExecutionPlan | null {
  if (!llmResponse || typeof llmResponse !== 'string') {
    return null;
  }

  const normalized = llmResponse.trim();

  try {
    // Strategy 1: JSON in ```json code block (most common LLM format)
    const jsonMatch = normalized.match(/```json\s*([\s\S]*?)\s*```/i);
    if (jsonMatch) {
      try {
        const plan = JSON.parse(jsonMatch[1].trim()) as ExecutionPlan;
        if (isValidExecutionPlan(plan)) {
          return plan;
        }
      } catch {
        // Try to fix common JSON issues (trailing commas, etc.)
        const fixed = tryFixJson(jsonMatch[1].trim());
        if (fixed) {
          try {
            const plan = JSON.parse(fixed) as ExecutionPlan;
            if (isValidExecutionPlan(plan)) {
              promptLogger.warn(
                { original: jsonMatch[1].substring(0, 100) },
                'Fixed JSON parsing issue in code block'
              );
              return plan;
            }
          } catch {
            // Still failed after fix attempt
          }
        }
      }
    }

    // Strategy 2: JSON in generic ``` code block
    const codeBlockMatch = normalized.match(/```\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      try {
        const plan = JSON.parse(codeBlockMatch[1].trim()) as ExecutionPlan;
        if (isValidExecutionPlan(plan)) {
          return plan;
        }
      } catch {
        // Try to fix common JSON issues
        const fixed = tryFixJson(codeBlockMatch[1].trim());
        if (fixed) {
          try {
            const plan = JSON.parse(fixed) as ExecutionPlan;
            if (isValidExecutionPlan(plan)) {
              promptLogger.warn(
                { original: codeBlockMatch[1].substring(0, 100) },
                'Fixed JSON parsing issue in generic code block'
              );
              return plan;
            }
          } catch {
            // Still failed after fix attempt
          }
        }
      }
    }

    // Strategy 3: Plain JSON string (LLM returns just JSON)
    try {
      const plan = JSON.parse(normalized) as ExecutionPlan;
      if (isValidExecutionPlan(plan)) {
        return plan;
      }
    } catch {
      // Try to fix common JSON issues
      const fixed = tryFixJson(normalized);
      if (fixed) {
        try {
          const plan = JSON.parse(fixed) as ExecutionPlan;
          if (isValidExecutionPlan(plan)) {
            promptLogger.warn(
              { original: normalized.substring(0, 100) },
              'Fixed JSON parsing issue in plain JSON'
            );
            return plan;
          }
        } catch {
          // Still failed after fix attempt
        }
      }
    }

    // Strategy 4: Find JSON object anywhere in the response (even with text before/after)
    // Look for patterns like { "id": "exec_", "steps": [...] }
    const jsonObjectMatch = normalized.match(
      /\{\s*"id"\s*:\s*"exec_[^"]*"[\s\S]*?"steps"\s*:\s*\[[\s\S]*?\]/
    );
    if (jsonObjectMatch) {
      // Try to extract the complete JSON object
      const jsonStart = normalized.indexOf('{');
      if (jsonStart !== -1) {
        // Find matching closing brace
        let braceCount = 0;
        let jsonEnd = -1;
        for (let i = jsonStart; i < normalized.length; i++) {
          if (normalized[i] === '{') braceCount++;
          if (normalized[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              jsonEnd = i + 1;
              break;
            }
          }
        }

        if (jsonEnd > jsonStart) {
          const jsonCandidate = normalized.substring(jsonStart, jsonEnd);
          try {
            const plan = JSON.parse(jsonCandidate) as ExecutionPlan;
            if (isValidExecutionPlan(plan)) {
              promptLogger.info(
                { extracted: jsonCandidate.substring(0, 100) },
                'Extracted JSON from response with surrounding text'
              );
              return plan;
            }
          } catch {
            // Try to fix common JSON issues
            const fixed = tryFixJson(jsonCandidate);
            if (fixed) {
              try {
                const plan = JSON.parse(fixed) as ExecutionPlan;
                if (isValidExecutionPlan(plan)) {
                  promptLogger.warn(
                    { original: jsonCandidate.substring(0, 100) },
                    'Fixed and extracted JSON from response with surrounding text'
                  );
                  return plan;
                }
              } catch {
                // Still failed after fix attempt
              }
            }
          }
        }
      }
    }

    // No plan found in response
    return null;
  } catch (error) {
    console.error(
      '[DotBot] ExecutionPlan was not created - extraction error:',
      error instanceof Error ? error.message : String(error)
    );
    promptLogger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      'ExecutionPlan was not created - extraction error'
    );
    return null;
  }
}

/**
 * Generate and log the system prompt to console (synchronous version)
 * 
 * @param context Optional system context
 * @param options Options for output formatting
 */
export function logSystemPrompt(
  context?: SystemContext,
  options?: {
    /** Whether to also log to console.error (for better visibility) */
    useError?: boolean;
    /** Whether to show prompt length */
    showLength?: boolean;
    /** Whether to show prompt in chunks (for very long prompts) */
    chunked?: boolean;
  }
): void {
  // Use sync version for immediate logging
  const prompt = context ? buildSystemPromptSync(context) : getDefaultSystemPrompt();
  
  const logFn = options?.useError ? console.error : console.log;
  
  if (options?.showLength) {
    logFn(`\n📊 System Prompt Length: ${prompt.length} characters\n`);
  }
  
  if (options?.chunked && prompt.length > 10000) {
    // Split into chunks for better readability
    const chunkSize = 5000;
    const chunks = [];
    for (let i = 0; i < prompt.length; i += chunkSize) {
      chunks.push(prompt.slice(i, i + chunkSize));
    }
    
    logFn('\n📝 System Prompt (chunked):\n');
    chunks.forEach((chunk, index) => {
      logFn(`\n--- Chunk ${index + 1}/${chunks.length} ---\n`);
      logFn(chunk);
    });
  } else {
    logFn('\n📝 System Prompt:\n');
    logFn(prompt);
  }
  
  logFn('\n✅ System prompt generated successfully\n');
}

/**
 * Generate and log the system prompt to console (async version)
 * 
 * @param context Optional system context
 * @param options Options for output formatting
 */
export async function logSystemPromptAsync(
  context?: SystemContext,
  options?: {
    /** Whether to also log to console.error (for better visibility) */
    useError?: boolean;
    /** Whether to show prompt length */
    showLength?: boolean;
    /** Whether to show prompt in chunks (for very long prompts) */
    chunked?: boolean;
  }
): Promise<void> {
  const prompt = await buildSystemPrompt(context);
  
  const logFn = options?.useError ? console.error : console.log;
  
  if (options?.showLength) {
    logFn(`\n📊 System Prompt Length: ${prompt.length} characters\n`);
  }
  
  if (options?.chunked && prompt.length > 10000) {
    const chunkSize = 5000;
    const chunks = [];
    for (let i = 0; i < prompt.length; i += chunkSize) {
      chunks.push(prompt.slice(i, i + chunkSize));
    }
    
    logFn('\n📝 System Prompt (chunked):\n');
    chunks.forEach((chunk, index) => {
      logFn(`\n--- Chunk ${index + 1}/${chunks.length} ---\n`);
      logFn(chunk);
    });
  } else {
    logFn('\n📝 System Prompt:\n');
    logFn(prompt);
  }
  
  logFn('\n✅ System prompt generated successfully\n');
}

/**
 * Generate system prompt and return as string (for copying)
 * 
 * @param context Optional system context
 * @returns The complete system prompt string
 */
export async function getSystemPromptString(
  context?: SystemContext
): Promise<string> {
  return context ? await buildSystemPrompt(context) : getDefaultSystemPrompt();
}

/**
 * Generate system prompt with mock context for testing
 */
export function logSystemPromptWithMockContext(): void {
  const mockContext: SystemContext = {
    wallet: {
      isConnected: true,
      address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
      provider: 'Talisman',
      accounts: [
        {
          address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
          name: 'Alice',
          balance: '100.5',
        },
      ],
    },
    network: {
      network: 'polkadot',
      rpcEndpoint: 'wss://rpc.polkadot.io',
    },
    balance: {
      relayChain: {
        free: '75000000000000',
        reserved: '0',
        frozen: '0',
      },
      assetHub: {
        free: '25500000000000',
      reserved: '0',
      frozen: '0',
      },
      total: '100500000000000',
      symbol: 'DOT',
    },
  };
  
  logSystemPrompt(mockContext, { showLength: true });
}

