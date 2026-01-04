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
    return '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
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
      address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
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
              recipient: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
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
});

