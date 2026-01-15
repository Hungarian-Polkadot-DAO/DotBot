/**
 * ConversationItems Component
 * 
 * Renders all conversation items (messages, execution flows) in the correct order.
 * Handles different item types and maps them to appropriate components.
 * 
 * Will be part of @dotbot/react package.
 */

import React from 'react';
import type { DotBot, ConversationItem, ExecutionMessage } from '@dotbot/core';
import Message from './Message';
import ExecutionFlow from '../execution-flow/ExecutionFlow';

interface ConversationItemsProps {
  items: ConversationItem[];
  dotbot: DotBot;
  backendSessionId?: string | null;
}

/**
 * Type guard to check if an item is an ExecutionMessage
 */
function isExecutionMessage(item: ConversationItem): item is ExecutionMessage {
  return item.type === 'execution';
}

const ConversationItems: React.FC<ConversationItemsProps> = ({ items, dotbot, backendSessionId }) => {
  // Deduplicate execution messages by executionId - keep only the latest one
  // This prevents duplicate ExecutionFlow components from being rendered
  const executionMessagesByExecutionId = new Map<string, ExecutionMessage>();
  
  // First pass: collect latest execution message per executionId
  for (const item of items) {
    if (isExecutionMessage(item) && item.executionId) {
      const existing = executionMessagesByExecutionId.get(item.executionId);
      // Keep the one with the latest timestamp, or if timestamps are equal, keep the last one encountered
      if (!existing || item.timestamp > existing.timestamp || 
          (item.timestamp === existing.timestamp && items.indexOf(item) > items.indexOf(existing))) {
        executionMessagesByExecutionId.set(item.executionId, item);
      }
    }
  }
  
  // Second pass: filter items, keeping only the latest execution message per executionId
  // Track which executionIds we've already included to prevent duplicates
  const seenExecutionIds = new Set<string>();
  const deduplicatedItems = items.filter((item) => {
    if (isExecutionMessage(item) && item.executionId) {
      // Only include if this is the latest message for this executionId
      const latest = executionMessagesByExecutionId.get(item.executionId);
      if (latest) {
        // Compare by properties (executionId, timestamp, id) instead of object reference
        const isLatest = latest.executionId === item.executionId && 
                        latest.timestamp === item.timestamp && 
                        latest.id === item.id;
        
        if (isLatest) {
          // Check if we've already included this executionId
          if (seenExecutionIds.has(item.executionId)) {
            return false; // Skip duplicate
          }
          seenExecutionIds.add(item.executionId);
          return true;
        }
      }
      return false; // Skip older execution messages or messages without executionId
    }
    return true; // Include all non-execution items
  });
  
  // Return null for empty array (correct React behavior)
  if (deduplicatedItems.length === 0) {
    return null;
  }
  
  return (
    <>
      {deduplicatedItems.map((item) => {
        // Execution Flow
        if (isExecutionMessage(item)) {
          // Defensive check: skip if executionId is missing (shouldn't happen, but handle gracefully)
          if (!item.executionId) {
            console.warn('[ConversationItems] Skipping execution message without executionId:', item.id);
            return null;
          }
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

