import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ThemeProvider } from './contexts/ThemeContext';
import CollapsibleSidebar from './components/layout/CollapsibleSidebar';
import MainContent from './components/layout/MainContent';
import { createSubsystemLogger } from './config/logger';
import { Subsystem } from './types/logging';
import './styles/globals.css';

// Initialize logger for the main App
const logger = createSubsystemLogger(Subsystem.APP);

// React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

interface Message {
  id: string;
  type: 'user' | 'bot';
  content: string;
  timestamp: number;
}

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [showWelcomeScreen, setShowWelcomeScreen] = useState(true);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);

  // Initialize app
  useEffect(() => {
    initializeApp();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const initializeApp = async () => {
    logger.info("DotBot Frontend starting up - Hello World from logging system!");
  };

  // Handler functions
  const handleNewChat = () => {
    console.log('New Chat clicked');
    setMessages([]);
    setShowWelcomeScreen(true);
  };

  const handleSearchChat = () => {
    console.log('Search Chat clicked');
    // TODO: Implement search chat functionality
  };

  const handleTransactions = () => {
    console.log('Transactions clicked');
    // TODO: Implement transactions view
  };

  const handleCheckBalance = () => {
    const message = "Please check my DOT balance";
    handleSendMessage(message);
  };

  const handleTransfer = () => {
    const message = "I want to transfer some DOT";
    handleSendMessage(message);
  };

  const handleStatus = () => {
    const message = "Show me my transaction status";
    handleSendMessage(message);
  };

  const handleSendMessage = async (message: string) => {
    console.log('Message sent:', message);
    
    // Hide welcome screen when first message is sent
    if (showWelcomeScreen) {
      setShowWelcomeScreen(false);
    }

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: message,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsTyping(true);

    // Simulate bot response
    setTimeout(() => {
      const botMessage: Message = {
        id: Date.now().toString() + '_bot',
        type: 'bot',
        content: getBotResponse(message),
        timestamp: Date.now()
      };
      
      setMessages(prev => [...prev, botMessage]);
      setIsTyping(false);
    }, 1500);
  };

  const getBotResponse = (userMessage: string): string => {
    const message = userMessage.toLowerCase();
    
    if (message.includes('balance')) {
      return "I can help you check your DOT balance! To get started, please connect your wallet using the button in the top right corner. Once connected, I'll be able to fetch your current DOT balance and other token balances.";
    }
    
    if (message.includes('transfer')) {
      return "I'd be happy to help you transfer DOT! To proceed with a transfer, I'll need to know:\n\n1. The recipient's address\n2. The amount you want to transfer\n3. Which network you'd like to use\n\nPlease make sure your wallet is connected first. Would you like to start by connecting your wallet?";
    }
    
    if (message.includes('status')) {
      return "I can help you track transaction status! To check your transaction status, please provide:\n\n1. The transaction hash, or\n2. Let me know if you want to see recent transactions\n\nOnce your wallet is connected, I can also show you pending transactions and recent activity.";
    }
    
    if (message.includes('hello') || message.includes('hi')) {
      return "Hello! I'm DotBot, your helpful assistant for the Polkadot ecosystem. I can help you with:\n\n• Checking balances\n• Making transfers\n• Tracking transactions\n• Navigating the Polkadot network\n\nWhat would you like to do today?";
    }
    
    return `Thanks for your message: "${userMessage}". I'm DotBot, and I'm here to help you with Polkadot-related tasks like checking balances, making transfers, and tracking transactions. \n\nTo get started, try connecting your wallet or ask me about specific DOT operations you'd like to perform!`;
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <div className={`app-container ${isSidebarExpanded ? '' : 'sidebar-collapsed'}`}>
          {/* Collapsible Sidebar */}
          <CollapsibleSidebar
            onNewChat={handleNewChat}
            onSearchChat={handleSearchChat}
            onTransactions={handleTransactions}
            isExpanded={isSidebarExpanded}
            onToggle={setIsSidebarExpanded}
          />

          {/* Main Content Area */}
          <MainContent
            onCheckBalance={handleCheckBalance}
            onTransfer={handleTransfer}
            onStatus={handleStatus}
            onSendMessage={handleSendMessage}
            messages={messages}
            isTyping={isTyping}
            showWelcomeScreen={showWelcomeScreen}
          />
        </div>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
