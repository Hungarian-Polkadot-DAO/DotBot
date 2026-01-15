/**
 * DotBot Frontend - Clean Component Structure
 * 
 * This demonstrates the minimal setup for using DotBot with React.
 * Component hierarchy ready for @dotbot/react package extraction.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ThemeProvider } from './contexts/ThemeContext';
import { WebSocketProvider, useWebSocket } from './contexts/WebSocketContext';
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
import type { ExecutionArrayState } from '@dotbot/core/executionEngine/types';
import { useWalletStore } from './stores/walletStore';
import { SigningRequest, BatchSigningRequest } from '@dotbot/core';
import { Settings } from 'lucide-react';
import {
  createDotBotInstance,
  setupScenarioEngineDependencies,
  getNetworkFromEnvironment
} from './utils/appUtils';
import {
  createDotBotSession,
  sendDotBotMessage,
  getDotBotSession,
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

// Create a context to share execution states between EarlyExecutionSubscriber and components
interface ExecutionStateContextValue {
  states: Map<string, ExecutionArrayState>;
}

const ExecutionStateContext = React.createContext<ExecutionStateContextValue>({
  states: new Map(),
});

export const useExecutionState = (executionId: string | undefined) => {
  const context = React.useContext(ExecutionStateContext);
  return executionId ? context.states.get(executionId) : undefined;
};

/**
 * Component to subscribe to execution updates early (before ExecutionFlow renders)
 * 
 * STRATEGY: Subscribe to session-level execution updates when WebSocket connects.
 * This allows catching ALL execution updates for the session, including those that
 * happen before we know the executionId. When updates arrive, we filter by executionId
 * and store them in context for ExecutionFlow to consume.
 * 
 * This ensures we catch simulation progress updates that happen immediately after
 * execution starts, even before the executionId is known.
 */
const EarlyExecutionSubscriber: React.FC<{
  subscribeRef: React.MutableRefObject<((executionId: string) => void) | null>;
  pendingExecutionId: string | null;
  dotbot: DotBot | null;
  onExecutionMessageCreated?: () => void; // Callback to trigger UI refresh
  children: React.ReactNode;
}> = ({ subscribeRef, pendingExecutionId, dotbot, onExecutionMessageCreated, children }) => {
  const { subscribeToSessionExecutions, isConnected } = useWebSocket();
  const subscribedRef = useRef<Set<string>>(new Set());
  const unsubscribeRef = useRef<Map<string, () => void>>(new Map());
  const sessionUnsubscribeRef = useRef<(() => void) | null>(null);
  
  // Store execution states in state (shared via context)
  const [executionStates, setExecutionStates] = useState<Map<string, ExecutionArrayState>>(new Map());
  
  // Subscribe to session-level execution updates when WebSocket connects
  // This catches ALL execution updates for the session, including early simulation progress
  useEffect(() => {
    if (!isConnected || typeof subscribeToSessionExecutions !== 'function') {
      return;
    }
    
    console.log('[EarlyExecutionSubscriber] Subscribing to session-level execution updates');
    
    // Subscribe to all execution updates for this session
    const unsubscribe = subscribeToSessionExecutions((executionId, state) => {
      console.log('[EarlyExecutionSubscriber] Session-level execution update received:', {
        executionId,
        itemsCount: state.items.length,
        hasSimulationStatus: state.items.some(item => item.simulationStatus),
        simulationPhases: state.items.map(item => item.simulationStatus?.phase).filter(Boolean),
      });
      
      // Update shared state so useExecutionFlowState can access it
      setExecutionStates(prev => {
        const next = new Map(prev);
        next.set(executionId, state);
        return next;
      });
      
      // Update the execution message in the chat instance
      // This ensures the message exists and is updated even if it wasn't created yet
      if (dotbot?.currentChat) {
        const messages = dotbot.currentChat.getDisplayMessages();
        let executionMsg = messages.find(
          (m: any) => m.type === 'execution' && m.executionId === executionId
        ) as any;
        
        // If execution message doesn't exist yet, create it from the state
        // This can happen if WebSocket update arrives before addExecutionMessage completes
        if (!executionMsg && state) {
          console.log('[EarlyExecutionSubscriber] Execution message not found, creating from WebSocket state:', executionId);
          try {
            // Create execution message with minimal data (plan will be added later)
            // We need at least the executionId and state to render ExecutionFlow
            dotbot.currentChat.addExecutionMessage(
              executionId,
              undefined, // plan - will be added when backend response arrives
              state,
              true // skipReload
            ).then(() => {
              // Notify parent to trigger UI refresh
              onExecutionMessageCreated?.();
            }).catch((err: unknown) => {
              console.error('[EarlyExecutionSubscriber] Failed to create execution message:', err);
            });
          } catch (error) {
            console.error('[EarlyExecutionSubscriber] Error creating execution message:', error);
          }
        } else if (executionMsg) {
          // Update existing message using DotBot method (fires events)
          dotbot.updateExecutionMessage(executionMsg.id, executionId, {
            executionArray: state,
          }).then(() => {
            // Notify parent to trigger UI refresh
            onExecutionMessageCreated?.();
          }).catch((err: unknown) => {
            console.error('[EarlyExecutionSubscriber] Failed to update execution message:', err);
          });
        }
      }
    });
    
    sessionUnsubscribeRef.current = unsubscribe;
    
    return () => {
      if (sessionUnsubscribeRef.current) {
        sessionUnsubscribeRef.current();
        sessionUnsubscribeRef.current = null;
      }
    };
  }, [isConnected, subscribeToSessionExecutions, dotbot, onExecutionMessageCreated]);
  
  // Internal subscription function - kept for backwards compatibility
  // Now it just marks the executionId as tracked (session subscription handles updates)
  const doSubscribe = useCallback((executionId: string) => {
    // Skip if already tracked
    if (subscribedRef.current.has(executionId)) {
      console.log('[EarlyExecutionSubscriber] Already tracking execution:', executionId);
      return;
    }
    
    console.log('[EarlyExecutionSubscriber] Tracking execution (session subscription active):', executionId);
    subscribedRef.current.add(executionId);
    
    // Session-level subscription is already active, so updates will be received automatically
    // No need to create individual subscription
  }, []);
  
  // Set ref immediately (synchronously) during render, not in useEffect
  // This ensures the ref is available when parent calls it
  subscribeRef.current = doSubscribe;
  
  // Handle pending executionId from state (fallback mechanism)
  useEffect(() => {
    if (pendingExecutionId) {
      doSubscribe(pendingExecutionId);
    }
  }, [pendingExecutionId, doSubscribe]);
  
  // Cleanup subscriptions on unmount
  useEffect(() => {
    return () => {
      // Cleanup session-level subscription
      if (sessionUnsubscribeRef.current) {
        sessionUnsubscribeRef.current();
        sessionUnsubscribeRef.current = null;
      }
      
      // Cleanup individual subscriptions (if any)
      unsubscribeRef.current.forEach((unsubscribe) => {
        unsubscribe();
      });
      unsubscribeRef.current.clear();
      subscribedRef.current.clear();
      subscribeRef.current = null;
    };
  }, [subscribeRef]);
  
  const contextValue = React.useMemo(() => ({
    states: executionStates,
  }), [executionStates]);
  
  return (
    <ExecutionStateContext.Provider value={contextValue}>
      {children}
    </ExecutionStateContext.Provider>
  );
};

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
  
  // Note: WebSocket connection status is checked inside WebSocketProvider context
  // We can't access it here because AppContent renders before WebSocketProvider
  // The check is moved to components that are inside the provider

  // Ref to store early subscription function (populated by EarlyExecutionSubscriber)
  // This allows immediate subscription without waiting for React state updates
  const earlySubscribeRef = useRef<((executionId: string) => void) | null>(null);
  // State to force re-render and trigger subscription (backup mechanism)
  const [pendingExecutionId, setPendingExecutionId] = useState<string | null>(null);
  
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
    setInitializingSubMessage('Connecting to backend...');
    
    try {
      // Create backend session first (this creates DotBot instance on backend)
      const walletAccount: WalletAccount = {
        address: selectedAccount!.address,
        name: selectedAccount!.name,
        source: selectedAccount!.source,
      };
      
      setInitializingSubMessage('Creating backend session...');
      const network = getNetworkFromEnvironment(preferredEnvironment);
      const sessionResponse = await createDotBotSession(
        walletAccount,
        preferredEnvironment,
        network,
        undefined // sessionId will be auto-generated
      );
      
      setBackendSessionId(sessionResponse.sessionId);
      console.log('[App] Backend session created:', sessionResponse.sessionId);
      
      // Create frontend DotBot instance for UI state management only
      // This is a "frontend helper" - it doesn't do AI calls
      setInitializingSubMessage('Setting up frontend UI...');
      const dotbotInstance = await createDotBotInstance(
        selectedAccount!,
        preferredEnvironment,
        null, // No preloaded managers - DotBot handles connections directly
        (request: any) => setSigningRequest(request)
      );
      
      setDotbot(dotbotInstance);
      
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
  // EarlyExecutionSubscriber already subscribes to ALL execution updates for the session
  // when WebSocket connects. This function just tracks the executionId so we can
  // filter updates when they arrive.
  const subscribeToExecutionUpdates = (chatResult: any) => {
    if (chatResult.plan && backendSessionId) {
      const executionId = chatResult.executionId || chatResult.executionArrayState?.id;
      if (executionId) {
        console.log('[App] Tracking executionId for session-level subscription:', executionId);
        
        // Track executionId - session-level subscription will automatically receive updates
        if (earlySubscribeRef.current) {
          try {
            earlySubscribeRef.current(executionId);
            console.log('[App] ExecutionId tracked successfully:', executionId);
            setPendingExecutionId(null);
          } catch (error) {
            console.error('[App] Error tracking executionId:', error);
            setPendingExecutionId(executionId);
          }
        } else {
          // Fallback: Set pending state (will be processed when ref is available)
          setPendingExecutionId(executionId);
        }
      } else {
        console.warn('[App] Execution plan found but no executionId - backend may not have provided it yet');
      }
    }
  };

  // Helper: Add messages to chat (user, bot, execution)
  const addMessagesToChat = (
    message: string,
    chatResult: any,
    currentChat: any
  ): Promise<any>[] => {
    const persistencePromises: Promise<any>[] = [];
    
    // Add user message first (persistence in background)
    persistencePromises.push(
      currentChat.addUserMessage(message, true)
        .then(() => console.log('[App] User message persisted'))
        .catch((err: unknown) => console.error('[App] Failed to persist user message:', err))
    );

    // Add bot response
    if (chatResult.response) {
      persistencePromises.push(
        currentChat.addBotMessage(chatResult.response, true)
          .then(() => console.log('[App] Bot message persisted'))
          .catch((err: unknown) => console.error('[App] Failed to persist bot message:', err))
      );
    }

    // If there's an execution plan, add execution message
    if (chatResult.plan) {
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
        console.log('[App] Adding execution message:', { 
          executionId, 
          hasState: !!chatResult.executionArrayState,
          hasPlan: !!chatResult.plan 
        });
        persistencePromises.push(
          currentChat.addExecutionMessage(
            executionId,
            chatResult.plan,
            chatResult.executionArrayState,
            true // skipReload
          )
            .then(() => console.log('[App] Execution message persisted'))
            .catch((err: unknown) => console.error('[App] Failed to persist execution message:', err))
        );
      } else if (chatResult.executionArrayState) {
        persistencePromises.push(
          currentChat.updateExecutionMessage(existingMessage.id, {
            executionArray: chatResult.executionArrayState,
          })
            .then(() => console.log('[App] Execution message updated'))
            .catch((err: unknown) => console.error('[App] Failed to update execution message:', err))
        );
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

      // Step 1.5: Warn if WebSocket not connected (subscription may happen late)
      // CRITICAL: Backend starts simulation immediately, so we need WebSocket ready
      // WebSocket connection check is handled inside EarlyExecutionSubscriber
      // which has access to WebSocketProvider context

      // Step 2: Send message to backend
      const chatResult = await sendMessageToBackend(message, currentChat);
      
      // Step 3: Subscribe to WebSocket IMMEDIATELY (CRITICAL - must happen synchronously)
      // Backend starts simulation right after creating execution, so we need to subscribe
      // in the same call stack as receiving the response, before any React state updates
      subscribeToExecutionUpdates(chatResult);

      // Step 4: Add messages to chat
      const persistencePromises = addMessagesToChat(message, chatResult, currentChat);

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
        <WebSocketProvider sessionId={backendSessionId} autoConnect={true}>
          <EarlyExecutionSubscriber 
            subscribeRef={earlySubscribeRef} 
            pendingExecutionId={pendingExecutionId} 
            dotbot={dotbot}
            onExecutionMessageCreated={() => setConversationRefresh(prev => prev + 1)}
          >
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
                  backendSessionId={backendSessionId}
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
      )}
        </div>
          </EarlyExecutionSubscriber>
        </WebSocketProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

const App: React.FC = () => {
  return <AppContent />;
};

export default App;
