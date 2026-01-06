import React, { useState, useRef, useEffect } from 'react';
import WalletButton from '../wallet/WalletButton';
import ThemeToggle from '../ui/ThemeToggle';
import ChatInterface from '../chat/ChatInterface';
import dotbotLogo from '../../assets/DotBotLogo.svg';
import coinStackIcon from '../../assets/coin-stack.svg';
import iconTransactions from '../../assets/icon-transactions.svg';
import iconCog from '../../assets/icon-cog.svg';
import voiceIcon from '../../assets/mingcute_voice-line.svg';
import actionButtonIcon from '../../assets/action-button.svg';
import type { ConversationItem, ExecutionMessage as ExecutionMessageType } from '../../lib';

interface Message {
  id: string;
  type: 'user' | 'bot';
  content: string;
  timestamp: number;
}

interface MainContentProps {
  onCheckBalance: () => void;
  onTransfer: () => void;
  onStatus: () => void;
  onSendMessage: (message: string) => void;
  messages?: Message[];  // Deprecated: use conversationItems instead
  conversationItems?: ConversationItem[];  // New: mixed array of messages + execution flows
  isTyping: boolean;
  showWelcomeScreen: boolean;
  disabled?: boolean;
  placeholder?: string;
  executionFlow?: React.ReactNode;  // Deprecated: execution flows are in conversationItems
  renderExecutionFlow?: (executionMessage: ExecutionMessageType) => React.ReactNode;
  simulationStatus?: {
    phase: string;
    message: string;
    progress?: number;
    details?: string;
    chain?: string;
    result?: {
      success: boolean;
      estimatedFee?: string;
      validationMethod?: 'chopsticks' | 'paymentInfo';
      balanceChanges?: Array<{ value: string; change: 'send' | 'receive' }>;
      runtimeInfo?: Record<string, any>;
      error?: string;
      wouldSucceed?: boolean;
    };
  } | null;
}

const MainContent: React.FC<MainContentProps> = ({
  onCheckBalance,
  onTransfer,
  onStatus,
  onSendMessage,
  messages,
  conversationItems,
  isTyping,
  showWelcomeScreen,
  disabled = false,
  placeholder = "Type your message...",
  executionFlow,
  renderExecutionFlow,
  simulationStatus
}) => {
  const [welcomeInputValue, setWelcomeInputValue] = useState('');
  const welcomeInputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize welcome textarea
  useEffect(() => {
    if (welcomeInputRef.current) {
      welcomeInputRef.current.style.height = 'auto';
      welcomeInputRef.current.style.height = welcomeInputRef.current.scrollHeight + 'px';
    }
  }, [welcomeInputValue]);

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
    <div className="main-content">
      {/* Header with Theme Toggle and Wallet */}
      <div className="main-header">
        <ThemeToggle />
        <WalletButton />
      </div>

      {/* Main Body */}
      <div className="main-body">
        {showWelcomeScreen ? (
          /* Welcome Screen */
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
                  disabled={disabled}
                  style={{
                    opacity: disabled ? 0.5 : 1,
                    cursor: disabled ? 'not-allowed' : 'pointer'
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
                onSubmit={(e) => e.preventDefault()} 
                className="action-badge"
              >
                <textarea
                  ref={welcomeInputRef}
                  placeholder={placeholder}
                  value={welcomeInputValue}
                  onChange={(e) => setWelcomeInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && welcomeInputValue.trim()) {
                      e.preventDefault();
                      onSendMessage(welcomeInputValue.trim());
                      setWelcomeInputValue('');
                    }
                  }}
                  rows={1}
                  disabled={disabled}
                />
                {!welcomeInputValue.trim() ? (
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
                    type="button"
                    className="action-button"
                    title="Send message"
                    disabled={disabled}
                    onClick={() => {
                      if (welcomeInputValue.trim()) {
                        onSendMessage(welcomeInputValue.trim());
                        setWelcomeInputValue('');
                      }
                    }}
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
                      src={actionButtonIcon} 
                      alt="Send message"
                      style={{ width: '32px', height: '32px' }}
                    />
                  </button>
                )}
              </form>
            </div>
          </div>
        ) : (
          /* Chat Interface */
          <ChatInterface
            messages={messages}
            conversationItems={conversationItems}
            onSendMessage={onSendMessage}
            isTyping={isTyping}
            disabled={disabled}
            placeholder={placeholder}
            executionFlow={executionFlow}
            renderExecutionFlow={renderExecutionFlow}
            simulationStatus={simulationStatus}
          />
        )}
      </div>
    </div>
  );
};

export default MainContent;
