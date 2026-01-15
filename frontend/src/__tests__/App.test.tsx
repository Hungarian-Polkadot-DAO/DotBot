/**
 * App Component Tests
 * 
 * Tests the critical handleSendMessage flow that triggers ExecutionFlow rendering
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import App from '../App';
import * as dotbotApi from '../services/dotbotApi';
import { createMockDotBot, createMockChatInstance } from '../test-utils/mocks';
import { createChatResultWithExecution, createChatResultWithoutExecution } from '../test-utils/fixtures';
import { useWalletStore } from '../stores/walletStore';

// Mock dependencies
jest.mock('../services/dotbotApi');
jest.mock('../stores/walletStore');
jest.mock('../utils/appUtils', () => ({
  createDotBotInstance: jest.fn(),
  setupScenarioEngineDependencies: jest.fn().mockResolvedValue(undefined),
  getNetworkFromEnvironment: jest.fn().mockReturnValue('polkadot'),
}));

// Global variable to store onSendMessage for testing
let testOnSendMessage: ((message: string) => Promise<any>) | null = null;

// Mock child components to access onSendMessage prop
jest.mock('../components/chat/Chat', () => {
  return function MockChat({ onSendMessage }: { onSendMessage: (message: string) => Promise<any> }) {
    // Expose onSendMessage to test via module-level variable
    testOnSendMessage = onSendMessage;
    return <div data-testid="chat-component">Chat Component</div>;
  };
});

jest.mock('../components/chat/WelcomeScreen', () => {
  return function MockWelcomeScreen({ onSendMessage }: { onSendMessage: (message: string) => Promise<any> }) {
    // Expose onSendMessage to test via module-level variable
    testOnSendMessage = onSendMessage;
    return <div data-testid="welcome-screen">Welcome Screen</div>;
  };
});

// Mock other components that might cause issues
jest.mock('../contexts/WebSocketContext', () => ({
  WebSocketProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useWebSocket: () => ({
    isConnected: true,
    isConnecting: false,
    connectionError: null,
    subscribeToExecution: jest.fn(() => () => {}),
    subscribeToSessionExecutions: jest.fn(() => () => {}),
    connect: jest.fn(),
    disconnect: jest.fn(),
    reconnect: jest.fn(),
  }),
}));

jest.mock('../contexts/ThemeContext', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTheme: () => ({
    theme: 'light',
    toggleTheme: jest.fn(),
  }),
}));

// Mock other UI components
jest.mock('../components/ui/ThemeToggle', () => {
  return function MockThemeToggle() {
    return <div data-testid="theme-toggle">Theme Toggle</div>;
  };
});

jest.mock('../components/wallet/WalletButton', () => {
  return function MockWalletButton() {
    return <div data-testid="wallet-button">Wallet Button</div>;
  };
});

jest.mock('../components/layout/CollapsibleSidebar', () => {
  return function MockCollapsibleSidebar() {
    return <div data-testid="sidebar">Sidebar</div>;
  };
});

jest.mock('../components/common/LoadingOverlay', () => {
  return function MockLoadingOverlay() {
    return null;
  };
});

jest.mock('../components/settings/SettingsModal', () => {
  return function MockSettingsModal() {
    return null;
  };
});

const mockSendDotBotMessage = dotbotApi.sendDotBotMessage as jest.MockedFunction<typeof dotbotApi.sendDotBotMessage>;
const mockCreateDotBotSession = dotbotApi.createDotBotSession as jest.MockedFunction<typeof dotbotApi.createDotBotSession>;
const mockUseWalletStore = useWalletStore as jest.MockedFunction<typeof useWalletStore>;

describe('App', () => {
  let mockDotBot: ReturnType<typeof createMockDotBot>;
  let mockChat: ReturnType<typeof createMockChatInstance>;

  beforeEach(() => {
    jest.clearAllMocks();
    // Clean up test globals
    testOnSendMessage = null;

    // Setup wallet store mock
    mockUseWalletStore.mockReturnValue({
      isConnected: true,
      selectedAccount: {
        address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
        name: 'Test Account',
        source: 'polkadot-js',
      },
      connect: jest.fn(),
      disconnect: jest.fn(),
      selectAccount: jest.fn(),
    } as any);

    // Setup DotBot and Chat mocks
    mockChat = createMockChatInstance();
    mockDotBot = createMockDotBot({ currentChat: mockChat });

    // Mock appUtils
    const { createDotBotInstance } = require('../utils/appUtils');
    createDotBotInstance.mockResolvedValue(mockDotBot);

    // Mock session creation
    mockCreateDotBotSession.mockResolvedValue({
      success: true,
      sessionId: 'test-session-id',
      environment: 'mainnet',
      network: 'polkadot',
      wallet: {
        address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
        name: 'Test Account',
        source: 'polkadot-js',
      },
      timestamp: new Date().toISOString(),
    });
  });

  describe('handleSendMessage()', () => {
    it('should call the backend API correctly', async () => {
      const testMessage = 'Hello, DotBot!';
      
      mockSendDotBotMessage.mockResolvedValue({
        success: true,
        result: createChatResultWithoutExecution(),
        sessionId: 'test-session-id',
        timestamp: new Date().toISOString(),
      });

      render(<App />);

      // Wait for initialization
      await waitFor(() => {
        expect(mockCreateDotBotSession).toHaveBeenCalled();
      }, { timeout: 5000 });

      // Wait for component to render Chat or WelcomeScreen (which exposes onSendMessage)
      // Check for either component's testid
      await waitFor(() => {
        const chatComponent = screen.queryByTestId('chat-component');
        const welcomeScreen = screen.queryByTestId('welcome-screen');
        return chatComponent || welcomeScreen;
      }, { timeout: 5000 });

      // Now testOnSendMessage should be set - wait a bit more for React to update
      await waitFor(() => {
        expect(testOnSendMessage).toBeDefined();
        expect(typeof testOnSendMessage).toBe('function');
      }, { timeout: 3000 });

      // Call handleSendMessage through the exposed function
      const onSendMessage = testOnSendMessage!;
      expect(typeof onSendMessage).toBe('function');
      await act(async () => {
        await onSendMessage(testMessage);
      });

      // Verify API was called with correct parameters
      expect(mockSendDotBotMessage).toHaveBeenCalledWith({
        message: testMessage,
        sessionId: 'test-session-id',
        wallet: {
          address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
          name: 'Test Account',
          source: 'polkadot-js',
        },
        environment: 'mainnet',
        network: 'polkadot',
        conversationHistory: [],
      });
    });

    it('should call addExecutionMessage when chatResult.plan exists', async () => {
      const testMessage = 'Transfer 1 DOT';
      const executionId = 'exec-123';
      
      mockSendDotBotMessage.mockResolvedValue({
        success: true,
        result: createChatResultWithExecution({ executionId }),
        sessionId: 'test-session-id',
        timestamp: new Date().toISOString(),
      });

      render(<App />);

      // Wait for initialization
      await waitFor(() => {
        expect(mockCreateDotBotSession).toHaveBeenCalled();
      }, { timeout: 5000 });

      // Wait for component to render Chat or WelcomeScreen (which exposes onSendMessage)
      // Check for either component's testid
      await waitFor(() => {
        const chatComponent = screen.queryByTestId('chat-component');
        const welcomeScreen = screen.queryByTestId('welcome-screen');
        expect(chatComponent || welcomeScreen).toBeInTheDocument();
      }, { timeout: 5000 });

      // Now testOnSendMessage should be set - wait a bit more for React to update
      await waitFor(() => {
        expect(testOnSendMessage).toBeDefined();
      }, { timeout: 3000 });

      // Call handleSendMessage
      const onSendMessage = testOnSendMessage!;
      await act(async () => {
        await onSendMessage(testMessage);
      });

      // Verify addExecutionMessage was called with correct parameters
      expect(mockChat.addExecutionMessage).toHaveBeenCalledWith(
        executionId,
        expect.objectContaining({
          steps: expect.any(Array),
        }),
        expect.objectContaining({
          id: executionId,
        }),
        true // skipReload
      );
    });

    it('should add user message before bot response', async () => {
      const testMessage = 'Transfer 1 DOT';
      
      mockSendDotBotMessage.mockResolvedValue({
        success: true,
        result: createChatResultWithoutExecution(),
        sessionId: 'test-session-id',
        timestamp: new Date().toISOString(),
      });

      render(<App />);

      // Wait for initialization
      await waitFor(() => {
        expect(mockCreateDotBotSession).toHaveBeenCalled();
      }, { timeout: 5000 });

      // Wait for component to render Chat or WelcomeScreen (which exposes onSendMessage)
      // Check for either component's testid
      await waitFor(() => {
        const chatComponent = screen.queryByTestId('chat-component');
        const welcomeScreen = screen.queryByTestId('welcome-screen');
        expect(chatComponent || welcomeScreen).toBeInTheDocument();
      }, { timeout: 5000 });

      // Now testOnSendMessage should be set - wait a bit more for React to update
      await waitFor(() => {
        expect(testOnSendMessage).toBeDefined();
      }, { timeout: 3000 });

      // Call handleSendMessage
      const onSendMessage = testOnSendMessage!;
      await act(async () => {
        await onSendMessage(testMessage);
      });

      // Verify message order: user message should be added first
      expect(mockChat.addUserMessage).toHaveBeenCalledWith(testMessage, true);
      expect(mockChat.addBotMessage).toHaveBeenCalled();
      
      // Verify addUserMessage was called before addBotMessage
      const addUserMessageCall = mockChat.addUserMessage.mock.invocationCallOrder[0];
      const addBotMessageCall = mockChat.addBotMessage.mock.invocationCallOrder[0];
      expect(addUserMessageCall).toBeLessThan(addBotMessageCall);
    });

    it('should handle errors gracefully', async () => {
      const testMessage = 'Test message';
      const errorMessage = 'Network error';
      
      mockSendDotBotMessage.mockRejectedValue(new Error(errorMessage));

      render(<App />);

      // Wait for initialization
      await waitFor(() => {
        expect(mockCreateDotBotSession).toHaveBeenCalled();
      });

      // Wait for component to render Chat or WelcomeScreen
      await waitFor(() => {
        const chatComponent = screen.queryByTestId('chat-component');
        const welcomeScreen = screen.queryByTestId('welcome-screen');
        return chatComponent || welcomeScreen;
      }, { timeout: 5000 });

      // Wait for onSendMessage to be available
      await waitFor(() => {
        expect(testOnSendMessage).toBeDefined();
        expect(typeof testOnSendMessage).toBe('function');
      }, { timeout: 3000 });

      // Call handleSendMessage (should handle error)
      const onSendMessage = testOnSendMessage!;
      await act(async () => {
        await onSendMessage(testMessage);
      });

      // Error should be handled and error message added to chat
      expect(mockChat.addBotMessage).toHaveBeenCalled();
      const errorCall = mockChat.addBotMessage.mock.calls.find(
        (call) => call[0] && call[0].includes('Sorry, I encountered an error')
      );
      expect(errorCall).toBeDefined();
      expect(errorCall![0]).toContain('Sorry, I encountered an error');
    });

    it('should throw error when backend does not provide executionId for execution plan', async () => {
      const testMessage = 'Transfer 1 DOT';
      const chatResult = createChatResultWithExecution();
      // Remove executionId and executionArrayState.id to test error handling
      delete chatResult.executionId;
      if (chatResult.executionArrayState) {
        // Use type assertion to allow deletion of required property for testing
        delete (chatResult.executionArrayState as any).id;
      }
      
      mockSendDotBotMessage.mockResolvedValue({
        success: true,
        result: chatResult,
        sessionId: 'test-session-id',
        timestamp: new Date().toISOString(),
      });

      render(<App />);

      // Wait for initialization
      await waitFor(() => {
        expect(mockCreateDotBotSession).toHaveBeenCalled();
      }, { timeout: 5000 });

      // Wait for component to render Chat or WelcomeScreen (which exposes onSendMessage)
      await waitFor(() => {
        const chatComponent = screen.queryByTestId('chat-component');
        const welcomeScreen = screen.queryByTestId('welcome-screen');
        expect(chatComponent || welcomeScreen).toBeInTheDocument();
      }, { timeout: 5000 });

      // Wait for onSendMessage to be available
      await waitFor(() => {
        expect(testOnSendMessage).toBeDefined();
      }, { timeout: 3000 });

      // Call handleSendMessage - should throw error and be caught
      const onSendMessage = testOnSendMessage!;
      await act(async () => {
        await onSendMessage(testMessage);
      });

      // Error should be handled and error message added to chat
      // The implementation throws an error which is caught by handleSendMessageError
      // Check the last call to addBotMessage (error message comes after normal response)
      const addBotMessageCalls = mockChat.addBotMessage.mock.calls;
      expect(addBotMessageCalls.length).toBeGreaterThan(0);
      const lastCall = addBotMessageCalls[addBotMessageCalls.length - 1];
      expect(lastCall[0]).toContain('Sorry, I encountered an error');
      
      // addExecutionMessage should NOT be called when executionId is missing
      expect(mockChat.addExecutionMessage).not.toHaveBeenCalled();
    });

    it('should not add duplicate execution messages', async () => {
      const testMessage = 'Transfer 1 DOT';
      const executionId = 'exec-123';
      
      // Setup existing execution message
      const existingExecutionMessage = {
        id: 'existing-exec-msg',
        type: 'execution' as const,
        timestamp: Date.now(),
        executionId,
      };
      
      mockChat.getDisplayMessages.mockReturnValue([existingExecutionMessage] as any);
      
      mockSendDotBotMessage.mockResolvedValue({
        success: true,
        result: createChatResultWithExecution({ 
          executionId,
          executionArrayState: {
            id: executionId,
            items: [],
            isExecuting: false,
            isPaused: false,
            currentIndex: 0,
            totalItems: 0,
            completedItems: 0,
            failedItems: 0,
            cancelledItems: 0,
          },
        }),
        sessionId: 'test-session-id',
        timestamp: new Date().toISOString(),
      });

      render(<App />);

      // Wait for initialization
      await waitFor(() => {
        expect(mockCreateDotBotSession).toHaveBeenCalled();
      }, { timeout: 5000 });

      // Wait for component to render Chat or WelcomeScreen (which exposes onSendMessage)
      // Check for either component's testid
      await waitFor(() => {
        const chatComponent = screen.queryByTestId('chat-component');
        const welcomeScreen = screen.queryByTestId('welcome-screen');
        expect(chatComponent || welcomeScreen).toBeInTheDocument();
      }, { timeout: 5000 });

      // Now testOnSendMessage should be set - wait a bit more for React to update
      await waitFor(() => {
        expect(testOnSendMessage).toBeDefined();
      }, { timeout: 3000 });

      // Call handleSendMessage
      const onSendMessage = testOnSendMessage!;
      await act(async () => {
        await onSendMessage(testMessage);
      });

      // Should update existing message instead of adding duplicate
      expect(mockChat.addExecutionMessage).not.toHaveBeenCalled();
      expect(mockChat.updateExecutionMessage).toHaveBeenCalledWith(
        'existing-exec-msg',
        expect.objectContaining({
          executionArray: expect.objectContaining({
            id: executionId,
          }),
          executionPlan: expect.any(Object),
        })
      );
    });
  });
});
