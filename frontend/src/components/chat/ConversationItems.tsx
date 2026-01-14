/**
 * ConversationItems Component
 * 
 * Renders all conversation items (messages, execution flows) in the correct order.
 * Handles different item types and maps them to appropriate components.
 * 
 * Will be part of @dotbot/react package.
 */

import React from 'react';
import type { DotBot, ConversationItem } from '@dotbot/core';
import Message from './Message';
import ExecutionFlow from '../execution-flow/ExecutionFlow';

interface ConversationItemsProps {
  items: ConversationItem[];
  dotbot: DotBot;
  backendSessionId?: string | null;
}

const ConversationItems: React.FC<ConversationItemsProps> = ({ items, dotbot, backendSessionId }) => {
  // Deduplicate execution messages by executionId - keep only the latest one
  // This prevents duplicate ExecutionFlow components from being rendered
  const executionMessagesByExecutionId = new Map<string, typeof items[0]>();
  
  // First pass: collect latest execution message per executionId
  for (const item of items) {
    if (item.type === 'execution') {
      const executionId = (item as any).executionId;
      if (executionId) {
        const existing = executionMessagesByExecutionId.get(executionId);
        if (!existing || item.timestamp > existing.timestamp) {
          executionMessagesByExecutionId.set(executionId, item);
        }
      }
    }
  }
  
  // Second pass: filter items, keeping only the latest execution message per executionId
  const seenExecutionIds = new Set<string>();
  const deduplicatedItems = items.filter((item) => {
    if (item.type === 'execution') {
      const executionId = (item as any).executionId;
      if (executionId) {
        // Only include if this is the latest message for this executionId
        const latest = executionMessagesByExecutionId.get(executionId);
        if (latest === item) {
          // Check if we've already included this executionId
          if (seenExecutionIds.has(executionId)) {
            return false; // Skip duplicate
          }
          seenExecutionIds.add(executionId);
          return true;
        }
        return false; // Skip older execution messages
      }
    }
    return true; // Include all non-execution items
  });
  
  return (
    <>
      {deduplicatedItems.map((item) => {
        // Execution Flow
        if (item.type === 'execution') {
          return (
            <ExecutionFlow
              key={item.id}
              executionMessage={item}
              dotbot={dotbot}
              backendSessionId={backendSessionId}
            />
          );
        }
        
        // Text Messages (user/bot/system)
        if (item.type === 'user' || item.type === 'bot' || item.type === 'system') {
          return (
            <Message
              key={item.id}
              message={item}
            />
          );
        }

        // Future: knowledge-request, search-request, etc.
        return null;
      })}
    </>
  );
};

export default ConversationItems;

