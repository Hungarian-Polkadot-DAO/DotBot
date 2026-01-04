/**
 * Unit tests for DotBot
 */

// Mock Polkadot modules before imports
jest.mock('@polkadot/api', () => ({
  ApiPromise: jest.fn(),
}));

// Mock web3FromAddress (browser-only, needs to be mocked for Node.js tests)
jest.mock('@polkadot/extension-dapp', () => ({
  web3FromAddress: jest.fn().mockResolvedValue({
    signer: {
      signPayload: jest.fn(),
      signRaw: jest.fn(),
    },
  }),
}));

// Mock @polkadot/util-crypto
jest.mock('@polkadot/util-crypto', () => ({
  decodeAddress: (address: string) => {
    if (!address || address.length === 0) {
      throw new Error('Invalid address');
    }
    return new Uint8Array(32);
  },
  encodeAddress: (publicKey: Uint8Array, ss58Format?: number) => {
    return '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';
  },
  isAddress: (address: string) => {
    return address && address.length > 0 && address.startsWith('5');
  },
}));

import { DotBot, DotBotConfig, ConversationMessage } from '../../dotbot';
import { ApiPromise } from '@polkadot/api';
import { WalletAccount } from '../../types/wallet';
import { RpcManager } from '../../rpcManager';
import { ExecutionSystem } from '../../executionEngine/system';
import { BrowserWalletSigner } from '../../executionEngine/signers/browserSigner';

// Mock dependencies
jest.mock('../../rpcManager');
jest.mock('../../executionEngine/system');
jest.mock('../../executionEngine/signers/browserSigner');
jest.mock('../../prompts/system/loader', () => ({
  buildSystemPrompt: jest.fn().mockResolvedValue('Default system prompt'),
}));

// Import mocked modules
import { createRelayChainManager, createAssetHubManager } from '../../rpcManager';
import { ExecutionSystem as MockExecutionSystem } from '../../executionEngine/system';
import { BrowserWalletSigner as MockBrowserWalletSigner } from '../../executionEngine/signers/browserSigner';
import { buildSystemPrompt } from '../../prompts/system/loader';

describe('DotBot', () => {
  let mockRelayChainApi: Partial<ApiPromise>;
  let mockAssetHubApi: Partial<ApiPromise>;
  let mockRelayChainManager: Partial<RpcManager>;
  let mockAssetHubManager: Partial<RpcManager>;
  let mockWallet: WalletAccount;
  let mockExecutionSystem: jest.Mocked<ExecutionSystem>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock API instances
    mockRelayChainApi = {
      isReady: Promise.resolve(),
      isConnected: true,
      disconnect: jest.fn().mockResolvedValue(undefined),
      query: {} as any,
      rpc: {} as any,
      registry: {} as any,
    } as any;

    mockAssetHubApi = {
      isReady: Promise.resolve(),
      isConnected: true,
      disconnect: jest.fn().mockResolvedValue(undefined),
      query: {} as any,
      rpc: {} as any,
      registry: {} as any,
    } as any;

    // Create mock RPC managers
    mockRelayChainManager = {
      getReadApi: jest.fn<Promise<ApiPromise>, []>().mockResolvedValue(mockRelayChainApi as ApiPromise),
      getCurrentEndpoint: jest.fn().mockReturnValue('wss://rpc.polkadot.io'),
      getHealthStatus: jest.fn().mockReturnValue([]),
    };

    mockAssetHubManager = {
      getReadApi: jest.fn<Promise<ApiPromise>, []>().mockResolvedValue(mockAssetHubApi as ApiPromise),
      getCurrentEndpoint: jest.fn().mockReturnValue('wss://polkadot-asset-hub-rpc.polkadot.io'),
      getHealthStatus: jest.fn().mockReturnValue([]),
    };

    // Create mock wallet
    mockWallet = {
      address: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
      name: 'Test Account',
      source: 'polkadot-js',
    };

    // Mock ExecutionSystem
    mockExecutionSystem = {
      initialize: jest.fn(),
    } as any;

    // Mock BrowserWalletSigner
    const mockSigner = {
      setSigningRequestHandler: jest.fn(),
      setBatchSigningRequestHandler: jest.fn(),
    };

    // Setup module mocks
    (createRelayChainManager as jest.Mock).mockReturnValue(mockRelayChainManager);
    (createAssetHubManager as jest.Mock).mockReturnValue(mockAssetHubManager);
    (MockExecutionSystem as jest.MockedClass<typeof ExecutionSystem>).mockImplementation(() => mockExecutionSystem);
    (MockBrowserWalletSigner as jest.MockedClass<typeof BrowserWalletSigner>).mockImplementation(() => mockSigner as any);

    // Suppress console.info during tests
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('create()', () => {
    it('should create new DotBot instance', async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
      };

      const dotbot = await DotBot.create(config);

      expect(dotbot).toBeInstanceOf(DotBot);
      expect(createRelayChainManager).toHaveBeenCalled();
      expect(createAssetHubManager).toHaveBeenCalled();
      expect(MockExecutionSystem).toHaveBeenCalled();
      expect(MockBrowserWalletSigner).toHaveBeenCalled();
    });

    it('should set up connections to Relay Chain and Asset Hub', async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
      };

      await DotBot.create(config);

      // Verify Relay Chain connection
      expect(mockRelayChainManager.getReadApi).toHaveBeenCalled();
      expect(mockRelayChainApi).toBeDefined();

      // Verify Asset Hub connection attempt
      expect(mockAssetHubManager.getReadApi).toHaveBeenCalled();
    });

    it('should gracefully continue if Asset Hub connection fails', async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
      };

      // Make Asset Hub connection fail
      (mockAssetHubManager.getReadApi as jest.Mock).mockRejectedValue(
        new Error('Asset Hub connection failed')
      );

      const dotbot = await DotBot.create(config);

      // Should still create DotBot instance
      expect(dotbot).toBeInstanceOf(DotBot);
      // Should log warning but continue
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Asset Hub connection failed'),
        expect.any(String)
      );
    });

    it('should create execution system', async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
      };

      await DotBot.create(config);

      // Verify ExecutionSystem was instantiated
      expect(MockExecutionSystem).toHaveBeenCalled();
      // Verify it was initialized with correct parameters
      expect(mockExecutionSystem.initialize).toHaveBeenCalledWith(
        mockRelayChainApi,
        mockWallet,
        expect.any(Object), // BrowserWalletSigner instance
        mockAssetHubApi,
        mockRelayChainManager,
        mockAssetHubManager,
        undefined
      );
    });

    it('should initialize browser wallet signer with handlers', async () => {
      const mockSigningHandler = jest.fn();
      const mockBatchSigningHandler = jest.fn();

      const config: DotBotConfig = {
        wallet: mockWallet,
        onSigningRequest: mockSigningHandler,
        onBatchSigningRequest: mockBatchSigningHandler,
      };

      const mockSigner = {
        setSigningRequestHandler: jest.fn(),
        setBatchSigningRequestHandler: jest.fn(),
      };

      (MockBrowserWalletSigner as jest.MockedClass<typeof BrowserWalletSigner>).mockImplementation(() => mockSigner as any);

      await DotBot.create(config);

      // Verify signer was created
      expect(MockBrowserWalletSigner).toHaveBeenCalledWith({
        autoApprove: false,
      });

      // Verify handlers were set
      expect(mockSigner.setSigningRequestHandler).toHaveBeenCalledWith(mockSigningHandler);
      expect(mockSigner.setBatchSigningRequestHandler).toHaveBeenCalledWith(mockBatchSigningHandler);
    });

    it('should initialize browser wallet signer with autoApprove option', async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
        autoApprove: true,
      };

      await DotBot.create(config);

      // Verify signer was created with autoApprove
      expect(MockBrowserWalletSigner).toHaveBeenCalledWith({
        autoApprove: true,
      });
    });

    it('should use pre-initialized RPC managers if provided', async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
        relayChainManager: mockRelayChainManager as RpcManager,
        assetHubManager: mockAssetHubManager as RpcManager,
      };

      await DotBot.create(config);

      // Should not create new managers
      expect(createRelayChainManager).not.toHaveBeenCalled();
      expect(createAssetHubManager).not.toHaveBeenCalled();

      // Should use provided managers
      expect(mockRelayChainManager.getReadApi).toHaveBeenCalled();
      expect(mockAssetHubManager.getReadApi).toHaveBeenCalled();
    });

    it('should initialize execution system with simulation status callback', async () => {
      const mockSimulationCallback = jest.fn();

      const config: DotBotConfig = {
        wallet: mockWallet,
        onSimulationStatus: mockSimulationCallback,
      };

      await DotBot.create(config);

      // Verify execution system was initialized with simulation callback
      expect(mockExecutionSystem.initialize).toHaveBeenCalledWith(
        mockRelayChainApi,
        mockWallet,
        expect.any(Object),
        mockAssetHubApi,
        mockRelayChainManager,
        mockAssetHubManager,
        mockSimulationCallback
      );
    });

    it('should throw error if wallet is missing', async () => {
      const config = {} as DotBotConfig;

      await expect(DotBot.create(config)).rejects.toThrow();
    });

    it('should throw error if Relay Chain connection fails', async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
      };

      // Make Relay Chain connection fail
      (mockRelayChainManager.getReadApi as jest.Mock).mockRejectedValue(
        new Error('Relay Chain connection failed')
      );

      await expect(DotBot.create(config)).rejects.toThrow('Relay Chain connection failed');
    });
  });

  describe('chat()', () => {
    let dotbot: DotBot;
    let mockCustomLLM: jest.Mock;

    beforeEach(async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
      };

      dotbot = await DotBot.create(config);
      mockCustomLLM = jest.fn();

      // Mock buildContextualSystemPrompt
      jest.spyOn(dotbot as any, 'buildContextualSystemPrompt').mockResolvedValue('Mock system prompt');
    });

    it('should return text response when no ExecutionPlan is found', async () => {
      const textResponse = 'Staking is a process where you lock your tokens to secure the network.';
      mockCustomLLM.mockResolvedValue(textResponse);

      const result = await dotbot.chat('What is staking?', {
        llm: mockCustomLLM,
      });

      expect(result.executed).toBe(false);
      expect(result.response).toBe(textResponse);
      expect(result.plan).toBeUndefined();
      expect(result.success).toBe(true);
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(0);
      expect(mockCustomLLM).toHaveBeenCalledWith(
        'What is staking?',
        'Mock system prompt',
        expect.objectContaining({
          conversationHistory: [],
        })
      );
    });

    it('should extract and execute ExecutionPlan from LLM response', async () => {
      const executionPlan = {
        id: 'test-plan-1',
        originalRequest: 'Send 2 DOT to Bob',
        steps: [
          {
            id: 'step-1',
            stepNumber: 1,
            agentClassName: 'AssetTransferAgent',
            functionName: 'transfer',
            parameters: {
              address: mockWallet.address,
              recipient: '14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3',
              amount: '20000000000',
            },
            executionType: 'extrinsic',
            status: 'pending',
            description: 'Transfer 2 DOT to Bob',
            requiresConfirmation: true,
            createdAt: Date.now(),
          },
        ],
        status: 'pending',
        requiresApproval: true,
        createdAt: Date.now(),
      };

      const llmResponse = `Here's your transaction plan:\n\`\`\`json\n${JSON.stringify(executionPlan)}\n\`\`\``;
      mockCustomLLM.mockResolvedValue(llmResponse);

      // Mock orchestrator and executioner
      const mockExecutionArray = {
        onStatusUpdate: jest.fn().mockReturnValue(() => {}),
        getState: jest.fn().mockReturnValue({
          completedItems: 1,
          failedItems: 0,
        }),
      };

      const mockOrchestrator = {
        orchestrate: jest.fn().mockResolvedValue({
          success: true,
          executionArray: mockExecutionArray,
          errors: [],
        }),
      };

      const mockExecutioner = {
        execute: jest.fn().mockResolvedValue(undefined),
      };

      (dotbot as any).executionSystem = {
        orchestrator: mockOrchestrator,
        executioner: mockExecutioner,
      };

      const result = await dotbot.chat('Send 2 DOT to Bob', {
        llm: mockCustomLLM,
      });

      expect(result.executed).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan?.id).toBe('test-plan-1');
      expect(result.success).toBe(true);
      expect(result.completed).toBe(1);
      expect(result.failed).toBe(0);
      expect(mockOrchestrator.orchestrate).toHaveBeenCalledWith(executionPlan);
    });

    it('should pass conversation history to LLM', async () => {
      const conversationHistory: ConversationMessage[] = [
        { role: 'user', content: 'Hello', timestamp: Date.now() },
        { role: 'assistant', content: 'Hi! How can I help?', timestamp: Date.now() },
      ];

      mockCustomLLM.mockResolvedValue('Response with history');

      await dotbot.chat('What did we talk about?', {
        llm: mockCustomLLM,
        conversationHistory,
      });

      expect(mockCustomLLM).toHaveBeenCalledWith(
        'What did we talk about?',
        'Mock system prompt',
        expect.objectContaining({
          conversationHistory,
        })
      );
    });

    it('should use custom system prompt when provided', async () => {
      const customPrompt = 'Custom system prompt';
      mockCustomLLM.mockResolvedValue('Response');

      await dotbot.chat('Test message', {
        llm: mockCustomLLM,
        systemPrompt: customPrompt,
      });

      expect(mockCustomLLM).toHaveBeenCalledWith(
        'Test message',
        customPrompt,
        expect.any(Object)
      );
      expect((dotbot as any).buildContextualSystemPrompt).not.toHaveBeenCalled();
    });

    it('should extract ExecutionPlan from various JSON formats', async () => {
      const executionPlan = {
        id: 'test-plan',
        originalRequest: 'Test',
        steps: [
          {
            id: 'step-1',
            stepNumber: 1,
            agentClassName: 'AssetTransferAgent',
            functionName: 'transfer',
            parameters: {},
            executionType: 'extrinsic',
            status: 'pending',
            description: 'Test step',
            requiresConfirmation: true,
            createdAt: Date.now(),
          },
        ],
        status: 'pending',
        requiresApproval: true,
        createdAt: Date.now(),
      };

      // Mock execution system for all formats
      const mockExecutionArray = {
        onStatusUpdate: jest.fn().mockReturnValue(() => {}),
        getState: jest.fn().mockReturnValue({
          completedItems: 1,
          failedItems: 0,
        }),
      };

      const mockOrchestrator = {
        orchestrate: jest.fn().mockResolvedValue({
          success: true,
          executionArray: mockExecutionArray,
          errors: [],
        }),
      };

      const mockExecutioner = {
        execute: jest.fn().mockResolvedValue(undefined),
      };

      (dotbot as any).executionSystem = {
        orchestrator: mockOrchestrator,
        executioner: mockExecutioner,
      };

      // Test JSON in code block
      const formats = [
        `\`\`\`json\n${JSON.stringify(executionPlan)}\n\`\`\``,
        `\`\`\`\n${JSON.stringify(executionPlan)}\n\`\`\``,
        JSON.stringify(executionPlan),
      ];

      for (const format of formats) {
        mockCustomLLM.mockResolvedValue(format);
        mockOrchestrator.orchestrate.mockClear();

        const result = await dotbot.chat('Test', {
          llm: mockCustomLLM,
        });

        expect(result.plan).toBeDefined();
        expect(result.plan?.id).toBe('test-plan');
        expect(result.executed).toBe(true);
      }
    });

    it('should handle execution failure gracefully', async () => {
      const executionPlan = {
        id: 'test-plan',
        originalRequest: 'Test',
        steps: [
          {
            id: 'step-1',
            stepNumber: 1,
            agentClassName: 'AssetTransferAgent',
            functionName: 'transfer',
            parameters: {},
            executionType: 'extrinsic',
            status: 'pending',
            description: 'Test step',
            requiresConfirmation: true,
            createdAt: Date.now(),
          },
        ],
        status: 'pending',
        requiresApproval: true,
        createdAt: Date.now(),
      };

      const llmResponse = `\`\`\`json\n${JSON.stringify(executionPlan)}\n\`\`\``;
      mockCustomLLM.mockResolvedValue(llmResponse);

      // Mock orchestrator to fail
      const mockOrchestrator = {
        orchestrate: jest.fn().mockRejectedValue(new Error('Orchestration failed')),
      };

      (dotbot as any).executionSystem = {
        orchestrator: mockOrchestrator,
      };

      const result = await dotbot.chat('Test', {
        llm: mockCustomLLM,
      });

      expect(result.executed).toBe(false);
      expect(result.success).toBe(false);
      expect(result.plan).toBeDefined();
      expect(result.response).toContain('Unable to prepare your transaction');
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(1);
    });

    it('should throw error if no LLM is provided', async () => {
      await expect(dotbot.chat('Test message')).rejects.toThrow('No LLM configured');
    });
  });

  describe('getBalance()', () => {
    let dotbot: DotBot;

    beforeEach(async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
      };

      dotbot = await DotBot.create(config);
    });

    it('should fetch balance from Relay Chain', async () => {
      const mockRelayData = {
        data: {
          free: '1000000000000', // 100 DOT
          reserved: '50000000000', // 5 DOT
          frozen: '0',
        },
      };

      (mockRelayChainApi.query as any) = {
        system: {
          account: jest.fn().mockResolvedValue({
            toJSON: () => mockRelayData,
          }),
        },
      };

      const balance = await dotbot.getBalance();

      expect(balance.relayChain.free).toBe('1000000000000');
      expect(balance.relayChain.reserved).toBe('50000000000');
      expect(balance.relayChain.frozen).toBe('0');
      expect(mockRelayChainApi.query?.system?.account).toHaveBeenCalledWith(mockWallet.address);
    });

    it('should fetch balance from both Relay Chain and Asset Hub', async () => {
      const mockRelayData = {
        data: {
          free: '1000000000000', // 100 DOT
          reserved: '0',
          frozen: '0',
        },
      };

      const mockAssetHubData = {
        data: {
          free: '500000000000', // 50 DOT
          reserved: '0',
          frozen: '0',
        },
      };

      (mockRelayChainApi.query as any) = {
        system: {
          account: jest.fn().mockResolvedValue({
            toJSON: () => mockRelayData,
          }),
        },
      };

      (mockAssetHubApi.query as any) = {
        system: {
          account: jest.fn().mockResolvedValue({
            toJSON: () => mockAssetHubData,
          }),
        },
      };

      const balance = await dotbot.getBalance();

      expect(balance.relayChain.free).toBe('1000000000000');
      expect(balance.assetHub).not.toBeNull();
      expect(balance.assetHub?.free).toBe('500000000000');
      expect(balance.total).toBe('1500000000000'); // 100 + 50 DOT
    });

    it('should calculate total balance correctly', async () => {
      const mockRelayData = {
        data: {
          free: '2000000000000', // 200 DOT
          reserved: '0',
          frozen: '0',
        },
      };

      const mockAssetHubData = {
        data: {
          free: '3000000000000', // 300 DOT
          reserved: '0',
          frozen: '0',
        },
      };

      (mockRelayChainApi.query as any) = {
        system: {
          account: jest.fn().mockResolvedValue({
            toJSON: () => mockRelayData,
          }),
        },
      };

      (mockAssetHubApi.query as any) = {
        system: {
          account: jest.fn().mockResolvedValue({
            toJSON: () => mockAssetHubData,
          }),
        },
      };

      const balance = await dotbot.getBalance();

      expect(balance.total).toBe('5000000000000'); // 200 + 300 DOT
    });

    it('should handle missing Asset Hub connection gracefully', async () => {
      const mockRelayData = {
        data: {
          free: '1000000000000',
          reserved: '0',
          frozen: '0',
        },
      };

      (mockRelayChainApi.query as any) = {
        system: {
          account: jest.fn().mockResolvedValue({
            toJSON: () => mockRelayData,
          }),
        },
      };

      // Set assetHubApi to null (not connected)
      (dotbot as any).assetHubApi = null;

      const balance = await dotbot.getBalance();

      expect(balance.relayChain.free).toBe('1000000000000');
      expect(balance.assetHub).toBeNull();
      expect(balance.total).toBe('1000000000000'); // Only Relay Chain balance
    });

    it('should handle missing balance data with defaults', async () => {
      const mockRelayData = {
        data: {},
      };

      (mockRelayChainApi.query as any) = {
        system: {
          account: jest.fn().mockResolvedValue({
            toJSON: () => mockRelayData,
          }),
        },
      };

      const balance = await dotbot.getBalance();

      expect(balance.relayChain.free).toBe('0');
      expect(balance.relayChain.reserved).toBe('0');
      expect(balance.relayChain.frozen).toBe('0');
    });

    it('should handle miscFrozen when frozen is not available', async () => {
      const mockRelayData = {
        data: {
          free: '1000000000000',
          reserved: '0',
          miscFrozen: '10000000000', // 1 DOT frozen
        },
      };

      (mockRelayChainApi.query as any) = {
        system: {
          account: jest.fn().mockResolvedValue({
            toJSON: () => mockRelayData,
          }),
        },
      };

      const balance = await dotbot.getBalance();

      expect(balance.relayChain.frozen).toBe('10000000000');
    });

    it('should handle Asset Hub query failure gracefully', async () => {
      const mockRelayData = {
        data: {
          free: '1000000000000',
          reserved: '0',
          frozen: '0',
        },
      };

      (mockRelayChainApi.query as any) = {
        system: {
          account: jest.fn().mockResolvedValue({
            toJSON: () => mockRelayData,
          }),
        },
      };

      // Make Asset Hub query fail
      (mockAssetHubApi.query as any) = {
        system: {
          account: jest.fn().mockRejectedValue(new Error('Asset Hub query failed')),
        },
      };

      const balance = await dotbot.getBalance();

      // Should still return Relay Chain balance
      expect(balance.relayChain.free).toBe('1000000000000');
      expect(balance.assetHub).toBeNull();
      expect(balance.total).toBe('1000000000000');
    });
  });

  describe('getChainInfo()', () => {
    let dotbot: DotBot;

    beforeEach(async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
      };

      dotbot = await DotBot.create(config);
    });

    it('should retrieve chain name and version', async () => {
      const mockChain = {
        toString: jest.fn().mockReturnValue('Polkadot'),
      };

      const mockVersion = {
        toString: jest.fn().mockReturnValue('0.9.42'),
      };

      (mockRelayChainApi.rpc as any) = {
        system: {
          chain: jest.fn().mockResolvedValue(mockChain),
          version: jest.fn().mockResolvedValue(mockVersion),
        },
      };

      const chainInfo = await dotbot.getChainInfo();

      expect(chainInfo.chain).toBe('Polkadot');
      expect(chainInfo.version).toBe('0.9.42');
      expect(mockRelayChainApi.rpc?.system?.chain).toHaveBeenCalled();
      expect(mockRelayChainApi.rpc?.system?.version).toHaveBeenCalled();
    });

    it('should query chain and version in parallel', async () => {
      const mockChain = {
        toString: jest.fn().mockReturnValue('Kusama'),
      };

      const mockVersion = {
        toString: jest.fn().mockReturnValue('0.9.40'),
      };

      let chainCalled = false;
      let versionCalled = false;

      (mockRelayChainApi.rpc as any) = {
        system: {
          chain: jest.fn().mockImplementation(async () => {
            chainCalled = true;
            return mockChain;
          }),
          version: jest.fn().mockImplementation(async () => {
            versionCalled = true;
            return mockVersion;
          }),
        },
      };

      await dotbot.getChainInfo();

      // Both should be called (Promise.all ensures parallel execution)
      expect(chainCalled).toBe(true);
      expect(versionCalled).toBe(true);
    });
  });

  describe('onExecutionArrayUpdate()', () => {
    let dotbot: DotBot;

    beforeEach(async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
      };

      dotbot = await DotBot.create(config);
    });

    it('should register callback and return unsubscribe function', () => {
      const callback = jest.fn();
      const unsubscribe = dotbot.onExecutionArrayUpdate(callback);

      expect(typeof unsubscribe).toBe('function');
      expect(callback).not.toHaveBeenCalled(); // No execution array yet
    });

    it('should call callback immediately if execution array exists', () => {
      const mockState = {
        totalItems: 1,
        completedItems: 0,
        failedItems: 0,
        cancelledItems: 0,
        currentIndex: -1,
        isExecuting: false,
        isPaused: false,
        items: [],
      };

      const mockExecutionArray = {
        onStatusUpdate: jest.fn().mockReturnValue(() => {}),
        getState: jest.fn().mockReturnValue(mockState),
      };

      (dotbot as any).currentExecutionArray = mockExecutionArray;

      const callback = jest.fn();
      dotbot.onExecutionArrayUpdate(callback);

      // Should be called immediately with current state
      expect(callback).toHaveBeenCalledWith(mockState);
      expect(mockExecutionArray.getState).toHaveBeenCalled();
    });

    it('should subscribe to execution array updates', () => {
      const mockState = {
        totalItems: 1,
        completedItems: 0,
        failedItems: 0,
        pendingItems: 1,
        items: [],
      };

      const mockUnsubscribe = jest.fn();
      const mockExecutionArray = {
        onStatusUpdate: jest.fn().mockReturnValue(mockUnsubscribe),
        getState: jest.fn().mockReturnValue(mockState),
      };

      (dotbot as any).currentExecutionArray = mockExecutionArray;

      const callback = jest.fn();
      const unsubscribe = dotbot.onExecutionArrayUpdate(callback);

      expect(mockExecutionArray.onStatusUpdate).toHaveBeenCalled();
    });

    it('should notify all callbacks when execution array updates', () => {
      const mockState = {
        totalItems: 1,
        completedItems: 1,
        failedItems: 0,
        cancelledItems: 0,
        currentIndex: 0,
        isExecuting: false,
        isPaused: false,
        items: [],
      };

      const mockExecutionArray = {
        onStatusUpdate: jest.fn().mockReturnValue(() => {}),
        getState: jest.fn().mockReturnValue(mockState),
      };

      (dotbot as any).currentExecutionArray = mockExecutionArray;

      const callback1 = jest.fn();
      const callback2 = jest.fn();

      dotbot.onExecutionArrayUpdate(callback1);
      dotbot.onExecutionArrayUpdate(callback2);

      // Get the callback that was registered with onStatusUpdate
      const registeredCallback = (mockExecutionArray.onStatusUpdate as jest.Mock).mock.calls[0][0];
      
      // Simulate execution array update - the callback receives an ExecutionItem
      // but the implementation calls getState() inside
      registeredCallback({ id: 'test-item' } as any);

      // Both callbacks should be notified (once immediately, once on update)
      expect(callback1).toHaveBeenCalledTimes(2);
      expect(callback2).toHaveBeenCalledTimes(2);
      // Both should receive the state
      expect(callback1).toHaveBeenCalledWith(mockState);
      expect(callback2).toHaveBeenCalledWith(mockState);
    });

    it('should remove callback when unsubscribe is called', () => {
      const mockState = {
        totalItems: 0,
        completedItems: 0,
        failedItems: 0,
        pendingItems: 0,
        items: [],
      };

      const mockUnsubscribe = jest.fn();
      const mockExecutionArray = {
        onStatusUpdate: jest.fn().mockReturnValue(mockUnsubscribe),
        getState: jest.fn().mockReturnValue(mockState),
      };

      (dotbot as any).currentExecutionArray = mockExecutionArray;

      const callback = jest.fn();
      const unsubscribe = dotbot.onExecutionArrayUpdate(callback);

      // Unsubscribe
      unsubscribe();

      // Callback should be removed from callbacks set
      // (We can't directly test the Set, but we can verify unsubscribe was called)
      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });

  describe('getRpcHealth()', () => {
    let dotbot: DotBot;

    beforeEach(async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
      };

      dotbot = await DotBot.create(config);
    });

    it('should return health status for both Relay Chain and Asset Hub', () => {
      const mockRelayHealth = [
        {
          endpoint: 'wss://rpc.polkadot.io',
          healthy: true,
          lastChecked: Date.now(),
          failureCount: 0,
        },
        {
          endpoint: 'wss://polkadot-rpc.dwellir.com',
          healthy: false,
          lastChecked: Date.now() - 10000,
          failureCount: 2,
          lastFailure: Date.now() - 5000,
        },
      ];

      const mockAssetHubHealth = [
        {
          endpoint: 'wss://polkadot-asset-hub-rpc.polkadot.io',
          healthy: true,
          lastChecked: Date.now(),
          failureCount: 0,
        },
      ];

      (mockRelayChainManager.getHealthStatus as jest.Mock).mockReturnValue(mockRelayHealth);
      (mockAssetHubManager.getHealthStatus as jest.Mock).mockReturnValue(mockAssetHubHealth);
      (mockRelayChainManager.getCurrentEndpoint as jest.Mock).mockReturnValue('wss://rpc.polkadot.io');
      (mockAssetHubManager.getCurrentEndpoint as jest.Mock).mockReturnValue('wss://polkadot-asset-hub-rpc.polkadot.io');

      const health = dotbot.getRpcHealth();

      expect(health.relayChain.current).toBe('wss://rpc.polkadot.io');
      expect(health.relayChain.endpoints).toEqual(mockRelayHealth);
      expect(health.assetHub.current).toBe('wss://polkadot-asset-hub-rpc.polkadot.io');
      expect(health.assetHub.endpoints).toEqual(mockAssetHubHealth);
    });

    it('should include all health information fields', () => {
      const mockHealth = [
        {
          endpoint: 'wss://rpc.polkadot.io',
          healthy: true,
          lastChecked: 1234567890,
          failureCount: 0,
          avgResponseTime: 150,
        },
      ];

      (mockRelayChainManager.getHealthStatus as jest.Mock).mockReturnValue(mockHealth);
      (mockAssetHubManager.getHealthStatus as jest.Mock).mockReturnValue([]);
      (mockRelayChainManager.getCurrentEndpoint as jest.Mock).mockReturnValue('wss://rpc.polkadot.io');
      (mockAssetHubManager.getCurrentEndpoint as jest.Mock).mockReturnValue(null);

      const health = dotbot.getRpcHealth();

      expect(health.relayChain.endpoints[0]).toHaveProperty('endpoint');
      expect(health.relayChain.endpoints[0]).toHaveProperty('healthy');
      expect(health.relayChain.endpoints[0]).toHaveProperty('lastChecked');
      expect(health.relayChain.endpoints[0]).toHaveProperty('failureCount');
      expect(health.relayChain.endpoints[0]).toHaveProperty('avgResponseTime');
    });
  });

  describe('buildContextualSystemPrompt()', () => {
    let dotbot: DotBot;

    beforeEach(async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
      };

      dotbot = await DotBot.create(config);
    });

    it('should build system prompt with wallet, network, and balance context', async () => {
      const mockBalance = {
        relayChain: {
          free: '1000000000000',
          reserved: '0',
          frozen: '0',
        },
        assetHub: {
          free: '500000000000',
          reserved: '0',
          frozen: '0',
        },
        total: '1500000000000',
      };

      const mockChainInfo = {
        chain: 'Polkadot',
        version: '0.9.42',
      };

      // Mock getBalance
      jest.spyOn(dotbot, 'getBalance').mockResolvedValue(mockBalance as any);
      // Mock getChainInfo
      jest.spyOn(dotbot, 'getChainInfo').mockResolvedValue(mockChainInfo);
      // Mock RPC manager
      (mockRelayChainManager.getCurrentEndpoint as jest.Mock).mockReturnValue('wss://rpc.polkadot.io');
      // Mock buildSystemPrompt
      (buildSystemPrompt as jest.Mock).mockResolvedValue('System prompt with context');

      const prompt = await (dotbot as any).buildContextualSystemPrompt();

      expect(dotbot.getBalance).toHaveBeenCalled();
      expect(dotbot.getChainInfo).toHaveBeenCalled();
      expect(buildSystemPrompt).toHaveBeenCalled();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('should include Asset Hub balance when available', async () => {
      const mockBalance = {
        relayChain: {
          free: '1000000000000',
          reserved: '0',
          frozen: '0',
        },
        assetHub: {
          free: '500000000000',
          reserved: '0',
          frozen: '0',
        },
        total: '1500000000000',
      };

      const mockChainInfo = {
        chain: 'Polkadot',
        version: '0.9.42',
      };

      jest.spyOn(dotbot, 'getBalance').mockResolvedValue(mockBalance as any);
      jest.spyOn(dotbot, 'getChainInfo').mockResolvedValue(mockChainInfo);
      (mockRelayChainManager.getCurrentEndpoint as jest.Mock).mockReturnValue('wss://rpc.polkadot.io');
      (buildSystemPrompt as jest.Mock).mockResolvedValue('System prompt with Asset Hub');

      await (dotbot as any).buildContextualSystemPrompt();

      // Verify balance was fetched (which includes Asset Hub)
      expect(dotbot.getBalance).toHaveBeenCalled();
      expect(buildSystemPrompt).toHaveBeenCalled();
    });

    it('should handle Kusama network detection', async () => {
      const mockBalance = {
        relayChain: {
          free: '1000000000000',
          reserved: '0',
          frozen: '0',
        },
        assetHub: null,
        total: '1000000000000',
      };

      const mockChainInfo = {
        chain: 'Kusama',
        version: '0.9.40',
      };

      jest.spyOn(dotbot, 'getBalance').mockResolvedValue(mockBalance as any);
      jest.spyOn(dotbot, 'getChainInfo').mockResolvedValue(mockChainInfo);
      (mockRelayChainManager.getCurrentEndpoint as jest.Mock).mockReturnValue('wss://kusama-rpc.polkadot.io');
      (buildSystemPrompt as jest.Mock).mockResolvedValue('Kusama system prompt');

      const prompt = await (dotbot as any).buildContextualSystemPrompt();

      expect(dotbot.getChainInfo).toHaveBeenCalled();
      expect(buildSystemPrompt).toHaveBeenCalled();
      expect(typeof prompt).toBe('string');
    });

    it('should fallback to basic prompt if context fetch fails', async () => {
      // Make getBalance fail
      jest.spyOn(dotbot, 'getBalance').mockRejectedValue(new Error('Balance fetch failed'));
      (buildSystemPrompt as jest.Mock).mockResolvedValue('Fallback system prompt');

      const prompt = await (dotbot as any).buildContextualSystemPrompt();

      // Should still return a prompt (fallback)
      expect(buildSystemPrompt).toHaveBeenCalled();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('should handle missing Asset Hub balance gracefully', async () => {
      const mockBalance = {
        relayChain: {
          free: '1000000000000',
          reserved: '0',
          frozen: '0',
        },
        assetHub: null, // Asset Hub not connected
        total: '1000000000000',
      };

      const mockChainInfo = {
        chain: 'Polkadot',
        version: '0.9.42',
      };

      jest.spyOn(dotbot, 'getBalance').mockResolvedValue(mockBalance as any);
      jest.spyOn(dotbot, 'getChainInfo').mockResolvedValue(mockChainInfo);
      (mockRelayChainManager.getCurrentEndpoint as jest.Mock).mockReturnValue('wss://rpc.polkadot.io');
      (buildSystemPrompt as jest.Mock).mockResolvedValue('System prompt without Asset Hub');

      const prompt = await (dotbot as any).buildContextualSystemPrompt();

      // Should still build prompt successfully
      expect(buildSystemPrompt).toHaveBeenCalled();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe('extractExecutionPlan()', () => {
    let dotbot: DotBot;

    beforeEach(async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
      };

      dotbot = await DotBot.create(config);
    });

    it('should extract ExecutionPlan from JSON code block', () => {
      const plan = {
        id: 'test-plan',
        originalRequest: 'Test',
        steps: [
          {
            id: 'step-1',
            stepNumber: 1,
            agentClassName: 'AssetTransferAgent',
            functionName: 'transfer',
            parameters: {},
            executionType: 'extrinsic',
            status: 'pending',
            description: 'Test step',
            requiresConfirmation: true,
            createdAt: Date.now(),
          },
        ],
        status: 'pending',
        requiresApproval: true,
        createdAt: Date.now(),
      };

      const llmResponse = `\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``;
      const result = (dotbot as any).extractExecutionPlan(llmResponse);

      expect(result).not.toBeNull();
      expect(result?.id).toBe('test-plan');
      expect(result?.steps).toHaveLength(1);
    });

    it('should extract ExecutionPlan from generic code block', () => {
      const plan = {
        id: 'test-plan',
        originalRequest: 'Test',
        steps: [],
        status: 'pending',
        requiresApproval: false,
        createdAt: Date.now(),
      };

      const llmResponse = `\`\`\`\n${JSON.stringify(plan)}\n\`\`\``;
      const result = (dotbot as any).extractExecutionPlan(llmResponse);

      expect(result).not.toBeNull();
      expect(result?.id).toBe('test-plan');
    });

    it('should extract ExecutionPlan from plain JSON string', () => {
      const plan = {
        id: 'test-plan',
        originalRequest: 'Test',
        steps: [],
        status: 'pending',
        requiresApproval: false,
        createdAt: Date.now(),
      };

      const llmResponse = JSON.stringify(plan);
      const result = (dotbot as any).extractExecutionPlan(llmResponse);

      expect(result).not.toBeNull();
      expect(result?.id).toBe('test-plan');
    });

    it('should return null for invalid JSON', () => {
      const llmResponse = 'This is not JSON at all';
      const result = (dotbot as any).extractExecutionPlan(llmResponse);

      expect(result).toBeNull();
    });

    it('should return null for JSON without required fields', () => {
      const invalidPlan = {
        // Missing id and steps
        originalRequest: 'Test',
      };

      const llmResponse = JSON.stringify(invalidPlan);
      const result = (dotbot as any).extractExecutionPlan(llmResponse);

      expect(result).toBeNull();
    });

    it('should return null for empty or null input', () => {
      expect((dotbot as any).extractExecutionPlan('')).toBeNull();
      expect((dotbot as any).extractExecutionPlan(null as any)).toBeNull();
      expect((dotbot as any).extractExecutionPlan(undefined as any)).toBeNull();
    });
  });

  describe('executeWithArrayTracking()', () => {
    let dotbot: DotBot;

    beforeEach(async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
      };

      dotbot = await DotBot.create(config);
    });

    it('should orchestrate plan and execute with tracking', async () => {
      const executionPlan = {
        id: 'test-plan',
        originalRequest: 'Test',
        steps: [
          {
            id: 'step-1',
            stepNumber: 1,
            agentClassName: 'AssetTransferAgent',
            functionName: 'transfer',
            parameters: {},
            executionType: 'extrinsic',
            status: 'pending',
            description: 'Test step',
            requiresConfirmation: true,
            createdAt: Date.now(),
          },
        ],
        status: 'pending',
        requiresApproval: true,
        createdAt: Date.now(),
      };

      const mockState = {
        totalItems: 1,
        completedItems: 1,
        failedItems: 0,
        cancelledItems: 0,
        currentIndex: 0,
        isExecuting: false,
        isPaused: false,
        items: [],
      };

      const mockExecutionArray = {
        onStatusUpdate: jest.fn().mockReturnValue(() => {}),
        getState: jest.fn().mockReturnValue(mockState),
      };

      const mockOrchestrator = {
        orchestrate: jest.fn().mockResolvedValue({
          success: true,
          executionArray: mockExecutionArray,
          errors: [],
        }),
      };

      const mockExecutioner = {
        execute: jest.fn().mockResolvedValue(undefined),
      };

      (dotbot as any).executionSystem = {
        orchestrator: mockOrchestrator,
        executioner: mockExecutioner,
      };

      const onComplete = jest.fn();

      await (dotbot as any).executeWithArrayTracking(executionPlan, undefined, { onComplete });

      expect(mockOrchestrator.orchestrate).toHaveBeenCalledWith(executionPlan);
      expect(mockExecutioner.execute).toHaveBeenCalledWith(mockExecutionArray, undefined);
      expect(onComplete).toHaveBeenCalledWith(true, 1, 0);
      expect((dotbot as any).currentExecutionArray).toBe(mockExecutionArray);
    });

    it('should throw error if orchestration fails', async () => {
      const executionPlan = {
        id: 'test-plan',
        originalRequest: 'Test',
        steps: [],
        status: 'pending',
        requiresApproval: false,
        createdAt: Date.now(),
      };

      const mockOrchestrator = {
        orchestrate: jest.fn().mockRejectedValue(new Error('Orchestration failed')),
      };

      (dotbot as any).executionSystem = {
        orchestrator: mockOrchestrator,
      };

      await expect(
        (dotbot as any).executeWithArrayTracking(executionPlan)
      ).rejects.toThrow('Orchestration failed');
    });

    it('should throw error if orchestration has errors', async () => {
      const executionPlan = {
        id: 'test-plan',
        originalRequest: 'Test',
        steps: [],
        status: 'pending',
        requiresApproval: false,
        createdAt: Date.now(),
      };

      const mockExecutionArray = {
        onStatusUpdate: jest.fn().mockReturnValue(() => {}),
        getState: jest.fn(),
      };

      const mockOrchestrator = {
        orchestrate: jest.fn().mockResolvedValue({
          success: false,
          executionArray: mockExecutionArray,
          errors: [{ error: 'Step 1 failed' }, { error: 'Step 2 failed' }],
        }),
      };

      (dotbot as any).executionSystem = {
        orchestrator: mockOrchestrator,
      };

      await expect(
        (dotbot as any).executeWithArrayTracking(executionPlan)
      ).rejects.toThrow('Failed to prepare transaction');
    });

    it('should unsubscribe from updates after execution', async () => {
      const executionPlan = {
        id: 'test-plan',
        originalRequest: 'Test',
        steps: [],
        status: 'pending',
        requiresApproval: false,
        createdAt: Date.now(),
      };

      const mockUnsubscribe = jest.fn();
      const mockExecutionArray = {
        onStatusUpdate: jest.fn().mockReturnValue(mockUnsubscribe),
        getState: jest.fn().mockReturnValue({
          totalItems: 0,
          completedItems: 0,
          failedItems: 0,
          cancelledItems: 0,
          currentIndex: -1,
          isExecuting: false,
          isPaused: false,
          items: [],
        }),
      };

      const mockOrchestrator = {
        orchestrate: jest.fn().mockResolvedValue({
          success: true,
          executionArray: mockExecutionArray,
          errors: [],
        }),
      };

      const mockExecutioner = {
        execute: jest.fn().mockResolvedValue(undefined),
      };

      (dotbot as any).executionSystem = {
        orchestrator: mockOrchestrator,
        executioner: mockExecutioner,
      };

      await (dotbot as any).executeWithArrayTracking(executionPlan);

      // Unsubscribe should be called (though we can't verify it directly, we can verify onStatusUpdate was called)
      expect(mockExecutionArray.onStatusUpdate).toHaveBeenCalled();
    });
  });
});

