/**
 * useExecutionFlowState Hook Tests
 * 
 * Tests state management with context-based state (updated implementation)
 */

import { renderHook, waitFor } from '@testing-library/react';
import { useExecutionFlowState } from '../../components/execution-flow/hooks/useExecutionFlowState';
import { createMockDotBot, createMockExecutionMessage, createMockExecutionArrayState } from '../../test-utils/mocks';

// Mock useExecutionState from App.tsx (context provider)
const mockUseExecutionState = jest.fn();
jest.mock('../../App', () => ({
  useExecutionState: (executionId: string | undefined) => mockUseExecutionState(executionId),
}));

describe('useExecutionFlowState', () => {
  let mockDotBot: ReturnType<typeof createMockDotBot>;
  let mockUnsubscribe: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockDotBot = createMockDotBot();
    mockUnsubscribe = jest.fn();
    
    // Default: no context state (returns undefined)
    mockUseExecutionState.mockReturnValue(undefined);
  });

  describe('state sources', () => {
    it('should return state from context when available', () => {
      const executionMessage = createMockExecutionMessage();
      const contextState = createMockExecutionArrayState({ id: executionMessage.executionId });
      
      mockUseExecutionState.mockReturnValue(contextState);

      const { result } = renderHook(() =>
        useExecutionFlowState(executionMessage, mockDotBot, undefined, 'test-session')
      );

      expect(result.current).toBe(contextState);
    });

    it('should return correct initial state from executionMessage', () => {
      const executionMessage = createMockExecutionMessage();
      const executionState = createMockExecutionArrayState();
      executionMessage.executionArray = executionState;

      const { result } = renderHook(() =>
        useExecutionFlowState(executionMessage, mockDotBot, undefined, undefined)
      );

      // Should return state from executionMessage
      expect(result.current).toBe(executionState);
    });

    it('should return legacy state when provided', () => {
      const legacyState = createMockExecutionArrayState();

      const { result } = renderHook(() =>
        useExecutionFlowState(undefined, mockDotBot, legacyState, undefined)
      );

      expect(result.current).toBe(legacyState);
    });

    it('should cleanup local subscription on unmount (stateful mode)', () => {
      const executionMessage = createMockExecutionMessage();
      const mockExecutionArray = {
        getState: jest.fn().mockReturnValue(createMockExecutionArrayState()),
      };
      
      // Mock stateful mode (has ExecutionArray)
      (mockDotBot.currentChat as any).getExecutionArray = jest.fn().mockReturnValue(mockExecutionArray);
      // Mock onExecutionUpdate to return unsubscribe function
      (mockDotBot.currentChat as any).onExecutionUpdate = jest.fn().mockReturnValue(mockUnsubscribe);

      const { unmount } = renderHook(() =>
        useExecutionFlowState(executionMessage, mockDotBot, undefined, undefined)
      );

      unmount();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    it('should re-subscribe when executionId changes (stateful mode)', () => {
      const executionMessage1 = createMockExecutionMessage({
        executionId: 'exec-1',
      });
      const state1 = createMockExecutionArrayState({ id: 'exec-1' });
      const mockExecutionArray1 = {
        getState: jest.fn().mockReturnValue(state1),
      };
      
      (mockDotBot.currentChat as any).getExecutionArray = jest.fn()
        .mockReturnValueOnce(mockExecutionArray1)
        .mockReturnValueOnce(null);
      
      // Mock onExecutionUpdate to return unsubscribe for first execution
      (mockDotBot.currentChat as any).onExecutionUpdate = jest.fn()
        .mockReturnValueOnce(mockUnsubscribe) // First subscription
        .mockReturnValueOnce(() => {}); // Second subscription (won't be called since getExecutionArray returns null)

      const { result, rerender } = renderHook(
        ({ executionMessage }) =>
          useExecutionFlowState(executionMessage, mockDotBot, undefined, undefined),
        {
          initialProps: { executionMessage: executionMessage1 },
        }
      );

      // Initial state should be from ExecutionArray
      expect(result.current).toBe(state1);

      const executionMessage2 = createMockExecutionMessage({
        executionId: 'exec-2',
      });
      const state2 = createMockExecutionArrayState({ id: 'exec-2' });
      executionMessage2.executionArray = state2;
      const mockExecutionArray2 = {
        getState: jest.fn().mockReturnValue(state2),
      };
      
      (mockDotBot.currentChat as any).getExecutionArray = jest.fn()
        .mockReturnValueOnce(null) // First call (cleanup - no ExecutionArray for exec-1 anymore)
        .mockReturnValue(mockExecutionArray2); // Second call (new ExecutionArray for exec-2)
      
      // Reset mocks but keep onExecutionUpdate returning unsubscribe
      mockUnsubscribe.mockClear();
      (mockDotBot.currentChat as any).onExecutionUpdate = jest.fn().mockReturnValue(mockUnsubscribe);

      // rerender automatically handles act() wrapping
      rerender({ executionMessage: executionMessage2 });

      // Cleanup from first subscription should have been called
      expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
      
      // State should use executionMessage2 state (from ExecutionArray)
      expect(result.current).toBe(state2);
    });

    it('should reset live state when executionId changes', async () => {
      const executionMessage1 = createMockExecutionMessage({
        executionId: 'exec-1',
      });
      const liveState1 = createMockExecutionArrayState({ id: 'exec-1', items: [{ id: 'item-1', status: 'executing' }] as any });
      const mockExecutionArray1 = {
        getState: jest.fn().mockReturnValue(liveState1),
      };
      
      (mockDotBot.currentChat as any).getExecutionArray = jest.fn()
        .mockReturnValueOnce(mockExecutionArray1)
        .mockReturnValueOnce(null);
      
      // Mock onExecutionUpdate to simulate state update
      (mockDotBot.currentChat as any).onExecutionUpdate = jest.fn().mockImplementation((executionId, callback) => {
        // Simulate state update
        setTimeout(() => callback(liveState1), 0);
        return mockUnsubscribe;
      });

      const { result, rerender } = renderHook(
        ({ executionMessage }) =>
          useExecutionFlowState(executionMessage, mockDotBot, undefined, undefined),
        {
          initialProps: { executionMessage: executionMessage1 },
        }
      );

      // Wait for state update
      await waitFor(() => {
        expect(result.current).toBe(liveState1);
      });

      // Change to execution-2
      const executionMessage2 = createMockExecutionMessage({
        executionId: 'exec-2',
      });
      const state2 = createMockExecutionArrayState({ id: 'exec-2' });
      executionMessage2.executionArray = state2;

      // Reset mocks - no ExecutionArray for exec-2 (stateless mode)
      mockUnsubscribe.mockClear();
      (mockDotBot.currentChat as any).getExecutionArray = jest.fn().mockReturnValue(null);
      (mockDotBot.currentChat as any).onExecutionUpdate = jest.fn().mockReturnValue(() => {});

      // rerender automatically handles act() wrapping
      rerender({ executionMessage: executionMessage2 });

      // Live state should be reset, so it should fall back to executionMessage2 state
      // (not the old liveState1)
      expect(result.current).toBe(state2);
      expect(result.current).not.toBe(liveState1);
    });
  });

  describe('state updates', () => {
    it('should update state when context state changes', async () => {
      const executionMessage = createMockExecutionMessage();
      const initialState = createMockExecutionArrayState({ id: 'exec-123' });
      const updatedState = createMockExecutionArrayState({
        id: 'exec-123',
        items: [{ id: 'item-1', type: 'transfer', status: 'executing' }] as any,
      });

      // Start with initial state
      mockUseExecutionState.mockReturnValue(initialState);

      const { result, rerender } = renderHook(() =>
        useExecutionFlowState(executionMessage, mockDotBot, undefined, undefined)
      );

      // Should return initial state
      expect(result.current).toBe(initialState);

      // Update context state
      mockUseExecutionState.mockReturnValue(updatedState);
      rerender();

      await waitFor(() => {
        expect(result.current).toBe(updatedState);
      });
    });

    it('should prioritize liveExecutionState (stateful) over context state', async () => {
      const executionMessage = createMockExecutionMessage();
      const contextState = createMockExecutionArrayState({ id: 'from-context' });
      const liveState = createMockExecutionArrayState({ id: 'live-state' });
      
      mockUseExecutionState.mockReturnValue(contextState);
      
      const mockExecutionArray = {
        getState: jest.fn().mockReturnValue(liveState),
      };
      
      (mockDotBot.currentChat as any).getExecutionArray = jest.fn().mockReturnValue(mockExecutionArray);
      
      // Mock onExecutionUpdate to simulate state update
      (mockDotBot.currentChat as any).onExecutionUpdate = jest.fn().mockImplementation((executionId, callback) => {
        // Simulate state update
        setTimeout(() => callback(liveState), 0);
        return mockUnsubscribe;
      });

      const { result } = renderHook(() =>
        useExecutionFlowState(executionMessage, mockDotBot, undefined, undefined)
      );

      // Should prioritize live state (stateful mode) over context state
      await waitFor(() => {
        expect(result.current).toBe(liveState);
      });
      
      // Should not use context state when live state is available
      expect(result.current).not.toBe(contextState);
    });
  });

  describe('context integration', () => {
    it('should use context state when available (stateless mode)', () => {
      const executionMessage = createMockExecutionMessage();
      const contextState = createMockExecutionArrayState({ id: executionMessage.executionId });
      
      mockUseExecutionState.mockReturnValue(contextState);

      const { result } = renderHook(() =>
        useExecutionFlowState(executionMessage, mockDotBot, undefined, 'test-session')
      );

      expect(result.current).toBe(contextState);
      expect(mockUseExecutionState).toHaveBeenCalledWith(executionMessage.executionId);
    });

    it('should fall back to executionMessage state when context state not available', () => {
      const executionMessage = createMockExecutionMessage();
      const messageState = createMockExecutionArrayState();
      executionMessage.executionArray = messageState;
      
      mockUseExecutionState.mockReturnValue(undefined);

      const { result } = renderHook(() =>
        useExecutionFlowState(executionMessage, mockDotBot, undefined, 'test-session')
      );

      expect(result.current).toBe(messageState);
    });

    it('should handle context returning undefined gracefully', () => {
      const executionMessage = createMockExecutionMessage();
      const messageState = createMockExecutionArrayState();
      executionMessage.executionArray = messageState;
      
      mockUseExecutionState.mockReturnValue(undefined);

      const { result } = renderHook(() =>
        useExecutionFlowState(executionMessage, mockDotBot, undefined, 'test-session')
      );

      // Should fall back to executionMessage state
      expect(result.current).toBe(messageState);
    });
  });

  describe('edge cases', () => {
    it('should return null when no state sources available', () => {
      const { result } = renderHook(() =>
        useExecutionFlowState(undefined, mockDotBot, null, undefined)
      );

      expect(result.current).toBeNull();
    });

    it('should handle missing executionMessage gracefully', () => {
      mockUseExecutionState.mockReturnValue(undefined);
      
      const { result } = renderHook(() =>
        useExecutionFlowState(undefined, mockDotBot, undefined, undefined)
      );

      expect(result.current).toBeNull();
    });

    it('should handle missing dotbot gracefully', () => {
      const executionMessage = createMockExecutionMessage();
      mockUseExecutionState.mockReturnValue(undefined);

      const { result } = renderHook(() =>
        useExecutionFlowState(executionMessage, undefined, undefined, undefined)
      );

      // Should return context state if available, otherwise null
      expect(result.current).toBeNull();
    });
  });
});
