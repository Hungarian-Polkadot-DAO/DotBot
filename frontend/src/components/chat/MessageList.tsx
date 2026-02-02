/**
 * MessageList Component
 *
 * Scrollable container for chat messages with auto-scroll behavior.
 * When suppressScrollRef.current is true, the next effect run skips scrolling (e.g. after Restore).
 */

import React, { useRef, useEffect, ReactNode } from 'react';

interface MessageListProps {
  children: ReactNode;
  /** When set to true before children update, the next scroll is skipped and ref is cleared. */
  suppressScrollRef?: React.MutableRefObject<boolean>;
}

const MessageList: React.FC<MessageListProps> = ({ children, suppressScrollRef }) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (suppressScrollRef?.current) {
      suppressScrollRef.current = false;
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [children, suppressScrollRef]);

  return (
    <div className="chat-messages">
      {children}
      <div ref={messagesEndRef} />
    </div>
  );
};

export default MessageList;

