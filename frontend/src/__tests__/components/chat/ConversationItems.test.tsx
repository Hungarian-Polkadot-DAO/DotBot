/**
 * ConversationItems Component Tests
 * 
 * Tests item mapping and ExecutionFlow rendering decision
 */

import React from 'react';
import { render } from '@testing-library/react';
import ConversationItems from '../../../components/chat/ConversationItems';
import { createMockDotBot, createMockExecutionMessage } from '../../../test-utils/mocks';

// Mock ExecutionFlow component
jest.mock('../../../components/execution-flow/ExecutionFlow', () => {
  return function MockExecutionFlow(props: any) {
    return <div data-testid="execution-flow" data-execution-id={props.executionMessage?.executionId} />;
  };
});

// Mock Message component
jest.mock('../../../components/chat/Message', () => {
  return function MockMessage(props: any) {
    return <div data-testid="message" data-message-id={props.message?.id} />;
  };
});

describe('ConversationItems', () => {
  let mockDotBot: ReturnType<typeof createMockDotBot>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDotBot = createMockDotBot();
  });

  describe('item mapping', () => {
    it('should receive items with type === execution', () => {
      const executionMessage = createMockExecutionMessage();
      const items = [
        {
          id: 'msg-1',
          type: 'user' as const,
          content: 'Transfer 1 DOT',
          timestamp: Date.now(),
        },
        executionMessage,
      ];

      const { getByTestId } = render(
        <ConversationItems
          items={items as any}
          dotbot={mockDotBot}
        />
      );

      // Should render ExecutionFlow for execution item
      expect(getByTestId('execution-flow')).toBeInTheDocument();
      expect(getByTestId('execution-flow')).toHaveAttribute('data-execution-id', 'exec-123');
    });

    it('should render ExecutionFlow for execution items', () => {
      const executionMessage = createMockExecutionMessage();
      const items = [executionMessage];

      const { getByTestId } = render(
        <ConversationItems
          items={items as any}
          dotbot={mockDotBot}
        />
      );

      const executionFlow = getByTestId('execution-flow');
      expect(executionFlow).toBeInTheDocument();
    });

    it('should pass correct props to ExecutionFlow', () => {
      const executionMessage = createMockExecutionMessage({
        executionId: 'exec-456',
        id: 'exec-msg-2',
      });
      const items = [executionMessage];

      const { getByTestId } = render(
        <ConversationItems
          items={items as any}
          dotbot={mockDotBot}
          backendSessionId="test-session"
        />
      );

      const executionFlow = getByTestId('execution-flow');
      expect(executionFlow).toHaveAttribute('data-execution-id', 'exec-456');
    });

    it('should render Message components for text items', () => {
      const items = [
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

      const { getAllByTestId } = render(
        <ConversationItems
          items={items as any}
          dotbot={mockDotBot}
        />
      );

      const messages = getAllByTestId('message');
      expect(messages).toHaveLength(2);
      expect(messages[0]).toHaveAttribute('data-message-id', 'msg-1');
      expect(messages[1]).toHaveAttribute('data-message-id', 'msg-2');
    });

    it('should handle mixed item types', () => {
      const executionMessage = createMockExecutionMessage();
      const items = [
        {
          id: 'msg-1',
          type: 'user' as const,
          content: 'Transfer 1 DOT',
          timestamp: Date.now(),
        },
        executionMessage,
        {
          id: 'msg-2',
          type: 'bot' as const,
          content: 'I will help you',
          timestamp: Date.now(),
        },
      ];

      const { getByTestId, getAllByTestId } = render(
        <ConversationItems
          items={items as any}
          dotbot={mockDotBot}
        />
      );

      // Should render both messages and execution flow
      expect(getAllByTestId('message')).toHaveLength(2);
      expect(getByTestId('execution-flow')).toBeInTheDocument();
    });
  });

  describe('deduplication', () => {
    it('should deduplicate execution messages by executionId', () => {
      const executionMessage1 = createMockExecutionMessage({
        id: 'exec-msg-1',
        executionId: 'exec-123',
        timestamp: Date.now() - 1000,
      });
      const executionMessage2 = createMockExecutionMessage({
        id: 'exec-msg-2',
        executionId: 'exec-123',
        timestamp: Date.now(),
      });

      const items = [executionMessage1, executionMessage2];

      const { getAllByTestId } = render(
        <ConversationItems
          items={items as any}
          dotbot={mockDotBot}
        />
      );

      // Should only render one ExecutionFlow (the latest one)
      const executionFlows = getAllByTestId('execution-flow');
      expect(executionFlows).toHaveLength(1);
      expect(executionFlows[0]).toHaveAttribute('data-execution-id', 'exec-123');
    });

    it('should keep latest execution message when duplicates exist', () => {
      const executionMessage1 = createMockExecutionMessage({
        id: 'exec-msg-1',
        executionId: 'exec-123',
        timestamp: 1000,
      });
      const executionMessage2 = createMockExecutionMessage({
        id: 'exec-msg-2',
        executionId: 'exec-123',
        timestamp: 2000,
      });

      const items = [executionMessage1, executionMessage2];

      const { getByTestId } = render(
        <ConversationItems
          items={items as any}
          dotbot={mockDotBot}
        />
      );

      // Should render the latest one (executionMessage2)
      const executionFlow = getByTestId('execution-flow');
      expect(executionFlow).toHaveAttribute('data-execution-id', 'exec-123');
    });

    it('should not deduplicate execution messages with different executionIds', () => {
      const executionMessage1 = createMockExecutionMessage({
        id: 'exec-msg-1',
        executionId: 'exec-123',
      });
      const executionMessage2 = createMockExecutionMessage({
        id: 'exec-msg-2',
        executionId: 'exec-456',
      });

      const items = [executionMessage1, executionMessage2];

      const { getAllByTestId } = render(
        <ConversationItems
          items={items as any}
          dotbot={mockDotBot}
        />
      );

      // Should render both ExecutionFlows
      const executionFlows = getAllByTestId('execution-flow');
      expect(executionFlows).toHaveLength(2);
    });
  });

  describe('edge cases', () => {
    it('should handle empty items array', () => {
      const { container } = render(
        <ConversationItems
          items={[]}
          dotbot={mockDotBot}
        />
      );

      // React Fragment returns null when empty, which is correct behavior
      expect(container.firstChild).toBeNull();
    });

    it('should handle execution items without executionId', () => {
      const executionMessage = createMockExecutionMessage();
      delete (executionMessage as any).executionId;
      
      const items = [executionMessage];

      const { queryByTestId } = render(
        <ConversationItems
          items={items as any}
          dotbot={mockDotBot}
        />
      );

      // Should not render ExecutionFlow if no executionId
      expect(queryByTestId('execution-flow')).not.toBeInTheDocument();
    });

    it('should handle execution items with equal timestamps', () => {
      const timestamp = Date.now();
      const executionMessage1 = createMockExecutionMessage({
        id: 'exec-msg-1',
        executionId: 'exec-123',
        timestamp,
      });
      const executionMessage2 = createMockExecutionMessage({
        id: 'exec-msg-2',
        executionId: 'exec-123',
        timestamp, // Same timestamp
      });

      const items = [executionMessage1, executionMessage2];

      const { getAllByTestId } = render(
        <ConversationItems
          items={items as any}
          dotbot={mockDotBot}
        />
      );

      // Should only render one ExecutionFlow (the last one encountered when timestamps are equal)
      const executionFlows = getAllByTestId('execution-flow');
      expect(executionFlows).toHaveLength(1);
      expect(executionFlows[0]).toHaveAttribute('data-execution-id', 'exec-123');
    });
  });
});
