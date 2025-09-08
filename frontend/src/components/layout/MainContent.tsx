import React from 'react';
import WalletButton from '../wallet/WalletButton';
import ThemeToggle from '../ui/ThemeToggle';
import ChatInterface from '../chat/ChatInterface';
import dotbotLogo from '../../assets/DotBotLogo.svg';
import coinStackIcon from '../../assets/coin-stack.svg';
import iconTransactions from '../../assets/icon-transactions.svg';
import iconCog from '../../assets/icon-cog.svg';

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
  messages: Message[];
  isTyping: boolean;
  showWelcomeScreen: boolean;
}

const MainContent: React.FC<MainContentProps> = ({
  onCheckBalance,
  onTransfer,
  onStatus,
  onSendMessage,
  messages,
  isTyping,
  showWelcomeScreen
}) => {
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
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <img 
                src={dotbotLogo} 
                alt="DotBot" 
                style={{ height: '80px', width: 'auto', marginBottom: '16px' }}
              />
              <p className="welcome-subtitle">
                What's the dot you need help with?
              </p>
            </div>

            {/* Quick Action Buttons */}
            <div className="quick-actions">
              {quickActions.map((action, index) => (
                <button
                  key={index}
                  onClick={action.onClick}
                  className="quick-action-btn"
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
                <input
                  type="text"
                  placeholder="Type your message..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                      onSendMessage(e.currentTarget.value.trim());
                      e.currentTarget.value = '';
                    }
                  }}
                />
                <button
                  type="button"
                  className="action-button"
                  onClick={() => {
                    const input = document.querySelector('.action-badge input') as HTMLInputElement;
                    if (input?.value.trim()) {
                      onSendMessage(input.value.trim());
                      input.value = '';
                    }
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22,2 15,22 11,13 2,9 22,2"></polygon>
                  </svg>
                </button>
              </form>
            </div>
          </div>
        ) : (
          /* Chat Interface */
          <ChatInterface
            messages={messages}
            onSendMessage={onSendMessage}
            isTyping={isTyping}
          />
        )}
      </div>
    </div>
  );
};

export default MainContent;
