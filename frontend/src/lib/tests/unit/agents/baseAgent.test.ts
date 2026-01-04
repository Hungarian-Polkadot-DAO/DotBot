/**
 * Unit tests for BaseAgent
 */

// Mock dependencies before imports
jest.mock('../../../services/simulation', () => ({
  simulateTransaction: jest.fn(),
  isChopsticksAvailable: jest.fn(),
}));

jest.mock('@polkadot/keyring', () => ({
  decodeAddress: jest.fn(),
  encodeAddress: jest.fn(),
}));

jest.mock('@polkadot/util-crypto', () => ({
  isAddress: jest.fn(),
}));

import { BaseAgent } from '../../../agents/baseAgent';
import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { AgentError, ValidationResult, BalanceInfo, DryRunResult } from '../../../agents/types';
import { RpcManager } from '../../../rpcManager';
import { SimulationStatusCallback } from '../../../agents/types';
import { BN } from '@polkadot/util';
import { decodeAddress, encodeAddress } from '@polkadot/keyring';
import { isAddress } from '@polkadot/util-crypto';
import { simulateTransaction, isChopsticksAvailable } from '../../../services/simulation';

// Create a concrete test class
class TestAgent extends BaseAgent {
  getAgentName(): string {
    return 'TestAgent';
  }
}

describe('BaseAgent', () => {
  let agent: TestAgent;
  let mockApi: Partial<ApiPromise>;
  let mockAssetHubApi: Partial<ApiPromise>;
  let mockRelayChainManager: jest.Mocked<RpcManager>;
  let mockAssetHubManager: jest.Mocked<RpcManager>;
  let mockOnStatusUpdate: jest.MockedFunction<SimulationStatusCallback>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock APIs
    mockApi = {
      isReady: Promise.resolve({} as ApiPromise),
      isConnected: true,
      query: {
        system: {
          account: jest.fn(),
        },
      },
      registry: {
        chainSS58: 0,
      },
      runtimeChain: {
        toString: jest.fn().mockReturnValue('Polkadot'),
      },
      runtimeVersion: {
        specName: {
          toString: jest.fn().mockReturnValue('polkadot'),
        },
      },
      genesisHash: {
        toHex: jest.fn().mockReturnValue('0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3'),
      },
    } as any;

    mockAssetHubApi = {
      isReady: Promise.resolve({} as ApiPromise),
      isConnected: true,
      query: {
        system: {
          account: jest.fn(),
        },
      },
      registry: {
        chainSS58: 0,
      },
      runtimeChain: {
        toString: jest.fn().mockReturnValue('Asset Hub'),
      },
      runtimeVersion: {
        specName: {
          toString: jest.fn().mockReturnValue('statemint'),
        },
      },
      genesisHash: {
        toHex: jest.fn().mockReturnValue('0x68d56f15f85d3136970ec16946040bc1752654e906147f7e43e9d539d7c3de2f'),
      },
    } as any;

    // Create mock RPC managers
    mockRelayChainManager = {
      getReadApi: jest.fn(),
      getHealthStatus: jest.fn().mockReturnValue([
        {
          endpoint: 'wss://rpc.polkadot.io',
          healthy: true,
          failureCount: 0,
          lastChecked: Date.now(),
        },
      ]),
      getCurrentEndpoint: jest.fn().mockReturnValue('wss://rpc.polkadot.io'),
    } as any;

    mockAssetHubManager = {
      getReadApi: jest.fn(),
      getHealthStatus: jest.fn().mockReturnValue([
        {
          endpoint: 'wss://polkadot-asset-hub-rpc.polkadot.io',
          healthy: true,
          failureCount: 0,
          lastChecked: Date.now(),
        },
      ]),
      getCurrentEndpoint: jest.fn().mockReturnValue('wss://polkadot-asset-hub-rpc.polkadot.io'),
    } as any;

    mockOnStatusUpdate = jest.fn();

    agent = new TestAgent();
  });

  describe('initialize()', () => {
    it('should initialize with API and optional parameters', () => {
      agent.initialize(
        mockApi as ApiPromise,
        mockAssetHubApi as ApiPromise,
        mockOnStatusUpdate,
        mockRelayChainManager,
        mockAssetHubManager
      );

      // Verify initialization (we can't directly access protected properties, but we can test behavior)
      expect(() => agent['getApi']()).not.toThrow();
    });

    it('should handle null optional parameters', () => {
      agent.initialize(mockApi as ApiPromise, null, null, null, null);

      expect(() => agent['getApi']()).not.toThrow();
    });
  });

  describe('validateAddress()', () => {
    beforeEach(() => {
      agent.initialize(mockApi as ApiPromise);
    });

    it('should validate correct Polkadot address', () => {
      const address = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';
      (isAddress as jest.Mock).mockReturnValue(true);
      (decodeAddress as jest.Mock).mockReturnValue(new Uint8Array([1, 2, 3]));

      const result = agent['validateAddress'](address);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(isAddress).toHaveBeenCalledWith(address);
      expect(decodeAddress).toHaveBeenCalledWith(address);
    });

    it('should reject empty address', () => {
      const result = agent['validateAddress']('');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Address is required');
    });

    it('should reject invalid address format', () => {
      const address = 'invalid-address';
      (isAddress as jest.Mock).mockReturnValue(false);

      const result = agent['validateAddress'](address);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(`Invalid address format: ${address}`);
    });

    it('should handle decodeAddress errors', () => {
      const address = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';
      (isAddress as jest.Mock).mockReturnValue(true);
      (decodeAddress as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid address');
      });

      const result = agent['validateAddress'](address);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('getBalance()', () => {
    beforeEach(() => {
      agent.initialize(mockApi as ApiPromise);
    });

    it('should fetch balance from Relay Chain', async () => {
      const address = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';
      const mockAccountData = {
        data: {
          free: { toString: () => '1000000000000' },
          reserved: { toString: () => '50000000000' },
          frozen: { toString: () => '0' },
        },
      };

      (mockApi.query!.system!.account as jest.Mock).mockResolvedValue(mockAccountData);

      const balance = await agent['getBalance'](address);

      expect(balance.free).toBe('1000000000000');
      expect(balance.reserved).toBe('50000000000');
      expect(balance.frozen).toBe('0');
      expect(balance.available).toBe('1000000000000'); // free - frozen
    });

    it('should calculate available balance correctly', async () => {
      const address = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';
      const mockAccountData = {
        data: {
          free: { toString: () => '1000000000000' },
          reserved: { toString: () => '0' },
          frozen: { toString: () => '200000000000' },
        },
      };

      (mockApi.query!.system!.account as jest.Mock).mockResolvedValue(mockAccountData);

      const balance = await agent['getBalance'](address);

      expect(balance.available).toBe('800000000000'); // 1000 - 200
    });

    it('should handle missing balance data gracefully', async () => {
      const address = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';
      const mockAccountData = {
        data: {},
      };

      (mockApi.query!.system!.account as jest.Mock).mockResolvedValue(mockAccountData);

      const balance = await agent['getBalance'](address);

      expect(balance.free).toBe('0');
      expect(balance.available).toBe('0');
    });
  });

  describe('getAssetHubBalance()', () => {
    beforeEach(() => {
      agent.initialize(mockApi as ApiPromise, mockAssetHubApi as ApiPromise);
    });

    it('should fetch balance from Asset Hub when API is available', async () => {
      const address = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';
      const mockAccountData = {
        data: {
          free: { toString: () => '500000000000' },
          reserved: { toString: () => '0' },
          frozen: { toString: () => '0' },
        },
      };

      (mockAssetHubApi.query!.system!.account as jest.Mock).mockResolvedValue(mockAccountData);

      const balance = await agent['getAssetHubBalance'](address);

      expect(balance).not.toBeNull();
      expect(balance!.free).toBe('500000000000');
    });

    it('should return null when Asset Hub API is not available', async () => {
      agent.initialize(mockApi as ApiPromise, null);

      const address = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';

      const balance = await agent['getAssetHubBalance'](address);

      expect(balance).toBeNull();
    });

    it('should reconnect using manager if API is null', async () => {
      agent.initialize(mockApi as ApiPromise, null, null, null, mockAssetHubManager);
      const address = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';

      const mockAccountData = {
        data: {
          free: { toString: () => '500000000000' },
          reserved: { toString: () => '0' },
          frozen: { toString: () => '0' },
        },
      };

      (mockAssetHubManager.getReadApi as jest.Mock).mockResolvedValue({
        ...mockAssetHubApi,
        query: {
          system: {
            account: jest.fn().mockResolvedValue(mockAccountData),
          },
        },
      });

      const balance = await agent['getAssetHubBalance'](address);

      expect(mockAssetHubManager.getReadApi).toHaveBeenCalled();
      expect(balance).not.toBeNull();
    });

    it('should return null if reconnection fails', async () => {
      agent.initialize(mockApi as ApiPromise, null, null, null, mockAssetHubManager);
      const address = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';

      (mockAssetHubManager.getReadApi as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      const balance = await agent['getAssetHubBalance'](address);

      expect(balance).toBeNull();
    });
  });

  describe('getBalanceOnChain()', () => {
    beforeEach(() => {
      agent.initialize(mockApi as ApiPromise, mockAssetHubApi as ApiPromise);
    });

    it('should get balance from Relay Chain', async () => {
      const address = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';
      const mockAccountData = {
        data: {
          free: { toString: () => '1000000000000' },
          reserved: { toString: () => '0' },
          frozen: { toString: () => '0' },
        },
      };

      (mockApi.query!.system!.account as jest.Mock).mockResolvedValue(mockAccountData);

      const balance = await agent['getBalanceOnChain']('relay', address);

      expect(balance.free).toBe('1000000000000');
    });

    it('should get balance from Asset Hub', async () => {
      const address = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';
      const mockAccountData = {
        data: {
          free: { toString: () => '500000000000' },
          reserved: { toString: () => '0' },
          frozen: { toString: () => '0' },
        },
      };

      (mockAssetHubApi.query!.system!.account as jest.Mock).mockResolvedValue(mockAccountData);

      const balance = await agent['getBalanceOnChain']('assetHub', address);

      expect(balance.free).toBe('500000000000');
    });

    it('should throw error if Asset Hub balance cannot be fetched', async () => {
      agent.initialize(mockApi as ApiPromise, null);
      const address = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';

      await expect(
        agent['getBalanceOnChain']('assetHub', address)
      ).rejects.toThrow(AgentError);
    });
  });

  describe('hasSufficientBalance()', () => {
    beforeEach(() => {
      agent.initialize(mockApi as ApiPromise);
    });

    it('should return sufficient when balance is enough', async () => {
      const address = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';
      const mockAccountData = {
        data: {
          free: { toString: () => '10000000000000' }, // 10 DOT
          reserved: { toString: () => '0' },
          frozen: { toString: () => '0' },
        },
      };

      (mockApi.query!.system!.account as jest.Mock).mockResolvedValue(mockAccountData);

      const result = await agent['hasSufficientBalance'](address, '5000000000000', true); // 5 DOT

      expect(result.sufficient).toBe(true);
      expect(result.available).toBe('10000000000000');
    });

    it('should return insufficient when balance is too low', async () => {
      const address = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';
      const mockAccountData = {
        data: {
          free: { toString: () => '1000000000000' }, // 1 DOT
          reserved: { toString: () => '0' },
          frozen: { toString: () => '0' },
        },
      };

      (mockApi.query!.system!.account as jest.Mock).mockResolvedValue(mockAccountData);

      const result = await agent['hasSufficientBalance'](address, '5000000000000', true); // 5 DOT

      expect(result.sufficient).toBe(false);
      expect(result.shortfall).toBeDefined();
    });

    it('should include fee buffer when includeFees is true', async () => {
      const address = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';
      const mockAccountData = {
        data: {
          free: { toString: () => '1000000000000' },
          reserved: { toString: () => '0' },
          frozen: { toString: () => '0' },
        },
      };

      (mockApi.query!.system!.account as jest.Mock).mockResolvedValue(mockAccountData);

      const result = await agent['hasSufficientBalance'](address, '900000000000', true);

      // Should pass because 900,000,000,000 + 10,000,000,000 < 1,000,000,000,000
      expect(result.sufficient).toBe(true);
    });

    it('should not include fee buffer when includeFees is false', async () => {
      const address = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';
      const mockAccountData = {
        data: {
          free: { toString: () => '1000000000000' },
          reserved: { toString: () => '0' },
          frozen: { toString: () => '0' },
        },
      };

      (mockApi.query!.system!.account as jest.Mock).mockResolvedValue(mockAccountData);

      const result = await agent['hasSufficientBalance'](address, '900000000000', false);

      // Should succeed because no fee buffer
      expect(result.sufficient).toBe(true);
    });
  });

  describe('estimateFee()', () => {
    beforeEach(() => {
      agent.initialize(mockApi as ApiPromise);
    });

    it('should estimate fee using paymentInfo', async () => {
      const mockExtrinsic = {
        paymentInfo: jest.fn().mockResolvedValue({
          partialFee: { toString: () => '1000000000' },
        }),
      } as any;

      const fee = await agent['estimateFee'](mockExtrinsic, '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5');

      expect(fee).toBe('1000000000');
      expect(mockExtrinsic.paymentInfo).toHaveBeenCalled();
    });

    it('should return conservative estimate on failure', async () => {
      const mockExtrinsic = {
        paymentInfo: jest.fn().mockRejectedValue(new Error('Fee estimation failed')),
      } as any;

      const fee = await agent['estimateFee'](mockExtrinsic, '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5');

      expect(fee).toBe('1000000000'); // 0.001 DOT
    });
  });

  describe('parseAmount()', () => {
    it('should parse human-readable amount to Planck', () => {
      const result = agent['parseAmount']('1.5', 10);

      expect(result.toString()).toBe('15000000000'); // 1.5 * 10^10
    });

    it('should handle whole numbers', () => {
      const result = agent['parseAmount']('10', 10);

      expect(result.toString()).toBe('100000000000'); // 10 * 10^10
    });

    it('should handle fractional amounts', () => {
      const result = agent['parseAmount']('0.001', 10);

      expect(result.toString()).toBe('10000000'); // 0.001 * 10^10
    });

    it('should handle number input', () => {
      const result = agent['parseAmount'](1.5, 10);

      expect(result.toString()).toBe('15000000000');
    });

    it('should pad fractional parts correctly', () => {
      const result = agent['parseAmount']('1.5', 12); // 12 decimals

      expect(result.toString()).toBe('1500000000000'); // 1.5 * 10^12
    });
  });

  describe('formatAmount()', () => {
    it('should format Planck to human-readable amount', () => {
      const result = agent['formatAmount']('15000000000', 10);

      expect(result).toBe('1.5000000000');
    });

    it('should handle BN input', () => {
      const amount = new BN('100000000000');
      const result = agent['formatAmount'](amount, 10);

      expect(result).toBe('10.0000000000');
    });

    it('should handle different decimal places', () => {
      const result = agent['formatAmount']('1500000000000', 12);

      expect(result).toBe('1.500000000000');
    });

    it('should pad fractional parts', () => {
      const result = agent['formatAmount']('1000000000', 10);

      expect(result).toBe('0.1000000000');
    });
  });

  describe('createResult()', () => {
    it('should create result with extrinsic', () => {
      const mockExtrinsic = {} as SubmittableExtrinsic<'promise'>;

      const result = agent['createResult']('Transfer 1 DOT', mockExtrinsic, {
        estimatedFee: '1000000000',
        warnings: ['Low balance'],
      });

      expect(result.description).toBe('Transfer 1 DOT');
      expect(result.extrinsic).toBe(mockExtrinsic);
      expect(result.estimatedFee).toBe('1000000000');
      expect(result.warnings).toEqual(['Low balance']);
      expect(result.resultType).toBe('extrinsic');
      expect(result.executionType).toBe('extrinsic');
    });

    it('should create result without extrinsic', () => {
      const result = agent['createResult']('Get balance', undefined, {
        data: { balance: '1000000000000' },
      });

      expect(result.description).toBe('Get balance');
      expect(result.extrinsic).toBeUndefined();
      expect(result.data).toEqual({ balance: '1000000000000' });
      expect(result.resultType).toBe('data');
      expect(result.executionType).toBe('data_fetch');
    });

    it('should use custom resultType and executionType', () => {
      const result = agent['createResult']('Confirm action', undefined, {
        resultType: 'confirmation',
        executionType: 'user_input',
      });

      expect(result.resultType).toBe('confirmation');
      expect(result.executionType).toBe('user_input');
    });
  });

  describe('ensurePolkadotAddress()', () => {
    it('should convert address to Polkadot SS58 format', () => {
      const address = '14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3';
      const decodedBytes = new Uint8Array([1, 2, 3, 4]);
      (decodeAddress as jest.Mock).mockReturnValue(decodedBytes);
      (encodeAddress as jest.Mock).mockReturnValue('15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5');

      const result = agent['ensurePolkadotAddress'](address);

      expect(decodeAddress).toHaveBeenCalledWith(address);
      expect(encodeAddress).toHaveBeenCalledWith(decodedBytes, 0);
      expect(result).toBe('15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5');
    });

    it('should return address as-is if decode fails', () => {
      const address = 'invalid-address';
      (decodeAddress as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid address');
      });

      const result = agent['ensurePolkadotAddress'](address);

      expect(result).toBe(address);
    });
  });

  describe('getApiForChain()', () => {
    beforeEach(() => {
      agent.initialize(mockApi as ApiPromise, mockAssetHubApi as ApiPromise);
    });

    it('should return Relay Chain API for relay chain', async () => {
      const api = await agent['getApiForChain']('relay');

      expect(api).toBe(mockApi);
    });

    it('should return Asset Hub API for assetHub', async () => {
      const api = await agent['getApiForChain']('assetHub');

      expect(api).toBe(mockAssetHubApi);
    });

    it('should reconnect Asset Hub if not available', async () => {
      agent.initialize(mockApi as ApiPromise, null, null, null, mockAssetHubManager);

      (mockAssetHubManager.getReadApi as jest.Mock).mockResolvedValue(mockAssetHubApi as ApiPromise);

      const api = await agent['getApiForChain']('assetHub');

      expect(mockAssetHubManager.getReadApi).toHaveBeenCalled();
      expect(api).toBe(mockAssetHubApi);
    });

    it('should throw error if Asset Hub cannot be connected', async () => {
      agent.initialize(mockApi as ApiPromise, null, null, null, mockAssetHubManager);

      (mockAssetHubManager.getReadApi as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      await expect(
        agent['getApiForChain']('assetHub')
      ).rejects.toThrow(AgentError);
    });

    it('should validate chain type matches API', async () => {
      // Create API that claims to be Asset Hub but is actually Relay Chain
      const wrongApi = {
        ...mockAssetHubApi,
        runtimeChain: {
          toString: jest.fn().mockReturnValue('Polkadot'), // Wrong!
        },
        runtimeVersion: {
          specName: {
            toString: jest.fn().mockReturnValue('polkadot'), // Wrong!
          },
        },
      } as any;

      agent.initialize(mockApi as ApiPromise, wrongApi);

      await expect(
        agent['getApiForChain']('assetHub')
      ).rejects.toThrow(AgentError);
    });
  });

  describe('dryRunExtrinsic()', () => {
    beforeEach(() => {
      agent.initialize(mockApi as ApiPromise, null, mockOnStatusUpdate);
    });

    it('should use Chopsticks simulation when available', async () => {
      const mockExtrinsic = {
        method: {
          section: 'balances',
          method: 'transfer',
        },
        paymentInfo: jest.fn(),
      } as any;

      (isChopsticksAvailable as jest.Mock).mockResolvedValue(true);
      (simulateTransaction as jest.Mock).mockResolvedValue({
        success: true,
        estimatedFee: '1000000000',
        balanceChanges: [{ value: '1000000000000', change: 'send' }],
        events: [],
      });

      const result = await agent['dryRunExtrinsic'](
        mockApi as ApiPromise,
        mockExtrinsic,
        '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'
      );

      expect(result.success).toBe(true);
      expect(result.validationMethod).toBe('chopsticks');
      expect(result.wouldSucceed).toBe(true);
      expect(simulateTransaction).toHaveBeenCalled();
    });

    it('should fallback to paymentInfo when Chopsticks unavailable', async () => {
      const mockExtrinsic = {
        method: {
          section: 'balances',
          method: 'transfer',
        },
        paymentInfo: jest.fn().mockResolvedValue({
          partialFee: { toString: () => '1000000000' },
          weight: { toString: () => '100000' },
          class: { toString: () => 'Normal' },
        }),
      } as any;

      (isChopsticksAvailable as jest.Mock).mockResolvedValue(false);

      const result = await agent['dryRunExtrinsic'](
        mockApi as ApiPromise,
        mockExtrinsic,
        '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'
      );

      expect(result.success).toBe(true);
      expect(result.validationMethod).toBe('paymentInfo');
      expect(mockExtrinsic.paymentInfo).toHaveBeenCalled();
    });

    it('should handle simulation failure', async () => {
      const mockExtrinsic = {
        method: {
          section: 'balances',
          method: 'transfer',
        },
        paymentInfo: jest.fn(),
      } as any;

      (isChopsticksAvailable as jest.Mock).mockResolvedValue(true);
      (simulateTransaction as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Insufficient balance',
        estimatedFee: '1000000000',
      });

      const result = await agent['dryRunExtrinsic'](
        mockApi as ApiPromise,
        mockExtrinsic,
        '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient balance');
      expect(result.wouldSucceed).toBe(false);
    });

    it('should call status update callback', async () => {
      const mockExtrinsic = {
        method: {
          section: 'balances',
          method: 'transfer',
        },
        paymentInfo: jest.fn(),
      } as any;

      (isChopsticksAvailable as jest.Mock).mockResolvedValue(true);
      (simulateTransaction as jest.Mock).mockResolvedValue({
        success: true,
        estimatedFee: '1000000000',
        balanceChanges: [],
        events: [],
      });

      await agent['dryRunExtrinsic'](
        mockApi as ApiPromise,
        mockExtrinsic,
        '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'
      );

      expect(mockOnStatusUpdate).toHaveBeenCalled();
    });

    it('should throw error for invalid extrinsic', async () => {
      const mockExtrinsic = {
        method: null,
      } as any;

      await expect(
        agent['dryRunExtrinsic'](
          mockApi as ApiPromise,
          mockExtrinsic,
          '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'
        )
      ).rejects.toThrow('Invalid extrinsic: missing method information');
    });
  });

  describe('ensureInitialized()', () => {
    it('should throw error if not initialized', () => {
      const uninitializedAgent = new TestAgent();

      expect(() => {
        uninitializedAgent['ensureInitialized']();
      }).toThrow(AgentError);
    });

    it('should not throw if initialized', () => {
      agent.initialize(mockApi as ApiPromise);

      expect(() => {
        agent['ensureInitialized']();
      }).not.toThrow();
    });
  });
});

