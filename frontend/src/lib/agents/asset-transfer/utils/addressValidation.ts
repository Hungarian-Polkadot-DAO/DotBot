/**
 * Address Validation Utilities
 * 
 * Provides address validation functions for transfer operations.
 */

import { isAddress, decodeAddress } from '@polkadot/util-crypto';
import { AgentError } from '../../types';

export interface AddressValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a single address
 */
export function validateAddress(address: string): AddressValidationResult {
  const errors: string[] = [];

  if (!address || address.trim().length === 0) {
    errors.push('Address is required');
    return { valid: false, errors };
  }

  try {
    if (!isAddress(address)) {
      errors.push(`Invalid address format: ${address}`);
      return { valid: false, errors };
    }

    decodeAddress(address);
  } catch (error) {
    errors.push(`Address validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}

/**
 * Validate sender and recipient addresses for a transfer
 */
export function validateTransferAddresses(sender: string, recipient: string): void {
  const senderValidation = validateAddress(sender);
  if (!senderValidation.valid) {
    throw new AgentError(
      `Invalid sender address: ${senderValidation.errors.join(', ')}`,
      'INVALID_SENDER_ADDRESS',
      { errors: senderValidation.errors }
    );
  }

  const recipientValidation = validateAddress(recipient);
  if (!recipientValidation.valid) {
    throw new AgentError(
      `Invalid recipient address: ${recipientValidation.errors.join(', ')}`,
      'INVALID_RECIPIENT_ADDRESS',
      { errors: recipientValidation.errors }
    );
  }

  if (sender === recipient) {
    throw new AgentError(
      'Sender and recipient addresses cannot be the same',
      'SAME_SENDER_RECIPIENT'
    );
  }
}

/**
 * Validate sender address
 */
export function validateSenderAddress(address: string): void {
  const validation = validateAddress(address);
  if (!validation.valid) {
    throw new AgentError(
      `Invalid sender address: ${validation.errors.join(', ')}`,
      'INVALID_SENDER_ADDRESS',
      { errors: validation.errors }
    );
  }
}

/**
 * Validate that sender address is decodable (for signature compatibility)
 * CRITICAL: Sender address MUST NOT be re-encoded! It must match the wallet format
 * exactly, otherwise the signature won't validate.
 */
export async function validateSenderAddressForSigning(address: string): Promise<void> {
  const { decodeAddress } = await import('@polkadot/util-crypto');
  
  try {
    decodeAddress(address);
  } catch (error) {
    throw new AgentError(
      `Invalid sender address: ${address}`,
      'INVALID_ADDRESS',
      { address, error: error instanceof Error ? error.message : String(error) }
    );
  }
}

