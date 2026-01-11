/**
 * Chat Component
 * 
 * Main conversation UI that manages the message list and renders
 * different item types (text messages, execution flows, system notifications).
 * 
 * This component will be part of @dotbot/react package.
 */

import React, { useState, useEffect } from 'react';
import type { DotBot, ConversationItem } from '../../lib';
import { useChatInput } from '../../contexts/ChatInputContext';
import MessageList from './MessageList';
import ConversationItems from './ConversationItems';
import ChatInput from './ChatInput';
import TypingIndicator from './TypingIndicator';

interface ChatProps {
  dotbot: DotBot;
  onSendMessage: (message: string) => Promise<void>;
  isTyping?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

const Chat: React.FC<ChatProps> = ({
  dotbot,
  onSendMessage,
  isTyping = false,
  disabled = false,
  placeholder = "Type your message...",
}) => {
  const [inputValue, setInputValue] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const { registerSetter } = useChatInput();

  // Register setInputValue with context (for ScenarioEngine)
  useEffect(() => {
    registerSetter(setInputValue);
  }, [registerSetter, setInputValue]);

  // Get conversation items from ChatInstance
  const conversationItems: ConversationItem[] = dotbot.currentChat?.getDisplayMessages() || [];
  
  // Force re-render when executionArray is added to execution messages
  // This ensures ExecutionFlow appears immediately when executionMessage is updated
  useEffect(() => {
    if (!dotbot.currentChat) return;
    
    const hasExecutionMessages = conversationItems.some(item => item.type === 'execution');
    if (!hasExecutionMessages) return;
    
    // Poll for executionArray updates (in case updateExecutionInChat hasn't triggered a re-render)
    const interval = setInterval(() => {
      const currentItems = dotbot.currentChat?.getDisplayMessages() || [];
      const hasExecutionArrays = currentItems.some(
        item => item.type === 'execution' && (item as any).executionArray
      );
      
      if (hasExecutionArrays) {
        setRefreshKey(prev => prev + 1);
        clearInterval(interval);
      }
    }, 150); // Check every 150ms
    
    return () => clearInterval(interval);
  }, [dotbot.currentChat, conversationItems.length]);

  const handleSubmit = async () => {
    const trimmedValue = inputValue.trim();
    if (trimmedValue && !isTyping) {
      // Clear input immediately to prevent double submission
      setInputValue('');
      await onSendMessage(trimmedValue);
    }
  };

  return (
    <div className="chat-container">
      {/* Messages */}
      <MessageList>
        <ConversationItems 
          key={refreshKey}
          items={conversationItems}
          dotbot={dotbot}
        />
        
        {/* Typing indicator */}
        {isTyping && <TypingIndicator />}
      </MessageList>

      {/* Input area */}
      <ChatInput
              value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
              placeholder={placeholder}
              disabled={disabled}
        isTyping={isTyping}
                />
    </div>
  );
};

export default Chat;

