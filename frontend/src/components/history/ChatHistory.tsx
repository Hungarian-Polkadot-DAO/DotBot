/**
 * ChatHistory Component
 * 
 * Displays a list of chat history with filtering options.
 * Includes toggle for testnet/mainnet chats.
 */

import React, { useState, useEffect } from 'react';
import type { ChatInstanceData } from '../../lib/types/chatInstance';
import type { DotBot } from '../../lib/dotbot';
import ChatHistoryCard from './ChatHistoryCard';
import '../../styles/chat-history.css';

interface ChatHistoryProps {
  dotbot: DotBot;
  onSelectChat: (chat: ChatInstanceData) => void;
  currentChatId?: string;
}

const ChatHistory: React.FC<ChatHistoryProps> = ({ 
  dotbot,
  onSelectChat, 
  currentChatId
}) => {
  const [chats, setChats] = useState<ChatInstanceData[]>([]);
  const [filteredChats, setFilteredChats] = useState<ChatInstanceData[]>([]);
  const [showTestnet, setShowTestnet] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadChats();
  }, [dotbot]);

  useEffect(() => {
    filterChats();
  }, [chats, showTestnet]);

  const loadChats = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const chatManager = dotbot.getChatManager();
      const allChats = await chatManager.loadInstances();
      
      setChats(allChats);
    } catch (err) {
      console.error('Failed to load chat history:', err);
      setError('Failed to load chat history');
    } finally {
      setIsLoading(false);
    }
  };

  const filterChats = () => {
    if (showTestnet) {
      // Show all chats
      setFilteredChats(chats);
    } else {
      // Show only mainnet chats
      setFilteredChats(chats.filter(chat => chat.environment === 'mainnet'));
    }
  };

  const handleToggleTestnet = () => {
    setShowTestnet(!showTestnet);
  };

  const testnetCount = chats.filter(chat => chat.environment === 'testnet').length;

  return (
    <div className="chat-history">
      <div className="chat-history-header">
        <h2 className="chat-history-title">Chat History</h2>
        {testnetCount > 0 && (
          <label className="chat-history-toggle">
            <input
              type="checkbox"
              checked={showTestnet}
              onChange={handleToggleTestnet}
            />
            <span className="chat-history-toggle-label">
              Display testnet chats ({testnetCount})
            </span>
          </label>
        )}
      </div>

      {isLoading ? (
        <div className="chat-history-loading">
          <p>Loading chat history...</p>
        </div>
      ) : error ? (
        <div className="chat-history-error">
          <p>{error}</p>
          <button onClick={loadChats} className="chat-history-retry">
            Retry
          </button>
        </div>
      ) : filteredChats.length === 0 ? (
        <div className="chat-history-empty">
          <p>No chats found</p>
          {!showTestnet && testnetCount > 0 && (
            <p className="chat-history-empty-hint">
              Enable "Display testnet chats" to see {testnetCount} testnet chat{testnetCount !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      ) : (
        <div className="chat-history-list">
          {filteredChats.map((chat) => (
            <ChatHistoryCard
              key={chat.id}
              chat={chat}
              onClick={onSelectChat}
              isSelected={chat.id === currentChatId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ChatHistory;

