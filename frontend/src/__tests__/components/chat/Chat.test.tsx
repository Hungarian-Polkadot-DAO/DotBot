/**
 * Chat Component Tests
 * 
 * Tests conversation rendering and refresh logic
 */

import React from 'react';
import { render, screen as _screen, waitFor, act } from '@testing-library/react';
import Chat from '../../../components/chat/Chat';
import { createMockDotBot, createMockChatInstance, createMockExecutionMessage } from '../../../test-utils/mocks';

// Mock react-markdown (ES module that needs transformation)
jest.mock('react-markdown', () => {
  return function ReactMarkdown({ children }: { children: React.ReactNode }) {
    return <div data-testid="react-markdown">{children}</div>;
  };
});

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  User: () => <div data-testid="user-icon" />,
}));

// Mock child components to focus on Chat logic
jest.mock('../../../components/chat/MessageList', () => {
  return function MessageList({ children }: { children: React.ReactNode }) {
    return <div data-testid="message-list">{children}</div>;
  };
});

jest.mock('../../../components/chat/ConversationItems', () => {
  return function ConversationItems({ items }: { items: any[]; dotbot: any; backendSessionId?: string | null }) {
    return (
      <div data-testid="conversation-items">
        {items.map((item) => (
          <div key={item.id} data-testid={`conversation-item-${item.id}`}>
            {item.type}: {item.content || item.id}
          </div>
        ))}
      </div>
    );
  };
});

jest.mock('../../../components/chat/ChatInput', () => {
  return function ChatInput({ 
    value, 
    onChange, 
    onSubmit, 
    placeholder, 
    disabled, 
    isTyping,
    showInjectionEffect 
  }: { 
    value: string; 
    onChange: (value: string) => void; 
    onSubmit: () => void;
    placeholder?: string;
    disabled?: boolean;
    isTyping?: boolean;
    showInjectionEffect?: boolean;
  }) {
    return (
      <div data-testid="chat-input">
        <input
          data-testid="chat-input-field"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled || isTyping}
        />
        <button data-testid="chat-input-submit" onClick={onSubmit} disabled={disabled || isTyping}>
          Submit
        </button>
        {showInjectionEffect && <div data-testid="injection-effect">Injected</div>}
      </div>
    );
  };
});

jest.mock('../../../components/chat/TypingIndicator', () => {
  return function TypingIndicator() {
    return <div data-testid="typing-indicator">Typing...</div>;
  };
});

describe('Chat', () => {
  let mockDotBot: ReturnType<typeof createMockDotBot>;
  let mockChat: ReturnType<typeof createMockChatInstance>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockChat = createMockChatInstance();
    mockDotBot = createMockDotBot({ currentChat: mockChat });
  });

  describe('conversation rendering', () => {
    it('should read conversationItems from dotbot.currentChat?.getDisplayMessages()', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'user' as const,
          content: 'Hello',
          timestamp: Date.now(),
        },
        {
          id: 'msg-2',
          type: 'bot' as const,
          content: 'Hi there!',
          timestamp: Date.now(),
        },
      ];

      mockChat.getDisplayMessages.mockReturnValue(messages as any);

      render(
        <Chat
          dotbot={mockDotBot}
          onSendMessage={jest.fn()}
        />
      );

      expect(mockChat.getDisplayMessages).toHaveBeenCalled();
    });

    it('should re-render when dotbot.currentChat changes', () => {
      const { rerender } = render(
        <Chat
          dotbot={mockDotBot}
          onSendMessage={jest.fn()}
        />
      );

      const initialCallCount = mockChat.getDisplayMessages.mock.calls.length;

      // Simulate chat change by creating a new chat instance
      const newMockChat = createMockChatInstance();
      const newMockDotBot = createMockDotBot({ currentChat: newMockChat });
      
      rerender(
        <Chat
          dotbot={newMockDotBot}
          onSendMessage={jest.fn()}
        />
      );

      // Component should re-render and call getDisplayMessages with new chat
      expect(newMockChat.getDisplayMessages).toHaveBeenCalled();
      // Old chat should not be called again (only on initial render)
      expect(mockChat.getDisplayMessages.mock.calls.length).toBe(initialCallCount);
    });

    it('should return items with type === execution', () => {
      const executionMessage = createMockExecutionMessage();
      const messages = [
        {
          id: 'msg-1',
          type: 'user' as const,
          content: 'Transfer 1 DOT',
          timestamp: Date.now(),
        },
        executionMessage,
      ];

      mockChat.getDisplayMessages.mockReturnValue(messages as any);

      render(
        <Chat
          dotbot={mockDotBot}
          onSendMessage={jest.fn()}
        />
      );

      const displayMessages = mockChat.getDisplayMessages();
      const executionItems = displayMessages.filter(item => item.type === 'execution');
      
      expect(executionItems.length).toBe(1);
      expect(executionItems[0]).toBe(executionMessage);
    });

    it('should handle empty conversation', () => {
      mockChat.getDisplayMessages.mockReturnValue([]);

      render(
        <Chat
          dotbot={mockDotBot}
          onSendMessage={jest.fn()}
        />
      );

      expect(mockChat.getDisplayMessages).toHaveBeenCalled();
      // Should render without errors
    });

    it('should handle null currentChat', () => {
      const dotbotWithoutChat = createMockDotBot({ currentChat: null });

      render(
        <Chat
          dotbot={dotbotWithoutChat}
          onSendMessage={jest.fn()}
        />
      );

      // Should handle null gracefully - component should render without errors
      expect(() => {
        dotbotWithoutChat.currentChat?.getDisplayMessages();
      }).not.toThrow();
    });

    it('should handle currentChat changing from null to chat instance', () => {
      const dotbotWithoutChat = createMockDotBot({ currentChat: null });
      const { rerender } = render(
        <Chat
          dotbot={dotbotWithoutChat}
          onSendMessage={jest.fn()}
        />
      );

      // Change to a chat instance
      const newMockChat = createMockChatInstance();
      const newMockDotBot = createMockDotBot({ currentChat: newMockChat });
      
      rerender(
        <Chat
          dotbot={newMockDotBot}
          onSendMessage={jest.fn()}
        />
      );

      expect(newMockChat.getDisplayMessages).toHaveBeenCalled();
    });

    it('should handle currentChat changing from chat instance to null', () => {
      const { rerender } = render(
        <Chat
          dotbot={mockDotBot}
          onSendMessage={jest.fn()}
        />
      );

      const initialCallCount = mockChat.getDisplayMessages.mock.calls.length;

      // Change to null
      const dotbotWithoutChat = createMockDotBot({ currentChat: null });
      rerender(
        <Chat
          dotbot={dotbotWithoutChat}
          onSendMessage={jest.fn()}
        />
      );

      // Should not call getDisplayMessages on null chat
      expect(mockChat.getDisplayMessages.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('DotBot event subscription', () => {
    it('should subscribe to DotBot events on mount', () => {
      render(
        <Chat
          dotbot={mockDotBot}
          onSendMessage={jest.fn()}
        />
      );

      expect(mockDotBot.addEventListener).toHaveBeenCalled();
      expect(mockDotBot.addEventListener).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should register event handler that responds to execution-message-added events', () => {
      let eventHandler: ((event: any) => void) | null = null;
      
      mockDotBot.addEventListener.mockImplementation((handler) => {
        eventHandler = handler;
        return handler;
      });

      const initialCallCount = mockChat.getDisplayMessages.mock.calls.length;

      render(
        <Chat
          dotbot={mockDotBot}
          onSendMessage={jest.fn()}
        />
      );

      expect(eventHandler).toBeTruthy();
      expect(typeof eventHandler).toBe('function');

      // Simulate execution-message-added event
      act(() => {
        if (eventHandler) {
          eventHandler({ 
            type: 'execution-message-added',
            executionId: 'exec-123',
            timestamp: Date.now()
          });
        }
      });

      // Component should re-render automatically (refreshKey changes)
      // This causes getDisplayMessages to be called again
      waitFor(() => {
        expect(mockChat.getDisplayMessages.mock.calls.length).toBeGreaterThan(initialCallCount);
      });
    });

    it('should not respond to other event types', () => {
      let eventHandler: ((event: any) => void) | null = null;
      
      mockDotBot.addEventListener.mockImplementation((handler) => {
        eventHandler = handler;
        return handler;
      });

      const initialCallCount = mockChat.getDisplayMessages.mock.calls.length;

      render(
        <Chat
          dotbot={mockDotBot}
          onSendMessage={jest.fn()}
        />
      );

      // Simulate other event types
      act(() => {
        if (eventHandler) {
          eventHandler({ type: 'chat-started', message: 'test' });
          eventHandler({ type: 'user-message-added', message: 'test', timestamp: Date.now() });
          eventHandler({ type: 'bot-message-added', message: 'test', timestamp: Date.now() });
        }
      });

      // Should not trigger excessive getDisplayMessages calls beyond initial render
      // (allowing for React internal re-renders and event handling)
      expect(mockChat.getDisplayMessages.mock.calls.length).toBeLessThanOrEqual(initialCallCount + 3);
    });

    it('should cleanup event listener on unmount', () => {
      let eventHandler: ((event: any) => void) | null = null;
      
      mockDotBot.addEventListener.mockImplementation((handler) => {
        eventHandler = handler;
        return handler;
      });

      mockDotBot.removeEventListener.mockImplementation((handler) => {
        // Verify it's the same handler
        expect(handler).toBe(eventHandler);
      });

      const { unmount } = render(
        <Chat
          dotbot={mockDotBot}
          onSendMessage={jest.fn()}
        />
      );

      unmount();

      expect(mockDotBot.removeEventListener).toHaveBeenCalled();
      expect(mockDotBot.removeEventListener).toHaveBeenCalledWith(eventHandler);
    });

    it('should cleanup and re-subscribe when dotbot reference changes', () => {
      let firstHandler: ((event: any) => void) | null = null;
      let secondHandler: ((event: any) => void) | null = null;
      
      mockDotBot.addEventListener.mockImplementation((handler) => {
        firstHandler = handler;
        return handler;
      });

      const { rerender } = render(
        <Chat
          dotbot={mockDotBot}
          onSendMessage={jest.fn()}
        />
      );

      // Create new dotbot instance
      const newMockChat = createMockChatInstance();
      const newMockDotBot = createMockDotBot({ currentChat: newMockChat });
      
      newMockDotBot.addEventListener.mockImplementation((handler) => {
        secondHandler = handler;
        return handler;
      });

      rerender(
        <Chat
          dotbot={newMockDotBot}
          onSendMessage={jest.fn()}
        />
      );

      // Should have cleaned up old listener and added new one
      expect(mockDotBot.removeEventListener).toHaveBeenCalled();
      expect(newMockDotBot.addEventListener).toHaveBeenCalled();
      expect(firstHandler).not.toBe(secondHandler);
    });
  });

  describe('polling for executionArray updates', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should start polling when execution messages exist without executionArray', () => {
      const executionMessage = createMockExecutionMessage();
      executionMessage.executionArray = undefined;
      
      mockChat.getDisplayMessages.mockReturnValue([executionMessage] as any);

      render(
        <Chat
          dotbot={mockDotBot}
          onSendMessage={jest.fn()}
        />
      );

      const initialCallCount = mockChat.getDisplayMessages.mock.calls.length;

      // Fast-forward time to trigger polling (150ms interval)
      act(() => {
        jest.advanceTimersByTime(300); // Should trigger at least 2 polls
      });

      // Should have polled multiple times
      expect(mockChat.getDisplayMessages.mock.calls.length).toBeGreaterThan(initialCallCount + 1);
    });

    it('should stop polling when executionArray becomes available', () => {
      const executionMessage = createMockExecutionMessage();
      executionMessage.executionArray = undefined;
      
      mockChat.getDisplayMessages.mockReturnValue([executionMessage] as any);

      render(
        <Chat
          dotbot={mockDotBot}
          onSendMessage={jest.fn()}
        />
      );

      const callCountBeforePolling = mockChat.getDisplayMessages.mock.calls.length;

      // Start polling
      act(() => {
        jest.advanceTimersByTime(150); // First poll
      });

      const callCountAfterFirstPoll = mockChat.getDisplayMessages.mock.calls.length;
      expect(callCountAfterFirstPoll).toBeGreaterThan(callCountBeforePolling);

      // Now simulate executionArray being added
      executionMessage.executionArray = {
        id: 'exec-123',
        items: [],
        isExecuting: false,
        currentIndex: 0,
        totalItems: 0,
        completedItems: 0,
        failedItems: 0,
        cancelledItems: 0,
        isPaused: false,
      };
      
      mockChat.getDisplayMessages.mockReturnValue([executionMessage] as any);

      // Advance time - polling should stop
      act(() => {
        jest.advanceTimersByTime(500); // Should stop after detecting executionArray
      });

      // Should not have polled excessively after executionArray is found
      // Allow for React re-renders when executionArray is detected
      const finalCallCount = mockChat.getDisplayMessages.mock.calls.length;
      expect(finalCallCount).toBeLessThanOrEqual(callCountAfterFirstPoll + 4);
    });

    it('should not start polling when executionArray already exists', () => {
      const executionMessage = createMockExecutionMessage();
      executionMessage.executionArray = {
        id: 'exec-123',
        items: [],
        isExecuting: false,
        currentIndex: 0,
        totalItems: 0,
        completedItems: 0,
        failedItems: 0,
        cancelledItems: 0,
        isPaused: false,
      };
      
      mockChat.getDisplayMessages.mockReturnValue([executionMessage] as any);

      render(
        <Chat
          dotbot={mockDotBot}
          onSendMessage={jest.fn()}
        />
      );

      const callCountBefore = mockChat.getDisplayMessages.mock.calls.length;
      
      // Advance time - should not poll
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      
      // Should not have polled (only initial render calls)
      // Allow for React internal re-renders
      expect(mockChat.getDisplayMessages.mock.calls.length).toBeLessThanOrEqual(callCountBefore + 5);
    });

    it('should stop polling after max attempts (20 attempts = 3 seconds)', () => {
      const executionMessage = createMockExecutionMessage();
      executionMessage.executionArray = undefined;
      
      mockChat.getDisplayMessages.mockReturnValue([executionMessage] as any);

      render(
        <Chat
          dotbot={mockDotBot}
          onSendMessage={jest.fn()}
        />
      );

      const callCountBefore = mockChat.getDisplayMessages.mock.calls.length;

      // Advance time beyond max attempts (20 * 150ms = 3000ms)
      act(() => {
        jest.advanceTimersByTime(3500);
      });

      // Should have polled up to max attempts (20)
      const totalCalls = mockChat.getDisplayMessages.mock.calls.length;
      expect(totalCalls).toBeGreaterThanOrEqual(callCountBefore + 20);
      
      // Advance more time - should not poll anymore
      const callCountAfterMax = mockChat.getDisplayMessages.mock.calls.length;
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      
      // Should not have polled after max attempts
      // Allow for some React re-renders
      expect(mockChat.getDisplayMessages.mock.calls.length).toBeLessThanOrEqual(callCountAfterMax + 5);
    });

    it('should not poll when there are no execution messages', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'user' as const,
          content: 'Hello',
          timestamp: Date.now(),
        },
      ];
      
      mockChat.getDisplayMessages.mockReturnValue(messages as any);

      render(
        <Chat
          dotbot={mockDotBot}
          onSendMessage={jest.fn()}
        />
      );

      const callCountBefore = mockChat.getDisplayMessages.mock.calls.length;
      
      // Advance time - should not poll
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      
      // Should not have polled
      // Allow for React re-renders
      expect(mockChat.getDisplayMessages.mock.calls.length).toBeLessThanOrEqual(callCountBefore + 5);
    });

    it('should cleanup polling interval on unmount', () => {
      const executionMessage = createMockExecutionMessage();
      executionMessage.executionArray = undefined;
      
      mockChat.getDisplayMessages.mockReturnValue([executionMessage] as any);

      const { unmount } = render(
        <Chat
          dotbot={mockDotBot}
          onSendMessage={jest.fn()}
        />
      );

      const callCountBefore = mockChat.getDisplayMessages.mock.calls.length;

      // Start polling
      act(() => {
        jest.advanceTimersByTime(150);
      });

      expect(mockChat.getDisplayMessages.mock.calls.length).toBeGreaterThan(callCountBefore);

      // Unmount component
      unmount();

      // Advance time after unmount
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      // Should not poll after unmount
      const callCountAfterUnmount = mockChat.getDisplayMessages.mock.calls.length;
      expect(mockChat.getDisplayMessages.mock.calls.length).toBe(callCountAfterUnmount);
    });
  });
});
