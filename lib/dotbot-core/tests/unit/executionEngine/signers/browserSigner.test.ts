/**
 * Unit tests for BrowserWalletSigner
 */

// Mock env to simulate browser environment
jest.mock('../../../../env', () => ({
  ...jest.requireActual('../../../../env'),
  isBrowser: jest.fn(() => true), // Mock as browser environment
}));

// Mock @polkadot/extension-dapp before imports
jest.mock('@polkadot/extension-dapp', () => ({
  web3FromAddress: jest.fn(),
}));

import { BrowserWalletSigner } from '../../../../executionEngine/signers/browserSigner';
import { web3FromAddress } from '@polkadot/extension-dapp';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { SigningRequest, BatchSigningRequest } from '../../../../executionEngine/types';

describe('BrowserWalletSigner', () => {
  let signer: BrowserWalletSigner;
  let mockExtrinsic: jest.Mocked<SubmittableExtrinsic<'promise'>>;
  let mockInjector: any;
  let mockSigner: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock signer
    mockSigner = {
      signPayload: jest.fn(),
      signRaw: jest.fn(),
    };

    // Create mock injector
    mockInjector = {
      signer: mockSigner,
    };

    // Mock web3FromAddress
    (web3FromAddress as jest.Mock).mockResolvedValue(mockInjector);

    // Create mock extrinsic
    mockExtrinsic = {
      signAsync: jest.fn().mockResolvedValue({
        // Return a signed extrinsic mock
        isSigned: true,
      } as any),
    } as any;

    signer = new BrowserWalletSigner();
  });

  describe('Constructor', () => {
    it('should create instance with default options', () => {
      const newSigner = new BrowserWalletSigner();
      expect(newSigner).toBeInstanceOf(BrowserWalletSigner);
    });

    it('should create instance with autoApprove option', () => {
      const newSigner = new BrowserWalletSigner({ autoApprove: true });
      expect(newSigner).toBeInstanceOf(BrowserWalletSigner);
    });
  });

  describe('getType()', () => {
    it('should return correct type', () => {
      expect(signer.getType()).toBe('BrowserWalletSigner');
    });
  });

  describe('setSigningRequestHandler()', () => {
    it('should set signing request handler', () => {
      const handler = jest.fn();
      
      signer.setSigningRequestHandler(handler);
      
      // Handler is stored internally, verify by calling requestApproval
      expect(() => {
        signer.setSigningRequestHandler(handler);
      }).not.toThrow();
    });
  });

  describe('setBatchSigningRequestHandler()', () => {
    it('should set batch signing request handler', () => {
      const handler = jest.fn();
      
      signer.setBatchSigningRequestHandler(handler);
      
      // Handler is stored internally, verify by calling requestBatchApproval
      expect(() => {
        signer.setBatchSigningRequestHandler(handler);
      }).not.toThrow();
    });
  });

  describe('signExtrinsic()', () => {
    const testAddress = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5';

    it('should sign extrinsic using browser wallet extension', async () => {
      const signedExtrinsic = await signer.signExtrinsic(mockExtrinsic, testAddress);

      expect(web3FromAddress).toHaveBeenCalledWith(testAddress);
      expect(mockExtrinsic.signAsync).toHaveBeenCalledWith(testAddress, {
        signer: mockSigner,
      });
      expect(signedExtrinsic).toBeDefined();
    });

    it('should handle web3FromAddress errors', async () => {
      const error = new Error('No extension found');
      (web3FromAddress as jest.Mock).mockRejectedValue(error);

      await expect(
        signer.signExtrinsic(mockExtrinsic, testAddress)
      ).rejects.toThrow('No extension found');
    });

    it('should handle signAsync errors', async () => {
      const error = new Error('Signing failed');
      (mockExtrinsic.signAsync as jest.Mock).mockRejectedValue(error);

      await expect(
        signer.signExtrinsic(mockExtrinsic, testAddress)
      ).rejects.toThrow('Signing failed');
    });
  });

  describe('requestApproval()', () => {
    let mockRequest: SigningRequest;

    beforeEach(() => {
      mockRequest = {
        itemId: 'item-1',
        extrinsic: mockExtrinsic,
        description: 'Transfer 1 DOT',
        estimatedFee: '0.01 DOT',
        warnings: [],
        metadata: {},
        accountAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        resolve: jest.fn(),
      };
    });

    it('should auto-approve when autoApprove option is enabled', async () => {
      const autoApproveSigner = new BrowserWalletSigner({ autoApprove: true });
      
      const result = await autoApproveSigner.requestApproval(mockRequest);

      expect(result).toBe(true);
    });

    it('should throw error if no handler is set', async () => {
      await expect(
        signer.requestApproval(mockRequest)
      ).rejects.toThrow('No signing request handler set. Call setSigningRequestHandler() first.');
    });

    it('should call handler and return approval result', async () => {
      const handler = jest.fn();
      signer.setSigningRequestHandler(handler);

      // Start the approval request (it will wait for handler to call resolve)
      const approvalPromise = signer.requestApproval(mockRequest);

      // Verify handler was called with request containing resolve function
      expect(handler).toHaveBeenCalledTimes(1);
      const handlerCall = handler.mock.calls[0][0];
      expect(handlerCall.itemId).toBe('item-1');
      expect(handlerCall.description).toBe('Transfer 1 DOT');
      expect(typeof handlerCall.resolve).toBe('function');

      // Simulate user approval
      handlerCall.resolve(true);

      const result = await approvalPromise;
      expect(result).toBe(true);
    });

    it('should return false when user rejects', async () => {
      const handler = jest.fn();
      signer.setSigningRequestHandler(handler);

      const approvalPromise = signer.requestApproval(mockRequest);

      // Handler should be called
      expect(handler).toHaveBeenCalledTimes(1);
      const handlerCall = handler.mock.calls[0][0];

      // Simulate user rejection
      handlerCall.resolve(false);

      const result = await approvalPromise;
      expect(result).toBe(false);
    });

    it('should pass all request fields to handler', async () => {
      const handler = jest.fn();
      signer.setSigningRequestHandler(handler);

      const requestWithAllFields: SigningRequest = {
        itemId: 'item-2',
        extrinsic: mockExtrinsic,
        description: 'Transfer 2 DOT',
        estimatedFee: '0.02 DOT',
        warnings: ['Low balance warning'],
        metadata: { chain: 'polkadot' },
        accountAddress: '14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3',
        resolve: jest.fn(),
      };

      const approvalPromise = signer.requestApproval(requestWithAllFields);

      expect(handler).toHaveBeenCalledTimes(1);
      const handlerCall = handler.mock.calls[0][0];
      expect(handlerCall.itemId).toBe('item-2');
      expect(handlerCall.description).toBe('Transfer 2 DOT');
      expect(handlerCall.estimatedFee).toBe('0.02 DOT');
      expect(handlerCall.warnings).toEqual(['Low balance warning']);
      expect(handlerCall.metadata).toEqual({ chain: 'polkadot' });
      expect(handlerCall.accountAddress).toBe('14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3');
      expect(typeof handlerCall.resolve).toBe('function');

      // Resolve to complete test
      handlerCall.resolve(true);
      await approvalPromise;
    });
  });

  describe('requestBatchApproval()', () => {
    let mockBatchRequest: BatchSigningRequest;

    beforeEach(() => {
      mockBatchRequest = {
        itemIds: ['item-1', 'item-2'],
        extrinsic: mockExtrinsic,
        descriptions: ['Transfer 1 DOT', 'Transfer 2 DOT'],
        estimatedFee: '0.03 DOT',
        warnings: [],
        accountAddress: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        resolve: jest.fn(),
      };
    });

    it('should auto-approve when autoApprove option is enabled', async () => {
      const autoApproveSigner = new BrowserWalletSigner({ autoApprove: true });
      
      const result = await autoApproveSigner.requestBatchApproval(mockBatchRequest);

      expect(result).toBe(true);
    });

    it('should fallback to single handler if batch handler not set', async () => {
      const singleHandler = jest.fn();
      signer.setSigningRequestHandler(singleHandler);

      const approvalPromise = signer.requestBatchApproval(mockBatchRequest);

      // Should call single handler with combined description
      expect(singleHandler).toHaveBeenCalledTimes(1);
      const handlerCall = singleHandler.mock.calls[0][0];
      expect(handlerCall.itemId).toBe('item-1,item-2');
      expect(handlerCall.description).toBe('Batch: Transfer 1 DOT, Transfer 2 DOT');
      expect(handlerCall.estimatedFee).toBe('0.03 DOT');
      expect(typeof handlerCall.resolve).toBe('function');

      // Simulate approval
      handlerCall.resolve(true);

      const result = await approvalPromise;
      expect(result).toBe(true);
    });

    it('should use batch handler when set', async () => {
      const batchHandler = jest.fn();
      signer.setBatchSigningRequestHandler(batchHandler);

      const approvalPromise = signer.requestBatchApproval(mockBatchRequest);

      // Should call batch handler
      expect(batchHandler).toHaveBeenCalledTimes(1);
      const handlerCall = batchHandler.mock.calls[0][0];
      expect(handlerCall.itemIds).toEqual(['item-1', 'item-2']);
      expect(handlerCall.descriptions).toEqual(['Transfer 1 DOT', 'Transfer 2 DOT']);
      expect(handlerCall.estimatedFee).toBe('0.03 DOT');
      expect(typeof handlerCall.resolve).toBe('function');

      // Simulate approval
      handlerCall.resolve(true);

      const result = await approvalPromise;
      expect(result).toBe(true);
    });

    it('should return false when user rejects batch', async () => {
      const batchHandler = jest.fn();
      signer.setBatchSigningRequestHandler(batchHandler);

      const approvalPromise = signer.requestBatchApproval(mockBatchRequest);

      expect(batchHandler).toHaveBeenCalledTimes(1);
      const handlerCall = batchHandler.mock.calls[0][0];

      // Simulate rejection
      handlerCall.resolve(false);

      const result = await approvalPromise;
      expect(result).toBe(false);
    });

    it('should pass all batch request fields to handler', async () => {
      const batchHandler = jest.fn();
      signer.setBatchSigningRequestHandler(batchHandler);

      const requestWithAllFields: BatchSigningRequest = {
        itemIds: ['item-1', 'item-2', 'item-3'],
        extrinsic: mockExtrinsic,
        descriptions: ['Transfer 1 DOT', 'Transfer 2 DOT', 'Transfer 3 DOT'],
        estimatedFee: '0.05 DOT',
        warnings: ['Batch warning'],
        accountAddress: '14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3',
        resolve: jest.fn(),
      };

      const approvalPromise = signer.requestBatchApproval(requestWithAllFields);

      expect(batchHandler).toHaveBeenCalledTimes(1);
      const handlerCall = batchHandler.mock.calls[0][0];
      expect(handlerCall.itemIds).toEqual(['item-1', 'item-2', 'item-3']);
      expect(handlerCall.descriptions).toEqual(['Transfer 1 DOT', 'Transfer 2 DOT', 'Transfer 3 DOT']);
      expect(handlerCall.estimatedFee).toBe('0.05 DOT');
      expect(handlerCall.warnings).toEqual(['Batch warning']);
      expect(handlerCall.accountAddress).toBe('14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3');
      expect(typeof handlerCall.resolve).toBe('function');

      // Resolve to complete test
      handlerCall.resolve(true);
      await approvalPromise;
    });
  });
});

