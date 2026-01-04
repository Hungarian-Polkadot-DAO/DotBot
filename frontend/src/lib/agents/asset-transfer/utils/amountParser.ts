/**
 * Amount Parsing Utilities
 * 
 * Provides amount parsing and formatting functions for transfer operations.
 */

import { BN } from '@polkadot/util';
import { TransferCapabilities } from './transferCapabilities';
import { AgentError } from '../../types';

/**
 * Parse and validate amount with chain-specific decimals
 * 
 * CRITICAL: This method MUST use the chain's actual decimals, not hardcoded 10!
 * According to GLOBAL RULE #9: AMOUNTS ARE ALWAYS BN INTERNALLY
 */
export function parseAndValidateAmountWithCapabilities(
  amount: string | number,
  capabilities: TransferCapabilities,
  index?: number
): BN {
  const amountBN = typeof amount === 'string' && amount.includes('.')
    ? parseAmount(amount, capabilities.nativeDecimals)
    : new BN(amount);

  if (amountBN.lte(new BN(0))) {
    const prefix = index !== undefined ? `Transfer ${index + 1}: ` : '';
    throw new AgentError(
      `${prefix}Transfer amount must be greater than zero`,
      'INVALID_AMOUNT',
      index !== undefined ? { index } : undefined
    );
  }

  return amountBN;
}

/**
 * Parse amount from human-readable format to Planck
 */
export function parseAmount(amount: string | number, decimals: number = 10): BN {
  const amountStr = typeof amount === 'number' ? amount.toString() : amount;
  const [whole, fraction = ''] = amountStr.split('.');
  const fractionPadded = fraction.padEnd(decimals, '0').slice(0, decimals);
  const wholeBN = new BN(whole || '0');
  const fractionBN = new BN(fractionPadded || '0');
  const divisor = new BN(10).pow(new BN(decimals));
  return wholeBN.mul(divisor).add(fractionBN);
}

/**
 * Format amount for display (convert from Planck to human-readable)
 */
export function formatAmount(amountBN: BN, decimals?: number): string {
  if (decimals === undefined) {
    decimals = 10;
  }
  const divisor = new BN(10).pow(new BN(decimals));
  const whole = amountBN.div(divisor).toString();
  const fraction = amountBN.mod(divisor).toString().padStart(decimals, '0');
  return `${whole}.${fraction}`;
}

