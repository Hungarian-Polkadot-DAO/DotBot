// Main chat interface component - ready for ChatGPT-like design

import React, { useState, useEffect, useRef } from 'react';
import { Message, ChatSession } from '../../types/chat';
import { AgentInfo } from '../../types/agents';
import MessageBubble from './MessageBubble';
import InputField from './InputField';
import TypingIndicator from './TypingIndicator';

interface ChatInterfaceProps {
  session: ChatSession | null;
  agents: AgentInfo[];
  onSendMessage: (message: string) => void;
  onVoiceInput?: () => void;
  isTyping?: boolean;
  className?: string;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  session,
  agents,
  onSendMessage,
  onVoiceInput,
  isTyping = false,
  className = ''
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState('');

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    scrollToBottom();
  }, [session?.messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = () => {
    if (inputValue.trim()) {
      onSendMessage(inputValue.trim());
      setInputValue('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Welcome message when no session
  const renderWelcomeMessage = () => (
    <div className=\"flex flex-col items-center justify-center h-full text-center p-8\">
      <div className=\"mb-8\">
        <h1 className=\"text-4xl font-bold mb-4 bg-gradient-to-r from-pink-500 to-violet-500 bg-clip-text text-transparent\">
          DotBot
        </h1>
        <p className=\"text-lg text-gray-400 mb-8\">
          What's the dot you need help with?
        </p>
      </div>
      
      {/* Quick action buttons matching the design */}
      <div className=\"flex gap-4 mb-8\">
        <button
          onClick={() => onSendMessage('Check my balance')}
          className=\"flex flex-col items-center p-4 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors\"
        >
          <div className=\"w-8 h-8 mb-2\">📊</div>
          <span className=\"text-sm text-gray-300\">Check Balance</span>
        </button>
        
        <button
          onClick={() => onSendMessage('Transfer DOT')}
          className=\"flex flex-col items-center p-4 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors\"
        >
          <div className=\"w-8 h-8 mb-2\">⇄</div>
          <span className=\"text-sm text-gray-300\">Transfer</span>
        </button>
        
        <button
          onClick={() => onSendMessage('Check network status')}
          className=\"flex flex-col items-center p-4 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors\"
        >
          <div className=\"w-8 h-8 mb-2\">📈</div>
          <span className=\"text-sm text-gray-300\">Status</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Messages area */}
      <div className=\"flex-1 overflow-y-auto p-4 space-y-4\">
        {!session || session.messages.length === 0 ? (
          renderWelcomeMessage()
        ) : (
          <>
            {session.messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                agents={agents}
              />
            ))}
            {isTyping && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <div className=\"border-t border-gray-700 p-4\">
        <InputField
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSendMessage}
          onKeyPress={handleKeyPress}
          onVoiceInput={onVoiceInput}
          placeholder=\"Type your message...\"
          disabled={isTyping}
        />
      </div>
    </div>
  );
};

export default ChatInterface;
