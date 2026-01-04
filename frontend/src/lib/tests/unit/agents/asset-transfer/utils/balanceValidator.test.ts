/**
 * Unit tests for Balance Validator Utilities
 */

import {
  validateBalance,
  checkAccountExists,
  checkAccountReapingRisk,
} from '../../../../../agents/asset-transfer/utils/balanceValidator';
import { TransferCapabilities } from '../../../../../agents/asset-transfer/utils/transferCapabilities';
import { AgentError } from '../../../../../agents/types';
import { ApiPromise } from '@polkadot/api';
import { BN } from '@polkadot/util';

describe('Balance Validator Utilities', () => {
  let mockApi: Partial<ApiPromise>;
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

    mockApi = {
      query: {
        system: {
          account: jest.fn(),
        },
      },
    } as any;
  });

  describe('validateBalance()', () => {
    it('should validate sufficient balance', async () => {
      const address = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
      const amount = new BN('1000000000000'); // 1 DOT
      const fee = new BN('1000000000'); // 0.001 DOT

      const mockAccountData = {
        data: {
          free: { toString: () => '2000000000000' }, // 2 DOT
          reserved: { toString: () => '0' },
          frozen: { toString: () => '0' },
        },
        nonce: { toString: () => '5' },
      };

      (mockApi.query!.system!.account as any).mockResolvedValue(mockAccountData);

      const result = await validateBalance(
        mockApi as ApiPromise,
        address,
        amount,
        fee,
        mockCapabilities
      );

      expect(result.sufficient).toBe(true);
      expect(result.available.toString()).toBe('2000000000000');
      expect(result.required.toString()).toBe('1001000000000'); // amount + fee
    });

    it('should throw error for insufficient balance', async () => {
      const address = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
      const amount = new BN('2000000000000'); // 2 DOT
      const fee = new BN('1000000000'); // 0.001 DOT

      const mockAccountData = {
        data: {
          free: { toString: () => '1000000000000' }, // 1 DOT (insufficient)
          reserved: { toString: () => '0' },
          frozen: { toString: () => '0' },
        },
        nonce: { toString: () => '5' },
      };

      (mockApi.query!.system!.account as any).mockResolvedValue(mockAccountData);

      await expect(
        validateBalance(mockApi as ApiPromise, address, amount, fee, mockCapabilities)
      ).rejects.toThrow(AgentError);
    });

    it('should throw error for non-existent account', async () => {
      const address = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
      const amount = new BN('1000000000000');
      const fee = new BN('1000000000');

      const mockAccountData = {
        data: {
          free: { toString: () => '0' },
          reserved: { toString: () => '0' },
          frozen: { toString: () => '0' },
        },
        nonce: { toString: () => '0' },
      };

      (mockApi.query!.system!.account as any).mockResolvedValue(mockAccountData);

      await expect(
        validateBalance(mockApi as ApiPromise, address, amount, fee, mockCapabilities)
      ).rejects.toThrow(AgentError);
    });

    it('should skip balance validation if validateBalance is false', async () => {
      const address = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
      const amount = new BN('2000000000000');
      const fee = new BN('1000000000');

      const mockAccountData = {
        data: {
          free: { toString: () => '1000000000000' }, // Insufficient, but validation skipped
          reserved: { toString: () => '0' },
          frozen: { toString: () => '0' },
        },
        nonce: { toString: () => '5' },
      };

      (mockApi.query!.system!.account as any).mockResolvedValue(mockAccountData);

      const result = await validateBalance(
        mockApi as ApiPromise,
        address,
        amount,
        fee,
        mockCapabilities,
        false // Skip validation
      );

      expect(result.sufficient).toBe(true); // Validation skipped
    });
  });

  describe('checkAccountExists()', () => {
    it('should return true if account has balance', async () => {
      const address = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

      const mockAccountData = {
        data: {
          free: { toString: () => '1000000000000' },
        },
        nonce: { toString: () => '0' },
      };

      (mockApi.query!.system!.account as any).mockResolvedValue(mockAccountData);

      const exists = await checkAccountExists(mockApi as ApiPromise, address);

      expect(exists).toBe(true);
    });

    it('should return true if account has nonce', async () => {
      const address = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

      const mockAccountData = {
        data: {
          free: { toString: () => '0' },
        },
        nonce: { toString: () => '5' },
      };

      (mockApi.query!.system!.account as any).mockResolvedValue(mockAccountData);

      const exists = await checkAccountExists(mockApi as ApiPromise, address);

      expect(exists).toBe(true);
    });

    it('should return false if account has no balance and no nonce', async () => {
      const address = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

      const mockAccountData = {
        data: {
          free: { toString: () => '0' },
        },
        nonce: { toString: () => '0' },
      };

      (mockApi.query!.system!.account as any).mockResolvedValue(mockAccountData);

      const exists = await checkAccountExists(mockApi as ApiPromise, address);

      expect(exists).toBe(false);
    });
  });

  describe('checkAccountReapingRisk()', () => {
    it('should return null if keepAlive is true', () => {
      const availableBN = new BN('1000000000000');
      const amountBN = new BN('500000000000');
      const feeBN = new BN('1000000000');
      const edBN = new BN('10000000000');

      const result = checkAccountReapingRisk(
        availableBN,
        amountBN,
        feeBN,
        edBN,
        true, // keepAlive
        mockCapabilities
      );

      expect(result).toBeNull();
    });

    it('should return warning if balance after transfer is below ED', () => {
      const availableBN = new BN('10000000000'); // 0.01 DOT
      const amountBN = new BN('5000000000'); // 0.005 DOT
      const feeBN = new BN('1000000000'); // 0.001 DOT
      const edBN = new BN('10000000000'); // 0.01 DOT

      // After transfer: 0.01 - 0.005 - 0.001 = 0.004 DOT < 0.01 ED
      const result = checkAccountReapingRisk(
        availableBN,
        amountBN,
        feeBN,
        edBN,
        false,
        mockCapabilities
      );

      expect(result).not.toBeNull();
      expect(result).toContain('ACCOUNT REAPING RISK');
      expect(result).toContain('Existential Deposit');
    });

    it('should return null if balance after transfer is above ED', () => {
      const availableBN = new BN('1000000000000'); // 1 DOT
      const amountBN = new BN('500000000000'); // 0.5 DOT
      const feeBN = new BN('1000000000'); // 0.001 DOT
      const edBN = new BN('10000000000'); // 0.01 DOT

      // After transfer: 1 - 0.5 - 0.001 = 0.499 DOT > 0.01 ED
      const result = checkAccountReapingRisk(
        availableBN,
        amountBN,
        feeBN,
        edBN,
        false,
        mockCapabilities
      );

      expect(result).toBeNull();
    });
  });
});

