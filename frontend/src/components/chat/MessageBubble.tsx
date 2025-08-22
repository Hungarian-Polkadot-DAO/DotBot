import React from 'react';
import { Message } from '../../types/chat';
import { AgentInfo } from '../../types/agents';

interface MessageBubbleProps {
  message: Message;
  agents: AgentInfo[];
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, agents }) => {
  const getAgentInfo = (agentId?: string) => {
    if (!agentId) return null;
    return agents.find(agent => agent.id === agentId);
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const isUser = message.type === 'user';
  const agentInfo = getAgentInfo(message.agentId);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-[70%] ${isUser ? 'order-2' : 'order-1'}`}>
        {/* Agent info */}
        {!isUser && (
          <div className="flex items-center mb-2">
            <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs text-white mr-2">
              {message.agentName?.[0] || 'A'}
            </div>
            <span className="text-sm text-gray-400">
              {message.agentName || agentInfo?.name || 'DotBot'}
            </span>
          </div>
        )}

        {/* Message bubble */}
        <div
          className={`rounded-lg px-4 py-3 ${
            isUser
              ? 'bg-blue-600 text-white ml-4'
              : 'bg-gray-800 text-gray-100 mr-4'
          }`}
        >
          <div className="whitespace-pre-wrap break-words">
            {message.content}
          </div>
          
          {/* Metadata */}
          {message.metadata && (
            <div className="mt-2 pt-2 border-t border-gray-600 text-xs opacity-75">
              {message.metadata.confidence && (
                <div>Confidence: {Math.round(message.metadata.confidence * 100)}%</div>
              )}
              {message.metadata.actionRequired && (
                <div className="text-yellow-400">Action required</div>
              )}
            </div>
          )}
          
          {/* Timestamp */}
          <div className={`text-xs mt-2 ${isUser ? 'text-blue-200' : 'text-gray-500'}`}>
            {formatTime(message.timestamp)}
          </div>
        </div>

        {/* Transaction data */}
        {message.metadata?.transactionData && (
          <div className="mt-2 p-3 bg-gray-900 rounded-lg border border-gray-700">
            <div className="text-sm text-gray-300 mb-2">Transaction Details</div>
            <pre className="text-xs text-gray-400 overflow-x-auto">
              {JSON.stringify(message.metadata.transactionData, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;
