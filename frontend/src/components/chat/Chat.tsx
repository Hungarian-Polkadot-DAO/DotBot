/**
 * Chat Component
 * 
 * Main conversation UI that manages the message list and renders
 * different item types (text messages, execution flows, system notifications).
 * 
 * This component will be part of @dotbot/react package.
 */

import React, { useState, useRef, useEffect } from 'react';
import type { DotBot } from '../../lib';
import type { ConversationItem } from '../../lib';
import Message from './Message';
import ExecutionFlow from '../execution/ExecutionFlow';
import SimulationStatus from '../simulation/SimulationStatus';
import voiceIcon from '../../assets/mingcute_voice-line.svg';
import actionButtonIcon from '../../assets/action-button.svg';

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Get conversation items from ChatInstance
  const conversationItems: ConversationItem[] = dotbot.currentChat?.getDisplayMessages() || [];

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversationItems.length, isTyping]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = inputRef.current.scrollHeight + 'px';
    }
  }, [inputValue]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedValue = inputValue.trim();
    if (trimmedValue && !isTyping) {
      // Clear input immediately to prevent double submission
      setInputValue('');
      await onSendMessage(trimmedValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="chat-container">
      {/* Messages */}
      <div className="chat-messages">
        {/* Render all conversation items (mixed array) */}
        {conversationItems.map((item) => {
          // Execution Flow
          if (item.type === 'execution') {
            return (
              <ExecutionFlow
                key={item.id}
                executionMessage={item}
                dotbot={dotbot}
              />
            );
          }
          
          // Text Messages (user/bot/system)
          if (item.type === 'user' || item.type === 'bot' || item.type === 'system') {
            return (
              <Message
                key={item.id}
                message={item}
              />
            );
          }

          // Future: knowledge-request, search-request, etc.
          return null;
        })}
        
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
        {isTyping && (
          <div className="message bot">
            <div className="message-avatar bot">D</div>
            <div className="message-content">
              <div className="typing-indicator">
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="input-area">
        <div className="input-container">
          <form onSubmit={handleSubmit} className="action-badge">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              rows={1}
              disabled={disabled || isTyping}
            />
            {!inputValue.trim() ? (
              <button
                type="button"
                className="input-action-btn mic"
                title="Voice input"
                disabled={disabled}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  padding: '0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: disabled ? 0.5 : 1,
                  cursor: disabled ? 'not-allowed' : 'pointer'
                }}
              >
                <img 
                  src={voiceIcon} 
                  alt="Voice input"
                  style={{ width: '32px', height: '32px' }}
                />
              </button>
            ) : (
              <button
                type="submit"
                className="action-button"
                title="Send message"
                disabled={disabled || isTyping}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: (disabled || isTyping) ? 0.5 : 1,
                  cursor: (disabled || isTyping) ? 'not-allowed' : 'pointer'
                }}
              >
                <img 
                  src={actionButtonIcon} 
                  alt="Send message"
                  style={{ width: '32px', height: '32px' }}
                />
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};

export default Chat;

