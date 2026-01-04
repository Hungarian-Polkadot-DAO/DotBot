/**
 * Unit tests for Address Encoder Utilities
 */

// Mock @polkadot/util-crypto before imports
jest.mock('@polkadot/util-crypto', () => ({
  decodeAddress: jest.fn(),
  encodeAddress: jest.fn(),
}));

import {
  encodeRecipientAddress,
  validateAddressFormat,
} from '../../../../../agents/asset-transfer/utils/addressEncoder';
import { TransferCapabilities } from '../../../../../agents/asset-transfer/utils/transferCapabilities';
import * as utilCrypto from '@polkadot/util-crypto';

const decodeAddress = jest.mocked(utilCrypto.decodeAddress);
const encodeAddress = jest.mocked(utilCrypto.encodeAddress);

describe('Address Encoder Utilities', () => {
  let mockCapabilities: TransferCapabilities;

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
  });

  describe('encodeRecipientAddress()', () => {
    it('should encode address to chain SS58 format', () => {
      const address = '14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3';
      const publicKey = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const encodedAddress = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';

      decodeAddress.mockReturnValue(publicKey);
      encodeAddress.mockReturnValue(encodedAddress);

      const result = encodeRecipientAddress(address, mockCapabilities);

      expect(decodeAddress).toHaveBeenCalledWith(address);
      expect(encodeAddress).toHaveBeenCalledWith(publicKey, 0); // SS58 prefix 0 for Polkadot
      expect(result).toBe(encodedAddress);
    });

    it('should use correct SS58 prefix from capabilities', () => {
      const address = '14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3';
      const publicKey = new Uint8Array([1, 2, 3]);
      const capabilitiesWithPrefix = {
        ...mockCapabilities,
        ss58Prefix: 2, // Kusama prefix
      };

      (decodeAddress as jest.Mock).mockReturnValue(publicKey);
      (encodeAddress as jest.Mock).mockReturnValue('encoded-address');

      encodeRecipientAddress(address, capabilitiesWithPrefix);

      expect(encodeAddress).toHaveBeenCalledWith(publicKey, 2);
    });

    it('should throw error for invalid address', () => {
      const address = 'invalid-address';
      decodeAddress.mockImplementation(() => {
        throw new Error('Invalid address format');
      });

      expect(() => {
        encodeRecipientAddress(address, mockCapabilities);
      }).toThrow('Invalid address');
    });
  });

  describe('validateAddressFormat()', () => {
    it('should return true for valid address', () => {
      const address = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';
      (decodeAddress as jest.Mock).mockReturnValue(new Uint8Array([1, 2, 3]));

      const result = validateAddressFormat(address);

      expect(result).toBe(true);
      expect(decodeAddress).toHaveBeenCalledWith(address);
    });

    it('should return false for invalid address', () => {
      const address = 'invalid-address';
      (decodeAddress as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid address');
      });

      const result = validateAddressFormat(address);

      expect(result).toBe(false);
    });
  });
});

