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
  onChatRenamed?: () => void;
  currentChatId?: string;
  refreshTrigger?: number;
}

const ChatHistory: React.FC<ChatHistoryProps> = ({ 
  dotbot,
  onSelectChat,
  onChatRenamed,
  currentChatId,
  refreshTrigger
}) => {
  const [chats, setChats] = useState<ChatInstanceData[]>([]);
  const [filteredChats, setFilteredChats] = useState<ChatInstanceData[]>([]);
  const [showTestnet, setShowTestnet] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadChats();
  }, [dotbot, refreshTrigger]);

  useEffect(() => {
    filterChats();
  }, [chats, showTestnet, searchQuery]);

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
    let filtered = chats;
    
    // Filter by environment
    if (!showTestnet) {
      filtered = filtered.filter(chat => chat.environment === 'mainnet');
    }
    
    // Filter by search query
    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase();
      filtered = filtered.filter(chat => {
        // Search title
        if (chat.title?.toLowerCase().includes(lowerQuery)) {
          return true;
        }
        
        // Search messages
        return chat.messages.some(msg => {
          if (msg.type === 'user' || msg.type === 'bot' || msg.type === 'system') {
            return msg.content.toLowerCase().includes(lowerQuery);
          }
          return false;
        });
      });
    }
    
    setFilteredChats(filtered);
  };

  const handleToggleTestnet = () => {
    setShowTestnet(!showTestnet);
  };

  const testnetCount = chats.filter(chat => chat.environment === 'testnet').length;

  return (
    <div className="chat-history">
      <div className="chat-history-content">
        {/* Menu Bar */}
        <div className="chat-history-menu-bar">
          <div className="chat-history-search-container">
            <input
              type="text"
              placeholder="Search chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="chat-history-search-input"
            />
          </div>
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

        <div className="chat-history-header">
          <h2 className="chat-history-title">Chat History</h2>
        </div>

      {isLoading ? (
        <div className="chat-history-loading">
          <div className="chat-history-loading-spinner"></div>
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
          <p>{searchQuery ? 'No chats match your search' : 'No chats found'}</p>
          {!showTestnet && testnetCount > 0 && !searchQuery && (
            <p className="chat-history-empty-hint">
              Enable "Display testnet chats" to see {testnetCount} testnet chat{testnetCount !== 1 ? 's' : ''}
            </p>
          )}
          {searchQuery && (
            <p className="chat-history-empty-hint">
              Try a different search term or clear the search
            </p>
          )}
        </div>
      ) : (
        <div className="chat-history-list">
          {filteredChats.map((chat) => (
            <ChatHistoryCard
              key={chat.id}
              chat={chat}
              dotbot={dotbot}
              onClick={onSelectChat}
              onRenamed={onChatRenamed}
              isSelected={chat.id === currentChatId}
            />
          ))}
        </div>
      )}
      </div>
    </div>
  );
};

export default ChatHistory;

