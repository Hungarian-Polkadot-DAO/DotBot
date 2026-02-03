/**
 * DotBot LLM/chat constants.
 */

/** Maximum number of conversation history messages sent to the LLM. Older messages are dropped so the model prioritizes system prompt and Current Context over stale history. */
export const CHAT_HISTORY_MESSAGE_LIMIT = 8;
