/**
 * Welcome Screen Component
 * 
 * Shows quick actions and initial input when starting a new chat.
 * 
 * This component will be part of @dotbot/react package.
 */

import React, { useState, useRef, useEffect } from 'react';
import dotbotLogo from '../../assets/DotBotLogo.svg';
import coinStackIcon from '../../assets/coin-stack.svg';
import iconTransactions from '../../assets/icon-transactions.svg';
import iconCog from '../../assets/icon-cog.svg';
import voiceIcon from '../../assets/mingcute_voice-line.svg';
import actionButtonIcon from '../../assets/action-button.svg';

interface WelcomeScreenProps {
  onSendMessage: (message: string) => Promise<any>;
  onCheckBalance: () => void;
  onTransfer: () => void;
  onStatus: () => void;
  disabled?: boolean;
  placeholder?: string;
  isTyping?: boolean;
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onSendMessage,
  onCheckBalance,
  onTransfer,
  onStatus,
  disabled = false,
  placeholder = "Type your message...",
  isTyping = false
}) => {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
    if (trimmedValue && !disabled && !isTyping) {
      // Clear input immediately to prevent double submission
      setInputValue('');
      await onSendMessage(trimmedValue);
    }
  };

  const quickActions = [
    {
      icon: coinStackIcon,
      label: 'Check Balance',
      onClick: onCheckBalance
    },
    {
      icon: iconTransactions,
      label: 'Transfer',
      onClick: onTransfer
    },
    {
      icon: iconCog,
      label: 'Status',
      onClick: onStatus
    }
  ];

  return (
    <div className="welcome-screen">
      {/* DotBot Logo/Title */}
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <img 
          src={dotbotLogo} 
          alt="DotBot" 
          style={{ height: '60px', width: 'auto', marginBottom: '12px' }}
        />
        <p className="welcome-subtitle">
          Let's connect the dots! How can I help you today?
        </p>
      </div>

      {/* Quick Action Buttons */}
      <div className="quick-actions">
        {quickActions.map((action, index) => (
          <button
            key={index}
            onClick={action.onClick}
            className="quick-action-btn"
            disabled={disabled || isTyping}
            style={{
              opacity: (disabled || isTyping) ? 0.5 : 1,
              cursor: (disabled || isTyping) ? 'not-allowed' : 'pointer'
            }}
          >
            <img 
              src={action.icon} 
              alt={action.label}
              className="quick-action-icon"
            />
            <span className="quick-action-label">
              {action.label}
            </span>
          </button>
        ))}
      </div>

      {/* Welcome Input */}
      <div style={{ width: '100%', maxWidth: '720px' }}>
        <form 
          onSubmit={handleSubmit} 
          className="action-badge"
        >
          <textarea
            ref={inputRef}
            placeholder={placeholder}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && inputValue.trim()) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            rows={1}
            disabled={disabled || isTyping}
          />
          {!inputValue.trim() ? (
            <button
              type="button"
              className="input-action-btn mic"
              title="Voice input"
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
  );
};

export default WelcomeScreen;

