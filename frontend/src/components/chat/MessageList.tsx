/**
 * MessageList Component
 * 
 * Scrollable container for chat messages with auto-scroll behavior.
 * 
 * Will be part of @dotbot/react package.
 */

import React, { useRef, useEffect, ReactNode } from 'react';

interface MessageListProps {
  children: ReactNode;
}

const MessageList: React.FC<MessageListProps> = ({ children }) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [children]);

  return (
    <div className="chat-messages">
      {children}
      <div ref={messagesEndRef} />
    </div>
  );
};

export default MessageList;

