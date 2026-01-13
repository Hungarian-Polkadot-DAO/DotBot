/**
 * Execution Signer
 * 
 * Handles transaction signing and approval requests.
 */

import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { ExecutionItem, SigningRequest, BatchSigningRequest } from '../types';
import { Signer } from '../signers/types';
import { BrowserWalletSigner } from '../signers/browserSigner';
import { isBrowser } from '../../env';

// Lazy import for browser-only extension-dapp
async function getWeb3FromAddress(address: string) {
  if (!isBrowser()) {
    throw new Error('web3FromAddress can only be used in browser environment');
  }
  // Dynamic import - only loads in browser
  const { web3FromAddress } = await import('@polkadot/extension-dapp');
  return web3FromAddress(address);
}

export interface SigningContext {
  accountAddress: string;
  signer: Signer | null;
  signingRequestHandler?: (request: SigningRequest) => void;
  batchSigningRequestHandler?: (request: BatchSigningRequest) => void;
}

/**
 * Create signing request for approval
 */
export async function createSigningRequest(
  item: ExecutionItem,
  extrinsic: SubmittableExtrinsic<'promise'>,
  context: SigningContext
): Promise<boolean> {
  if (context.signer && context.signer.requestApproval) {
    const request: SigningRequest = {
      itemId: item.id,
      extrinsic,
      description: item.description,
      estimatedFee: item.estimatedFee,
      warnings: item.warnings,
      metadata: item.metadata,
      accountAddress: context.accountAddress,
      resolve: () => {},
    };
    return await context.signer.requestApproval(request);
  }

  if (!context.signingRequestHandler) {
    throw new Error('No signing request handler set');
  }

  return new Promise<boolean>((resolve) => {
    const request: SigningRequest = {
      itemId: item.id,
      extrinsic,
      description: item.description,
      estimatedFee: item.estimatedFee,
      warnings: item.warnings,
      metadata: item.metadata,
      accountAddress: context.accountAddress,
      resolve: (approved: boolean) => {
        resolve(approved);
      },
    };

    context.signingRequestHandler!(request);
  });
}

/**
 * Create batch signing request
 */
export async function createBatchSigningRequest(
  items: ExecutionItem[],
  batchExtrinsic: SubmittableExtrinsic<'promise'>,
  context: SigningContext
): Promise<boolean> {
  if (!context.batchSigningRequestHandler) {
    throw new Error('No batch signing request handler set');
  }

  return new Promise<boolean>((resolve) => {
    const totalFee = items.reduce((sum, item) => {
      if (item.estimatedFee) {
        return sum + BigInt(item.estimatedFee);
      }
      return sum;
    }, BigInt(0)).toString();

    const warnings = items
      .flatMap(item => item.warnings || [])
      .filter((w, i, arr) => arr.indexOf(w) === i);

    const request: BatchSigningRequest = {
      itemIds: items.map(item => item.id),
      extrinsic: batchExtrinsic,
      descriptions: items.map(item => item.description),
      estimatedFee: totalFee,
      warnings: warnings.length > 0 ? warnings : undefined,
      accountAddress: context.accountAddress,
      resolve: (approved: boolean) => {
        resolve(approved);
      },
    };

    context.batchSigningRequestHandler!(request);
  });
}

/**
 * Sign extrinsic using pluggable signer
 */
export async function signExtrinsic(
  extrinsic: SubmittableExtrinsic<'promise'>,
  address: string,
  signer: Signer | null
): Promise<SubmittableExtrinsic<'promise'>> {
  if (signer) {
    return await signer.signExtrinsic(extrinsic, address);
  }

  // Fallback to browser extension (only works in browser)
  if (!isBrowser()) {
    throw new Error('No signer provided and cannot use browser extension in Node.js environment');
  }
  
  const injector = await getWeb3FromAddress(address);
  return await extrinsic.signAsync(address, {
    // @ts-expect-error - Polkadot.js type mismatch
    signer: injector.signer,
  });
}

/**
 * Encode address for chain's SS58 format
 */
export async function encodeAddressForChain(
  address: string,
  ss58Format: number
): Promise<string> {
  const { encodeAddress, decodeAddress } = await import('@polkadot/util-crypto');
  const publicKey = decodeAddress(address);
  return encodeAddress(publicKey, ss58Format);
}

