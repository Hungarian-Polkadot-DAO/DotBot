/**
 * Unit tests for Capability Detectors
 */

import {
  detectBalancesMethods,
  detectUtilityMethods,
  detectAssetMethods,
  detectChainMetadata,
  detectChainType,
  getExistentialDeposit,
  getRuntimeVersion,
} from '../../../../../agents/asset-transfer/utils/capabilityDetectors';
import { ApiPromise } from '@polkadot/api';

describe('Capability Detectors', () => {
  let mockApi: Partial<ApiPromise>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockApi = {
      tx: {
        balances: {
          transferAllowDeath: jest.fn(),
          transfer: jest.fn(),
          transferKeepAlive: jest.fn(),
        },
        utility: {
          batch: jest.fn(),
          batchAll: jest.fn(),
        },
        assets: {},
        tokens: {},
      },
      registry: {
        chainTokens: ['DOT'],
        chainDecimals: [10],
        chainSS58: 0,
      },
      runtimeChain: {
        toString: jest.fn().mockReturnValue('Polkadot'),
      },
      runtimeVersion: {
        specName: {
          toString: jest.fn().mockReturnValue('polkadot'),
        },
        specVersion: {
          toNumber: jest.fn().mockReturnValue(1),
        },
      },
      consts: {
        balances: {
          existentialDeposit: {
            toString: jest.fn().mockReturnValue('10000000000'),
          },
        },
      },
      rpc: {
        state: {
          getRuntimeVersion: jest.fn(),
        },
      },
      isReady: Promise.resolve({} as ApiPromise),
    } as any;
  });

  describe('detectBalancesMethods()', () => {
    it('should detect balances methods', () => {
      const result = detectBalancesMethods(mockApi as ApiPromise);

      expect(result.hasBalances).toBe(true);
      expect(result.hasTransferAllowDeath).toBe(true);
      expect(result.hasTransfer).toBe(true);
      expect(result.hasTransferKeepAlive).toBe(true);
    });

    it('should return false for missing methods', () => {
      const apiWithoutMethods = {
        ...mockApi,
        tx: {
          balances: {},
        },
      } as any;

      const result = detectBalancesMethods(apiWithoutMethods);

      expect(result.hasBalances).toBe(true); // balances pallet exists
      expect(result.hasTransferAllowDeath).toBe(false);
      expect(result.hasTransfer).toBe(false);
      expect(result.hasTransferKeepAlive).toBe(false);
    });
  });

  describe('detectUtilityMethods()', () => {
    it('should detect utility methods', () => {
      const result = detectUtilityMethods(mockApi as ApiPromise);

      expect(result.hasUtility).toBe(true);
      expect(result.hasBatch).toBe(true);
      expect(result.hasBatchAll).toBe(true);
    });
  });

  describe('detectAssetMethods()', () => {
    it('should detect asset methods', () => {
      const result = detectAssetMethods(mockApi as ApiPromise);

      expect(result.hasAssets).toBe(true);
      expect(result.hasTokens).toBe(true);
    });
  });

  describe('detectChainMetadata()', () => {
    it('should detect chain metadata', () => {
      const result = detectChainMetadata(mockApi as ApiPromise);

      expect(result.chainName).toBe('Polkadot');
      expect(result.nativeTokenSymbol).toBe('DOT');
      expect(result.nativeDecimals).toBe(10);
      expect(result.ss58Prefix).toBe(0);
    });

    it('should use defaults for missing metadata', () => {
      const apiWithoutMetadata = {
        ...mockApi,
        registry: {
          chainTokens: undefined,
          chainDecimals: undefined,
          chainSS58: undefined,
        },
        runtimeChain: undefined,
      } as any;

      const result = detectChainMetadata(apiWithoutMetadata);

      expect(result.chainName).toBe('Unknown Chain');
      expect(result.nativeTokenSymbol).toBe('UNIT');
      expect(result.nativeDecimals).toBe(10);
      expect(result.ss58Prefix).toBe(0);
    });
  });

  describe('detectChainType()', () => {
    it('should detect Asset Hub', () => {
      const result = detectChainType('Asset Hub', 'statemint');

      expect(result.isAssetHub).toBe(true);
      expect(result.isRelayChain).toBe(false);
      expect(result.isParachain).toBe(false);
    });

    it('should detect Relay Chain', () => {
      const result = detectChainType('Polkadot', 'polkadot');

      expect(result.isAssetHub).toBe(false);
      expect(result.isRelayChain).toBe(true);
      expect(result.isParachain).toBe(false);
    });

    it('should detect Parachain', () => {
      const result = detectChainType('Acala', 'acala');

      expect(result.isAssetHub).toBe(false);
      expect(result.isRelayChain).toBe(false);
      expect(result.isParachain).toBe(true);
    });
  });

  describe('getExistentialDeposit()', () => {
    it('should get existential deposit from API', () => {
      const result = getExistentialDeposit(mockApi as ApiPromise);

      expect(result).toBe('10000000000');
    });

    it('should return 0 if ED cannot be fetched', () => {
      const apiWithoutED = {
        ...mockApi,
        consts: {
          balances: undefined,
        },
      } as any;

      const result = getExistentialDeposit(apiWithoutED);

      expect(result).toBe('0');
    });
  });

  describe('getRuntimeVersion()', () => {
    it('should get runtime version from cached API', async () => {
      const result = await getRuntimeVersion(mockApi as ApiPromise);

      expect(result.specName).toBe('polkadot');
      expect(result.specVersion).toBe(1);
    });

    it('should fallback to RPC call if cached version unavailable', async () => {
      const apiWithoutCached = {
        ...mockApi,
        runtimeVersion: undefined,
        rpc: {
          state: {
            getRuntimeVersion: jest.fn().mockResolvedValue({
              specName: { toString: () => 'polkadot' },
              specVersion: { toNumber: () => 2 },
            }),
          },
        },
      } as any;

      const result = await getRuntimeVersion(apiWithoutCached);

      expect(result.specName).toBe('polkadot');
      expect(result.specVersion).toBe(2);
    });

    it('should use defaults if all methods fail', async () => {
      const apiFailing = {
        ...mockApi,
        runtimeVersion: undefined,
        rpc: {
          state: {
            getRuntimeVersion: jest.fn().mockRejectedValue(new Error('RPC failed')),
          },
        },
      } as any;

      const result = await getRuntimeVersion(apiFailing);

      expect(result.specName).toBe('unknown');
      expect(result.specVersion).toBe(0);
    });
  });
});

