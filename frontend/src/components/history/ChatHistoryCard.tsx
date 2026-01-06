/**
 * ChatHistoryCard Component
 * 
 * Displays a single chat instance in the history list.
 * Shows title, preview, timestamp, and environment badge (for testnet).
 * Supports inline editing of chat title.
 */

import React, { useState, useRef, useEffect } from 'react';
import type { ChatInstanceData } from '../../lib/types/chatInstance';
import type { DotBot } from '../../lib/dotbot';
import EnvironmentBadge from '../wallet/EnvironmentBadge';
import '../../styles/chat-history-card.css';

interface ChatHistoryCardProps {
  chat: ChatInstanceData;
  dotbot: DotBot;
  onClick: (chat: ChatInstanceData) => void;
  onRenamed?: () => void;
  isSelected?: boolean;
}

const ChatHistoryCard: React.FC<ChatHistoryCardProps> = ({ 
  chat, 
  dotbot,
  onClick,
  onRenamed,
  isSelected = false 
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(chat.title || '');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleTitleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isEditing) {
      setIsEditing(true);
      setEditedTitle(chat.title || '');
    }
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditedTitle(e.target.value);
  };

  const handleTitleBlur = async () => {
    await saveTitle();
  };

  const handleTitleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await saveTitle();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditedTitle(chat.title || '');
    }
  };

  const saveTitle = async () => {
    if (isSaving) return;
    
    const trimmedTitle = editedTitle.trim();
    if (trimmedTitle === (chat.title || '')) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      // Update through ChatInstanceManager
      const chatManager = dotbot.getChatManager();
      await chatManager.updateInstance(chat.id, { title: trimmedTitle || undefined });
      onRenamed?.();
    } catch (error) {
      console.error('Failed to save chat title:', error);
      // Revert on error
      setEditedTitle(chat.title || '');
    } finally {
      setIsSaving(false);
      setIsEditing(false);
    }
  };
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

  const displayTitle = chat.title || chat.id;

  return (
    <div 
      className={`chat-history-card ${isSelected ? 'selected' : ''}`}
      onClick={() => !isEditing && onClick(chat)}
    >
      <div className="chat-history-card-header">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editedTitle}
            onChange={handleTitleChange}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            className="chat-history-card-title-input"
            disabled={isSaving}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <h3 
            className="chat-history-card-title"
            onClick={handleTitleClick}
            title="Click to rename"
          >
            {displayTitle}
          </h3>
        )}
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

