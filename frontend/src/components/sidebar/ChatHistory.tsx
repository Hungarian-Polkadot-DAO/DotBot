import React from 'react';
import { ChatSession } from '../../types/chat';

interface ChatHistoryProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
}

const ChatHistory: React.FC<ChatHistoryProps> = ({
  sessions,
  currentSessionId,
  onSelectSession,
  onDeleteSession
}) => {
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="p-2">
      {sessions.length === 0 ? (
        <div className="text-center text-gray-500 py-8">
          <p>No conversations yet</p>
          <p className="text-sm mt-1">Start a new chat to get going!</p>
        </div>
      ) : (
        <div className="space-y-1">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`group relative p-3 rounded-lg cursor-pointer transition-colors ${
                currentSessionId === session.id
                  ? 'bg-blue-600 text-white'
                  : 'hover:bg-gray-800 text-gray-300'
              }`}
              onClick={() => onSelectSession(session.id)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium truncate">
                    {session.title || 'New conversation'}
                  </h3>
                  <p className="text-xs opacity-75 mt-1">
                    {formatDate(session.updatedAt)}
                  </p>
                </div>
                
                {onDeleteSession && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 transition-all p-1"
                  >
                    🗑️
                  </button>
                )}
              </div>
              
              {session.messages.length > 0 && (
                <p className="text-xs opacity-60 mt-1 truncate">
                  {session.messages[session.messages.length - 1].content}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ChatHistory;
