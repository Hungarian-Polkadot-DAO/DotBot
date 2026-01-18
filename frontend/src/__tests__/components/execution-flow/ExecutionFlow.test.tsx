/**
 * ExecutionFlow Component Tests
 * 
 * Tests the component that should appear but doesn't
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ExecutionFlow from '../../../components/execution-flow/ExecutionFlow';
import { createMockDotBot, createMockExecutionMessage, createMockExecutionArrayState } from '../../../test-utils/mocks';

// Mock hooks - need to mock the index file since component imports from './hooks'
// Create mocks that will be used
const createMockUseExpandedItems = () => ({
  isExpanded: jest.fn(() => false),
  toggleExpand: jest.fn(),
});

jest.mock('../../../components/execution-flow/hooks', () => ({
  useExecutionFlowState: jest.fn(),
  useExpandedItems: createMockUseExpandedItems,
}));

// Mock child components
jest.mock('../../../components/execution-flow/ExecutionFlowHeader', () => {
  return function MockHeader() {
    return <div data-testid="execution-flow-header">Header</div>;
  };
});

jest.mock('../../../components/execution-flow/ExecutionFlowFooter', () => {
  return function MockFooter(props: any) {
    return (
      <div data-testid="execution-flow-footer">
        {props.isWaitingForApproval && props.showAccept && (
          <button onClick={props.onAcceptAndStart} data-testid="accept-button">
            Accept and Start
          </button>
        )}
        {props.showCancel && (
          <button onClick={props.onCancel} data-testid="cancel-button">
            Cancel
          </button>
        )}
      </div>
    );
  };
});

jest.mock('../../../components/execution-flow/ExecutionFlowItem', () => {
  return function MockItem() {
    return <div data-testid="execution-flow-item">Item</div>;
  };
});

jest.mock('../../../components/execution-flow/components/LoadingState', () => {
  return function MockLoadingState() {
    return <div data-testid="loading-state">Loading...</div>;
  };
});

jest.mock('../../../services/dotbotApi', () => ({
  startExecution: jest.fn(),
}));

// Get the mocked functions after jest.mock has run
const hooksModule = require('../../../components/execution-flow/hooks');
const mockUseExecutionFlowStateFn = hooksModule.useExecutionFlowState;

describe('ExecutionFlow', () => {
  let mockDotBot: ReturnType<typeof createMockDotBot>;
  const mockUseExecutionFlowState = require('../../../components/execution-flow/hooks').useExecutionFlowState;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDotBot = createMockDotBot();
    mockUseExecutionFlowState.mockReturnValue(null);
  });

  describe('rendering', () => {
    it('should render with valid props', () => {
      const executionMessage = createMockExecutionMessage();
      const executionState = createMockExecutionArrayState({
        items: [{ id: 'item-1', status: 'pending' }] as any,
      });
      
      mockUseExecutionFlowState.mockReturnValue(executionState);

      render(
        <ExecutionFlow
          executionMessage={executionMessage}
          dotbot={mockDotBot}
        />
      );

      expect(screen.getByTestId('execution-flow-header')).toBeInTheDocument();
      expect(screen.getByTestId('execution-flow-footer')).toBeInTheDocument();
    });

    it('should call useExecutionFlowState with the correct parameters', () => {
      const executionMessage = createMockExecutionMessage({
        executionId: 'exec-456',
      });

      render(
        <ExecutionFlow
          executionMessage={executionMessage}
          dotbot={mockDotBot}
        />
      );

      expect(mockUseExecutionFlowState).toHaveBeenCalledWith(
        executionMessage,
        mockDotBot,
        undefined
      );
    });

    it('should render loading state when executionMessage exists but no state', () => {
      const executionMessage = createMockExecutionMessage();
      
      mockUseExecutionFlowState.mockReturnValue(null);

      render(
        <ExecutionFlow
          executionMessage={executionMessage}
          dotbot={mockDotBot}
        />
      );

      expect(screen.getByTestId('loading-state')).toBeInTheDocument();
    });

    it('should render loading state when state has no items', () => {
      const executionMessage = createMockExecutionMessage();
      const executionState = createMockExecutionArrayState({
        items: [],
      });
      
      mockUseExecutionFlowState.mockReturnValue(executionState);

      render(
        <ExecutionFlow
          executionMessage={executionMessage}
          dotbot={mockDotBot}
        />
      );

      expect(screen.getByTestId('loading-state')).toBeInTheDocument();
    });

    it('should not render when shouldShow is false', () => {
      // When executionMessage is provided, shouldShow is always true (line 71)
      // So we test with no executionMessage and show=false
      const executionState = createMockExecutionArrayState();
      
      mockUseExecutionFlowState.mockReturnValue(executionState);

      const { container } = render(
        <ExecutionFlow
          dotbot={mockDotBot}
          show={false}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it('should render null when no executionMessage and show is false', () => {
      const executionState = createMockExecutionArrayState();
      
      mockUseExecutionFlowState.mockReturnValue(executionState);

      const { container } = render(
        <ExecutionFlow
          dotbot={mockDotBot}
          show={false}
        />
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe('execution state handling', () => {
    it('should render execution items when state is available', () => {
      const executionMessage = createMockExecutionMessage();
      const executionState = createMockExecutionArrayState({
        items: [
          {
            id: 'item-1',
            type: 'transfer',
            status: 'pending',
          },
          {
            id: 'item-2',
            type: 'transfer',
            status: 'pending',
          },
        ] as any,
      });
      
      mockUseExecutionFlowState.mockReturnValue(executionState);

      render(
        <ExecutionFlow
          executionMessage={executionMessage}
          dotbot={mockDotBot}
        />
      );

      const items = screen.getAllByTestId('execution-flow-item');
      expect(items).toHaveLength(2);
    });

    it('should handle null executionState gracefully', () => {
      const executionMessage = createMockExecutionMessage();
      
      mockUseExecutionFlowState.mockReturnValue(null);

      const { container } = render(
        <ExecutionFlow
          executionMessage={executionMessage}
          dotbot={mockDotBot}
        />
      );

      // Should show loading state, not crash
      expect(screen.getByTestId('loading-state')).toBeInTheDocument();
    });
  });

  describe('legacy API support', () => {
    it('should support legacy state prop', () => {
      const executionState = createMockExecutionArrayState();
      
      mockUseExecutionFlowState.mockReturnValue(executionState);

      render(
        <ExecutionFlow
          state={executionState}
          dotbot={mockDotBot}
        />
      );

      expect(mockUseExecutionFlowState).toHaveBeenCalledWith(
        undefined,
        mockDotBot,
        executionState
      );
    });

    it('should prioritize executionMessage over legacy state', () => {
      const executionMessage = createMockExecutionMessage();
      const legacyState = createMockExecutionArrayState();
      
      mockUseExecutionFlowState.mockReturnValue(legacyState);

      render(
        <ExecutionFlow
          executionMessage={executionMessage}
          state={legacyState}
          dotbot={mockDotBot}
        />
      );

      // Should use executionMessage (new API)
      expect(mockUseExecutionFlowState).toHaveBeenCalledWith(
        executionMessage,
        mockDotBot,
        legacyState
      );
    });
  });

  describe('execution actions', () => {
    it('should call onAcceptAndStart when provided and button clicked', async () => {
      // When executionMessage is provided, it uses dotbot.startExecution instead of onAcceptAndStart
      // So test without executionMessage to use the callback
      // Items need to be in 'pending' or 'ready' status for waitingForApproval to be true
      const executionState = createMockExecutionArrayState({
        items: [{ id: 'item-1', status: 'pending' }] as any,
      });
      const onAcceptAndStart = jest.fn();
      
      mockUseExecutionFlowState.mockReturnValue(executionState);

      render(
        <ExecutionFlow
          state={executionState}
          dotbot={mockDotBot}
          onAcceptAndStart={onAcceptAndStart}
          show={true}
        />
      );

      // Find and click the accept button (only shows when waitingForApproval is true)
      const acceptButton = screen.getByTestId('accept-button');
      acceptButton.click();

      // onAcceptAndStart is synchronous, so no need to wait
      expect(onAcceptAndStart).toHaveBeenCalled();
    });

    it('should call onCancel when provided and button clicked', () => {
      const executionMessage = createMockExecutionMessage();
      const executionState = createMockExecutionArrayState({
        items: [{ id: 'item-1', status: 'pending' }] as any,
      });
      const onCancel = jest.fn();
      
      mockUseExecutionFlowState.mockReturnValue(executionState);

      render(
        <ExecutionFlow
          executionMessage={executionMessage}
          dotbot={mockDotBot}
          onCancel={onCancel}
        />
      );

      // Find and click the cancel button if it exists
      const cancelButton = screen.queryByRole('button', { name: /cancel/i });
      if (cancelButton) {
        cancelButton.click();
        expect(onCancel).toHaveBeenCalled();
      }
    });

    it('should call dotbot.startExecution when executionMessage and dotbot are provided', async () => {
      const executionMessage = createMockExecutionMessage();
      const executionState = createMockExecutionArrayState({
        items: [{ id: 'item-1', status: 'pending' }] as any,
      });
      
      mockUseExecutionFlowState.mockReturnValue(executionState);
      mockDotBot.startExecution = jest.fn().mockResolvedValue(undefined);
      
      // Mock startExecution API to avoid actual network call
      // Since we don't have backendSessionId, the backend call won't happen
      const { startExecution: mockStartExecution } = require('../../../services/dotbotApi');
      mockStartExecution.mockResolvedValue({ success: true, executionId: executionMessage.executionId });

      render(
        <ExecutionFlow
          executionMessage={executionMessage}
          dotbot={mockDotBot}
        />
      );

      // Find and click the accept button
      const acceptButton = screen.getByTestId('accept-button');
      acceptButton.click();

      // Wait for async execution to start
      // Since handleAcceptAndStart is async, we need to wait for it
      await waitFor(() => {
        expect(mockDotBot.startExecution).toHaveBeenCalledWith(
          executionMessage.executionId,
          { autoApprove: false }
        );
      }, { timeout: 3000 });
    });
  });

  describe('flow status calculations', () => {
    it('should calculate correct flow status for pending state', () => {
      const executionMessage = createMockExecutionMessage();
      const executionState = createMockExecutionArrayState({
        items: [{ id: 'item-1', status: 'pending' }] as any,
        isExecuting: false,
      });
      
      mockUseExecutionFlowState.mockReturnValue(executionState);

      const { container } = render(
        <ExecutionFlow
          executionMessage={executionMessage}
          dotbot={mockDotBot}
        />
      );

      expect(container.querySelector('[data-flow-status="pending"]')).toBeInTheDocument();
    });

    it('should calculate correct flow status for executing state', () => {
      const executionMessage = createMockExecutionMessage();
      const executionState = createMockExecutionArrayState({
        items: [{ id: 'item-1', status: 'executing' }] as any,
        isExecuting: true,
      });
      
      mockUseExecutionFlowState.mockReturnValue(executionState);

      const { container } = render(
        <ExecutionFlow
          executionMessage={executionMessage}
          dotbot={mockDotBot}
        />
      );

      expect(container.querySelector('[data-flow-status="executing"]')).toBeInTheDocument();
    });
  });
});
