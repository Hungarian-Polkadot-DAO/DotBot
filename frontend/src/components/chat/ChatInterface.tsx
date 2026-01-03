import React, { useState, useRef, useEffect } from 'react';
import voiceIcon from '../../assets/mingcute_voice-line.svg';
import actionButtonIcon from '../../assets/action-button.svg';
import SimulationStatus from '../simulation/SimulationStatus';

interface Message {
  id: string;
  type: 'user' | 'bot';
  content: string;
  timestamp: number;
}

interface ChatInterfaceProps {
  onSendMessage: (message: string) => void;
  messages: Message[];
  isTyping?: boolean;
  disabled?: boolean;
  placeholder?: string;
  executionFlow?: React.ReactNode;
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

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  onSendMessage,
  messages,
  isTyping = false,
  disabled = false,
  placeholder = "Type your message...",
  executionFlow,
  simulationStatus
}) => {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = inputRef.current.scrollHeight + 'px';
    }
  }, [inputValue]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedValue = inputValue.trim();
    if (trimmedValue) {
      onSendMessage(trimmedValue);
      setInputValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="chat-container">
      {/* Messages */}
      <div className="chat-messages">
        {messages.map((message) => (
          <div key={message.id} className={`message ${message.type}`}>
            <div className={`message-avatar ${message.type}`}>
              {message.type === 'user' ? 'U' : 'D'}
            </div>
            <div className="message-content">
              <div className="message-bubble">
                {message.content}
              </div>
              <div className="message-time">
                {formatTime(message.timestamp)}
              </div>
            </div>
          </div>
        ))}
        
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
        
        {/* Execution Flow - appears after messages */}
        {executionFlow}
        
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
              disabled={disabled}
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

export default ChatInterface;
