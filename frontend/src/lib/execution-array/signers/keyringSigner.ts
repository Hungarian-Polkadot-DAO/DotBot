/**
 * Keyring Signer
 * 
 * Uses Polkadot Keyring for signing (terminal, backend, tests).
 * Works anywhere Node.js/JavaScript runs.
 */

import { SubmittableExtrinsic } from '@polkadot/api/types';
import { Keyring } from '@polkadot/keyring';
import { KeyringPair } from '@polkadot/keyring/types';
import { Signer, SignerOptions } from './types';
import { SigningRequest, BatchSigningRequest } from '../types';

/**
 * Keyring Signer
 * 
 * Uses Polkadot Keyring for signing.
 * Perfect for:
 * - Terminal/CLI applications
 * - Backend services
 * - Testing
 * - Automated scripts
 */
export class KeyringSigner implements Signer {
  private keyringPair: KeyringPair;
  private options: SignerOptions;
  
  /**
   * Create a keyring signer
   * 
   * @param keyringPair Keyring pair (from Keyring.addFromUri, etc.)
   * @param options Signer options
   */
  constructor(keyringPair: KeyringPair, options: SignerOptions = {}) {
    this.keyringPair = keyringPair;
    this.options = options;
  }
  
  /**
   * Create from mnemonic (seed phrase)
   * 
   * @param mnemonic Seed phrase
   * @param type Key type ('sr25519' or 'ed25519')
   * @param options Signer options
   */
  static fromMnemonic(
    mnemonic: string,
    type: 'sr25519' | 'ed25519' = 'sr25519',
    options: SignerOptions = {}
  ): KeyringSigner {
    const keyring = new Keyring({ type });
    const pair = keyring.addFromMnemonic(mnemonic);
    return new KeyringSigner(pair, options);
  }
  
  /**
   * Create from URI (mnemonic, hex seed, etc.)
   * 
   * @param uri URI string
   * @param type Key type
   * @param options Signer options
   */
  static fromUri(
    uri: string,
    type: 'sr25519' | 'ed25519' = 'sr25519',
    options: SignerOptions = {}
  ): KeyringSigner {
    const keyring = new Keyring({ type });
    const pair = keyring.addFromUri(uri);
    return new KeyringSigner(pair, options);
  }
  
  async signExtrinsic(
    extrinsic: SubmittableExtrinsic<'promise'>,
    address: string
  ): Promise<SubmittableExtrinsic<'promise'>> {
    // Verify address matches
    if (this.keyringPair.address !== address) {
      throw new Error(
        `Address mismatch: keyring has ${this.keyringPair.address}, requested ${address}`
      );
    }
    
    // Sign with keyring
    return await extrinsic.signAsync(this.keyringPair);
  }
  
  async requestApproval(request: SigningRequest): Promise<boolean> {
    // Keyring signer is typically auto-approve (no UI)
    // But can be configured to require approval
    if (this.options.autoApprove !== false) {
      console.log(`[KeyringSigner] Auto-approving: ${request.description}`);
      return true;
    }
    
    // If custom approval is needed, throw error
    throw new Error(
      'KeyringSigner requires autoApprove option or custom approval handler'
    );
  }
  
  async requestBatchApproval(request: BatchSigningRequest): Promise<boolean> {
    if (this.options.autoApprove !== false) {
      console.log(`[KeyringSigner] Auto-approving batch: ${request.descriptions.join(', ')}`);
      return true;
    }
    
    throw new Error(
      'KeyringSigner requires autoApprove option or custom approval handler'
    );
  }
  
  getType(): string {
    return 'KeyringSigner';
  }
  
  /**
   * Get the keyring pair address
   */
  getAddress(): string {
    return this.keyringPair.address;
  }
}


