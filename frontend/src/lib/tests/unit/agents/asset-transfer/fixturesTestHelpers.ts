/**
 * Test Fixtures and Mocks for AssetTransferAgent
 * 
 * This file is excluded from test runs (see package.json jest.testPathIgnorePatterns)
 */

import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { BN } from '@polkadot/util';

/**
 * Valid test addresses (SS58 format)
 */
export const TEST_ADDRESSES = {
  ALICE: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
  BOB: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
  CHARLIE: '5FLSigC9HGRKVhB9F7s3C6qNK8p7tvYwDDeYNP83mZ4pzH9i',
};

/**
 * Invalid test addresses
 */
export const INVALID_ADDRESSES = {
  EMPTY: '',
  TOO_SHORT: '5Grwva',
  INVALID_CHARS: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY!!!',
  NOT_SS58: '0x1234567890abcdef',
};

/**
 * Test amounts (in Planck - smallest unit)
 */
export const TEST_AMOUNTS = {
  ONE_DOT: '10000000000', // 1 DOT
  HALF_DOT: '5000000000', // 0.5 DOT
  ONE_PLANCK: '1',
  ZERO: '0',
  NEGATIVE: '-10000000000',
};

/**
 * Test amounts (human-readable)
 */
export const TEST_AMOUNTS_HUMAN = {
  ONE_DOT: '1.0',
  HALF_DOT: '0.5',
  SMALL: '0.0001',
};

/**
 * Create a mock extrinsic
 */
export function createMockExtrinsic(
  method: string = 'transfer',
  pallet: string = 'balances'
): SubmittableExtrinsic<'promise'> {
  const mockExtrinsic = {
    method: {
      method,
      section: pallet,
    },
    paymentInfo: jest.fn().mockResolvedValue({
      partialFee: new BN(1000000000), // 0.001 DOT
      weight: new BN(1000000),
    }),
    signAndSend: jest.fn(),
    toHex: jest.fn().mockReturnValue('0x1234'),
    toString: jest.fn().mockReturnValue(`${pallet}.${method}`),
  } as any;

  return mockExtrinsic;
}

/**
 * Create a mock Polkadot API instance
 */
export function createMockApi(isAssetHub: boolean = false): Partial<ApiPromise> {
  const mockTransfer = createMockExtrinsic('transfer', 'balances');
  const mockTransferKeepAlive = createMockExtrinsic('transferKeepAlive', 'balances');
  const mockBatch = createMockExtrinsic('batch', 'utility');
  const mockBatchAll = createMockExtrinsic('batchAll', 'utility');

  // Mock account data
  const mockAccountData = {
    data: {
      free: new BN(100000000000), // 10 DOT
      reserved: new BN(0),
      frozen: new BN(0),
    },
  };

  const chainName = isAssetHub ? 'Polkadot Asset Hub' : 'Polkadot';
  const specName = isAssetHub ? 'statemint' : 'polkadot';

  return {
    tx: {
      balances: {
        transfer: jest.fn().mockReturnValue(mockTransfer),
        transferKeepAlive: jest.fn().mockReturnValue(mockTransferKeepAlive),
      },
      utility: {
        batch: jest.fn().mockReturnValue(mockBatch),
        batchAll: jest.fn().mockReturnValue(mockBatchAll),
      },
    },
    query: {
      system: {
        account: jest.fn().mockResolvedValue(mockAccountData),
      },
    },
    registry: {
      chainTokens: ['DOT'],
      chainDecimals: [10],
      chainSS58: 0,
    },
    runtimeChain: {
      toString: () => chainName,
    },
    consts: {
      balances: {
        existentialDeposit: new BN(100000000), // 0.01 DOT
      },
    },
    runtimeVersion: {
      specName: { toString: () => specName },
      specVersion: { toNumber: () => 1000 },
    },
    rpc: {
      state: {
        getRuntimeVersion: jest.fn().mockResolvedValue({
          specName: { toString: () => specName },
          specVersion: { toNumber: () => 1000 },
        }),
      },
    },
    isReady: Promise.resolve(),
  } as any;
}

/**
 * Create mock balance data
 */
export function createMockBalanceData(balance: string = '100000000000') {
  const balanceBN = new BN(balance);
  return {
    data: {
      free: balanceBN,
      reserved: new BN(0),
      frozen: new BN(0),
    },
  };
}

/**
 * Create mock balance data with insufficient balance
 */
export function createMockInsufficientBalance() {
  return {
    data: {
      free: new BN(1000000000), // 0.1 DOT
      reserved: new BN(0),
      frozen: new BN(0),
    },
  };
}


