/**
 * Unit tests for Safe Extrinsic Builder
 */

// Mock dependencies before imports
jest.mock('../../../../../agents/asset-transfer/utils/transferCapabilities', () => ({
  validateMinimumCapabilities: jest.fn(),
  getBestTransferMethod: jest.fn(),
  validateExistentialDeposit: jest.fn(),
}));

jest.mock('../../../../../agents/asset-transfer/utils/addressEncoder', () => ({
  encodeRecipientAddress: jest.fn(),
}));

jest.mock('../../../../../agents/asset-transfer/utils/amountNormalizer', () => ({
  normalizeAmountToBN: jest.fn(),
}));

jest.mock('../../../../../agents/asset-transfer/utils/capabilityDetectors', () => ({
  detectChainType: jest.fn(),
}));

import {
  buildSafeTransferExtrinsic,
  buildSafeBatchExtrinsic,
} from '../../../../../agents/asset-transfer/utils/safeExtrinsicBuilder';
import { TransferCapabilities } from '../../../../../agents/asset-transfer/utils/transferCapabilities';
import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { BN } from '@polkadot/util';
import {
  validateMinimumCapabilities,
  getBestTransferMethod,
  validateExistentialDeposit,
} from '../../../../../agents/asset-transfer/utils/transferCapabilities';
import { encodeRecipientAddress } from '../../../../../agents/asset-transfer/utils/addressEncoder';
import { normalizeAmountToBN } from '../../../../../agents/asset-transfer/utils/amountNormalizer';
import { detectChainType } from '../../../../../agents/asset-transfer/utils/capabilityDetectors';

describe('Safe Extrinsic Builder', () => {
  let mockApi: Partial<ApiPromise>;
  let mockCapabilities: TransferCapabilities;
  let mockExtrinsic: jest.Mocked<SubmittableExtrinsic<'promise'>>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockCapabilities = {
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

    mockExtrinsic = {
      method: {
        section: 'balances',
        method: 'transferAllowDeath',
        toHex: jest.fn().mockReturnValue('0x1234'),
      },
    } as any;

    mockApi = {
      isReady: Promise.resolve({} as ApiPromise),
      tx: {
        balances: {
          transferAllowDeath: jest.fn().mockReturnValue(mockExtrinsic),
          transfer: jest.fn().mockReturnValue(mockExtrinsic),
          transferKeepAlive: jest.fn().mockReturnValue(mockExtrinsic),
        },
        utility: {
          batch: jest.fn().mockReturnValue(mockExtrinsic),
          batchAll: jest.fn().mockReturnValue(mockExtrinsic),
        },
      },
    } as any;

    // Setup default mocks
    (validateMinimumCapabilities as jest.Mock).mockImplementation(() => {});
    (getBestTransferMethod as jest.Mock).mockReturnValue('transferAllowDeath');
    (validateExistentialDeposit as jest.Mock).mockReturnValue({ valid: true });
    (encodeRecipientAddress as jest.Mock).mockReturnValue('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY');
    (normalizeAmountToBN as jest.Mock).mockReturnValue(new BN('1000000000000'));
    (detectChainType as jest.Mock).mockReturnValue({
      isAssetHub: false,
      isRelayChain: true,
      isParachain: false,
    });
  });

  describe('buildSafeTransferExtrinsic()', () => {
    it('should build transfer extrinsic with validation', () => {
      const params = {
        recipient: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
        amount: '1',
      };

      const result = buildSafeTransferExtrinsic(mockApi as ApiPromise, params, mockCapabilities);

      expect(validateMinimumCapabilities).toHaveBeenCalledWith(mockCapabilities);
      expect(getBestTransferMethod).toHaveBeenCalled();
      expect(encodeRecipientAddress).toHaveBeenCalled();
      expect(normalizeAmountToBN).toHaveBeenCalled();
      expect(result.extrinsic).toBe(mockExtrinsic);
      expect(result.method).toBe('transferAllowDeath');
    });

    it('should use keepAlive when specified', () => {
      const params = {
        recipient: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
        amount: '1',
        keepAlive: true,
      };

      (getBestTransferMethod as jest.Mock).mockReturnValue('transferKeepAlive');

      const result = buildSafeTransferExtrinsic(mockApi as ApiPromise, params, mockCapabilities);

      expect(getBestTransferMethod).toHaveBeenCalledWith(mockCapabilities, true);
      expect(result.method).toBe('transferKeepAlive');
    });

    it('should include warnings for ED validation', () => {
      const params = {
        recipient: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
        amount: '1',
      };

      (validateExistentialDeposit as jest.Mock).mockReturnValue({
        valid: false,
        warning: 'Amount below ED',
      });

      const result = buildSafeTransferExtrinsic(mockApi as ApiPromise, params, mockCapabilities);

      expect(result.warnings).toContain('Amount below ED');
    });

    it('should throw error if API is not ready', () => {
      const apiNotReady = {
        isReady: false,
      } as any;

      const params = {
        recipient: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
        amount: '1',
      };

      expect(() => {
        buildSafeTransferExtrinsic(apiNotReady, params, mockCapabilities);
      }).toThrow('API not ready');
    });

    it('should throw error for zero amount', () => {
      const params = {
        recipient: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
        amount: '0',
      };

      (normalizeAmountToBN as jest.Mock).mockReturnValue(new BN('0'));

      expect(() => {
        buildSafeTransferExtrinsic(mockApi as ApiPromise, params, mockCapabilities);
      }).toThrow('Amount must be greater than zero');
    });

    it('should throw error if method does not exist', () => {
      const params = {
        recipient: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
        amount: '1',
      };

      const apiWithoutMethod = {
        ...mockApi,
        tx: {
          balances: {},
        },
      } as any;

      expect(() => {
        buildSafeTransferExtrinsic(apiWithoutMethod, params, mockCapabilities);
      }).toThrow('Method transferAllowDeath is not available');
    });
  });

  describe('buildSafeBatchExtrinsic()', () => {
    it('should build batch transfer extrinsic', () => {
      const transfers = [
        { recipient: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', amount: '1' },
        { recipient: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', amount: '2' },
      ];

      const result = buildSafeBatchExtrinsic(mockApi as ApiPromise, transfers, mockCapabilities);

      expect(result.extrinsic).toBe(mockExtrinsic);
      expect(mockApi.tx!.utility!.batchAll).toHaveBeenCalled();
    });

    it('should use batch instead of batchAll when useAtomicBatch is false', () => {
      const transfers = [
        { recipient: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', amount: '1' },
      ];

      const result = buildSafeBatchExtrinsic(
        mockApi as ApiPromise,
        transfers,
        mockCapabilities,
        false
      );

      expect(mockApi.tx!.utility!.batch).toHaveBeenCalled();
      expect(mockApi.tx!.utility!.batchAll).not.toHaveBeenCalled();
    });

    it('should throw error if utility pallet not available', () => {
      const capabilitiesWithoutUtility = {
        ...mockCapabilities,
        hasUtility: false,
        hasBatch: false,
        hasBatchAll: false,
      };

      const transfers = [
        { recipient: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', amount: '1' },
      ];

      expect(() => {
        buildSafeBatchExtrinsic(mockApi as ApiPromise, transfers, capabilitiesWithoutUtility);
      }).toThrow('does not have utility pallet');
    });

    it('should validate batch transfers', () => {
      const transfers: any[] = [];

      expect(() => {
        buildSafeBatchExtrinsic(mockApi as ApiPromise, transfers, mockCapabilities);
      }).toThrow();
    });
  });
});

