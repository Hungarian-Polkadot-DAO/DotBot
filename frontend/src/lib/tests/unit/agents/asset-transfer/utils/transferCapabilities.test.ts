/**
 * Unit tests for Transfer Capabilities
 */

import {
  detectTransferCapabilities,
  validateMinimumCapabilities,
  getBestTransferMethod,
  validateExistentialDeposit,
  getTransferMethodSummary,
} from '../../../../../agents/asset-transfer/utils/transferCapabilities';
import { TransferCapabilities } from '../../../../../agents/asset-transfer/utils/transferCapabilities';
import { ApiPromise } from '@polkadot/api';
import { BN } from '@polkadot/util';

// Mock capability detectors
jest.mock('../../../../../agents/asset-transfer/utils/capabilityDetectors', () => ({
  detectBalancesMethods: jest.fn(),
  detectUtilityMethods: jest.fn(),
  detectAssetMethods: jest.fn(),
  detectChainMetadata: jest.fn(),
  detectChainType: jest.fn(),
  getExistentialDeposit: jest.fn(),
  getRuntimeVersion: jest.fn(),
}));

import {
  detectBalancesMethods,
  detectUtilityMethods,
  detectAssetMethods,
  detectChainMetadata,
  detectChainType,
  getExistentialDeposit,
  getRuntimeVersion,
} from '../../../../../agents/asset-transfer/utils/capabilityDetectors';

describe('Transfer Capabilities', () => {
  let mockApi: Partial<ApiPromise>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockApi = {
      isReady: Promise.resolve({} as ApiPromise),
    } as any;

    // Setup default mocks
    (detectBalancesMethods as jest.Mock).mockReturnValue({
      hasBalances: true,
      hasTransferAllowDeath: true,
      hasTransfer: true,
      hasTransferKeepAlive: true,
    });

    (detectUtilityMethods as jest.Mock).mockReturnValue({
      hasUtility: true,
      hasBatch: true,
      hasBatchAll: true,
    });

    (detectAssetMethods as jest.Mock).mockReturnValue({
      hasAssets: false,
      hasTokens: false,
    });

    (detectChainMetadata as jest.Mock).mockReturnValue({
      chainName: 'Polkadot',
      nativeTokenSymbol: 'DOT',
      nativeDecimals: 10,
      ss58Prefix: 0,
    });

    (detectChainType as jest.Mock).mockReturnValue({
      isAssetHub: false,
      isRelayChain: true,
      isParachain: false,
    });

    (getExistentialDeposit as jest.Mock).mockReturnValue('10000000000');

    (getRuntimeVersion as jest.Mock).mockResolvedValue({
      specName: 'polkadot',
      specVersion: 1,
    });
  });

  describe('detectTransferCapabilities()', () => {
    it('should detect all transfer capabilities', async () => {
      const capabilities = await detectTransferCapabilities(mockApi as ApiPromise);

      expect(capabilities.hasBalances).toBe(true);
      expect(capabilities.hasTransferAllowDeath).toBe(true);
      expect(capabilities.hasTransfer).toBe(true);
      expect(capabilities.hasTransferKeepAlive).toBe(true);
      expect(capabilities.chainName).toBe('Polkadot');
      expect(capabilities.nativeTokenSymbol).toBe('DOT');
      expect(capabilities.nativeDecimals).toBe(10);
    });

    it('should wait for API to be ready', async () => {
      let readyResolved = false;
      const apiWithReady = {
        ...mockApi,
        isReady: new Promise((resolve) => {
          setTimeout(() => {
            readyResolved = true;
            resolve({} as ApiPromise);
          }, 10);
        }),
      } as any;

      const promise = detectTransferCapabilities(apiWithReady);
      expect(readyResolved).toBe(false);

      await promise;
      expect(readyResolved).toBe(true);
    });

    it('should throw error if API is not ready', async () => {
      const apiNotReady = {
        isReady: false,
      } as any;

      await expect(
        detectTransferCapabilities(apiNotReady)
      ).rejects.toThrow('API is not ready');
    });
  });

  describe('validateMinimumCapabilities()', () => {
    it('should pass validation for valid capabilities', () => {
      const capabilities: TransferCapabilities = {
        hasBalances: true,
        hasTransferAllowDeath: true,
        hasTransfer: true,
        hasTransferKeepAlive: true,
        hasAssets: false,
        hasTokens: false,
        hasUtility: true,
        hasBatch: true,
        hasBatchAll: true,
        chainName: 'Polkadot',
        nativeTokenSymbol: 'DOT',
        nativeDecimals: 10,
        existentialDeposit: '10000000000',
        ss58Prefix: 0,
        isAssetHub: false,
        isRelayChain: true,
        isParachain: false,
        specName: 'polkadot',
        specVersion: 1,
      };

      expect(() => {
        validateMinimumCapabilities(capabilities);
      }).not.toThrow();
    });

    it('should throw error if balances pallet is missing', () => {
      const capabilities: TransferCapabilities = {
        hasBalances: false,
        hasTransferAllowDeath: false,
        hasTransfer: false,
        hasTransferKeepAlive: false,
        hasAssets: false,
        hasTokens: false,
        hasUtility: false,
        hasBatch: false,
        hasBatchAll: false,
        chainName: 'Test Chain',
        nativeTokenSymbol: 'TEST',
        nativeDecimals: 10,
        existentialDeposit: '0',
        ss58Prefix: 0,
        isAssetHub: false,
        isRelayChain: false,
        isParachain: true,
        specName: 'test',
        specVersion: 1,
      };

      expect(() => {
        validateMinimumCapabilities(capabilities);
      }).toThrow('does not have balances pallet');
    });

    it('should throw error if no transfer methods available', () => {
      const capabilities: TransferCapabilities = {
        hasBalances: true,
        hasTransferAllowDeath: false,
        hasTransfer: false,
        hasTransferKeepAlive: false,
        hasAssets: false,
        hasTokens: false,
        hasUtility: false,
        hasBatch: false,
        hasBatchAll: false,
        chainName: 'Test Chain',
        nativeTokenSymbol: 'TEST',
        nativeDecimals: 10,
        existentialDeposit: '0',
        ss58Prefix: 0,
        isAssetHub: false,
        isRelayChain: false,
        isParachain: true,
        specName: 'test',
        specVersion: 1,
      };

      expect(() => {
        validateMinimumCapabilities(capabilities);
      }).toThrow('no transfer methods');
    });
  });

  describe('getBestTransferMethod()', () => {
    it('should return transferKeepAlive when keepAlive is true', () => {
      const capabilities: TransferCapabilities = {
        hasBalances: true,
        hasTransferAllowDeath: true,
        hasTransfer: true,
        hasTransferKeepAlive: true,
        hasAssets: false,
        hasTokens: false,
        hasUtility: true,
        hasBatch: true,
        hasBatchAll: true,
        chainName: 'Polkadot',
        nativeTokenSymbol: 'DOT',
        nativeDecimals: 10,
        existentialDeposit: '10000000000',
        ss58Prefix: 0,
        isAssetHub: false,
        isRelayChain: true,
        isParachain: false,
        specName: 'polkadot',
        specVersion: 1,
      };

      const method = getBestTransferMethod(capabilities, true);

      expect(method).toBe('transferKeepAlive');
    });

    it('should return transferAllowDeath when available and keepAlive is false', () => {
      const capabilities: TransferCapabilities = {
        hasBalances: true,
        hasTransferAllowDeath: true,
        hasTransfer: true,
        hasTransferKeepAlive: true,
        hasAssets: false,
        hasTokens: false,
        hasUtility: true,
        hasBatch: true,
        hasBatchAll: true,
        chainName: 'Polkadot',
        nativeTokenSymbol: 'DOT',
        nativeDecimals: 10,
        existentialDeposit: '10000000000',
        ss58Prefix: 0,
        isAssetHub: false,
        isRelayChain: true,
        isParachain: false,
        specName: 'polkadot',
        specVersion: 1,
      };

      const method = getBestTransferMethod(capabilities, false);

      expect(method).toBe('transferAllowDeath');
    });

    it('should fallback to transfer if transferAllowDeath not available', () => {
      const capabilities: TransferCapabilities = {
        hasBalances: true,
        hasTransferAllowDeath: false,
        hasTransfer: true,
        hasTransferKeepAlive: false,
        hasAssets: false,
        hasTokens: false,
        hasUtility: true,
        hasBatch: true,
        hasBatchAll: true,
        chainName: 'Polkadot',
        nativeTokenSymbol: 'DOT',
        nativeDecimals: 10,
        existentialDeposit: '10000000000',
        ss58Prefix: 0,
        isAssetHub: false,
        isRelayChain: true,
        isParachain: false,
        specName: 'polkadot',
        specVersion: 1,
      };

      const method = getBestTransferMethod(capabilities, false);

      expect(method).toBe('transfer');
    });

    it('should throw error if keepAlive requested but not available', () => {
      const capabilities: TransferCapabilities = {
        hasBalances: true,
        hasTransferAllowDeath: true,
        hasTransfer: true,
        hasTransferKeepAlive: false,
        hasAssets: false,
        hasTokens: false,
        hasUtility: true,
        hasBatch: true,
        hasBatchAll: true,
        chainName: 'Polkadot',
        nativeTokenSymbol: 'DOT',
        nativeDecimals: 10,
        existentialDeposit: '10000000000',
        ss58Prefix: 0,
        isAssetHub: false,
        isRelayChain: true,
        isParachain: false,
        specName: 'polkadot',
        specVersion: 1,
      };

      expect(() => {
        getBestTransferMethod(capabilities, true);
      }).toThrow('transferKeepAlive not available');
    });
  });

  describe('validateExistentialDeposit()', () => {
    it('should validate amount above ED', () => {
      const capabilities: TransferCapabilities = {
        hasBalances: true,
        hasTransferAllowDeath: true,
        hasTransfer: true,
        hasTransferKeepAlive: true,
        hasAssets: false,
        hasTokens: false,
        hasUtility: true,
        hasBatch: true,
        hasBatchAll: true,
        chainName: 'Polkadot',
        nativeTokenSymbol: 'DOT',
        nativeDecimals: 10,
        existentialDeposit: '10000000000', // 0.01 DOT
        ss58Prefix: 0,
        isAssetHub: false,
        isRelayChain: true,
        isParachain: false,
        specName: 'polkadot',
        specVersion: 1,
      };

      const amount = new BN('100000000000'); // 0.1 DOT (above ED)

      const result = validateExistentialDeposit(amount, capabilities);

      expect(result.valid).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it('should return warning for amount below ED', () => {
      const capabilities: TransferCapabilities = {
        hasBalances: true,
        hasTransferAllowDeath: true,
        hasTransfer: true,
        hasTransferKeepAlive: true,
        hasAssets: false,
        hasTokens: false,
        hasUtility: true,
        hasBatch: true,
        hasBatchAll: true,
        chainName: 'Polkadot',
        nativeTokenSymbol: 'DOT',
        nativeDecimals: 10,
        existentialDeposit: '10000000000', // 0.01 DOT
        ss58Prefix: 0,
        isAssetHub: false,
        isRelayChain: true,
        isParachain: false,
        specName: 'polkadot',
        specVersion: 1,
      };

      const amount = new BN('1000000000'); // 0.001 DOT (below ED)

      const result = validateExistentialDeposit(amount, capabilities);

      expect(result.valid).toBe(false);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('existential deposit');
    });
  });

  describe('getTransferMethodSummary()', () => {
    it('should return summary of available methods', () => {
      const capabilities: TransferCapabilities = {
        hasBalances: true,
        hasTransferAllowDeath: true,
        hasTransfer: true,
        hasTransferKeepAlive: true,
        hasAssets: false,
        hasTokens: false,
        hasUtility: true,
        hasBatch: true,
        hasBatchAll: true,
        chainName: 'Polkadot',
        nativeTokenSymbol: 'DOT',
        nativeDecimals: 10,
        existentialDeposit: '10000000000',
        ss58Prefix: 0,
        isAssetHub: false,
        isRelayChain: true,
        isParachain: false,
        specName: 'polkadot',
        specVersion: 1,
      };

      const summary = getTransferMethodSummary(capabilities);

      expect(summary).toContain('Polkadot');
      expect(summary).toContain('transferAllowDeath');
      expect(summary).toContain('transfer');
      expect(summary).toContain('transferKeepAlive');
    });
  });
});

