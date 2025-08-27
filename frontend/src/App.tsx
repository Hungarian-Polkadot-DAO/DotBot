// Main App component - layout structure ready for ChatGPT-like design

import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ChatSession, Message } from './types/chat';
import { AgentInfo } from './types/agents';
import { storageService } from './services/storageService';
import { AgentCommunicationService } from './services/agentCommunication';
import Sidebar from './components/sidebar/Sidebar';
import ChatInterface from './components/chat/ChatInterface';
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

const App: React.FC = () => {
  // State management
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [agentService] = useState(() => new AgentCommunicationService());

  // Initialize app
  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    logger.info("DotBot Frontend starting up - Hello World from logging system!");
    
    // Load saved sessions
    logger.debug("Loading saved chat sessions");
    const savedSessions = storageService.loadChatSessions();
    setSessions(savedSessions);
    logger.info({ sessionCount: savedSessions.length }, "Loaded chat sessions");

    // Load current session
    const currentSessionId = storageService.loadCurrentSession();
    if (currentSessionId && savedSessions.length > 0) {
      const session = savedSessions.find(s => s.id === currentSessionId);
      if (session) {
        setCurrentSession(session);
      }
    }

    // Load available agents
    const availableAgents = agentService.getAvailableAgents();
    setAgents(availableAgents);

    // Check agent availability
    await agentService.checkAgentAvailability();
  };

  // Create new chat session
  const handleNewChat = () => {
    const newSession = storageService.createNewSession();
    setSessions(prev => [newSession, ...prev]);
    setCurrentSession(newSession);
  };

  // Select existing session
  const handleSelectSession = (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      setCurrentSession(session);
      storageService.saveCurrentSession(sessionId);
    }
  };

  // Delete session
  const handleDeleteSession = (sessionId: string) => {
    storageService.deleteSession(sessionId);
    const updatedSessions = sessions.filter(s => s.id !== sessionId);
    setSessions(updatedSessions);

    // If deleted session was current, select another or create new
    if (currentSession?.id === sessionId) {
      if (updatedSessions.length > 0) {
        setCurrentSession(updatedSessions[0]);
        storageService.saveCurrentSession(updatedSessions[0].id);
      } else {
        setCurrentSession(null);
      }
    }
  };

  // Send message
  const handleSendMessage = async (messageContent: string) => {
    if (!currentSession) {
      // Create new session if none exists
      handleNewChat();
      return;
    }

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: messageContent,
      timestamp: Date.now()
    };

    // Update session with user message
    const updatedSession = {
      ...currentSession,
      messages: [...currentSession.messages, userMessage],
      updatedAt: Date.now(),
      title: currentSession.messages.length === 0 ? 
        messageContent.slice(0, 30) + (messageContent.length > 30 ? '...' : '') : 
        currentSession.title
    };

    setCurrentSession(updatedSession);
    storageService.addMessageToSession(currentSession.id, userMessage);

    // Update sessions list
    setSessions(prev => prev.map(s => s.id === currentSession.id ? updatedSession : s));

    // Show typing indicator
    setIsTyping(true);

    try {
      // Route to appropriate agent
      const agentId = agentService.routeMessage(messageContent);
      
      // Send to agent
      const agentResponse = await agentService.sendToAgent({
        agentId,
        message: messageContent,
        context: {
          conversationId: currentSession.id,
          previousMessages: currentSession.messages.slice(-5).map(m => m.content),
        }
      });

      // Add agent response
      const agentMessage: Message = {
        id: Date.now().toString() + '_agent',
        type: 'agent',
        content: agentResponse.content,
        timestamp: Date.now(),
        agentId: agentResponse.agentId,
        agentName: agents.find(a => a.id === agentResponse.agentId)?.name,
        metadata: {
          confidence: agentResponse.metadata?.confidence,
          transactionData: agentResponse.metadata?.transactionData,
          actionRequired: agentResponse.metadata?.requiresAction
        }
      };

      // Update session with agent response
      const finalSession = {
        ...updatedSession,
        messages: [...updatedSession.messages, agentMessage],
        updatedAt: Date.now()
      };

      setCurrentSession(finalSession);
      storageService.addMessageToSession(currentSession.id, agentMessage);
      setSessions(prev => prev.map(s => s.id === currentSession.id ? finalSession : s));

    } catch (error) {
      console.error('Error sending message:', error);
      
      // Add error message
      const errorMessage: Message = {
        id: Date.now().toString() + '_error',
        type: 'system',
        content: 'Sorry, I encountered an error processing your request. Please try again.',
        timestamp: Date.now()
      };

      const errorSession = {
        ...updatedSession,
        messages: [...updatedSession.messages, errorMessage],
        updatedAt: Date.now()
      };

      setCurrentSession(errorSession);
      storageService.addMessageToSession(currentSession.id, errorMessage);
      setSessions(prev => prev.map(s => s.id === currentSession.id ? errorSession : s));
    } finally {
      setIsTyping(false);
    }
  };

  // Voice input handler (placeholder)
  const handleVoiceInput = () => {
    console.log('Voice input requested');
    // TODO: Implement voice input
  };

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen bg-gray-950 text-white">
        {/* Sidebar */}
        <div className="w-80 flex-shrink-0">
          <Sidebar
            sessions={sessions}
            currentSessionId={currentSession?.id || null}
            onNewChat={handleNewChat}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
          />
        </div>

        {/* Main chat area */}
        <div className="flex-1 flex flex-col">
          <ChatInterface
            session={currentSession}
            agents={agents}
            onSendMessage={handleSendMessage}
            onVoiceInput={handleVoiceInput}
            isTyping={isTyping}
          />
        </div>
      </div>
    </QueryClientProvider>
  );
};

export default App;
