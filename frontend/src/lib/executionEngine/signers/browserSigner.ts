/**
 * Browser Wallet Signer
 * 
 * Uses browser wallet extensions (Polkadot.js, Talisman, SubWallet, etc.)
 * Only works in browser environment.
 */

import { SubmittableExtrinsic } from '@polkadot/api/types';
import { web3FromAddress } from '@polkadot/extension-dapp';
import { Signer, SignerOptions } from './types';
import { SigningRequest, BatchSigningRequest } from '../types';

/**
 * Browser Wallet Signer
 * 
 * Uses browser wallet extensions for signing.
 * Requires user to have wallet extension installed.
 */
export class BrowserWalletSigner implements Signer {
  private signingRequestHandler?: (request: SigningRequest) => void;
  private batchSigningRequestHandler?: (request: BatchSigningRequest) => void;
  private options: SignerOptions;
  
  constructor(options: SignerOptions = {}) {
    this.options = options;
  }
  
  /**
   * Set handler for signing requests (shows UI modal)
   */
  setSigningRequestHandler(handler: (request: SigningRequest) => void): void {
    this.signingRequestHandler = handler;
  }
  
  /**
   * Set handler for batch signing requests
   */
  setBatchSigningRequestHandler(handler: (request: BatchSigningRequest) => void): void {
    this.batchSigningRequestHandler = handler;
  }
  
  async signExtrinsic(
    extrinsic: SubmittableExtrinsic<'promise'>,
    address: string
  ): Promise<SubmittableExtrinsic<'promise'>> {
    const injector = await web3FromAddress(address);
    return await extrinsic.signAsync(address, {
      // @ts-expect-error - Polkadot.js type mismatch between @polkadot/extension-inject and @polkadot/api versions
      signer: injector.signer,
    });
  }
  
  async requestApproval(request: SigningRequest): Promise<boolean> {
    if (this.options.autoApprove) {
      return true;
    }
    
    if (!this.signingRequestHandler) {
      throw new Error('No signing request handler set. Call setSigningRequestHandler() first.');
    }
    
    return new Promise<boolean>((resolve) => {
      const resolveWrapper = (approved: boolean) => {
        resolve(approved);
      };
      
      this.signingRequestHandler!({
        ...request,
        resolve: resolveWrapper,
      });
    });
  }
  
  async requestBatchApproval(request: BatchSigningRequest): Promise<boolean> {
    if (this.options.autoApprove) {
      return true;
    }
    
    if (!this.batchSigningRequestHandler) {
      // Fall back to single signing handler
      return this.requestApproval({
        itemId: request.itemIds.join(','),
        extrinsic: request.extrinsic,
        description: `Batch: ${request.descriptions.join(', ')}`,
        estimatedFee: request.estimatedFee,
        warnings: request.warnings,
        metadata: {},
        accountAddress: request.accountAddress,
        resolve: () => {},
      });
    }
    
    return new Promise<boolean>((resolve) => {
      const resolveWrapper = (approved: boolean) => {
        resolve(approved);
      };
      
      this.batchSigningRequestHandler!({
        ...request,
        resolve: resolveWrapper,
      });
    });
  }
  
  getType(): string {
    return 'BrowserWalletSigner';
  }
}


