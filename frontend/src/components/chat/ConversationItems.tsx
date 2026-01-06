/**
 * ConversationItems Component
 * 
 * Renders all conversation items (messages, execution flows) in the correct order.
 * Handles different item types and maps them to appropriate components.
 * 
 * Will be part of @dotbot/react package.
 */

import React from 'react';
import type { DotBot, ConversationItem } from '../../lib';
import Message from './Message';
import ExecutionFlow from '../execution/ExecutionFlow';

interface ConversationItemsProps {
  items: ConversationItem[];
  dotbot: DotBot;
}

const ConversationItems: React.FC<ConversationItemsProps> = ({ items, dotbot }) => {
  return (
    <>
      {items.map((item) => {
        // Execution Flow
        if (item.type === 'execution') {
          return (
            <ExecutionFlow
              key={item.id}
              executionMessage={item}
              dotbot={dotbot}
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

