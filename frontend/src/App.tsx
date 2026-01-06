/**
 * DotBot Frontend - Clean Component Structure
 * 
 * This demonstrates the minimal setup for using DotBot with React.
 * Component hierarchy ready for @dotbot/react package extraction.
 */

import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ThemeProvider } from './contexts/ThemeContext';
import WalletButton from './components/wallet/WalletButton';
import ThemeToggle from './components/ui/ThemeToggle';
import CollapsibleSidebar from './components/layout/CollapsibleSidebar';
import WelcomeScreen from './components/chat/WelcomeScreen';
import Chat from './components/chat/Chat';
import ChatHistory from './components/history/ChatHistory';
import { DotBot, Environment } from './lib';
import type { ChatInstanceData } from './lib/types/chatInstance';
import { useWalletStore } from './stores/walletStore';
import { ASIOneService } from './lib/services/asiOneService';
import { SigningRequest, BatchSigningRequest } from './lib';
import './styles/globals.css';
import './styles/execution-flow.css';
import './styles/chat-history.css';
import './styles/chat-history-card.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const App: React.FC = () => {
  // UI State
  const [isTyping, setIsTyping] = useState(false);
  const [showWelcomeScreen, setShowWelcomeScreen] = useState(true);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [conversationRefresh, setConversationRefresh] = useState(0);
  const [chatHistoryRefresh, setChatHistoryRefresh] = useState(0);
  const [showChatHistory, setShowChatHistory] = useState(false);
  
  // DotBot State
  const [dotbot, setDotbot] = useState<DotBot | null>(null);
  const [asiOne] = useState(() => new ASIOneService());
  const [isInitializing, setIsInitializing] = useState(false);
  
  // Signing & Simulation
  const [signingRequest, setSigningRequest] = useState<SigningRequest | BatchSigningRequest | null>(null);
  const [simulationStatus, setSimulationStatus] = useState<{
    phase: string;
    message: string;
    progress?: number;
    details?: string;
    chain?: string;
    result?: any;
  } | null>(null);
  
  const { isConnected, selectedAccount } = useWalletStore();

  // Initialize DotBot when wallet connects
  useEffect(() => {
    if (isConnected && selectedAccount && !dotbot && !isInitializing) {
      initializeDotBot();
    }
  }, [isConnected, selectedAccount]);

  // Auto-hide welcome screen when chat has messages
  useEffect(() => {
    if (dotbot?.currentChat && !dotbot.currentChat.isEmpty) {
      setShowWelcomeScreen(false);
    }
  }, [dotbot, conversationRefresh]);

  // Send transaction approval to the wallet
  useEffect(() => {
    if (signingRequest) {
      signingRequest.resolve(true);
      setSigningRequest(null);
    }
  }, [signingRequest]);

  const initializeDotBot = async () => {
    setIsInitializing(true);
    try {
      const dotbotInstance = await DotBot.create({
        wallet: selectedAccount!,
        onSigningRequest: (request) => setSigningRequest(request),
        onBatchSigningRequest: (request) => setSigningRequest(request),
        onSimulationStatus: (status) => {
          setSimulationStatus(status);
          if (status.phase === 'complete' || status.phase === 'error') {
            setTimeout(() => setSimulationStatus(null), 3000);
          }
        }
      });
      
      setDotbot(dotbotInstance);
    } catch (error) {
      console.error('Failed to initialize DotBot:', error);
    } finally {
      setIsInitializing(false);
    }
  };

  const handleSendMessage = async (message: string) => {
    if (showWelcomeScreen) {
      setShowWelcomeScreen(false);
    }

    setIsTyping(true);

    try {
      if (!dotbot) {
        throw new Error('Please connect your wallet first');
      }

      await dotbot.chat(message, {
        llm: async (msg, systemPrompt, llmContext) => {
          const response = await asiOne.sendMessage(msg, {
            systemPrompt,
            ...llmContext,
            walletAddress: selectedAccount?.address,
            network: dotbot.getNetwork().charAt(0).toUpperCase() + dotbot.getNetwork().slice(1)
          });
          return response;
        }
      });

      setConversationRefresh(prev => prev + 1);
    } catch (error) {
      console.error('Error:', error);
      
      if (dotbot?.currentChat) {
        await dotbot.currentChat.addBotMessage(
          `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
        setConversationRefresh(prev => prev + 1);
      }
    } finally {
      setIsTyping(false);
    }
  };

  const handleNewChat = async () => {
    if (!dotbot) return;
    
    try {
      await dotbot.clearHistory();
      setShowWelcomeScreen(true);
      setConversationRefresh(prev => prev + 1);
    } catch (error) {
      console.error('Failed to create new chat:', error);
    }
  };

  const handleEnvironmentSwitch = async (environment: Environment) => {
    if (!dotbot) return;
    
    try {
      console.log(`Switching to ${environment}...`);
      await dotbot.switchEnvironment(environment);
      setShowWelcomeScreen(true);
      setConversationRefresh(prev => prev + 1);
      console.info(`Successfully switched to ${environment}`);
    } catch (error) {
      console.error('Failed to switch environment:', error);
      // We might want to show an error toast/notification here
    }
  };

  const handleSearchChat = () => {
    setShowChatHistory(true);
  };

  const handleSelectChat = async (chat: ChatInstanceData) => {
    if (!dotbot) return;
    
    try {
      setIsInitializing(true);
      await dotbot.loadChatInstance(chat.id);
      setShowChatHistory(false);
      setShowWelcomeScreen(false);
      setConversationRefresh(prev => prev + 1);
    } catch (error) {
      console.error('Failed to load chat:', error);
      // We might want to show an error toast/notification here
    } finally {
      setIsInitializing(false);
    }
  };

  const handleCheckBalance = () => handleSendMessage("Please check my DOT balance");
  const handleTransfer = () => handleSendMessage("I want to transfer some DOT");
  const handleStatus = () => handleSendMessage("Show me my transaction status");

  const placeholder = !isConnected 
    ? "Connect your wallet to start chatting..."
    : isInitializing
    ? "Initializing DotBot..."
    : "Type your message...";

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <div className={`app-container ${isSidebarExpanded ? '' : 'sidebar-collapsed'}`}>
          <CollapsibleSidebar
            onNewChat={handleNewChat}
            onSearchChat={handleSearchChat}
            onTransactions={() => {}}
            isExpanded={isSidebarExpanded}
            onToggle={setIsSidebarExpanded}
          />

          <div className="main-content">
            {/* Header */}
            <div className="main-header">
              <ThemeToggle />
              <WalletButton 
                environment={dotbot?.getEnvironment() as Environment}
                onEnvironmentSwitch={handleEnvironmentSwitch}
              />
            </div>

            {/* Main Body */}
            <div className="main-body">
              {showChatHistory ? (
                <div className="chat-container">
                  {dotbot && (
                    <ChatHistory
                      dotbot={dotbot}
                      onSelectChat={handleSelectChat}
                      onChatRenamed={() => {
                        // Reload chat history after rename
                        setChatHistoryRefresh(prev => prev + 1);
                      }}
                      currentChatId={dotbot.currentChat?.id}
                      refreshTrigger={chatHistoryRefresh}
                    />
                  )}
                </div>
              ) : showWelcomeScreen && dotbot ? (
                <WelcomeScreen
                  onSendMessage={handleSendMessage}
                  onCheckBalance={handleCheckBalance}
                  onTransfer={handleTransfer}
                  onStatus={handleStatus}
                  disabled={!dotbot}
                  placeholder={placeholder}
                  isTyping={isTyping}
                />
              ) : dotbot ? (
                <Chat
                  dotbot={dotbot}
                  onSendMessage={handleSendMessage}
                  isTyping={isTyping}
                  disabled={!dotbot}
                  placeholder={placeholder}
                  simulationStatus={simulationStatus}
                />
              ) : (
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                  {placeholder}
                </div>
              )}
            </div>
          </div>
        </div>

      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
