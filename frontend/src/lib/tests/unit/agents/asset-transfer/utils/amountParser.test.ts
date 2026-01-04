/**
 * Unit tests for Amount Parser Utilities
 */

import {
  parseAndValidateAmountWithCapabilities,
  parseAmount,
  formatAmount,
} from '../../../../../agents/asset-transfer/utils/amountParser';
import { TransferCapabilities } from '../../../../../agents/asset-transfer/utils/transferCapabilities';
import { AgentError } from '../../../../../agents/types';
import { BN } from '@polkadot/util';

describe('Amount Parser Utilities', () => {
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

  describe('parseAmount()', () => {
    it('should parse decimal string to Planck', () => {
      const result = parseAmount('1.5', 10);

      expect(result.toString()).toBe('15000000000'); // 1.5 * 10^10
    });

    it('should parse whole number string', () => {
      const result = parseAmount('10', 10);

      expect(result.toString()).toBe('100000000000'); // 10 * 10^10
    });

    it('should parse number input', () => {
      const result = parseAmount(1.5, 10);

      expect(result.toString()).toBe('15000000000');
    });

    it('should handle different decimal places', () => {
      const result = parseAmount('1.5', 12); // 12 decimals

      expect(result.toString()).toBe('1500000000000'); // 1.5 * 10^12
    });

    it('should pad fractional parts correctly', () => {
      const result = parseAmount('1.5', 10);

      expect(result.toString()).toBe('15000000000');
    });

    it('should handle amounts without decimal point', () => {
      const result = parseAmount('100', 10);

      expect(result.toString()).toBe('1000000000000');
    });
  });

  describe('formatAmount()', () => {
    it('should format Planck to human-readable amount', () => {
      const amountBN = new BN('15000000000');
      const result = formatAmount(amountBN, 10);

      expect(result).toBe('1.5000000000');
    });

    it('should handle different decimal places', () => {
      const amountBN = new BN('1500000000000');
      const result = formatAmount(amountBN, 12);

      expect(result).toBe('1.500000000000');
    });

    it('should pad fractional parts', () => {
      const amountBN = new BN('1000000000');
      const result = formatAmount(amountBN, 10);

      expect(result).toBe('0.1000000000');
    });

    it('should use default 10 decimals if not specified', () => {
      const amountBN = new BN('15000000000');
      const result = formatAmount(amountBN);

      expect(result).toBe('1.5000000000');
    });
  });

  describe('parseAndValidateAmountWithCapabilities()', () => {
    it('should parse and validate amount with capabilities', () => {
      const result = parseAndValidateAmountWithCapabilities('1.5', mockCapabilities);

      expect(result.toString()).toBe('15000000000');
    });

    it('should use chain-specific decimals from capabilities', () => {
      const capabilitiesWith12Decimals = {
        ...mockCapabilities,
        nativeDecimals: 12,
      };

      const result = parseAndValidateAmountWithCapabilities('1.5', capabilitiesWith12Decimals);

      expect(result.toString()).toBe('1500000000000'); // 1.5 * 10^12
    });

    it('should throw error for zero amount', () => {
      expect(() => {
        parseAndValidateAmountWithCapabilities('0', mockCapabilities);
      }).toThrow(AgentError);
    });

    it('should throw error for negative amount', () => {
      expect(() => {
        parseAndValidateAmountWithCapabilities('-1', mockCapabilities);
      }).toThrow(AgentError);
    });

    it('should handle number input', () => {
      const result = parseAndValidateAmountWithCapabilities(1.5, mockCapabilities);

      expect(result.toString()).toBe('15000000000');
    });

    it('should include index in error message for batch transfers', () => {
      expect(() => {
        parseAndValidateAmountWithCapabilities('0', mockCapabilities, 2);
      }).toThrow('Transfer 3: Transfer amount must be greater than zero');
    });
  });
});

