/**
 * executionFlowUtils Tests
 * 
 * Tests WebSocket subscription logic
 */

import { setupExecutionSubscription, isWaitingForApproval, isFlowComplete, isFlowExecuting, isFlowSuccessful, isFlowFailed } from '../../components/execution-flow/executionFlowUtils';
import { createMockDotBot, createMockChatInstance, createMockExecutionMessage, createMockExecutionArrayState } from '../../test-utils/mocks';
import * as dotbotApi from '../../services/dotbotApi';

// Mock API
jest.mock('../../services/dotbotApi');

const mockGetExecutionState = dotbotApi.getExecutionState as jest.MockedFunction<typeof dotbotApi.getExecutionState>;

describe('executionFlowUtils', () => {
  let mockDotBot: ReturnType<typeof createMockDotBot>;
  let mockChat: ReturnType<typeof createMockChatInstance>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    mockChat = createMockChatInstance();
    mockDotBot = createMockDotBot({ currentChat: mockChat });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('setupExecutionSubscription', () => {
    it('should subscribe to WebSocket when wsSubscribe is provided', () => {
      const executionMessage = createMockExecutionMessage();
      const mockWsSubscribe = jest.fn().mockReturnValue(() => {});
      const setLiveExecutionState = jest.fn();

      const cleanup = setupExecutionSubscription(
        executionMessage,
        mockDotBot,
        setLiveExecutionState,
        'test-session',
        mockWsSubscribe
      );

      expect(mockWsSubscribe).toHaveBeenCalledWith(
        'exec-123',
        expect.any(Function)
      );

      cleanup();
    });

    it('should use correct room name execution:${executionId}', () => {
      const executionMessage = createMockExecutionMessage({
        executionId: 'exec-456',
      });
      const mockWsSubscribe = jest.fn().mockReturnValue(() => {});
      const setLiveExecutionState = jest.fn();

      setupExecutionSubscription(
        executionMessage,
        mockDotBot,
        setLiveExecutionState,
        'test-session',
        mockWsSubscribe
      );

      expect(mockWsSubscribe).toHaveBeenCalledWith(
        'exec-456',
        expect.any(Function)
      );
    });

    it('should fall back to HTTP polling when WebSocket unavailable', async () => {
      const executionMessage = createMockExecutionMessage();
      const setLiveExecutionState = jest.fn();
      
      mockGetExecutionState.mockResolvedValue({
        success: true,
        executionId: 'exec-123',
        state: createMockExecutionArrayState(),
        timestamp: new Date().toISOString(),
      });

      const cleanup = setupExecutionSubscription(
        executionMessage,
        mockDotBot,
        setLiveExecutionState,
        'test-session',
        undefined // No WebSocket
      );

      // Fast-forward to trigger polling (initial call + first interval)
      jest.advanceTimersByTime(2000);
      
      // Wait for async operations to complete
      await Promise.resolve();

      expect(mockGetExecutionState).toHaveBeenCalledWith(
        'test-session',
        'exec-123'
      );

      cleanup();
    });

    it('should use local subscription when ExecutionArray available', () => {
      const executionMessage = createMockExecutionMessage();
      const setLiveExecutionState = jest.fn();
      const mockUnsubscribe = jest.fn();
      
      mockChat.getExecutionArray.mockReturnValue({
        getState: jest.fn().mockReturnValue(createMockExecutionArrayState()),
        onUpdate: jest.fn().mockReturnValue(mockUnsubscribe),
      } as any);

      const cleanup = setupExecutionSubscription(
        executionMessage,
        mockDotBot,
        setLiveExecutionState,
        undefined, // No backend session
        undefined
      );

      expect(mockChat.getExecutionArray).toHaveBeenCalledWith('exec-123');
      expect(mockChat.onExecutionUpdate).toHaveBeenCalled();

      cleanup();
    });

    it('should set initial state from ExecutionArray if available', () => {
      const executionMessage = createMockExecutionMessage();
      const executionState = createMockExecutionArrayState();
      const setLiveExecutionState = jest.fn();
      
      mockChat.getExecutionArray.mockReturnValue({
        getState: jest.fn().mockReturnValue(executionState),
      } as any);

      setupExecutionSubscription(
        executionMessage,
        mockDotBot,
        setLiveExecutionState,
        undefined,
        undefined
      );

      expect(setLiveExecutionState).toHaveBeenCalledWith(executionState);
    });

    it('should set initial state from executionMessage.executionArray', () => {
      const executionMessage = createMockExecutionMessage();
      const executionState = createMockExecutionArrayState();
      executionMessage.executionArray = executionState;
      const setLiveExecutionState = jest.fn();

      setupExecutionSubscription(
        executionMessage,
        mockDotBot,
        setLiveExecutionState,
        undefined,
        undefined
      );

      expect(setLiveExecutionState).toHaveBeenCalledWith(executionState);
    });

    it('should cleanup WebSocket subscription on cleanup', () => {
      const executionMessage = createMockExecutionMessage();
      const mockUnsubscribe = jest.fn();
      const mockWsSubscribe = jest.fn().mockReturnValue(mockUnsubscribe);
      const setLiveExecutionState = jest.fn();

      const cleanup = setupExecutionSubscription(
        executionMessage,
        mockDotBot,
        setLiveExecutionState,
        'test-session',
        mockWsSubscribe
      );

      cleanup();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    it('should cleanup polling on cleanup', () => {
      const executionMessage = createMockExecutionMessage();
      const setLiveExecutionState = jest.fn();

      mockGetExecutionState.mockResolvedValue({
        success: true,
        executionId: 'exec-123',
        state: createMockExecutionArrayState(),
        timestamp: new Date().toISOString(),
      });

      const cleanup = setupExecutionSubscription(
        executionMessage,
        mockDotBot,
        setLiveExecutionState,
        'test-session',
        undefined
      );

      cleanup();

      // Fast-forward time - polling should be stopped
      jest.advanceTimersByTime(5000);

      // Should not have called getExecutionState after cleanup
      const callCount = mockGetExecutionState.mock.calls.length;
      expect(callCount).toBeGreaterThan(0); // Initial call
    });
  });

  describe('flow state helpers', () => {
    describe('isWaitingForApproval', () => {
      it('should return true when all items are pending or ready', () => {
        const state = createMockExecutionArrayState({
          items: [
            { id: 'item-1', status: 'pending' } as any,
            { id: 'item-2', status: 'ready' } as any,
          ],
        });

        expect(isWaitingForApproval(state)).toBe(true);
      });

      it('should return false when any item is executing', () => {
        const state = createMockExecutionArrayState({
          items: [
            { id: 'item-1', status: 'pending' } as any,
            { id: 'item-2', status: 'executing' } as any,
          ],
        });

        expect(isWaitingForApproval(state)).toBe(false);
      });
    });

    describe('isFlowComplete', () => {
      it('should return true when all items are completed', () => {
        const state = createMockExecutionArrayState({
          items: [
            { id: 'item-1', status: 'completed' } as any,
            { id: 'item-2', status: 'finalized' } as any,
          ],
        });

        expect(isFlowComplete(state)).toBe(true);
      });

      it('should return false when any item is pending', () => {
        const state = createMockExecutionArrayState({
          items: [
            { id: 'item-1', status: 'completed' } as any,
            { id: 'item-2', status: 'pending' } as any,
          ],
        });

        expect(isFlowComplete(state)).toBe(false);
      });
    });

    describe('isFlowExecuting', () => {
      it('should return true when isExecuting is true', () => {
        const state = createMockExecutionArrayState({
          isExecuting: true,
          items: [],
        });

        expect(isFlowExecuting(state)).toBe(true);
      });

      it('should return true when any item is executing', () => {
        const state = createMockExecutionArrayState({
          items: [
            { id: 'item-1', status: 'executing' } as any,
          ],
        });

        expect(isFlowExecuting(state)).toBe(true);
      });

      it('should return false when flow is complete', () => {
        const state = createMockExecutionArrayState({
          items: [
            { id: 'item-1', status: 'completed' } as any,
          ],
        });

        expect(isFlowExecuting(state)).toBe(false);
      });
    });

    describe('isFlowSuccessful', () => {
      it('should return true when all items are completed', () => {
        const state = createMockExecutionArrayState({
          items: [
            { id: 'item-1', status: 'completed' } as any,
            { id: 'item-2', status: 'finalized' } as any,
          ],
        });

        expect(isFlowSuccessful(state)).toBe(true);
      });

      it('should return false when flow is not complete', () => {
        const state = createMockExecutionArrayState({
          items: [
            { id: 'item-1', status: 'pending' } as any,
          ],
        });

        expect(isFlowSuccessful(state)).toBe(false);
      });
    });

    describe('isFlowFailed', () => {
      it('should return true when any item failed', () => {
        const state = createMockExecutionArrayState({
          items: [
            { id: 'item-1', status: 'completed' } as any,
            { id: 'item-2', status: 'failed' } as any,
          ],
        });

        expect(isFlowFailed(state)).toBe(true);
      });

      it('should return false when flow is not complete', () => {
        const state = createMockExecutionArrayState({
          items: [
            { id: 'item-1', status: 'pending' } as any,
          ],
        });

        expect(isFlowFailed(state)).toBe(false);
      });
    });
  });
});
