/**
 * useExecutionFlowState Hook Tests
 * 
 * Tests state management with context-based state (updated implementation)
 */

import { renderHook, waitFor } from '@testing-library/react';
import { useExecutionFlowState } from '../../components/execution-flow/hooks/useExecutionFlowState';
import { createMockDotBot, createMockExecutionMessage, createMockExecutionArrayState } from '../../test-utils/mocks';

// Note: useExecutionFlowState no longer uses useExecutionState from App.tsx
// It's a simpler implementation that only handles stateful mode

describe('useExecutionFlowState', () => {
  let mockDotBot: ReturnType<typeof createMockDotBot>;
  let mockUnsubscribe: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockDotBot = createMockDotBot();
    mockUnsubscribe = jest.fn();
  });

  describe('state sources', () => {
    it('should return state from executionMessage.executionArray when available', () => {
      const executionMessage = createMockExecutionMessage();
      const executionState = createMockExecutionArrayState({ id: executionMessage.executionId });
      executionMessage.executionArray = executionState;

      const { result } = renderHook(() =>
        useExecutionFlowState(executionMessage, mockDotBot, undefined)
      );

      expect(result.current).toBe(executionState);
    });

    it('should return correct initial state from executionMessage', () => {
      const executionMessage = createMockExecutionMessage();
      const executionState = createMockExecutionArrayState();
      executionMessage.executionArray = executionState;

      const { result } = renderHook(() =>
        useExecutionFlowState(executionMessage, mockDotBot, undefined)
      );

      // Should return state from executionMessage
      expect(result.current).toBe(executionState);
    });

    it('should return legacy state when provided', () => {
      const legacyState = createMockExecutionArrayState();

      const { result } = renderHook(() =>
        useExecutionFlowState(undefined, mockDotBot, legacyState)
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
        useExecutionFlowState(executionMessage, mockDotBot, undefined)
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
          useExecutionFlowState(executionMessage, mockDotBot, undefined),
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
          useExecutionFlowState(executionMessage, mockDotBot, undefined),
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
    it('should update state when ExecutionArray state changes', async () => {
      const executionMessage = createMockExecutionMessage();
      const initialState = createMockExecutionArrayState({ id: 'exec-123' });
      const updatedState = createMockExecutionArrayState({
        id: 'exec-123',
        items: [{ id: 'item-1', type: 'transfer', status: 'executing' }] as any,
      });

      const mockExecutionArray = {
        getState: jest.fn().mockReturnValue(initialState),
      };
      
      (mockDotBot.currentChat as any).getExecutionArray = jest.fn().mockReturnValue(mockExecutionArray);
      
      // Mock onExecutionUpdate to simulate state update
      (mockDotBot.currentChat as any).onExecutionUpdate = jest.fn().mockImplementation((executionId, callback) => {
        // Simulate state update after a delay
        setTimeout(() => {
          mockExecutionArray.getState.mockReturnValue(updatedState);
          callback(updatedState);
        }, 10);
        return mockUnsubscribe;
      });

      const { result } = renderHook(() =>
        useExecutionFlowState(executionMessage, mockDotBot, undefined)
      );

      // Should return initial state
      expect(result.current).toBe(initialState);

      // Wait for state update
      await waitFor(() => {
        expect(result.current).toBe(updatedState);
      }, { timeout: 1000 });
    });

    it('should prioritize liveExecutionState over executionMessage.executionArray', async () => {
      const executionMessage = createMockExecutionMessage();
      const messageState = createMockExecutionArrayState({ id: 'from-message' });
      const liveState = createMockExecutionArrayState({ id: 'live-state' });
      
      executionMessage.executionArray = messageState;
      
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
        useExecutionFlowState(executionMessage, mockDotBot, undefined)
      );

      // Should prioritize live state (stateful mode) over message state
      await waitFor(() => {
        expect(result.current).toBe(liveState);
      });
      
      // Should not use message state when live state is available
      expect(result.current).not.toBe(messageState);
    });
  });

  describe('fallback behavior', () => {
    it('should fall back to executionMessage.executionArray when no ExecutionArray available', () => {
      const executionMessage = createMockExecutionMessage();
      const messageState = createMockExecutionArrayState();
      executionMessage.executionArray = messageState;
      
      (mockDotBot.currentChat as any).getExecutionArray = jest.fn().mockReturnValue(null);

      const { result } = renderHook(() =>
        useExecutionFlowState(executionMessage, mockDotBot, undefined)
      );

      expect(result.current).toBe(messageState);
    });

    it('should fall back to legacyState when no other state available', () => {
      const executionMessage = createMockExecutionMessage();
      const legacyState = createMockExecutionArrayState();
      
      (mockDotBot.currentChat as any).getExecutionArray = jest.fn().mockReturnValue(null);

      const { result } = renderHook(() =>
        useExecutionFlowState(executionMessage, mockDotBot, legacyState)
      );

      expect(result.current).toBe(legacyState);
    });
  });

  describe('edge cases', () => {
    it('should return null when no state sources available', () => {
      const { result } = renderHook(() =>
        useExecutionFlowState(undefined, mockDotBot, null)
      );

      expect(result.current).toBeNull();
    });

    it('should handle missing executionMessage gracefully', () => {
      (mockDotBot.currentChat as any).getExecutionArray = jest.fn().mockReturnValue(null);
      
      const { result } = renderHook(() =>
        useExecutionFlowState(undefined, mockDotBot, undefined)
      );

      expect(result.current).toBeNull();
    });

    it('should handle missing dotbot gracefully', () => {
      const executionMessage = createMockExecutionMessage();
      const messageState = createMockExecutionArrayState();
      executionMessage.executionArray = messageState;

      const { result } = renderHook(() =>
        useExecutionFlowState(executionMessage, undefined, undefined)
      );

      // Should fall back to executionMessage.executionArray
      expect(result.current).toBe(messageState);
    });
  });
});
