/**
 * DotBot Frontend - Clean Component Structure
 * 
 * This demonstrates the minimal setup for using DotBot with React.
 * Component hierarchy ready for @dotbot/react package extraction.
 */

import React, { useState, useEffect, useRef as _useRef } from 'react';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ThemeProvider } from './contexts/ThemeContext';
// WebSocket removed - frontend does all simulation locally
import { useScenarioPrompt } from './hooks/useScenarioPrompt';
import WalletButton from './components/wallet/WalletButton';
import ThemeToggle from './components/ui/ThemeToggle';
import SettingsModal from './components/settings/SettingsModal';
import CollapsibleSidebar from './components/layout/CollapsibleSidebar';
import WelcomeScreen from './components/chat/WelcomeScreen';
import Chat from './components/chat/Chat';
import ChatHistory from './components/history/ChatHistory';
import ScenarioEngineOverlay from './components/scenarioEngine/ScenarioEngineOverlay';
import { ScenarioEngineProvider } from './components/scenarioEngine/context/ScenarioEngineContext';
import LoadingOverlay from './components/common/LoadingOverlay';
import { DotBot, Environment, ScenarioEngine, SigningRequest, BatchSigningRequest, DotBotEventType } from '@dotbot/core';
import type { ChatInstanceData, ExecutionMessage } from '@dotbot/core';
import { useWalletStore } from './stores/walletStore';
import { Settings } from 'lucide-react';
import {
  createDotBotInstance,
  setupScenarioEngineDependencies,
  getNetworkFromEnvironment
} from './utils/appUtils';
import {
  createDotBotSession,
  sendDotBotMessage,
  type WalletAccount,
} from './services/dotbotApi';
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

// WebSocket removed - frontend does all simulation locally via ExecutionArray subscriptions

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
  // Frontend DotBot is now just a UI helper - all AI communication happens on backend
  const [dotbot, setDotbot] = useState<DotBot | null>(null);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [backendSessionId, setBackendSessionId] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initializingMessage, setInitializingMessage] = useState<string>('');
  const [initializingSubMessage, setInitializingSubMessage] = useState<string>('');
  
  // ScenarioEngine State - lazy loaded
  const [scenarioEngine] = useState(() => new ScenarioEngine({
    logLevel: 'info',
    autoSaveResults: true,
  }));
  const [isScenarioEngineReady, setIsScenarioEngineReady] = useState(false);
  const [isScenarioEngineInitializing, setIsScenarioEngineInitializing] = useState(false);
  
  // Environment preference (for when wallet is not connected yet)
  const [preferredEnvironment, setPreferredEnvironment] = useState<Environment>('mainnet');
  
  // Preloaded RPC managers removed - DotBot handles connections directly
  
  // Signing
  const [signingRequest, setSigningRequest] = useState<SigningRequest | BatchSigningRequest | null>(null);
  
  const { isConnected, selectedAccount } = useWalletStore();
  
  // WebSocket removed - execution updates come from local ExecutionArray subscriptions
  
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

  // Initialize ScenarioEngine dependencies when enabled and DotBot is ready
  useEffect(() => {
    if (scenarioEngineEnabled && dotbot && selectedAccount && !isScenarioEngineReady && !isScenarioEngineInitializing) {
      setIsScenarioEngineInitializing(true);
      
      const walletAccount: WalletAccount = {
        address: selectedAccount.address,
        name: selectedAccount.name,
        source: selectedAccount.source,
      };
      
      setupScenarioEngineDependencies(scenarioEngine, dotbot, walletAccount)
        .then(() => {
          setIsScenarioEngineReady(true);
          setIsScenarioEngineInitializing(false);
          console.log('[App] ScenarioEngine dependencies initialized');
        })
        .catch((error) => {
          console.error('[App] Failed to initialize ScenarioEngine dependencies:', error);
          setIsScenarioEngineInitializing(false);
          // Don't set ready state on error - user can retry by toggling
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioEngineEnabled, dotbot, selectedAccount, isScenarioEngineReady, isScenarioEngineInitializing]);

  // Sync current chat ID when dotbot changes
  useEffect(() => {
    if (dotbot?.currentChat) {
      setCurrentChatId(dotbot.currentChat.id);
    } else {
      setCurrentChatId(null);
    }
  }, [dotbot]);

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
      // Create backend session first (this creates DotBot instance on backend)
      const walletAccount: WalletAccount = {
        address: selectedAccount!.address,
        name: selectedAccount!.name,
        source: selectedAccount!.source,
      };
      
      const network = getNetworkFromEnvironment(preferredEnvironment);
      const sessionResponse = await createDotBotSession(
        walletAccount,
        preferredEnvironment,
        network,
        undefined // sessionId will be auto-generated
      );
      
      setBackendSessionId(sessionResponse.sessionId);
      console.log('[App] Backend session created:', sessionResponse.sessionId);
      
      // Create frontend DotBot instance - DotBot handles RPC connections directly
      // When preloadedManagers is null, DotBot creates its own RPC managers internally
      // RPC connections are lazy-loaded (created but not connected during initialization)
      const dotbotInstance = await createDotBotInstance(
        selectedAccount!,
        preferredEnvironment,
        null, // No preloaded managers - DotBot handles connections directly
        (request: any) => setSigningRequest(request)
      );
      
      setDotbot(dotbotInstance);
      console.groupEnd();
      
      // LAZY LOADING: ScenarioEngine will be initialized when overlay is opened
      // No initialization here - faster DotBot startup
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

  // Helper: Validate prerequisites before sending message
  const validateSendMessagePrerequisites = (): { currentChat: any } => {
    if (!dotbot || !backendSessionId || !selectedAccount) {
      throw new Error('Please connect your wallet first');
    }

    const currentChat = dotbot.currentChat;
    if (!currentChat) {
      throw new Error('No active chat session');
    }

    return { currentChat };
  };

  // Helper: Send message to backend API
  const sendMessageToBackend = async (
    message: string,
    currentChat: any
  ): Promise<any> => {
    const walletAccount: WalletAccount = {
      address: selectedAccount!.address,
      name: selectedAccount!.name,
      source: selectedAccount!.source,
    };

    const conversationHistory = currentChat.getHistory();

    const apiResponse = await sendDotBotMessage({
      message,
      sessionId: backendSessionId!,
      wallet: walletAccount,
      environment: dotbot!.getEnvironment(),
      network: dotbot!.getNetwork(),
      conversationHistory,
    });

    // Validate backend response structure
    if (!apiResponse || !apiResponse.result) {
      throw new Error('Invalid response from backend: missing result');
    }

    const chatResult = apiResponse.result;

    // Validate chatResult structure
    if (typeof chatResult !== 'object' || chatResult === null) {
      throw new Error('Invalid response from backend: result is not an object');
    }

    if (typeof chatResult.response !== 'string' && chatResult.response !== undefined) {
      throw new Error('Invalid response from backend: response field is not a string');
    }

    return chatResult;
  };

  // Helper: Track executionId for session-level subscription
  // 
  // NOTE: With session-level subscription, we don't need to subscribe per executionId.
  // WebSocket removed - no subscription needed, ExecutionFlow subscribes directly to ExecutionArray

  // Helper: Add messages to chat (bot, execution)
  // NOTE: User message is now added in handleSendMessage before backend call
  const addMessagesToChat = (
    message: string,
    chatResult: any,
    currentChat: any
  ): Promise<any>[] => {
    const persistencePromises: Promise<any>[] = [];

    // Add bot response
    if (chatResult.response) {
      persistencePromises.push(
        currentChat.addBotMessage(chatResult.response, true)
          .then(() => {
            console.log('[App] Bot message persisted');
            // Emit event so Chat component can react
            if (dotbot) {
              dotbot.emit({ type: DotBotEventType.BOT_MESSAGE_ADDED, message: chatResult.response, timestamp: Date.now() });
            }
          })
          .catch((err: unknown) => console.error('[App] Failed to persist bot message:', err))
      );
    }

    // If there's an execution plan, add execution message
    if (chatResult.plan) {
      console.log('[App] ExecutionPlan received from backend:', {
        planId: chatResult.plan.id,
        stepsCount: chatResult.plan.steps.length,
        originalRequest: chatResult.plan.originalRequest
      });
      
      const executionId = chatResult.executionId || chatResult.executionArrayState?.id;
      
      if (!executionId) {
        console.error('[App] CRITICAL: Backend did not provide executionId for execution plan. This is a backend bug.');
        console.error('[App] Plan:', chatResult.plan);
        console.error('[App] Result:', chatResult);
        throw new Error('Backend did not provide executionId for execution plan. This is a backend bug.');
      }
      
      // Check for existing execution message AFTER user/bot messages are added
      const existingMessage = currentChat.getDisplayMessages()
        .find((m: any) => m.type === 'execution' && m.executionId === executionId);
      
      if (!existingMessage) {
        console.log('[App] ExecutionPlan sent to frontend - adding execution message:', { 
          executionId, 
          planId: chatResult.plan.id,
          stepsCount: chatResult.plan.steps.length,
          hasState: !!chatResult.executionArrayState,
          hasPlan: !!chatResult.plan 
        });
        
        // Add execution message first (stores plan)
        // Use skipReload: true to avoid reloading before user/bot messages are persisted
        // We'll manually trigger UI update after all messages are added
        const addMessagePromise = currentChat.addExecutionMessage(
          executionId,
          chatResult.plan,
          undefined, // Don't use backend's executionArrayState - frontend will rebuild and simulate
          true // Skip reload to avoid race condition with user/bot message persistence
        )
          .then(async (_executionMessage: ExecutionMessage) => {
            console.log('[App] Execution message persisted');
            
            // Trigger UI refresh to show execution message
            setConversationRefresh(prev => prev + 1);
            
            // Frontend rebuilds ExecutionArray from plan and runs simulation
            // NOTE: This will create RPC connections directly from the frontend to blockchain nodes
            // This is expected when frontend simulation is enabled (backendSimulation: false)
            // The frontend DotBot instance uses its own RPC managers to connect to public endpoints
            if (chatResult.plan && dotbot) {
              console.log('[App] Rebuilding ExecutionArray from plan and running simulation on frontend');
              console.log('[App] NOTE: Frontend will create direct RPC connections for simulation');
              try {
                // prepareExecution is private, but we need to call it to rebuild and simulate
                // Type assertion to access private method (prepareExecution will create ExecutionArray and run simulation)
                // This will trigger RPC connections via dotbot's relayChainManager and assetHubManager
                await (dotbot as any).prepareExecution(chatResult.plan, executionId, false);
                console.log('[App] Frontend simulation completed');
                
                // Trigger UI refresh after ExecutionArray is set
                setConversationRefresh(prev => prev + 1);
              } catch (error) {
                console.error('[App] Failed to prepare execution on frontend:', error);
                // Don't throw - execution message is already added, user can retry
              }
            }
          })
          .catch((err: unknown) => console.error('[App] Failed to persist execution message:', err));
        
        persistencePromises.push(addMessagePromise);
      } else {
        // Update existing message with plan and/or state
        const updates: any = {};
        if (chatResult.executionArrayState) {
          updates.executionArray = chatResult.executionArrayState;
        }
        if (chatResult.plan) {
          updates.executionPlan = chatResult.plan;
        }
        
        if (Object.keys(updates).length > 0) {
          persistencePromises.push(
            currentChat.updateExecutionMessage(existingMessage.id, updates)
              .then(() => console.log('[App] Execution message updated:', Object.keys(updates)))
              .catch((err: unknown) => console.error('[App] Failed to update execution message:', err))
          );
        }
      }
    }

    return persistencePromises;
  };

  // Helper: Update UI after messages are added
  const updateUIAfterMessages = (persistencePromises: Promise<any>[]) => {
    // Messages are now in memory (push is synchronous), trigger UI refresh
    console.log('[App] Messages added to memory, triggering refresh. Count:', dotbot?.currentChat?.getDisplayMessages().length);
    console.log('[App] Current messages:', dotbot?.currentChat?.getDisplayMessages().map((m: any) => ({ type: m.type, id: m.id })));
    
    // Trigger UI refresh immediately (messages are in memory, persistence happens in background)
    setConversationRefresh(prev => prev + 1);
    
    // Let persistence complete in background (don't await)
    // The merge logic in reload() will preserve in-memory messages even if they're not persisted yet
    Promise.all(persistencePromises).catch(err => 
      console.error('[App] Some persistence operations failed:', err)
    );
  };

  // Helper: Handle errors and add error message to chat
  const handleSendMessageError = async (error: unknown): Promise<any> => {
    console.error('Error:', error);
    
    const errorMessage = `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    
    const currentChat = dotbot?.currentChat;
    if (currentChat) {
      try {
        await currentChat.addBotMessage(errorMessage);
        setConversationRefresh(prev => prev + 1);
      } catch (addMessageError) {
        console.error('[App] Failed to add error message to chat:', addMessageError);
        setConversationRefresh(prev => prev + 1);
      }
    }
    
    // Return error result for scenario engine
    return {
      response: errorMessage,
      plan: undefined,
      executionArrayState: undefined,
      executionId: undefined,
      executed: false,
      success: false,
      completed: 0,
      failed: 1,
    };
  };

  // Main handler: Orchestrates the message sending flow
  const handleSendMessage = async (message: string) => {
    if (showWelcomeScreen) {
      setShowWelcomeScreen(false);
    }

    setIsTyping(true);

    try {
      // Step 1: Validate prerequisites
      const { currentChat } = validateSendMessagePrerequisites();

      // Step 2: Add user message to chat IMMEDIATELY (before backend call)
      // This ensures the user sees their message right away
      const userMessagePromise = currentChat.addUserMessage(message, true)
        .then(() => {
          console.log('[App] User message persisted');
          // Emit event so Chat component can react
          if (dotbot) {
            dotbot.emit({ type: DotBotEventType.USER_MESSAGE_ADDED, message, timestamp: Date.now() });
          }
          // Trigger UI refresh immediately
          setConversationRefresh(prev => prev + 1);
        })
        .catch((err: unknown) => console.error('[App] Failed to persist user message:', err));

      // Step 3: Send message to backend (returns plan only, no simulation)
      const chatResult = await sendMessageToBackend(message, currentChat);

      // Step 4: Add bot/execution messages to chat
      const persistencePromises = addMessagesToChat(message, chatResult, currentChat);
      // Include user message promise in persistence promises
      persistencePromises.push(userMessagePromise);

      // Step 5: Update UI
      updateUIAfterMessages(persistencePromises);

      // Return the chat result for scenario engine
      return chatResult;
    } catch (error) {
      return await handleSendMessageError(error);
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
                  key={currentChatId || 'default'}
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
           dotbot.getEnvironment() === 'testnet' && (
        <ScenarioEngineProvider>
          <ScenarioEngineOverlay 
                engine={scenarioEngine}
                dotbot={dotbot}
                onClose={() => {
                  setScenarioEngineEnabled(false);
                  // Reset ready state when closed (will re-initialize on next open)
                  setIsScenarioEngineReady(false);
                }}
                onSendMessage={handleSendMessageWithScenario}
                autoSubmit={autoSubmitPrompts}
                onAutoSubmitChange={setAutoSubmitPrompts}
                isInitializing={isScenarioEngineInitializing}
                isReady={isScenarioEngineReady}
          />
        </ScenarioEngineProvider>
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
