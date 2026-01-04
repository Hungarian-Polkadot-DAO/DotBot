/**
 * Utility functions for system prompt debugging and inspection
 */

import { buildSystemPromptSync, getDefaultSystemPrompt, buildSystemPrompt } from './loader';
import type { SystemContext } from './context/types';

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

