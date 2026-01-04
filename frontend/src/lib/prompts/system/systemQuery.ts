/**
 * System Query Handler
 * 
 * This module handles dynamic knowledge loading for the LLM.
 * Instead of including all knowledge in the system prompt upfront,
 * the LLM can request specific knowledge files as needed.
 * 
 * This keeps the system prompt lean and allows for on-demand knowledge retrieval.
 * 
 * @example LLM Response with System Query
 * ```
 * ***SYSTEM_QUERY: knowledge/staking.md What are the minimum requirements for staking?***
 * ```
 * 
 * The system will:
 * 1. Detect the system query marker
 * 2. Load the requested knowledge file
 * 3. Re-prompt the LLM with the additional context
 * 4. Return the final response to the user
 */

/**
 * System query pattern
 * Format: ***SYSTEM_QUERY: <file_path> <query>***
 */
const SYSTEM_QUERY_PATTERN = /\*\*\*SYSTEM_QUERY:\s*([^\s]+)\s+(.+?)\*\*\*/g;

/**
 * Parsed system query
 */
export interface SystemQuery {
  /** Knowledge file path relative to knowledge base */
  filePath: string;
  
  /** The specific query/question about the knowledge */
  query: string;
  
  /** Full match string */
  originalMatch: string;
}

/**
 * Detect if LLM response contains system queries
 * 
 * @param llmResponse The raw LLM response text
 * @returns Array of detected system queries (empty if none found)
 */
export function detectSystemQueries(llmResponse: string): SystemQuery[] {
  const queries: SystemQuery[] = [];
  const matches = llmResponse.matchAll(SYSTEM_QUERY_PATTERN);
  
  for (const match of matches) {
    queries.push({
      filePath: match[1],
      query: match[2],
      originalMatch: match[0]
    });
  }
  
  return queries;
}

/**
 * Load knowledge file content
 * 
 * This is a placeholder for the actual implementation.
 * In the future, this should load markdown files from the knowledge directory.
 * 
 * @param filePath Relative path to knowledge file
 * @returns Knowledge file content
 */
export async function loadKnowledgeFile(filePath: string): Promise<string> {
  // TODO: Implement actual file loading
  // This could load from:
  // - Static files bundled with the app
  // - Remote API endpoint
  // - Local file system (in development)
  
  console.warn(`📚 Knowledge loading not yet implemented: ${filePath}`);
  
  // For now, return a placeholder
  return `Knowledge file "${filePath}" is not yet available. This feature is under development.`;
}

/**
 * Process LLM response with system queries
 * 
 * This is the main function to handle system queries.
 * It detects queries, loads knowledge, and can re-prompt the LLM.
 * 
 * @param llmResponse Initial LLM response
 * @param systemPrompt Base system prompt
 * @param userMessage Original user message
 * @param llmFunction Function to call LLM
 * @returns Final processed response
 */
export async function processSystemQueries(
  llmResponse: string,
  systemPrompt: string,
  userMessage: string,
  llmFunction: (message: string, systemPrompt: string) => Promise<string>
): Promise<string> {
  // Detect system queries
  const queries = detectSystemQueries(llmResponse);
  
  // If no queries, return response as-is
  if (queries.length === 0) {
    return llmResponse;
  }
  
  console.log(`🔍 Detected ${queries.length} system query/queries:`, queries);
  
  // Load all requested knowledge files
  const knowledgePromises = queries.map(q => loadKnowledgeFile(q.filePath));
  const knowledgeContents = await Promise.all(knowledgePromises);
  
  // Build enhanced system prompt with loaded knowledge
  let enhancedPrompt = systemPrompt;
  enhancedPrompt += '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  enhancedPrompt += '## 📚 Additional Knowledge (Dynamically Loaded)\n\n';
  
  queries.forEach((query, index) => {
    enhancedPrompt += `### ${query.filePath}\n\n`;
    enhancedPrompt += `**Your Question**: ${query.query}\n\n`;
    enhancedPrompt += knowledgeContents[index];
    enhancedPrompt += '\n\n';
  });
  
  enhancedPrompt += '**Instructions**: Use this additional knowledge to answer the user\'s question.\n';
  enhancedPrompt += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  
  // Re-prompt LLM with enhanced context
  console.log('🔄 Re-prompting LLM with enhanced knowledge...');
  const finalResponse = await llmFunction(userMessage, enhancedPrompt);
  
  return finalResponse;
}

/**
 * Check if system queries are enabled
 * 
 * This allows for gradual rollout of the feature.
 */
export function areSystemQueriesEnabled(): boolean {
  // TODO: Make this configurable
  return false; // Disabled by default for now
}

