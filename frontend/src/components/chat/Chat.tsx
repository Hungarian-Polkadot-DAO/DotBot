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
import SimulationStatus from '../simulation/SimulationStatus';

interface ChatProps {
  dotbot: DotBot;
  onSendMessage: (message: string) => Promise<void>;
  isTyping?: boolean;
  disabled?: boolean;
  placeholder?: string;
  simulationStatus?: {
    phase: string;
    message: string;
    progress?: number;
    details?: string;
    chain?: string;
    result?: any;
  } | null;
}

const Chat: React.FC<ChatProps> = ({
  dotbot,
  onSendMessage,
  isTyping = false,
  disabled = false,
  placeholder = "Type your message...",
  simulationStatus
}) => {
  const [inputValue, setInputValue] = useState('');
  const { registerSetter } = useChatInput();

  // Register setInputValue with context (for ScenarioEngine)
  useEffect(() => {
    registerSetter(setInputValue);
  }, [registerSetter, setInputValue]);

  // Get conversation items from ChatInstance
  const conversationItems: ConversationItem[] = dotbot.currentChat?.getDisplayMessages() || [];

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
          items={conversationItems}
                dotbot={dotbot}
              />
        
        {/* Simulation Status */}
        {simulationStatus && (
          <SimulationStatus
            phase={simulationStatus.phase as any}
            message={simulationStatus.message}
            progress={simulationStatus.progress}
            details={simulationStatus.details}
            chain={simulationStatus.chain}
          />
        )}
        
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

