/**
 * Test utilities - Mocks
 */

import type { DotBot, ChatInstance, ConversationItem, ExecutionMessage, ExecutionArrayState } from '@dotbot/core';
import type { WalletAccount } from '@dotbot/core/types/wallet';

/**
 * Create a mock ChatInstance
 */
export function createMockChatInstance(overrides?: Partial<ChatInstance>): jest.Mocked<ChatInstance> {
  const mockMessages: ConversationItem[] = [];
  
  return {
    id: 'test-chat-id',
    environment: 'mainnet',
    network: 'polkadot',
    walletAddress: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isEmpty: true,
    getDisplayMessages: jest.fn().mockReturnValue(mockMessages),
    getHistory: jest.fn().mockReturnValue([]),
    addUserMessage: jest.fn().mockResolvedValue(undefined),
    addBotMessage: jest.fn().mockResolvedValue(undefined),
    addExecutionMessage: jest.fn().mockResolvedValue(undefined),
    updateExecutionMessage: jest.fn().mockResolvedValue(undefined),
    getExecutionArray: jest.fn().mockReturnValue(null),
    onExecutionUpdate: jest.fn().mockReturnValue(() => {}),
    ...overrides,
  } as any;
}

/**
 * Create a mock DotBot instance
 */
export function createMockDotBot(overrides?: Partial<DotBot>): jest.Mocked<DotBot> {
  const mockChat = createMockChatInstance();
  
  return {
    getEnvironment: jest.fn().mockReturnValue('mainnet'),
    getNetwork: jest.fn().mockReturnValue('polkadot'),
    getWallet: jest.fn().mockReturnValue({
      address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
      name: 'Test Account',
      source: 'polkadot-js',
    } as WalletAccount),
    currentChat: mockChat,
    startExecution: jest.fn().mockResolvedValue(undefined),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    ...overrides,
  } as any;
}

/**
 * Create a mock ExecutionMessage
 */
export function createMockExecutionMessage(overrides?: Partial<ExecutionMessage>): ExecutionMessage {
  return {
    id: 'exec-msg-1',
    type: 'execution',
    timestamp: Date.now(),
    executionId: 'exec-123',
    executionPlan: {
      steps: [],
    },
    executionArray: undefined,
    ...overrides,
  } as ExecutionMessage;
}

/**
 * Create a mock ExecutionArrayState
 */
export function createMockExecutionArrayState(overrides?: Partial<ExecutionArrayState>): ExecutionArrayState {
  return {
    id: 'exec-123',
    items: [],
    isExecuting: false,
    isPaused: false,
    currentIndex: 0,
    totalItems: 0,
    completedItems: 0,
    failedItems: 0,
    cancelledItems: 0,
    ...overrides,
  };
}

/**
 * Create a mock WalletAccount
 */
export function createMockWalletAccount(overrides?: Partial<WalletAccount>): WalletAccount {
  return {
    address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    name: 'Test Account',
    source: 'polkadot-js',
    ...overrides,
  };
}
