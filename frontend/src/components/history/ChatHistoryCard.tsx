/**
 * ChatHistoryCard Component
 * 
 * Displays a single chat instance in the history list.
 * Shows title, preview, timestamp, and environment badge (for testnet).
 */

import React from 'react';
import type { ChatInstanceData } from '../../lib/types/chatInstance';
import EnvironmentBadge from '../wallet/EnvironmentBadge';
import '../../styles/chat-history-card.css';

interface ChatHistoryCardProps {
  chat: ChatInstanceData;
  onClick: (chat: ChatInstanceData) => void;
  isSelected?: boolean;
}

const ChatHistoryCard: React.FC<ChatHistoryCardProps> = ({ 
  chat, 
  onClick,
  isSelected = false 
}) => {
  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  };

  const getPreview = (): string => {
    // Get first user message or bot message as preview
    const firstUserMessage = chat.messages.find(m => m.type === 'user');
    if (firstUserMessage && firstUserMessage.type === 'user') {
      const content = firstUserMessage.content;
      return content.length > 60 ? content.substring(0, 60) + '...' : content;
    }
    
    const firstBotMessage = chat.messages.find(m => m.type === 'bot');
    if (firstBotMessage && firstBotMessage.type === 'bot') {
      const content = firstBotMessage.content;
      return content.length > 60 ? content.substring(0, 60) + '...' : content;
    }
    
    return 'New chat';
  };

  const title = chat.title || getPreview();

  return (
    <div 
      className={`chat-history-card ${isSelected ? 'selected' : ''}`}
      onClick={() => onClick(chat)}
    >
      <div className="chat-history-card-header">
        <h3 className="chat-history-card-title">{title}</h3>
        {chat.environment === 'testnet' && (
          <EnvironmentBadge environment={chat.environment} />
        )}
      </div>
      
      {chat.messages.length > 0 && (
        <p className="chat-history-card-preview">{getPreview()}</p>
      )}
      
      <div className="chat-history-card-footer">
        <span className="chat-history-card-date">
          {formatDate(chat.updatedAt)}
        </span>
        {chat.messages.length > 0 && (
          <span className="chat-history-card-message-count">
            {chat.messages.length} {chat.messages.length === 1 ? 'message' : 'messages'}
          </span>
        )}
      </div>
    </div>
  );
};

export default ChatHistoryCard;

