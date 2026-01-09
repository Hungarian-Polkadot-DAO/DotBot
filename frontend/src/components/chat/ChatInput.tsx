/**
 * ChatInput Component
 * 
 * Input area with textarea, voice button, and send button.
 * Handles auto-resize, keyboard shortcuts, and loading states.
 * 
 * Part of @dotbot/react package.
 */

import React, { useRef, useEffect, useState } from 'react';
import { useChatInput } from '../../contexts/ChatInputContext';
import voiceIcon from '../../assets/mingcute_voice-line.svg';
import actionButtonIcon from '../../assets/action-button.svg';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  isTyping?: boolean;
}

const ChatInput: React.FC<ChatInputProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder = "Type your message...",
  disabled = false,
  isTyping = false
}) => {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { lastInjectionTime } = useChatInput();
  const [isInjected, setIsInjected] = useState(false);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = inputRef.current.scrollHeight + 'px';
    }
  }, [value]);

  // Visual effect when injection happens
  useEffect(() => {
    if (lastInjectionTime > 0) {
      setIsInjected(true);
      if (containerRef.current) {
        containerRef.current.classList.add('chat-input-injected');
      }
      const timer = setTimeout(() => {
        setIsInjected(false);
        if (containerRef.current) {
          containerRef.current.classList.remove('chat-input-injected');
        }
      }, 2000); // Animation lasts 2 seconds
      return () => clearTimeout(timer);
    }
  }, [lastInjectionTime]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !isTyping && !disabled) {
        onSubmit();
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim() && !isTyping && !disabled) {
      onSubmit();
    }
  };

  const isDisabled = disabled || isTyping;

  return (
    <div className="input-area">
      <div ref={containerRef} className={`input-container ${isInjected ? 'chat-input-injected' : ''}`}>
        <form onSubmit={handleSubmit} className="action-badge">
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={isDisabled}
          />
          {!value.trim() ? (
            <button
              type="button"
              className="input-action-btn mic"
              title="Voice input"
              disabled={isDisabled}
              style={{ 
                background: 'none', 
                border: 'none', 
                padding: '0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: isDisabled ? 0.5 : 1,
                cursor: isDisabled ? 'not-allowed' : 'pointer'
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
              disabled={isDisabled}
              style={{
                background: 'none',
                border: 'none',
                padding: '0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: isDisabled ? 0.5 : 1,
                cursor: isDisabled ? 'not-allowed' : 'pointer'
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
  );
};

export default ChatInput;

