/**
 * DotBot Frontend - Out of the Box Integration
 * 
 * This demonstrates how simple the lib is to use.
 * Total integration code: ~20 lines
 */

import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ThemeProvider } from './contexts/ThemeContext';
import CollapsibleSidebar from './components/layout/CollapsibleSidebar';
import MainContent from './components/layout/MainContent';
import ExecutionFlow from './components/execution/ExecutionFlow';
import { DotBot, ExecutionArrayState, ConversationMessage } from './lib';
import { useWalletStore } from './stores/walletStore';
import { ASIOneService } from './lib/services/asiOneService';
import { SigningRequest, BatchSigningRequest } from './lib';
import { createRelayChainManager, createAssetHubManager, RpcManager } from './lib/rpcManager';
import './styles/globals.css';
import './styles/execution-flow.css';

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
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [showWelcomeScreen, setShowWelcomeScreen] = useState(true);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [signingRequest, setSigningRequest] = useState<SigningRequest | BatchSigningRequest | null>(null);
  const [executionArrayState, setExecutionArrayState] = useState<ExecutionArrayState | null>(null);
  const [autoApprovePending, setAutoApprovePending] = useState(false);
  const [simulationStatus, setSimulationStatus] = useState<{
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
  } | null>(null);
  
  // DotBot integration
  const [dotbot, setDotbot] = useState<DotBot | null>(null);
  const [asiOne] = useState(() => new ASIOneService());
  const [isInitializing, setIsInitializing] = useState(false);
  
  const [relayChainManager] = useState<RpcManager>(() => createRelayChainManager());
  const [assetHubManager] = useState<RpcManager>(() => createAssetHubManager());
  
  const { isConnected, selectedAccount } = useWalletStore();

  useEffect(() => {
    Promise.all([
      relayChainManager.getReadApi(),
      assetHubManager.getReadApi()
    ]).catch(() => {
      // Ignore pre-connection errors - will retry when needed
    });
  }, []);

  // Initialize DotBot when wallet connects
  useEffect(() => {
    if (isConnected && selectedAccount && !dotbot && !isInitializing) {
      initializeDotBot();
    }
  }, [isConnected, selectedAccount]);

  useEffect(() => {
    if (!dotbot) return;

    const unsubscribe = dotbot.onExecutionArrayUpdate((state) => {
      setExecutionArrayState(state);
    });

    return () => {
      unsubscribe();
    };
  }, [dotbot]);

  useEffect(() => {
    if (autoApprovePending && signingRequest) {
      signingRequest.resolve(true);
      setSigningRequest(null);
      setAutoApprovePending(false);
    }
  }, [signingRequest, autoApprovePending]);

  const initializeDotBot = async () => {
    setIsInitializing(true);
    try {
      const dotbotInstance = await DotBot.create({
        wallet: selectedAccount!,
        relayChainManager,
        assetHubManager,
        onSigningRequest: (request) => setSigningRequest(request),
        onBatchSigningRequest: (request) => setSigningRequest(request),
        onSimulationStatus: (status) => {
          setSimulationStatus(status);
          // Clear status after 3 seconds if complete or error
          if (status.phase === 'complete' || status.phase === 'error') {
            setTimeout(() => setSimulationStatus(null), 3000);
          }
        }
      });
      
      setDotbot(dotbotInstance);
      
      const botMessage: Message = {
        id: Date.now().toString(),
        type: 'bot',
        content: `Hello! I'm DotBot. Your wallet is connected (${selectedAccount!.address.slice(0, 8)}...). I can help you with Polkadot operations!`,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, botMessage]);
    } catch (error) {
      console.error('Failed to initialize DotBot:', error);
      
      const errorMessage: Message = {
        id: Date.now().toString(),
        type: 'bot',
        content: 'Failed to connect to Polkadot network. Please check your connection and try again.',
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsInitializing(false);
    }
  };

  /**
   * Send message - Simple!
   */
  const handleSendMessage = async (message: string) => {
    if (showWelcomeScreen) {
      setShowWelcomeScreen(false);
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: message,
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, userMessage]);
    setIsTyping(true);

    try {
      if (!dotbot) {
        throw new Error('Please connect your wallet first');
      }

      const result = await dotbot.chat(message, {
        conversationHistory,
        llm: async (msg, systemPrompt, llmContext) => {
          const response = await asiOne.sendMessage(msg, {
            systemPrompt,
            ...llmContext,
            walletAddress: selectedAccount?.address,
            network: 'Polkadot'
          });
          return response;
        }
      });

      setConversationHistory(prev => [
        ...prev,
        { role: 'user', content: message, timestamp: Date.now() },
        { role: 'assistant', content: result.response, timestamp: Date.now() }
      ]);

      const botMessage: Message = {
        id: Date.now().toString(),
        type: 'bot',
        content: result.response,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, botMessage]);

      if (result.executed) {
        const statusMessage: Message = {
          id: Date.now().toString() + '_status',
          type: 'bot',
          content: result.success 
            ? `✅ Successfully executed ${result.completed} operation(s).`
            : `⚠️ Completed ${result.completed}, failed ${result.failed} operation(s).`,
          timestamp: Date.now()
        };
        setMessages(prev => [...prev, statusMessage]);
      }
    } catch (error) {
      console.error('Error:', error);
      
      const errorMessage: Message = {
        id: Date.now().toString(),
        type: 'bot',
        content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    setConversationHistory([]); // Clear conversation history
    setShowWelcomeScreen(true);
  };

  const handleCheckBalance = () => handleSendMessage("Please check my DOT balance");
  const handleTransfer = () => handleSendMessage("I want to transfer some DOT");
  const handleStatus = () => handleSendMessage("Show me my transaction status");
  const handleSearchChat = () => {};
  const handleTransactions = () => {};

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <div className={`app-container ${isSidebarExpanded ? '' : 'sidebar-collapsed'}`}>
          <CollapsibleSidebar
            onNewChat={handleNewChat}
            onSearchChat={handleSearchChat}
            onTransactions={handleTransactions}
            isExpanded={isSidebarExpanded}
            onToggle={setIsSidebarExpanded}
          />

          <MainContent
            onCheckBalance={handleCheckBalance}
            onTransfer={handleTransfer}
            onStatus={handleStatus}
            onSendMessage={handleSendMessage}
            messages={messages}
            isTyping={isTyping}
            showWelcomeScreen={showWelcomeScreen}
            disabled={!dotbot}
            placeholder={
              !isConnected 
                ? "Connect your wallet to start chatting..."
                : isInitializing
                ? "Initializing DotBot (connecting to Polkadot networks)..."
                : "Type your message..."
            }
            simulationStatus={simulationStatus}
            executionFlow={
              /* Execution Flow - Shows immediately with simulation status */
              <ExecutionFlow
                state={executionArrayState}
                onAcceptAndStart={async () => {
                  if (signingRequest) {
                    signingRequest.resolve(true);
                    setSigningRequest(null);
                    setAutoApprovePending(false);
                  } else {
                    setAutoApprovePending(true);
                  }

                  if (dotbot && executionArrayState) {
                    const executionArray = (dotbot as any).currentExecutionArray;
                    if (executionArray && !executionArrayState.isExecuting) {
                      try {
                        const executionSystem = (dotbot as any).executionSystem;
                        const executioner = (executionSystem as any).executioner;
                        if (executioner) {
                          executioner.execute(executionArray, { autoApprove: false }).catch(() => {
                            setAutoApprovePending(false);
                          });
                        }
                      } catch {
                        setAutoApprovePending(false);
                      }
                    } else if (!executionArrayState.isExecuting) {
                      setAutoApprovePending(false);
                    }
                  }
            }}
            onCancel={() => {
              setAutoApprovePending(false);
              if (signingRequest) {
                signingRequest.resolve(false);
                setSigningRequest(null);
              }
              setExecutionArrayState(null);
            }}
            show={!!executionArrayState && executionArrayState.items.length > 0}
          />
            }
          />
        </div>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
