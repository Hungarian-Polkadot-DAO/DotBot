/**
 * Message Component
 * 
 * Renders a single text message (user, bot, or system).
 * 
 * This component will be part of @dotbot/react package.
 */

import React from 'react';
import type { TextMessage, SystemMessage } from '../../lib';

interface MessageProps {
  message: TextMessage | SystemMessage;
}

const Message: React.FC<MessageProps> = ({ message }) => {
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // System messages are displayed as bot messages
  const displayType = message.type === 'system' ? 'bot' : message.type;
  const content = 'content' in message ? message.content : '';

  return (
    <div className={`message ${displayType}`}>
      <div className={`message-avatar ${displayType}`}>
        {displayType === 'user' ? 'U' : 'D'}
      </div>
      <div className="message-content">
        <div className="message-bubble">
          {content}
        </div>
        <div className="message-time">
          {formatTime(message.timestamp)}
        </div>
      </div>
    </div>
  );
};

export default Message;

