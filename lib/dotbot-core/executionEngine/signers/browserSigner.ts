/**
 * Browser Wallet Signer
 * 
 * Uses browser wallet extensions (Polkadot.js, Talisman, SubWallet, etc.)
 * Only works in browser environment.
 */

import { SubmittableExtrinsic } from '@polkadot/api/types';
import { Signer, SignerOptions } from './types';
import { SigningRequest, BatchSigningRequest } from '../types';
import { isBrowser } from '../../env';

// Lazy import for browser-only extension-dapp
async function getWeb3FromAddress(address: string) {
  if (!isBrowser()) {
    throw new Error('BrowserWalletSigner can only be used in browser environment');
  }
  // Dynamic import - only loads in browser
  const { web3FromAddress } = await import('@polkadot/extension-dapp');
  return web3FromAddress(address);
}

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
    if (!isBrowser()) {
      throw new Error('BrowserWalletSigner can only be used in browser environment');
    }
    const injector = await getWeb3FromAddress(address);
    return await extrinsic.signAsync(address, {
      // @ts-expect-error - Polkadot.js type mismatch between @polkadot/extension-inject and @polkadot/api versions
      signer: injector.signer,
    });
  }
  
  async requestApproval(request: SigningRequest): Promise<boolean> {
    console.log('[BrowserWalletSigner] 🔐 requestApproval called:', {
      itemId: request.itemId,
      description: request.description,
      autoApprove: this.options.autoApprove,
      hasHandler: !!this.signingRequestHandler,
    });
    
    if (this.options.autoApprove) {
      console.log('[BrowserWalletSigner] ✅ Auto-approve enabled, approving immediately');
      return true;
    }
    
    if (!this.signingRequestHandler) {
      throw new Error('No signing request handler set. Call setSigningRequestHandler() first.');
    }
    
    console.log('[BrowserWalletSigner] 📝 Creating signing request and calling handler...');
    return new Promise<boolean>((resolve) => {
      const resolveWrapper = (approved: boolean) => {
        console.log(`[BrowserWalletSigner] ✅ Signing request resolved: approved=${approved}`);
        resolve(approved);
      };
      
      const requestWithResolve = {
        ...request,
        resolve: resolveWrapper,
      };
      console.log('requestWithResolve', requestWithResolve);
      console.log('[BrowserWalletSigner] 📤 Calling signing request handler with request:', {
        itemId: requestWithResolve.itemId,
        description: requestWithResolve.description,
        hasResolve: typeof requestWithResolve.resolve === 'function',
      });
      
      this.signingRequestHandler!(requestWithResolve);
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


