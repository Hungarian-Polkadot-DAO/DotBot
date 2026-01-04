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
  
  // Pre-initialized RPC managers (created on app load, used by DotBot when wallet connects)
  const [relayChainManager] = useState<RpcManager>(() => {
    console.log('🌐 Creating Relay Chain manager (background)...');
    return createRelayChainManager();
  });
  const [assetHubManager] = useState<RpcManager>(() => {
    console.log('🌐 Creating Asset Hub manager (background)...');
    return createAssetHubManager();
  });
  
  const { isConnected, selectedAccount } = useWalletStore();

  // Pre-connect to networks BEFORE wallet (runs once on app load)
  useEffect(() => {
    const preConnectNetworks = async () => {
      try {
        console.log('🔗 Pre-connecting to Polkadot networks (background)...');
        
        // Start connecting in the background (don't block wallet connection)
        Promise.all([
          relayChainManager.getReadApi().then(api => {
            console.log('✅ Relay Chain pre-connected:', relayChainManager.getCurrentEndpoint());
          }),
          assetHubManager.getReadApi().then(api => {
            console.log('✅ Asset Hub pre-connected:', assetHubManager.getCurrentEndpoint());
          })
        ]).catch(error => {
          console.warn('⚠️ Some networks failed to pre-connect (will retry):', error);
        });
      } catch (error) {
        console.warn('⚠️ Network pre-connection failed:', error);
      }
    };
    
    preConnectNetworks();
  }, []); // Run once on mount

  // Initialize DotBot when wallet connects
  useEffect(() => {
    if (isConnected && selectedAccount && !dotbot && !isInitializing) {
      initializeDotBot();
    }
  }, [isConnected, selectedAccount]);

  // Subscribe to execution array updates
  useEffect(() => {
    if (!dotbot) return;

    const unsubscribe = dotbot.onExecutionArrayUpdate((state) => {
      console.log('📊 ExecutionArray state update:', state);
      setExecutionArrayState(state);
    });

    return () => {
      unsubscribe();
    };
  }, [dotbot]);

  // Auto-resolve signing requests if user has already clicked Accept
  useEffect(() => {
    if (autoApprovePending && signingRequest) {
      console.log('📝 Auto-resolving signing request (user already approved)');
      signingRequest.resolve(true);
      setSigningRequest(null);
      setAutoApprovePending(false);
    }
  }, [signingRequest, autoApprovePending]);

  /**
   * Initialize DotBot - Simple!
   */
  const initializeDotBot = async () => {
    setIsInitializing(true);
    try {
      console.log('🚀 Initializing DotBot with pre-connected networks...');
      const dotbotInstance = await DotBot.create({
        wallet: selectedAccount!,
        endpoint: 'wss://rpc.polkadot.io',
        // Pass pre-initialized managers (already connecting in background!)
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

      // Use DotBot - call chat() with conversation history!
      console.log('💬 Sending message to DotBot:', message);
      console.log('💬 Conversation history length:', conversationHistory.length);
      
      const result = await dotbot.chat(message, {
        conversationHistory, // Pass conversation history!
        llm: async (msg, systemPrompt, llmContext) => {
          console.log('🤖 Calling LLM with system prompt length:', systemPrompt.length);
          console.log('🤖 System prompt preview:', systemPrompt.substring(0, 500));
          console.log('🤖 LLM context:', llmContext);
          console.log('🤖 Conversation history in context:', llmContext?.conversationHistory?.length || 0);
          
          // Pass systemPrompt and context (including conversationHistory) to ASIOneService
          const response = await asiOne.sendMessage(msg, { 
            systemPrompt,  // This will be used by ASIOneService
            ...llmContext,  // This includes conversationHistory
            walletAddress: selectedAccount?.address,
            network: 'Polkadot'
          });
          console.log('🤖 LLM response received, length:', response.length);
          console.log('🤖 LLM response preview:', response.substring(0, 500));
          return response;
        }
      });
      
      // Update conversation history after receiving response
      setConversationHistory(prev => [
        ...prev,
        { role: 'user', content: message, timestamp: Date.now() },
        { role: 'assistant', content: result.response, timestamp: Date.now() }
      ]);
      console.log('📝 Updated conversation history, new length:', conversationHistory.length + 2);
      
      console.log('📊 DotBot result:', {
        executed: result.executed,
        success: result.success,
        completed: result.completed,
        failed: result.failed,
        hasPlan: !!result.plan
      });

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
  const handleSearchChat = () => console.log('Search Chat clicked');
  const handleTransactions = () => console.log('Transactions clicked');

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
                  console.log('✅ Accepting and starting execution flow');
                  
                  // If signing request already exists, resolve it immediately
                  if (signingRequest) {
                    console.log('📝 Resolving existing signing request');
                    signingRequest.resolve(true);
                    setSigningRequest(null);
                    setAutoApprovePending(false);
                  } else {
                    // No signing request yet - set flag to auto-approve when it appears
                    console.log('⏳ No signing request yet - will auto-approve when it appears');
                    setAutoApprovePending(true);
                  }
                  
                  // If execution hasn't started yet, start it now
                  // The signing request will be created as execution progresses
                  if (dotbot && executionArrayState) {
                    const executionArray = (dotbot as any).currentExecutionArray;
                    if (executionArray && !executionArrayState.isExecuting) {
                      console.log('🚀 Execution not started yet, starting now...');
                      try {
                        const executionSystem = (dotbot as any).executionSystem;
                        const executioner = (executionSystem as any).executioner;
                        if (executioner) {
                          console.log('▶️ Starting executioner.execute()');
                          // Start execution (signing requests will be created and auto-approved)
                          executioner.execute(executionArray, { autoApprove: false }).catch((error: Error) => {
                            console.error('❌ Execution error:', error);
                            setAutoApprovePending(false);
                          });
                        }
                      } catch (error) {
                        console.error('❌ Failed to start execution:', error);
                        setAutoApprovePending(false);
                      }
                    } else if (executionArrayState.isExecuting) {
                      console.log('ℹ️ Execution already running');
                    } else {
                      console.warn('⚠️ No execution array available');
                      setAutoApprovePending(false);
                    }
                  }
            }}
            onCancel={() => {
              console.log('🚫 Cancelling execution');
              // Clear auto-approve flag
              setAutoApprovePending(false);
              // Reject signing request if exists
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
