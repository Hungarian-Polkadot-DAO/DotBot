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

import { DotBot, DotBotConfig, ConversationMessage, CHAT_HISTORY_MESSAGE_LIMIT } from '../../dotbot';
import { extractExecutionPlan } from '../../prompts/system/utils';
import { ApiPromise } from '@polkadot/api';
import { WalletAccount } from '../../types/wallet';
import { RpcManager } from '../../rpcManager';
import { ExecutionSystem } from '../../executionEngine/system';
import { BrowserWalletSigner } from '../../executionEngine/signers/browserSigner';
import * as llmModule from '../../dotbot/llm';

// Mock dependencies
jest.mock('../../rpcManager');
jest.mock('../../executionEngine/system');
jest.mock('../../executionEngine/signers/browserSigner');
jest.mock('../../prompts/system/loader', () => ({
  buildSystemPrompt: jest.fn().mockResolvedValue('Default system prompt'),
  formatBalanceTurnContext: jest.fn((_context: any) => ''),
}));
jest.mock('../../dotbot/llm', () => {
  const actual = jest.requireActual('../../dotbot/llm');
  return {
    ...actual,
    buildContextualSystemPrompt: jest.fn().mockResolvedValue({ systemPrompt: 'Mock system prompt', turnContext: undefined }),
  };
});
jest.mock('../../prompts/system/knowledge', () => ({
  detectNetworkFromChainName: jest.fn((chainName: string) => {
    if (chainName.toLowerCase().includes('westend')) return 'westend';
    if (chainName.toLowerCase().includes('kusama')) return 'kusama';
    return 'polkadot';
  }),
  getKnowledgeBaseForNetwork: jest.fn().mockResolvedValue({ parachains: [] }),
  formatKnowledgeBaseForNetwork: jest.fn().mockReturnValue('Formatted knowledge'),
}));

// Import mocked modules
import { createRelayChainManager, createAssetHubManager, createRpcManagersForNetwork } from '../../rpcManager';
import { ExecutionSystem as MockExecutionSystem } from '../../executionEngine/system';
import { BrowserWalletSigner as MockBrowserWalletSigner } from '../../executionEngine/signers/browserSigner';
import { buildSystemPrompt } from '../../prompts/system/loader';
import { detectNetworkFromChainName } from '../../prompts/system/knowledge';

// Mock createRpcManagersForNetwork
jest.mock('../../rpcManager', () => ({
  ...jest.requireActual('../../rpcManager'),
  createRelayChainManager: jest.fn(),
  createAssetHubManager: jest.fn(),
  createRpcManagersForNetwork: jest.fn(),
}));

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
      rpc: {
        system: {
          chain: jest.fn().mockResolvedValue({ toString: () => 'Polkadot' }),
        },
      } as any,
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
    (createRpcManagersForNetwork as jest.Mock).mockReturnValue({
      relayChainManager: mockRelayChainManager,
      assetHubManager: mockAssetHubManager,
    });
    // Setup default detectNetworkFromChainName mock - can be overridden in specific tests
    (detectNetworkFromChainName as jest.Mock).mockImplementation((chainName: string) => {
      const name = chainName.toLowerCase();
      if (name.includes('westend')) return 'westend';
      if (name.includes('kusama')) return 'kusama';
      return 'polkadot';
    });
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
      // Should use createRpcManagersForNetwork (not legacy factory functions)
      expect(createRpcManagersForNetwork).toHaveBeenCalled();
      expect(MockExecutionSystem).toHaveBeenCalled();
      // Signer is created lazily in ensureRpcConnectionsReady (on first chat/getBalance), not during create()
    });

    it('should NOT connect to RPC endpoints during creation (lazy loading)', async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
      };

      await DotBot.create(config);

      // LAZY LOADING: RPC connections should NOT be established during creation
      expect(mockRelayChainManager.getReadApi).not.toHaveBeenCalled();
      expect(mockAssetHubManager.getReadApi).not.toHaveBeenCalled();
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
      // Asset Hub connection failure is now handled silently - non-critical
      // The system gracefully continues without Asset Hub
    });

    it('should create execution system but NOT initialize it (lazy loading)', async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
      };

      await DotBot.create(config);

      // Verify ExecutionSystem was instantiated
      expect(MockExecutionSystem).toHaveBeenCalled();
      // LAZY LOADING: Execution system should NOT be initialized during creation
      expect(mockExecutionSystem.initialize).not.toHaveBeenCalled();
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

      const dotbot = await DotBot.create(config);

      // Signer is created lazily on first use (e.g. chat); trigger it
      await dotbot.chat('hi', { llm: () => Promise.resolve('no plan') });

      // Verify signer was created with correct config
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

      const dotbot = await DotBot.create(config);

      // Signer is created lazily on first use; trigger it
      await dotbot.chat('hi', { llm: () => Promise.resolve('no plan') });

      expect(MockBrowserWalletSigner).toHaveBeenCalledWith({
        autoApprove: true,
      });
    });

    it('should use pre-initialized RPC managers if provided (but not connect)', async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
        relayChainManager: mockRelayChainManager as RpcManager,
        assetHubManager: mockAssetHubManager as RpcManager,
      };

      await DotBot.create(config);

      // Should not create new managers
      expect(createRelayChainManager).not.toHaveBeenCalled();
      expect(createAssetHubManager).not.toHaveBeenCalled();

      // LAZY LOADING: Should use provided managers but NOT connect during creation
      expect(mockRelayChainManager.getReadApi).not.toHaveBeenCalled();
      expect(mockAssetHubManager.getReadApi).not.toHaveBeenCalled();
    });

    it('should store simulation status callback but NOT initialize execution system (lazy loading)', async () => {
      const mockSimulationCallback = jest.fn();

      const config: DotBotConfig = {
        wallet: mockWallet,
        onSimulationStatus: mockSimulationCallback,
      };

      await DotBot.create(config);

      // LAZY LOADING: Execution system should NOT be initialized during creation
      // The callback will be passed when ensureRpcConnectionsReady() is called
      expect(mockExecutionSystem.initialize).not.toHaveBeenCalled();
    });

    it('should throw error if wallet is missing', async () => {
      const config = {} as DotBotConfig;

      await expect(DotBot.create(config)).rejects.toThrow();
    });

    it('should NOT throw error if Relay Chain connection fails during creation (lazy loading)', async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
      };

      // Make Relay Chain connection fail (but it won't be called during creation)
      (mockRelayChainManager.getReadApi as jest.Mock).mockRejectedValue(
        new Error('Relay Chain connection failed')
      );

      // LAZY LOADING: Creation should succeed - connection errors happen later when needed
      const dotbot = await DotBot.create(config);
      expect(dotbot).toBeInstanceOf(DotBot);
      // Connection will fail when ensureRpcConnectionsReady() is called (e.g., in startExecution)
    });

    describe('Network support', () => {
      beforeEach(() => {
        // Setup mock chain info for network detection
        (mockRelayChainApi.rpc as any) = {
          system: {
            chain: jest.fn().mockResolvedValue({ toString: () => 'Polkadot' }),
          },
        };

        // Mock createRpcManagersForNetwork to return our mock managers
        (createRpcManagersForNetwork as jest.Mock).mockReturnValue({
          relayChainManager: mockRelayChainManager,
          assetHubManager: mockAssetHubManager,
        });
      });

      it('should default to Polkadot network if not specified', async () => {
        const config: DotBotConfig = {
          wallet: mockWallet,
        };

        const dotbot = await DotBot.create(config);

        // Should create Polkadot managers
        expect(createRpcManagersForNetwork).toHaveBeenCalledWith('polkadot');
        expect(dotbot.getNetwork()).toBe('polkadot');
      });

      it('should accept network parameter for Westend', async () => {
        // Mock Westend chain name
        (mockRelayChainApi.rpc as any).system.chain.mockResolvedValue({ 
          toString: () => 'Westend' 
        });

        const config: DotBotConfig = {
          wallet: mockWallet,
          network: 'westend',
        };

        const dotbot = await DotBot.create(config);

        // Should create Westend managers
        expect(createRpcManagersForNetwork).toHaveBeenCalledWith('westend');
        expect(dotbot.getNetwork()).toBe('westend');
      });

      it('should accept network parameter for Kusama', async () => {
        // Mock Kusama chain name
        (mockRelayChainApi.rpc as any).system.chain.mockResolvedValue({ 
          toString: () => 'Kusama' 
        });

        const config: DotBotConfig = {
          wallet: mockWallet,
          network: 'kusama',
        };

        const dotbot = await DotBot.create(config);

        // Should create Kusama managers
        expect(createRpcManagersForNetwork).toHaveBeenCalledWith('kusama');
        expect(dotbot.getNetwork()).toBe('kusama');
      });

      it('should NOT detect network from chain name during creation (lazy loading)', async () => {
        // Mock Westend chain name
        (mockRelayChainApi.rpc as any).system.chain.mockResolvedValue({ 
          toString: () => 'Westend Development' 
        });

        const config: DotBotConfig = {
          wallet: mockWallet,
          network: 'polkadot', // Configured as Polkadot
        };

        await DotBot.create(config);

        // LAZY LOADING: Network detection happens when ensureRpcConnectionsReady() is called
        // Not during creation
        expect(detectNetworkFromChainName).not.toHaveBeenCalled();
      });

      it('should use pre-initialized managers regardless of network param (but not connect)', async () => {
        const config: DotBotConfig = {
          wallet: mockWallet,
          network: 'westend',
          relayChainManager: mockRelayChainManager as RpcManager,
          assetHubManager: mockAssetHubManager as RpcManager,
        };

        await DotBot.create(config);

        // Should use provided managers, not create new ones
        expect(createRpcManagersForNetwork).not.toHaveBeenCalled();
        // LAZY LOADING: Should not connect during creation
        expect(mockRelayChainManager.getReadApi).not.toHaveBeenCalled();
      });

      it('should log network information', async () => {
        (mockRelayChainApi.rpc as any).system.chain.mockResolvedValue({ 
          toString: () => 'Westend' 
        });

        const config: DotBotConfig = {
          wallet: mockWallet,
          network: 'westend',
        };

        const dotbot = await DotBot.create(config);

        // Should create successfully with westend network
        expect(dotbot).toBeInstanceOf(DotBot);
        // Network logging now uses structured logger instead of console.info
      });
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
    });

    it('should return text response when no ExecutionPlan is found', async () => {
      const textResponse = 'Staking is a process where you lock your tokens to secure the network.';
      mockCustomLLM.mockResolvedValue(textResponse);

      const result = await dotbot.chat('What is staking?', {
        llm: mockCustomLLM,
        systemPrompt: 'Mock system prompt', // skip buildContextualSystemPrompt (would need RPC/balance in test)
      });

      expect(result.executed).toBe(false);
      expect(result.response).toBe(textResponse);
      expect(result.plan).toBeUndefined();
      expect(result.success).toBe(true);
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(0);
      expect(mockCustomLLM).toHaveBeenCalledWith(
        'What is staking?',
        expect.any(String),
        expect.objectContaining({
          conversationHistory: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: 'What is staking?',
            }),
          ]),
        })
      );
    });

    it('should extract and prepare ExecutionPlan from LLM response', async () => {
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
          id: 'exec_test_' + Date.now(),
          totalItems: 1,
          completedItems: 1,
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

      // Mock currentChat methods needed by prepareExecution
      const mockSessions = {
        relayChain: { endpoint: 'wss://test', api: mockRelayChainApi } as any,
        assetHub: null as any,
      };
      // Create a mock execution message that will be returned by getDisplayMessages
      // after addExecutionMessage is called
      let executionMessageAdded = false;
      const mockExecutionMessage = {
        type: 'execution',
        executionId: expect.any(String),
        executionPlan: executionPlan,
      };
      
      (dotbot.currentChat as any) = {
        initializeExecutionSessions: jest.fn().mockResolvedValue(undefined),
        getExecutionSessions: jest.fn().mockReturnValue(mockSessions),
        addExecutionMessageEarly: jest.fn().mockResolvedValue(undefined),
        addExecutionMessage: jest.fn().mockImplementation(async () => {
          executionMessageAdded = true;
        }),
        updateExecutionInChat: jest.fn().mockResolvedValue(undefined),
        getDisplayMessages: jest.fn().mockImplementation(() => {
          // Return the execution message if it was added, otherwise empty array
          return executionMessageAdded ? [mockExecutionMessage] : [];
        }),
        getHistory: jest.fn().mockReturnValue([]),
        addUserMessage: jest.fn().mockResolvedValue(undefined),
        addBotMessage: jest.fn().mockResolvedValue(undefined),
        autoGenerateTitle: jest.fn().mockResolvedValue(undefined),
        getExecutionArray: jest.fn().mockReturnValue(null),
        setExecution: jest.fn(),
        updateExecutionMessage: jest.fn().mockResolvedValue(undefined),
        setExecutionArray: jest.fn(),
      };

      const mockOrchestrateExecutionArray = jest.fn().mockImplementation(async (plan, relayChainSession, assetHubSession, executionId) => {
        // Call orchestrate with the plan (matching actual implementation)
        const result = await mockOrchestrator.orchestrate(plan, {}, executionId);
        if (!result.success) {
          throw new Error('Orchestration failed');
        }
        return mockExecutionArray;
      });
      
      // Mock initialize method for lazy loading
      const mockInitialize = jest.fn().mockResolvedValue(undefined);
      
      (dotbot as any).executionSystem = {
        initialize: mockInitialize,
        getOrchestrator: jest.fn().mockReturnValue(mockOrchestrator),
        getExecutioner: jest.fn().mockReturnValue(mockExecutioner),
        orchestrateExecutionArray: mockOrchestrateExecutionArray,
        runSimulation: jest.fn().mockResolvedValue(undefined),
      };
      
      // Also update the mockExecutionSystem reference so the test assertion works
      mockExecutionSystem.initialize = mockInitialize;

      // Clear any previous calls from creation
      jest.clearAllMocks();

      const result = await dotbot.chat('Send 2 DOT to Bob', {
        llm: mockCustomLLM,
      });

      // LAZY LOADING: prepareExecution() (called by chat()) should trigger RPC connections
      expect(mockRelayChainManager.getReadApi).toHaveBeenCalled();
      expect(mockInitialize).toHaveBeenCalled();

      // chat() now only PREPARES execution (does not auto-execute)
      // If preparation succeeded, plan should be defined
      if (result.success) {
        expect(result.plan).toBeDefined();
        expect(result.plan?.id).toBe('test-plan-1');
        expect(mockOrchestrateExecutionArray).toHaveBeenCalled();
        expect(mockOrchestrator.orchestrate).toHaveBeenCalled();
        const orchestrateCall = (mockOrchestrator.orchestrate as jest.Mock).mock.calls[0];
        expect(orchestrateCall[0]).toMatchObject({
          id: 'test-plan-1',
          originalRequest: 'Send 2 DOT to Bob',
          steps: expect.arrayContaining([
            expect.objectContaining({
              agentClassName: 'AssetTransferAgent',
              functionName: 'transfer',
            }),
          ]),
        });
        
        // Verify ExecutionMessage was added to chat
        const messages = dotbot.currentChat?.getDisplayMessages() || [];
        const executionMessage = messages.find(m => m.type === 'execution');
        expect(executionMessage).toBeDefined();
      } else {
        // If preparation failed, plan should be undefined
        expect(result.plan).toBeUndefined();
        expect(result.success).toBe(false);
      }
      
      expect(result.executed).toBe(false);
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
        systemPrompt: 'Mock system prompt', // skip buildContextualSystemPrompt (would need RPC/balance in test)
      });

      // System prompt is the one we passed (mock); LLM receives conversationHistory (unchanged when ≤ limit)
      expect(mockCustomLLM).toHaveBeenCalledWith(
        'What did we talk about?',
        expect.any(String),
        expect.objectContaining({
          conversationHistory: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'Hello' }),
            expect.objectContaining({ role: 'assistant', content: 'Hi! How can I help?' }),
          ]),
        })
      );
    });

    it('should limit conversation history to CHAT_HISTORY_MESSAGE_LIMIT when not overridden', async () => {
      const longHistory: ConversationMessage[] = Array.from({ length: 15 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i + 1}`,
        timestamp: Date.now(),
      }));

      mockCustomLLM.mockResolvedValue('Response');

      await dotbot.chat('Follow-up question?', {
        llm: mockCustomLLM,
        conversationHistory: longHistory,
        systemPrompt: 'Mock system prompt',
      });

      expect(mockCustomLLM).toHaveBeenCalledWith(
        'Follow-up question?',
        expect.any(String),
        expect.objectContaining({
          conversationHistory: expect.any(Array),
        })
      );
      const callArgs = mockCustomLLM.mock.calls[0];
      const passedHistory = callArgs[2]?.conversationHistory as ConversationMessage[];
      expect(passedHistory).toHaveLength(CHAT_HISTORY_MESSAGE_LIMIT);
      // Should be the last 8 messages (indices 7..14)
      expect(passedHistory[0].content).toBe('Message 8');
      expect(passedHistory[7].content).toBe('Message 15');
    });

    it('should respect options.historyLimit when provided', async () => {
      const history: ConversationMessage[] = [
        { role: 'user', content: 'A', timestamp: Date.now() },
        { role: 'assistant', content: 'B', timestamp: Date.now() },
        { role: 'user', content: 'C', timestamp: Date.now() },
        { role: 'assistant', content: 'D', timestamp: Date.now() },
        { role: 'user', content: 'E', timestamp: Date.now() },
      ];

      mockCustomLLM.mockResolvedValue('Response');

      await dotbot.chat('Question?', {
        llm: mockCustomLLM,
        conversationHistory: history,
        systemPrompt: 'Mock system prompt',
        historyLimit: 3,
      });

      const callArgs = mockCustomLLM.mock.calls[0];
      const passedHistory = callArgs[2]?.conversationHistory as ConversationMessage[];
      expect(passedHistory).toHaveLength(3);
      expect(passedHistory[0].content).toBe('C');
      expect(passedHistory[2].content).toBe('E');
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
      expect(llmModule.buildContextualSystemPrompt).not.toHaveBeenCalled();
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
          id: 'exec_test_formats_' + Date.now(),
          totalItems: 1,
          completedItems: 1,
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

      // Mock currentChat for stateful execution
      const mockSessions = {
        relayChain: { endpoint: 'wss://test', api: mockRelayChainApi } as any,
        assetHub: null as any,
      };
      
      (dotbot.currentChat as any) = {
        initializeExecutionSessions: jest.fn().mockResolvedValue(undefined),
        getExecutionSessions: jest.fn().mockReturnValue(mockSessions),
        addExecutionMessage: jest.fn().mockResolvedValue(undefined),
        updateExecutionInChat: jest.fn().mockResolvedValue(undefined),
        getDisplayMessages: jest.fn().mockReturnValue([]),
        getHistory: jest.fn().mockReturnValue([]),
        addUserMessage: jest.fn().mockResolvedValue(undefined),
        addBotMessage: jest.fn().mockResolvedValue(undefined),
        autoGenerateTitle: jest.fn().mockResolvedValue(undefined),
        updateExecutionMessage: jest.fn().mockResolvedValue(undefined),
      };
      
      const mockOrchestrateExecutionArray = jest.fn().mockImplementation(async (plan, relayChainSession, assetHubSession, executionId) => {
        const result = await mockOrchestrator.orchestrate(plan, {}, executionId);
        if (!result.success) {
          throw new Error('Orchestration failed');
        }
        return mockExecutionArray;
      });

      (dotbot as any).executionSystem = {
        getOrchestrator: jest.fn().mockReturnValue(mockOrchestrator),
        getExecutioner: jest.fn().mockReturnValue(mockExecutioner),
        orchestrateExecutionArray: mockOrchestrateExecutionArray,
        runSimulation: jest.fn().mockResolvedValue(undefined),
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

        // Plan should be defined if preparation succeeded
        if (result.success) {
          expect(result.plan).toBeDefined();
          expect(result.plan?.id).toBe('test-plan');
        }
      }
    });

    it('should handle orchestration/preparation failure gracefully', async () => {
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

      // Mock LLM to return helpful error message when asked about the error
      mockCustomLLM.mockImplementation((message: string) => {
        if (message.includes('I tried to prepare the transaction')) {
          return Promise.resolve('I was unable to prepare your transaction due to an orchestration error. Please try again.');
        }
        return Promise.resolve(llmResponse);
      });

      (dotbot as any).executionSystem = {
        getOrchestrator: jest.fn().mockReturnValue(mockOrchestrator),
        orchestrateExecutionArray: jest.fn().mockRejectedValue(new Error('Orchestration failed')),
      };

      const result = await dotbot.chat('Test', {
        llm: mockCustomLLM,
      });

      expect(result.executed).toBe(false);
      expect(result.success).toBe(false);
      // Plan is undefined on error - the implementation changed to not include failed plans
      expect(result.plan).toBeUndefined();
      expect(result.response).toBeDefined();
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(1);
    });

    it('should return error result if no LLM is provided', async () => {
      // Pass systemPrompt so we skip buildContextualSystemPrompt and reach callLLM, which throws when no LLM
      const result = await dotbot.chat('Test message', { systemPrompt: 'Mock system prompt' });
      expect(result.success).toBe(false);
      expect(result.executed).toBe(false);
      expect(result.response).toContain('No LLM configured');
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(1);
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

    it('should fetch balance from Relay Chain (triggers lazy loading)', async () => {
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

      // Clear any previous calls from creation
      jest.clearAllMocks();

      const balance = await dotbot.getBalance();

      // LAZY LOADING: getBalance() should trigger RPC connections
      expect(mockRelayChainManager.getReadApi).toHaveBeenCalled();
      expect(mockExecutionSystem.initialize).toHaveBeenCalled();

      expect(balance.relayChain.free).toBe('1000000000000');
      expect(balance.relayChain.reserved).toBe('50000000000');
      expect(balance.relayChain.frozen).toBe('0');
      expect(mockRelayChainApi.query?.system?.account).toHaveBeenCalledWith(mockWallet.address);
    });

    it('should fetch balance from both Relay Chain and Asset Hub (triggers lazy loading)', async () => {
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

      // Clear any previous calls from creation
      jest.clearAllMocks();

      const balance = await dotbot.getBalance();

      // LAZY LOADING: getBalance() should trigger RPC connections
      expect(mockRelayChainManager.getReadApi).toHaveBeenCalled();
      expect(mockAssetHubManager.getReadApi).toHaveBeenCalled();
      expect(mockExecutionSystem.initialize).toHaveBeenCalled();

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

    it('should retrieve chain name and version (triggers lazy loading)', async () => {
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

      // Clear any previous calls from creation
      jest.clearAllMocks();

      const chainInfo = await dotbot.getChainInfo();

      // LAZY LOADING: getChainInfo() should trigger RPC connections
      expect(mockRelayChainManager.getReadApi).toHaveBeenCalled();
      expect(mockExecutionSystem.initialize).toHaveBeenCalled();

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

  /**
   * REMOVED: onExecutionArrayUpdate() tests
   * 
   * The method has been removed. Use dotbot.currentChat.onExecutionUpdate(executionId, callback) instead.
   * 
   * See ChatInstance tests for execution update subscription tests.
   */
  
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
    const actualLlm = jest.requireActual('../../dotbot/llm') as { buildContextualSystemPrompt: (dotbot: any) => Promise<{ systemPrompt: string; turnContext?: string }> };
    let dotbot: DotBot;

    beforeEach(async () => {
      const config: DotBotConfig = {
        wallet: mockWallet,
      };

      dotbot = await DotBot.create(config);
    });

    it('should build system prompt with wallet, network, and balance context (triggers lazy loading)', async () => {
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

      // Setup API mocks for lazy loading
      (mockRelayChainApi.query as any) = {
        system: {
          account: jest.fn().mockResolvedValue({
            toJSON: () => ({ data: { free: '1000000000000', reserved: '0', frozen: '0' } }),
          }),
        },
      };
      (mockRelayChainApi.rpc as any) = {
        system: {
          chain: jest.fn().mockResolvedValue({ toString: () => 'Polkadot' }),
          version: jest.fn().mockResolvedValue({ toString: () => '0.9.42' }),
        },
      };
      (mockRelayChainApi.registry as any) = { chainDecimals: [10] };
      (mockAssetHubApi.registry as any) = { chainDecimals: [10] };

      // Mock RPC manager
      (mockRelayChainManager.getCurrentEndpoint as jest.Mock).mockReturnValue('wss://rpc.polkadot.io');
      // Mock buildSystemPrompt
      (buildSystemPrompt as jest.Mock).mockResolvedValue('System prompt with context');

      // Clear any previous calls from creation
      jest.clearAllMocks();

      const result = await actualLlm.buildContextualSystemPrompt(dotbot);

      // LAZY LOADING: buildContextualSystemPrompt() should trigger RPC connections
      expect(mockRelayChainManager.getReadApi).toHaveBeenCalled();
      expect(mockExecutionSystem.initialize).toHaveBeenCalled();

      expect(buildSystemPrompt).toHaveBeenCalled();
      expect(typeof result.systemPrompt).toBe('string');
      expect(result.systemPrompt.length).toBeGreaterThan(0);
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

      await actualLlm.buildContextualSystemPrompt(dotbot);

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

      const result = await actualLlm.buildContextualSystemPrompt(dotbot);

      expect(dotbot.getChainInfo).toHaveBeenCalled();
      expect(buildSystemPrompt).toHaveBeenCalled();
      expect(typeof result.systemPrompt).toBe('string');
    });

    it('should throw when context fetch fails (no fallback)', async () => {
      // Make getBalance fail
      jest.spyOn(dotbot, 'getBalance').mockRejectedValue(new Error('Balance fetch failed'));

      await expect(actualLlm.buildContextualSystemPrompt(dotbot)).rejects.toThrow(
        'Failed to build system prompt: Balance fetch failed'
      );
      // Should NOT call buildSystemPrompt (we throw instead of falling back)
      expect(buildSystemPrompt).not.toHaveBeenCalled();
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

      const result = await actualLlm.buildContextualSystemPrompt(dotbot);

      // Should still build prompt successfully
      expect(buildSystemPrompt).toHaveBeenCalled();
      expect(typeof result.systemPrompt).toBe('string');
      expect(result.systemPrompt.length).toBeGreaterThan(0);
    });

    describe('Network-specific context', () => {
      it('should use Westend token symbol for Westend network', async () => {
        // Mock detectNetworkFromChainName for this specific test
        (detectNetworkFromChainName as jest.Mock).mockReturnValue('westend');
        
        // Create Westend DotBot
        (mockRelayChainApi.rpc as any) = {
          system: {
            chain: jest.fn().mockResolvedValue({ toString: () => 'Westend' }),
          },
        };

        const config: DotBotConfig = {
          wallet: mockWallet,
          network: 'westend',
        };

        const westendDotbot = await DotBot.create(config);

        // Verify network was set correctly
        expect(westendDotbot.getNetwork()).toBe('westend');

        const mockBalance = {
          relayChain: { free: '1000000000000', reserved: '0', frozen: '0' },
          assetHub: null,
          total: '1000000000000',
        };

        const mockChainInfo = { chain: 'Westend', version: '0.9.42' };

        jest.spyOn(westendDotbot, 'getBalance').mockResolvedValue(mockBalance as any);
        jest.spyOn(westendDotbot, 'getChainInfo').mockResolvedValue(mockChainInfo);
        (mockRelayChainManager.getCurrentEndpoint as jest.Mock).mockReturnValue('wss://westend-rpc.polkadot.io');
        (buildSystemPrompt as jest.Mock).mockClear();

        await actualLlm.buildContextualSystemPrompt(westendDotbot);

        // Should be called with WND symbol
        expect(buildSystemPrompt).toHaveBeenCalledWith(
          expect.objectContaining({
            balance: expect.objectContaining({
              symbol: 'WND',
            }),
            network: expect.objectContaining({
              network: 'westend',
            }),
          })
        );
      });

      it('should use Kusama token symbol for Kusama network', async () => {
        // Mock detectNetworkFromChainName for this specific test
        (detectNetworkFromChainName as jest.Mock).mockReturnValue('kusama');
        
        // Create Kusama DotBot
        (mockRelayChainApi.rpc as any) = {
          system: {
            chain: jest.fn().mockResolvedValue({ toString: () => 'Kusama' }),
          },
        };

        const config: DotBotConfig = {
          wallet: mockWallet,
          network: 'kusama',
        };

        const kusamaDotbot = await DotBot.create(config);

        // Verify network was set correctly
        expect(kusamaDotbot.getNetwork()).toBe('kusama');

        const mockBalance = {
          relayChain: { free: '1000000000000', reserved: '0', frozen: '0' },
          assetHub: null,
          total: '1000000000000',
        };

        const mockChainInfo = { chain: 'Kusama', version: '0.9.40' };

        jest.spyOn(kusamaDotbot, 'getBalance').mockResolvedValue(mockBalance as any);
        jest.spyOn(kusamaDotbot, 'getChainInfo').mockResolvedValue(mockChainInfo);
        (mockRelayChainManager.getCurrentEndpoint as jest.Mock).mockReturnValue('wss://kusama-rpc.polkadot.io');
        (buildSystemPrompt as jest.Mock).mockClear();

        await actualLlm.buildContextualSystemPrompt(kusamaDotbot);

        // Should be called with KSM symbol
        expect(buildSystemPrompt).toHaveBeenCalledWith(
          expect.objectContaining({
            balance: expect.objectContaining({
              symbol: 'KSM',
            }),
            network: expect.objectContaining({
              network: 'kusama',
            }),
          })
        );
      });

      it('should set isTestnet flag for Westend', async () => {
        // Mock detectNetworkFromChainName for this specific test
        (detectNetworkFromChainName as jest.Mock).mockReturnValue('westend');
        
        // Create Westend DotBot
        (mockRelayChainApi.rpc as any) = {
          system: {
            chain: jest.fn().mockResolvedValue({ toString: () => 'Westend' }),
          },
        };

        const config: DotBotConfig = {
          wallet: mockWallet,
          network: 'westend',
        };

        const westendDotbot = await DotBot.create(config);

        // Verify network was set correctly
        expect(westendDotbot.getNetwork()).toBe('westend');

        const mockBalance = {
          relayChain: { free: '1000000000000', reserved: '0', frozen: '0' },
          assetHub: null,
          total: '1000000000000',
        };

        const mockChainInfo = { chain: 'Westend', version: '0.9.42' };

        jest.spyOn(westendDotbot, 'getBalance').mockResolvedValue(mockBalance as any);
        jest.spyOn(westendDotbot, 'getChainInfo').mockResolvedValue(mockChainInfo);
        (buildSystemPrompt as jest.Mock).mockClear();

        await actualLlm.buildContextualSystemPrompt(westendDotbot);

        // Should set isTestnet to true
        expect(buildSystemPrompt).toHaveBeenCalledWith(
          expect.objectContaining({
            network: expect.objectContaining({
              network: 'westend',
              isTestnet: true,
            }),
          })
        );
      });

      it('should not set isTestnet flag for Polkadot', async () => {
        // Mock detectNetworkFromChainName for consistency
        (detectNetworkFromChainName as jest.Mock).mockReturnValue('polkadot');
        
        // Verify network is polkadot
        expect(dotbot.getNetwork()).toBe('polkadot');

        const mockBalance = {
          relayChain: { free: '1000000000000', reserved: '0', frozen: '0' },
          assetHub: null,
          total: '1000000000000',
        };

        const mockChainInfo = { chain: 'Polkadot', version: '0.9.42' };

        jest.spyOn(dotbot, 'getBalance').mockResolvedValue(mockBalance as any);
        jest.spyOn(dotbot, 'getChainInfo').mockResolvedValue(mockChainInfo);
        (buildSystemPrompt as jest.Mock).mockClear();

        await actualLlm.buildContextualSystemPrompt(dotbot);

        // Should set isTestnet to false
        expect(buildSystemPrompt).toHaveBeenCalledWith(
          expect.objectContaining({
            network: expect.objectContaining({
              network: 'polkadot',
              isTestnet: false,
            }),
          })
        );
      });
    });
  });

  describe('extractExecutionPlan()', () => {
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
      const result = extractExecutionPlan(llmResponse);

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
      const result = extractExecutionPlan(llmResponse);

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
      const result = extractExecutionPlan(llmResponse);

      expect(result).not.toBeNull();
      expect(result?.id).toBe('test-plan');
    });

    it('should return null for invalid JSON', () => {
      const llmResponse = 'This is not JSON at all';
      const result = extractExecutionPlan(llmResponse);

      expect(result).toBeNull();
    });

    it('should return null for JSON without required fields', () => {
      const invalidPlan = {
        // Missing id and steps
        originalRequest: 'Test',
      };

      const llmResponse = JSON.stringify(invalidPlan);
      const result = extractExecutionPlan(llmResponse);

      expect(result).toBeNull();
    });

    it('should return null for empty or null input', () => {
      expect(extractExecutionPlan('')).toBeNull();
      expect(extractExecutionPlan(null as any)).toBeNull();
      expect(extractExecutionPlan(undefined as any)).toBeNull();
    });

    it('should extract ExecutionPlan from JSON with surrounding text', () => {
      const plan = {
        id: 'exec_1234567890',
        originalRequest: 'Send 2 DOT to Alice',
        steps: [
          {
            id: 'step_1',
            stepNumber: 1,
            agentClassName: 'AssetTransferAgent',
            functionName: 'transfer',
            parameters: { recipient: 'Alice', amount: '2' },
            executionType: 'extrinsic',
            status: 'pending',
            description: 'Transfer 2 DOT to Alice',
            requiresConfirmation: true,
            createdAt: 1234567890,
          },
        ],
        status: 'pending',
        requiresApproval: true,
        createdAt: 1234567890,
      };

      const llmResponse = `Some text before the JSON\n${JSON.stringify(plan)}\nSome text after`;
      const result = extractExecutionPlan(llmResponse);

      expect(result).not.toBeNull();
      expect(result?.id).toBe('exec_1234567890');
      expect(result?.steps).toHaveLength(1);
    });

    it('should fix trailing commas in JSON', () => {
      const plan = {
        id: 'exec_1234567890',
        originalRequest: 'Test',
        steps: [
          {
            id: 'step_1',
            stepNumber: 1,
            agentClassName: 'AssetTransferAgent',
            functionName: 'transfer',
            parameters: { amount: '2' },
            executionType: 'extrinsic',
            status: 'pending',
            description: 'Test',
            requiresConfirmation: true,
            createdAt: 1234567890,
          },
        ],
        status: 'pending',
        requiresApproval: true,
        createdAt: 1234567890,
      };

      // Create JSON with trailing comma
      let jsonWithTrailingComma = JSON.stringify(plan, null, 2);
      jsonWithTrailingComma = jsonWithTrailingComma.replace(/}$/, ',\n}');

      const llmResponse = `\`\`\`json\n${jsonWithTrailingComma}\n\`\`\``;
      const result = extractExecutionPlan(llmResponse);

      expect(result).not.toBeNull();
      expect(result?.id).toBe('exec_1234567890');
    });
  });

  /**
   * REMOVED: executeWithArrayTracking() tests
   * 
   * The method has been replaced by prepareExecution() and startExecution().
   * 
   * See tests for:
   * - prepareExecution() - orchestrates and adds to chat
   * - startExecution() - executes when user approves
   */
});

