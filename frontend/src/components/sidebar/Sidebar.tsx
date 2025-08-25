// Sidebar component - matches ChatGPT-like design

import React from 'react';
import { ChatSession } from '../../types/chat';
import NewChatButton from './NewChatButton';
import ChatHistory from './ChatHistory';
import TransactionHistory from './TransactionHistory';

interface SidebarProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  className?: string;
}

const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  currentSessionId,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  className = ''
}) => {
  return (
    <div className={`flex flex-col h-full bg-gray-900 border-r border-gray-700 ${className}`}>
      {/* Header with New Chat button */}
      <div className="p-4 border-b border-gray-700">
        <NewChatButton onClick={onNewChat} />
      </div>

      {/* Search functionality (placeholder for future) */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center space-x-3 text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
          <div className="w-4 h-4">🔍</div>
          <span className="text-sm">Search Chat</span>
        </div>
      </div>

      {/* Chat History */}
      <div className="flex-1 overflow-y-auto">
        <ChatHistory
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelectSession={onSelectSession}
          onDeleteSession={onDeleteSession}
        />
      </div>

      {/* Transaction History Link */}
      <div className="border-t border-gray-700 p-4">
        <div className="flex items-center space-x-3 text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
          <div className="w-4 h-4">📊</div>
          <span className="text-sm">Transactions</span>
        </div>
      </div>

      {/* Footer with settings and user info */}
      <div className="border-t border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-r from-pink-500 to-violet-500 rounded-full flex items-center justify-center text-white text-sm font-semibold">
              D
            </div>
            <span className="text-sm text-gray-300">DotBot User</span>
          </div>
          <button className="text-gray-400 hover:text-gray-300 transition-colors">
            ⚙️
          </button>
        </div>
        
        {/* Powered by ASI.One */}
        <div className="mt-2 text-xs text-gray-500">
          Powered by ASI.One
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
