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
import { ASIOneService } from './services/asiOneService';
import { SigningRequest, BatchSigningRequest } from './lib';
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
  
  // DotBot integration - just two lines!
  const [dotbot, setDotbot] = useState<DotBot | null>(null);
  const [asiOne] = useState(() => new ASIOneService());
  const [isInitializing, setIsInitializing] = useState(false);
  
  const { isConnected, selectedAccount } = useWalletStore();

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

  /**
   * Initialize DotBot - Simple!
   */
  const initializeDotBot = async () => {
    setIsInitializing(true);
    try {
      const dotbotInstance = await DotBot.create({
        wallet: selectedAccount!,
        endpoint: 'wss://rpc.polkadot.io',
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
              /* Execution Flow - Visual representation and approval */
          <ExecutionFlow
            state={executionArrayState}
                onAcceptAndStart={async () => {
                  console.log('✅ Accepting and starting execution flow');
                  
                  // Resolve the signing request if it exists (this unblocks execution)
                  if (signingRequest) {
                    console.log('📝 Resolving signing request to unblock execution');
                    signingRequest.resolve(true);
                    setSigningRequest(null);
                  } else {
                    console.warn('⚠️ No signing request found - execution may not be waiting for approval');
                  }
                  
                  // If execution hasn't started yet, start it now
                  // This handles the case where execution was deferred until user approval
                  if (dotbot && executionArrayState) {
                    const executionArray = (dotbot as any).currentExecutionArray;
                    if (executionArray && !executionArrayState.isExecuting) {
                      console.log('🚀 Execution not started yet, starting now...');
                      try {
                        const executionSystem = (dotbot as any).executionSystem;
                        const executioner = (executionSystem as any).executioner;
                        if (executioner) {
                          console.log('▶️ Starting executioner.execute()');
                          // Start execution (signing requests will be handled normally)
                          executioner.execute(executionArray, { autoApprove: false }).catch((error: Error) => {
                            console.error('❌ Execution error:', error);
                          });
                        }
                      } catch (error) {
                        console.error('❌ Failed to start execution:', error);
                      }
                    } else if (executionArrayState.isExecuting) {
                      console.log('ℹ️ Execution already running');
                    } else {
                      console.warn('⚠️ No execution array available');
                    }
                  }
            }}
            onCancel={() => {
              console.log('🚫 Cancelling execution');
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
