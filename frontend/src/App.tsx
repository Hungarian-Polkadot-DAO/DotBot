/**
 * DotBot Frontend - Clean Component Structure
 * 
 * This demonstrates the minimal setup for using DotBot with React.
 * Component hierarchy ready for @dotbot/react package extraction.
 */

import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ThemeProvider } from './contexts/ThemeContext';
import { useScenarioPrompt } from './hooks/useScenarioPrompt';
import WalletButton from './components/wallet/WalletButton';
import ThemeToggle from './components/ui/ThemeToggle';
import SettingsModal from './components/settings/SettingsModal';
import CollapsibleSidebar from './components/layout/CollapsibleSidebar';
import WelcomeScreen from './components/chat/WelcomeScreen';
import Chat from './components/chat/Chat';
import ChatHistory from './components/history/ChatHistory';
import ScenarioEngineOverlay from './components/scenarioEngine/ScenarioEngineOverlay';
import LoadingOverlay from './components/common/LoadingOverlay';
import { DotBot, Environment, ScenarioEngine } from '@dotbot/core';
import type { ChatInstanceData } from '@dotbot/core/types/chatInstance';
import { useWalletStore } from './stores/walletStore';
import { ASIOneService } from '@dotbot/core/services/asiOneService';
import { SigningRequest, BatchSigningRequest } from '@dotbot/core';
import { Settings } from 'lucide-react';
import {
  createDotBotInstance,
  setupScenarioEngineDependencies
} from './utils/appUtils';
import './styles/globals.css';
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

const AppContent: React.FC = () => {
  // UI State
  const [isTyping, setIsTyping] = useState(false);
  const [showWelcomeScreen, setShowWelcomeScreen] = useState(true);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [conversationRefresh, setConversationRefresh] = useState(0);
  const [chatHistoryRefresh] = useState(0);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [scenarioEngineEnabled, setScenarioEngineEnabled] = useState(false);
  const [autoSubmitPrompts, setAutoSubmitPrompts] = useState<boolean>(true);
  
  // DotBot State
  const [dotbot, setDotbot] = useState<DotBot | null>(null);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [asiOne] = useState(() => new ASIOneService());
  const [isInitializing, setIsInitializing] = useState(false);
  const [initializingMessage, setInitializingMessage] = useState<string>('');
  const [initializingSubMessage, setInitializingSubMessage] = useState<string>('');
  
  // ScenarioEngine State
  const [scenarioEngine] = useState(() => new ScenarioEngine({
    logLevel: 'info',
    autoSaveResults: true,
  }));
  const [isScenarioEngineReady, setIsScenarioEngineReady] = useState(false);
  
  // Environment preference (for when wallet is not connected yet)
  const [preferredEnvironment, setPreferredEnvironment] = useState<Environment>('mainnet');
  
  // Preloaded RPC managers removed - DotBot handles connections directly
  
  // Signing
  const [signingRequest, setSigningRequest] = useState<SigningRequest | BatchSigningRequest | null>(null);
  
  const { isConnected, selectedAccount } = useWalletStore();
  
  // Note: useChatInput is called in AppWithChatInput component (inside provider)

  // Note: Preloading removed - DotBot initialization handles connections directly
  // This matches staging behavior and prevents redundant connection attempts

  // Initialize DotBot when wallet connects
  useEffect(() => {
    if (isConnected && selectedAccount && !dotbot && !isInitializing) {
      initializeDotBot();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, selectedAccount]);

  // Sync current chat ID when dotbot changes
  useEffect(() => {
    if (dotbot?.currentChat) {
      setCurrentChatId(dotbot.currentChat.id);
    } else {
      setCurrentChatId(null);
    }
  }, [dotbot, conversationRefresh]);

  // Auto-hide welcome screen when chat has messages
  useEffect(() => {
    if (dotbot?.currentChat && !dotbot.currentChat.isEmpty) {
      setShowWelcomeScreen(false);
    }
  }, [dotbot, conversationRefresh, currentChatId]);

  // Send transaction approval to the wallet
  useEffect(() => {
    if (signingRequest) {
      signingRequest.resolve(true);
      setSigningRequest(null);
    }
  }, [signingRequest]);

  // Preload function removed - not needed, DotBot handles connections directly

  const initializeDotBot = async () => {
    setIsInitializing(true);
    setInitializingMessage('Initializing DotBot');
    setInitializingSubMessage('Connecting...');
    
    try {
      const dotbotInstance = await createDotBotInstance(
        selectedAccount!,
        preferredEnvironment,
        null, // No preloaded managers - DotBot handles connections directly
        (request: any) => setSigningRequest(request)
      );
      
      setDotbot(dotbotInstance);
      
      // Initialize ScenarioEngine
        try {
          setInitializingMessage('Initializing ScenarioEngine');
          setInitializingSubMessage('Setting up scenario execution engine...');
        
        await setupScenarioEngineDependencies(
          scenarioEngine,
          dotbotInstance,
          selectedAccount
        );
        
        setIsScenarioEngineReady(true);
        console.log('[ScenarioEngine] Initialized and ready');
        setInitializingMessage('Ready');
        setInitializingSubMessage('DotBot is ready to use');
      } catch (error) {
        console.error('[ScenarioEngine] Failed to initialize:', error);
        setInitializingMessage('Initialization Complete');
        setInitializingSubMessage('ScenarioEngine initialization failed, but DotBot is ready');
      }
    } catch (error) {
      console.error('Failed to initialize DotBot:', error);
      setInitializingMessage('Initialization Failed');
      setInitializingSubMessage(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setTimeout(() => {
        setIsInitializing(false);
        setInitializingMessage('');
        setInitializingSubMessage('');
      }, 500);
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

      // Capture the chat result to return it (for scenario engine)
      const chatResult = await dotbot.chat(message, {
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
      
      // Return the chat result for scenario engine
      return chatResult;
    } catch (error) {
      console.error('Error:', error);
      
      const errorMessage = `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      
      if (dotbot?.currentChat) {
        await dotbot.currentChat.addBotMessage(errorMessage);
        setConversationRefresh(prev => prev + 1);
      }
      
      // Return error result for scenario engine
      return {
        response: errorMessage,
        executed: false,
        success: false,
        completed: 0,
        failed: 1,
      };
    } finally {
      setIsTyping(false);
    }
  };

  const handleNewChat = async () => {
    if (!dotbot) return;
    
    try {
      const currentEnvironment = dotbot.getEnvironment();
      
      // If preferred environment is different, switch to it (creates new chat)
      if (preferredEnvironment !== currentEnvironment) {
        await dotbot.switchEnvironment(preferredEnvironment);
      } else {
        // Otherwise, just clear history in current environment
        await dotbot.clearHistory();
      }
      
      // Close history view and show the new chat
      setShowChatHistory(false);
      setShowWelcomeScreen(true);
      // Update current chat ID to trigger re-render
      if (dotbot.currentChat) {
        setCurrentChatId(dotbot.currentChat.id);
      }
      setConversationRefresh(prev => prev + 1);
    } catch (error) {
      console.error('Failed to create new chat:', error);
    }
  };

  const handleEnvironmentSwitch = async (environment: Environment) => {
    // Store preference (for when wallet is not connected yet)
    setPreferredEnvironment(environment);
    
    // If DotBot is already initialized, switch environment (creates new chat)
    if (dotbot) {
      try {
        console.log(`Switching to ${environment}...`);
        await dotbot.switchEnvironment(environment);
        setShowWelcomeScreen(true);
        // Update current chat ID to trigger re-render
        if (dotbot.currentChat) {
          setCurrentChatId(dotbot.currentChat.id);
        }
        setConversationRefresh(prev => prev + 1);
        console.info(`Successfully switched to ${environment}`);
      } catch (error) {
        console.error('Failed to switch environment:', error);
        // We might want to show an error toast/notification here
      }
    } else {
      // If not connected yet, preference will be used when wallet connects
      console.log(`Environment preference set to ${environment}. Will be applied when wallet connects.`);
    }
  };

  const handleSearchChat = () => {
    setShowChatHistory(true);
  };

  const handleSelectChat = async (chat: ChatInstanceData) => {
    if (!dotbot) return;
    
    try {
      setIsInitializing(true);
      
      // Check if we need to switch network/environment
      const currentEnvironment = dotbot.getEnvironment();
      const currentNetwork = dotbot.getNetwork();
      const needsEnvironmentSwitch = chat.environment !== currentEnvironment;
      const needsNetworkSwitch = chat.network !== currentNetwork;
      
      if (needsEnvironmentSwitch) {
        setInitializingMessage('Switching Environment');
        setInitializingSubMessage(`Switching from ${currentEnvironment} to ${chat.environment}...`);
      } else if (needsNetworkSwitch) {
        setInitializingMessage('Switching Network');
        setInitializingSubMessage(`Connecting to ${chat.network}...`);
      } else {
        setInitializingMessage('Loading Chat');
        setInitializingSubMessage('Restoring conversation...');
      }
      
      await dotbot.loadChatInstance(chat.id);
      setShowChatHistory(false);
      setShowWelcomeScreen(false);
      // Update current chat ID to trigger re-render
      if (dotbot.currentChat) {
        setCurrentChatId(dotbot.currentChat.id);
      }
      setConversationRefresh(prev => prev + 1);
    } catch (error) {
      console.error('Failed to load chat:', error);
      // We might want to show an error toast/notification here
    } finally {
      setIsInitializing(false);
      setInitializingMessage('');
      setInitializingSubMessage('');
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

  // Use ScenarioEngine prompt injection hook
  const { 
    injectedPrompt, 
    clearPrompt, 
    notifyPromptProcessed 
  } = useScenarioPrompt(scenarioEngineEnabled ? scenarioEngine : null);

  // Handle sending messages with ScenarioEngine integration
  const handleSendMessageWithScenario = async (message: string) => {
    const result = await handleSendMessage(message);
    
    // If this was an injected prompt, clear it
    if (injectedPrompt && message.trim() === injectedPrompt.prompt.trim()) {
      clearPrompt();
    }
    
    return result;
  };

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
          <div className="header-right">
            <button
              className="settings-button"
                  onClick={() => setShowSettingsModal(true)}
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
            <WalletButton 
                  environment={dotbot?.getEnvironment() || preferredEnvironment}
                  onEnvironmentSwitch={handleEnvironmentSwitch}
            />
          </div>
        </div>

        {/* Main Body */}
        <div className="main-body">
              {showChatHistory ? (
            <div className="chat-container">
                  {dotbot && (
                <ChatHistory
                      dotbot={dotbot}
                      onSelectChat={handleSelectChat}
                      onChatRenamed={() => {}}
                      currentChatId={dotbot.currentChat?.id}
                      refreshTrigger={chatHistoryRefresh}
                      isLoadingChat={isInitializing}
                />
              )}
            </div>
              ) : showWelcomeScreen && dotbot && dotbot.currentChat ? (
            <WelcomeScreen
                  onSendMessage={handleSendMessageWithScenario}
                  onCheckBalance={handleCheckBalance}
                  onTransfer={handleTransfer}
                  onStatus={handleStatus}
                  disabled={!dotbot}
                  placeholder={placeholder}
                  isTyping={isTyping}
            />
              ) : dotbot && dotbot.currentChat ? (
            <Chat
                  dotbot={dotbot}
                  onSendMessage={handleSendMessageWithScenario}
                  isTyping={isTyping}
                  disabled={!dotbot}
                  placeholder={placeholder}
                  injectedPrompt={injectedPrompt?.prompt || null}
                  onPromptProcessed={notifyPromptProcessed}
                  autoSubmit={autoSubmitPrompts}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
                  {placeholder}
            </div>
          )}
        </div>
      </div>

      {/* Loading Overlay */}
      <LoadingOverlay
            isVisible={isInitializing}
            message={initializingMessage || 'Loading...'}
            subMessage={initializingSubMessage}
      />

      {/* Settings Modal */}
      <SettingsModal
            isOpen={showSettingsModal}
            onClose={() => setShowSettingsModal(false)}
            scenarioEngineEnabled={scenarioEngineEnabled}
            onToggleScenarioEngine={setScenarioEngineEnabled}
            isMainnet={(dotbot?.getEnvironment() || preferredEnvironment) === 'mainnet'}
      />

      {/* ScenarioEngine Overlay - Only on testnet */}
          {scenarioEngineEnabled && 
           dotbot && 
           isScenarioEngineReady && 
           dotbot.getEnvironment() === 'testnet' && (
        <ScenarioEngineOverlay 
              engine={scenarioEngine}
              dotbot={dotbot}
              onClose={() => setScenarioEngineEnabled(false)}
              onSendMessage={handleSendMessageWithScenario}
              autoSubmit={autoSubmitPrompts}
              onAutoSubmitChange={setAutoSubmitPrompts}
        />
      )}
    </div>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

const App: React.FC = () => {
  return <AppContent />;
};

export default App;
