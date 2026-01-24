/**
 * WebSocketContext Tests
 * 
 * Tests WebSocket message handling
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { WebSocketProvider, useWebSocket } from '../../contexts/WebSocketContext';
import { createMockExecutionArrayState } from '../../test-utils/mocks';

// Create a shared mock socket that can be reused across tests
const createMockSocket = () => ({
  on: jest.fn(),
  emit: jest.fn(),
  disconnect: jest.fn(),
  connect: jest.fn(),
  connected: false,
  id: 'mock-socket-id',
  io: {
    engine: {
      transport: {
        name: 'websocket',
      },
    },
  },
});

// Mock socket.io-client
const _mockIo = jest.fn();
jest.mock('socket.io-client', () => {
  const mockFn = jest.fn();
  return {
    __esModule: true,
    default: mockFn,
    io: mockFn,
  };
});

// Get the mocked io function
const getMockIo = () => {
  const socketIoClient = require('socket.io-client');
  return socketIoClient.io || socketIoClient.default;
};

describe('WebSocketContext', () => {
  let mockIo: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIo = getMockIo();
    mockIo.mockImplementation(() => createMockSocket());
  });

  describe('connection management', () => {
    it('should connect when sessionId is provided and autoConnect is true', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <WebSocketProvider sessionId="test-session" autoConnect={true}>
          {children}
        </WebSocketProvider>
      );

      renderHook(() => useWebSocket(), { wrapper });

      await waitFor(() => {
        expect(mockIo).toHaveBeenCalled();
      });
    });

    it('should not connect when sessionId is null', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <WebSocketProvider sessionId={null} autoConnect={true}>
          {children}
        </WebSocketProvider>
      );

      renderHook(() => useWebSocket(), { wrapper });

      expect(mockIo).not.toHaveBeenCalled();
    });
  });

  describe('execution subscriptions', () => {
    it('should subscribe to execution updates', () => {
      const mockSocket = createMockSocket();
      mockSocket.connected = true;
      mockIo.mockReturnValue(mockSocket);

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <WebSocketProvider sessionId="test-session" autoConnect={false}>
          {children}
        </WebSocketProvider>
      );

      const { result } = renderHook(() => useWebSocket(), { wrapper });

      result.current.connect();

      // Simulate connection
      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')?.[1];
      if (connectHandler) {
        connectHandler();
      }

      const callback = jest.fn();
      const unsubscribe = result.current.subscribeToExecution('exec-123', callback);

      expect(mockSocket.emit).toHaveBeenCalledWith('subscribe-execution', {
        sessionId: 'test-session',
        executionId: 'exec-123',
      });

      unsubscribe();
    });

    it('should receive and broadcast execution updates', () => {
      const mockSocket = createMockSocket();
      mockSocket.connected = true;
      mockIo.mockReturnValue(mockSocket);

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <WebSocketProvider sessionId="test-session" autoConnect={false}>
          {children}
        </WebSocketProvider>
      );

      const { result } = renderHook(() => useWebSocket(), { wrapper });

      result.current.connect();

      // Simulate connection
      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')?.[1];
      if (connectHandler) {
        connectHandler();
      }

      const callback = jest.fn();
      result.current.subscribeToExecution('exec-123', callback);

      // Simulate execution-update event
      const updateHandler = mockSocket.on.mock.calls.find(call => call[0] === 'execution-update')?.[1];
      if (updateHandler) {
        const executionState = createMockExecutionArrayState();
        updateHandler({ executionId: 'exec-123', state: executionState });
      }

      expect(callback).toHaveBeenCalled();
    });

    it('should call subscription callback with correct data', () => {
      const mockSocket = createMockSocket();
      mockSocket.connected = true;
      mockIo.mockReturnValue(mockSocket);

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <WebSocketProvider sessionId="test-session" autoConnect={false}>
          {children}
        </WebSocketProvider>
      );

      const { result } = renderHook(() => useWebSocket(), { wrapper });

      result.current.connect();

      // Simulate connection
      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')?.[1];
      if (connectHandler) {
        connectHandler();
      }

      const callback = jest.fn();
      result.current.subscribeToExecution('exec-123', callback);

      // Simulate execution-update event
      const updateHandler = mockSocket.on.mock.calls.find(call => call[0] === 'execution-update')?.[1];
      if (updateHandler) {
        const executionState = createMockExecutionArrayState({
          id: 'exec-123',
          items: [{ id: 'item-1', type: 'transfer', status: 'executing' }] as any,
        });
        
        updateHandler({ executionId: 'exec-123', state: executionState });
      }

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'exec-123',
        })
      );
    });

    it('should unsubscribe from execution updates', () => {
      const mockSocket = createMockSocket();
      mockSocket.connected = true;
      mockIo.mockReturnValue(mockSocket);

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <WebSocketProvider sessionId="test-session" autoConnect={false}>
          {children}
        </WebSocketProvider>
      );

      const { result } = renderHook(() => useWebSocket(), { wrapper });

      result.current.connect();

      // Simulate connection
      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')?.[1];
      if (connectHandler) {
        connectHandler();
      }

      const callback = jest.fn();
      const unsubscribe = result.current.subscribeToExecution('exec-123', callback);

      unsubscribe();

      expect(mockSocket.emit).toHaveBeenCalledWith('unsubscribe-execution', {
        sessionId: 'test-session',
        executionId: 'exec-123',
      });
    });
  });

  describe('connection state', () => {
    it('should report connection status correctly', async () => {
      const mockSocket = createMockSocket();
      mockSocket.connected = false;
      mockIo.mockReturnValue(mockSocket);

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <WebSocketProvider sessionId="test-session" autoConnect={false}>
          {children}
        </WebSocketProvider>
      );

      const { result } = renderHook(() => useWebSocket(), { wrapper });

      expect(result.current.isConnected).toBe(false);

      result.current.connect();

      // Simulate connection
      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')?.[1];
      if (connectHandler) {
        connectHandler();
      }

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });
    });
  });
});
