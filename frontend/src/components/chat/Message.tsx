/**
 * Message Component
 * 
 * Renders a single text message (user, bot, or system).
 * 
 * This component will be part of @dotbot/react package.
 */

import React from 'react';
import { User } from 'lucide-react';
import dotbotFavicon from '../../assets/dotbot-favicon.svg';
import type { TextMessage, SystemMessage } from '../../lib';

interface MessageProps {
  message: TextMessage | SystemMessage;
}

const Message: React.FC<MessageProps> = ({ message }) => {
  const formatDateTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const day = date.getDate();
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const time = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    return `${day}, ${month}, ${time}`;
  };

  // System messages are displayed as bot messages
  const displayType = message.type === 'system' ? 'bot' : message.type;
  const content = 'content' in message ? message.content : '';
  const senderName = displayType === 'user' ? 'You' : 'DotBot';

  return (
    <div className={`message ${displayType}`}>
      <div className="message-header">
        {displayType === 'user' ? (
          <>
            <span className="message-date">{formatDateTime(message.timestamp)}</span>
            <span className="message-name">{senderName}</span>
            <div className={`message-avatar ${displayType}`}>
              <User size={18} />
            </div>
          </>
        ) : (
          <>
            <div className={`message-avatar ${displayType}`}>
              <img src={dotbotFavicon} alt="DotBot" className="message-avatar-img" />
            </div>
            <span className="message-name">{senderName}</span>
            <span className="message-date">{formatDateTime(message.timestamp)}</span>
          </>
        )}
      </div>
      <div className="message-content">
        <div className="message-bubble">
          {content}
        </div>
      </div>
    </div>
  );
};

export default Message;

