/**
 * Unit tests for Address Validation Utilities
 */

// Mock @polkadot/util-crypto before imports
jest.mock('@polkadot/util-crypto', () => ({
  isAddress: jest.fn(),
  decodeAddress: jest.fn(),
}));

import {
  validateAddress,
  validateTransferAddresses,
  validateSenderAddress,
  validateSenderAddressForSigning,
} from '../../../../../agents/asset-transfer/utils/addressValidation';
import { AgentError } from '../../../../../agents/types';
import * as utilCrypto from '@polkadot/util-crypto';

const isAddress = jest.mocked(utilCrypto.isAddress);
const decodeAddress = jest.mocked(utilCrypto.decodeAddress);

describe('Address Validation Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateAddress()', () => {
    it('should validate correct address', () => {
      const address = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
      isAddress.mockReturnValue(true);
      decodeAddress.mockReturnValue(new Uint8Array([1, 2, 3]));

      const result = validateAddress(address);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(isAddress).toHaveBeenCalledWith(address);
      expect(decodeAddress).toHaveBeenCalledWith(address);
    });

    it('should reject empty address', () => {
      const result = validateAddress('');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Address is required');
    });

    it('should reject whitespace-only address', () => {
      const result = validateAddress('   ');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Address is required');
    });

    it('should reject invalid address format', () => {
      const address = 'invalid-address';
      isAddress.mockReturnValue(false);

      const result = validateAddress(address);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(`Invalid address format: ${address}`);
    });

    it('should handle decodeAddress errors', () => {
      const address = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
      (isAddress as jest.Mock).mockReturnValue(true);
      decodeAddress.mockImplementation(() => {
        throw new Error('Invalid checksum');
      });

      const result = validateAddress(address);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Address validation failed');
    });
  });

  describe('validateTransferAddresses()', () => {
    it('should validate both sender and recipient', () => {
      const sender = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
      const recipient = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
      
      isAddress.mockReturnValue(true);
      decodeAddress.mockReturnValue(new Uint8Array([1, 2, 3]));

      expect(() => {
        validateTransferAddresses(sender, recipient);
      }).not.toThrow();
    });

    it('should throw error for invalid sender', () => {
      const sender = 'invalid-sender';
      const recipient = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
      
      isAddress.mockReturnValue(false);

      expect(() => {
        validateTransferAddresses(sender, recipient);
      }).toThrow(AgentError);
    });

    it('should throw error for invalid recipient', () => {
      const sender = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
      const recipient = 'invalid-recipient';
      
      isAddress
        .mockReturnValueOnce(true) // sender is valid
        .mockReturnValueOnce(false); // recipient is invalid
      decodeAddress.mockReturnValue(new Uint8Array([1, 2, 3]));

      expect(() => {
        validateTransferAddresses(sender, recipient);
      }).toThrow(AgentError);
    });

    it('should throw error if sender and recipient are the same', () => {
      const address = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
      
      isAddress.mockReturnValue(true);
      decodeAddress.mockReturnValue(new Uint8Array([1, 2, 3]));

      expect(() => {
        validateTransferAddresses(address, address);
      }).toThrow(AgentError);
    });
  });

  describe('validateSenderAddress()', () => {
    it('should validate correct sender address', () => {
      const address = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
      isAddress.mockReturnValue(true);
      decodeAddress.mockReturnValue(new Uint8Array([1, 2, 3]));

      expect(() => {
        validateSenderAddress(address);
      }).not.toThrow();
    });

    it('should throw error for invalid sender address', () => {
      const address = 'invalid-address';
      isAddress.mockReturnValue(false);

      expect(() => {
        validateSenderAddress(address);
      }).toThrow(AgentError);
    });
  });

  describe('validateSenderAddressForSigning()', () => {
    it('should validate decodable address', async () => {
      const address = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
      // Configure the existing mock to succeed
      decodeAddress.mockReturnValue(new Uint8Array([1, 2, 3]));

      await expect(
        validateSenderAddressForSigning(address)
      ).resolves.not.toThrow();
    });

    it('should throw error for non-decodable address', async () => {
      const address = 'invalid-address';
      // Configure the existing mock to throw
      decodeAddress.mockImplementation(() => {
        throw new Error('Invalid address');
      });

      await expect(
        validateSenderAddressForSigning(address)
      ).rejects.toThrow(AgentError);
    });
  });
});

