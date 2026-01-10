/**
 * DotBot Frontend - Clean Component Structure
 * 
 * This demonstrates the minimal setup for using DotBot with React.
 * Component hierarchy ready for @dotbot/react package extraction.
 */

import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ThemeProvider } from './contexts/ThemeContext';
import { ChatInputProvider, useChatInput } from './contexts/ChatInputContext';
import WalletButton from './components/wallet/WalletButton';
import ThemeToggle from './components/ui/ThemeToggle';
import SettingsModal from './components/settings/SettingsModal';
import CollapsibleSidebar from './components/layout/CollapsibleSidebar';
import WelcomeScreen from './components/chat/WelcomeScreen';
import Chat from './components/chat/Chat';
import ChatHistory from './components/history/ChatHistory';
import ScenarioEngineOverlay from './components/scenarioEngine/ScenarioEngineOverlay';
import LoadingOverlay from './components/common/LoadingOverlay';
import { DotBot, Environment, ScenarioEngine } from './lib';
import type { ChatInstanceData } from './lib/types/chatInstance';
import type { ChatResult } from './lib';
import { useWalletStore } from './stores/walletStore';
import { ASIOneService } from './lib/services/asiOneService';
import { SigningRequest, BatchSigningRequest } from './lib';
import { Settings } from 'lucide-react';
import './styles/globals.css';
import './styles/execution-flow.css';
import './styles/chat-history.css';
import './styles/chat-history-card.css';

// =============================================================================
// SCENARIO ENGINE FEATURE FLAG
// =============================================================================
const ENABLE_SCENARIO_ENGINE = true; // Set to true to show ScenarioEngine overlay

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
  const [chatHistoryRefresh, setChatHistoryRefresh] = useState(0);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [scenarioEngineEnabled, setScenarioEngineEnabled] = useState(false);
  
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
  
  // Note: useChatInput is called in AppWithChatInput component (inside provider)

  // Initialize DotBot when wallet connects
  useEffect(() => {
    if (isConnected && selectedAccount && !dotbot && !isInitializing) {
      initializeDotBot();
    }
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

  const initializeDotBot = async () => {
    setIsInitializing(true);
    try {
      // Derive network from environment (same logic as switchEnvironment)
      const network = preferredEnvironment === 'mainnet' ? 'polkadot' : 'westend';
      
      const dotbotInstance = await DotBot.create({
        wallet: selectedAccount!,
        environment: preferredEnvironment,
        network: network,
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
      
      // Initialize ScenarioEngine with DotBot's API
      // NOTE: The API is always connected to the real chain (Westend/Mainnet).
      // For synthetic mode, the executor uses queryBalance (mocked) instead of api.
      // For emulated mode, StateAllocator creates its own Chopsticks fork and uses setStorage.
      // For live mode, the real API is used.
        try {
          await scenarioEngine.initialize();
          const api = await dotbotInstance.getApi();
          const environment = dotbotInstance.getEnvironment();
          
          // Set wallet account and signer for live mode transfers
          if (selectedAccount) {
            // Get the signer from DotBot's execution system
            // The signer is stored in the executionSystem's executioner
            const dotbotAny = dotbotInstance as any;
            const executionSystem = dotbotAny.executionSystem;
            const executioner = executionSystem?.executioner;
            const signer = executioner?.signer || null;
            
            if (signer) {
              scenarioEngine.setWalletForLiveMode(
                {
                  address: selectedAccount.address,
                  name: selectedAccount.name,
                  source: selectedAccount.source
                },
                signer
              );
            } else {
              console.warn('[App] No signer found in DotBot executioner - live mode transfers may not work');
            }
          }
          
          scenarioEngine.setDependencies({
          api, // Real API (Westend/Mainnet) - used for live mode
          // For synthetic mode, provide mocked balance queries from scenario state
          queryBalance: async (address: string) => {
            // Look up entity by address
            const entity = scenarioEngine.getEntityByAddress(address);
            if (entity) {
              // Get balance from current scenario's walletState
              const state = scenarioEngine.getState();
              const scenario = state.currentScenario;
              if (scenario?.walletState?.accounts) {
                const account = scenario.walletState.accounts.find(
                  a => a.entityName === entity.name
                );
                if (account?.balance) {
                  return account.balance;
                }
              }
            }
            // Default: return 0 DOT if not found in scenario state
            return '0 DOT';
          },
          getEntityKeypair: (entityName: string) => {
            const entity = scenarioEngine.getEntity(entityName);
            return entity?.uri ? { uri: entity.uri } : undefined;
          },
          getEntityAddress: (entityName: string) => {
            const entity = scenarioEngine.getEntity(entityName);
            return entity?.address;
          },
        });
        
        // Subscribe to DotBot events for automatic response capture
        // This is the DEEP integration - ScenarioEngine listens at library level
        // All DotBot responses are automatically captured without UI-level hooking
        scenarioEngine.subscribeToDotBot(dotbotInstance);
        
        // Set RPC manager provider for StateAllocator (so it can use Asset Hub or Relay Chain as needed)
        scenarioEngine.setRpcManagerProvider(() => {
          // Access DotBot's RPC managers via internal properties
          // Note: This is a workaround - ideally DotBot would expose a getter for these
          const dotbotAny = dotbotInstance as any;
          return {
            relayChainManager: dotbotAny.relayChainManager,
            assetHubManager: dotbotAny.assetHubManager,
          };
        });
        setIsScenarioEngineReady(true);
        console.log('[ScenarioEngine] Initialized and ready');
      } catch (error) {
        console.error('[ScenarioEngine] Failed to initialize:', error);
      }
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

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ChatInputProvider>
          <AppWithChatInputWrapper
            handleSendMessage={handleSendMessage}
            dotbot={dotbot}
            isTyping={isTyping}
            showWelcomeScreen={showWelcomeScreen}
            isSidebarExpanded={isSidebarExpanded}
            conversationRefresh={conversationRefresh}
            chatHistoryRefresh={chatHistoryRefresh}
            showChatHistory={showChatHistory}
            showSettingsModal={showSettingsModal}
            scenarioEngineEnabled={scenarioEngineEnabled}
            currentChatId={currentChatId}
            isInitializing={isInitializing}
            initializingMessage={initializingMessage}
            initializingSubMessage={initializingSubMessage}
            scenarioEngine={scenarioEngine}
            isScenarioEngineReady={isScenarioEngineReady}
            preferredEnvironment={preferredEnvironment}
            simulationStatus={simulationStatus}
            setIsSidebarExpanded={setIsSidebarExpanded}
            setShowChatHistory={setShowChatHistory}
            setShowSettingsModal={setShowSettingsModal}
            setScenarioEngineEnabled={setScenarioEngineEnabled}
            handleNewChat={handleNewChat}
            handleSearchChat={handleSearchChat}
            handleSelectChat={handleSelectChat}
            handleCheckBalance={handleCheckBalance}
            handleTransfer={handleTransfer}
            handleStatus={handleStatus}
            handleEnvironmentSwitch={handleEnvironmentSwitch}
            placeholder={!isConnected 
              ? "Connect your wallet to start chatting..."
              : isInitializing
              ? "Initializing DotBot..."
              : "Type your message..."}
          />
        </ChatInputProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

// Wrapper component that uses ChatInput context (must be inside provider)
const AppWithChatInputWrapper: React.FC<{
  handleSendMessage: (message: string) => Promise<ChatResult | undefined>;
  dotbot: DotBot | null;
  isTyping: boolean;
  showWelcomeScreen: boolean;
  isSidebarExpanded: boolean;
  conversationRefresh: number;
  chatHistoryRefresh: number;
  showChatHistory: boolean;
  showSettingsModal: boolean;
  scenarioEngineEnabled: boolean;
  currentChatId: string | null;
  isInitializing: boolean;
  initializingMessage: string;
  initializingSubMessage: string;
  scenarioEngine: ScenarioEngine;
  isScenarioEngineReady: boolean;
  preferredEnvironment: Environment;
  simulationStatus: any;
  setIsSidebarExpanded: (v: boolean) => void;
  setShowChatHistory: (v: boolean) => void;
  setShowSettingsModal: (v: boolean) => void;
  setScenarioEngineEnabled: (v: boolean) => void;
  handleNewChat: () => Promise<void>;
  handleSearchChat: () => void;
  handleSelectChat: (chat: ChatInstanceData) => Promise<void>;
  handleCheckBalance: () => void;
  handleTransfer: () => void;
  handleStatus: () => void;
  handleEnvironmentSwitch: (environment: Environment) => Promise<void>;
  placeholder: string;
}> = (props) => {
  const { pendingPrompt, executor, setPendingPrompt, setExecutor } = useChatInput();

  // Override handleSendMessage to detect scenario prompts
  // NOTE: We no longer need to manually notify executor - ScenarioEngine
  // automatically subscribes to DotBot events at the library level!
  const handleSendMessageWithContext = async (message: string) => {
    // Check if this is a scenario prompt
    const isScenarioPrompt = pendingPrompt && message.trim() === pendingPrompt.trim();
    
    // Send the message (DotBot events will automatically notify ScenarioEngine)
    await props.handleSendMessage(message);
    
    // Clear pending prompt and executor reference after sending
    if (isScenarioPrompt) {
      setPendingPrompt(null);
      setExecutor(null);
    }
  };

  return (
    <div className={`app-container ${props.isSidebarExpanded ? '' : 'sidebar-collapsed'}`}>
      <CollapsibleSidebar
        onNewChat={props.handleNewChat}
        onSearchChat={props.handleSearchChat}
        onTransactions={() => {}}
        isExpanded={props.isSidebarExpanded}
        onToggle={props.setIsSidebarExpanded}
      />

      <div className="main-content">
        {/* Header */}
        <div className="main-header">
          <ThemeToggle />
          <div className="header-right">
            <button
              className="settings-button"
              onClick={() => props.setShowSettingsModal(true)}
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
            <WalletButton 
              environment={props.dotbot?.getEnvironment() || props.preferredEnvironment}
              onEnvironmentSwitch={props.handleEnvironmentSwitch}
            />
          </div>
        </div>

        {/* Main Body */}
        <div className="main-body">
          {props.showChatHistory ? (
            <div className="chat-container">
              {props.dotbot && (
                <ChatHistory
                  dotbot={props.dotbot}
                  onSelectChat={props.handleSelectChat}
                  onChatRenamed={() => {
                    // Reload chat history after rename
                    // setChatHistoryRefresh(prev => prev + 1);
                  }}
                  currentChatId={props.dotbot.currentChat?.id}
                  refreshTrigger={props.chatHistoryRefresh}
                  isLoadingChat={props.isInitializing}
                />
              )}
            </div>
          ) : props.showWelcomeScreen && props.dotbot && props.dotbot.currentChat ? (
            <WelcomeScreen
              onSendMessage={handleSendMessageWithContext}
              onCheckBalance={props.handleCheckBalance}
              onTransfer={props.handleTransfer}
              onStatus={props.handleStatus}
              disabled={!props.dotbot}
              placeholder={props.placeholder}
              isTyping={props.isTyping}
            />
          ) : props.dotbot && props.dotbot.currentChat ? (
            <Chat
              dotbot={props.dotbot}
              onSendMessage={handleSendMessageWithContext}
              isTyping={props.isTyping}
              disabled={!props.dotbot}
              placeholder={props.placeholder}
              simulationStatus={props.simulationStatus}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              {props.placeholder}
            </div>
          )}
        </div>
      </div>

      {/* Loading Overlay */}
      <LoadingOverlay
        isVisible={props.isInitializing}
        message={props.initializingMessage || 'Loading...'}
        subMessage={props.initializingSubMessage}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={props.showSettingsModal}
        onClose={() => props.setShowSettingsModal(false)}
        scenarioEngineEnabled={props.scenarioEngineEnabled}
        onToggleScenarioEngine={props.setScenarioEngineEnabled}
        isMainnet={(props.dotbot?.getEnvironment() || props.preferredEnvironment) === 'mainnet'}
      />

      {/* ScenarioEngine Overlay - Only on testnet */}
      {props.scenarioEngineEnabled && 
       props.dotbot && 
       props.isScenarioEngineReady && 
       props.dotbot.getEnvironment() === 'testnet' && (
        <ScenarioEngineOverlay 
          engine={props.scenarioEngine}
          dotbot={props.dotbot}
          onClose={() => props.setScenarioEngineEnabled(false)}
          onSendMessage={handleSendMessageWithContext}
        />
      )}
    </div>
  );
};

const App: React.FC = () => {
  return <AppContent />;
};

export default App;
