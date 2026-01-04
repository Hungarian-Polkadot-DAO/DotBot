/**
 * Unit tests for Amount Normalizer Utilities
 */

import { normalizeAmountToBN } from '../../../../../agents/asset-transfer/utils/amountNormalizer';
import { TransferCapabilities } from '../../../../../agents/asset-transfer/utils/transferCapabilities';
import { BN } from '@polkadot/util';

describe('Amount Normalizer Utilities', () => {
  let mockCapabilities: TransferCapabilities;

  beforeEach(() => {
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
  });

  describe('normalizeAmountToBN()', () => {
    it('should passthrough BN objects', () => {
      const amountBN = new BN('1000000000000');
      const result = normalizeAmountToBN(amountBN, mockCapabilities);

      expect(result).toBe(amountBN); // Same reference
      expect(result.toString()).toBe('1000000000000');
    });

    it('should convert number to BN', () => {
      const result = normalizeAmountToBN(1000000000000, mockCapabilities);

      expect(BN.isBN(result)).toBe(true);
      expect(result.toString()).toBe('1000000000000');
    });

    it('should throw error for negative number', () => {
      expect(() => {
        normalizeAmountToBN(-100, mockCapabilities);
      }).toThrow('Invalid amount');
    });

    it('should throw error for non-integer number', () => {
      expect(() => {
        normalizeAmountToBN(1.5, mockCapabilities);
      }).toThrow('Invalid amount');
    });

    it('should parse decimal string using chain decimals', () => {
      const result = normalizeAmountToBN('1.5', mockCapabilities);

      expect(result.toString()).toBe('15000000000'); // 1.5 * 10^10
    });

    it('should parse integer string', () => {
      const result = normalizeAmountToBN('1000000000000', mockCapabilities);

      expect(result.toString()).toBe('1000000000000');
    });

    it('should throw error for too many decimal places', () => {
      expect(() => {
        normalizeAmountToBN('1.12345678901', mockCapabilities); // 11 decimals, max is 10
      }).toThrow('Too many decimal places');
    });

    it('should throw error for invalid string format', () => {
      expect(() => {
        normalizeAmountToBN('invalid', mockCapabilities);
      }).toThrow('Invalid amount format');
    });

    it('should handle different decimal places from capabilities', () => {
      const capabilitiesWith12Decimals = {
        ...mockCapabilities,
        nativeDecimals: 12,
      };

      const result = normalizeAmountToBN('1.5', capabilitiesWith12Decimals);

      expect(result.toString()).toBe('1500000000000'); // 1.5 * 10^12
    });

    it('should throw error for unsupported type', () => {
      expect(() => {
        normalizeAmountToBN(true as any, mockCapabilities);
      }).toThrow('Unsupported amount type');
    });
  });
});

