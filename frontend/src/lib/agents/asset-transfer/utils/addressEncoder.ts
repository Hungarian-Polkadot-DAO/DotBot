/**
 * Address Encoding Utilities
 * 
 * Provides address encoding functions for chain-specific SS58 formats.
 */

import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { TransferCapabilities } from './transferCapabilities';

/**
 * Encode address for chain's SS58 format
 * 
 * CRITICAL: Addresses must be in the correct SS58 format for the target chain.
 * Using wrong format causes runtime panics (wasm unreachable errors).
 * 
 * @param address Address in any valid SS58 format
 * @param capabilities Chain capabilities
 * @returns Address encoded for chain's SS58 prefix
 */
export function encodeRecipientAddress(
  address: string,
  capabilities: TransferCapabilities
): string {
  try {
    const publicKey = decodeAddress(address);
    const encoded = encodeAddress(publicKey, capabilities.ss58Prefix);
    return encoded;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid address: ${address}. Error: ${errorMessage}`);
  }
}

/**
 * Validate address format
 */
export function validateAddressFormat(address: string): boolean {
  try {
    decodeAddress(address);
    return true;
  } catch {
    return false;
  }
}

