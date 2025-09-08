import React from 'react';
import { Receipt, ArrowRightLeft, BarChart3 } from 'lucide-react';
import WalletButton from '../wallet/WalletButton';
import ChatInterface from '../chat/ChatInterface';

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
      icon: Receipt,
      label: 'Check Balance',
      onClick: onCheckBalance
    },
    {
      icon: ArrowRightLeft,
      label: 'Transfer',
      onClick: onTransfer
    },
    {
      icon: BarChart3,
      label: 'Status',
      onClick: onStatus
    }
  ];

  return (
    <div className="main-content">
      {/* Header with Wallet */}
      <div className="main-header">
        <WalletButton />
      </div>

      {/* Main Body */}
      <div className="main-body">
        {showWelcomeScreen ? (
          /* Welcome Screen */
          <div className="welcome-screen">
            {/* DotBot Logo/Title */}
            <div style={{ textAlign: 'center', marginBottom: '48px' }}>
              <h1 className="welcome-title">
                DotBot
              </h1>
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
                  <action.icon className="quick-action-icon" />
                  <span className="quick-action-label">
                    {action.label}
                  </span>
                </button>
              ))}
            </div>

            {/* Welcome Input */}
            <div style={{ width: '100%', maxWidth: '768px' }}>
              <div className="input-container">
                <form onSubmit={(e) => e.preventDefault()} className="input-form">
                  <input
                    type="text"
                    placeholder="Type your message..."
                    className="input-field"
                    style={{ paddingRight: '48px' }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                        onSendMessage(e.currentTarget.value.trim());
                        e.currentTarget.value = '';
                      }
                    }}
                  />
                </form>
              </div>
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
