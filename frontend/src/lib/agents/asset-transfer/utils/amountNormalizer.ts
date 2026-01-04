/**
 * Amount Normalization Utilities
 * 
 * Provides amount conversion functions for different input formats.
 */

import { BN } from '@polkadot/util';
import { TransferCapabilities } from './transferCapabilities';

/**
 * Normalize amount to BN, handling different input formats
 * 
 * Accepts:
 * - BN object (passthrough)
 * - Number (converted to BN)
 * - String integer: "15000000000" (converted to BN)
 * - String decimal: "1.5" (converted to Planck using chain decimals)
 * 
 * @param amount Amount in various formats
 * @param capabilities Chain capabilities for decimal conversion
 * @returns Amount as BN in smallest unit (Planck)
 */
export function normalizeAmountToBN(
  amount: string | number | BN,
  capabilities: TransferCapabilities
): BN {
  if (BN.isBN(amount)) {
    return amount;
  }

  if (typeof amount === 'number') {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new Error(`Invalid amount: ${amount}. Must be a positive integer in Planck.`);
    }
    return new BN(amount);
  }

  if (typeof amount === 'string') {
    if (amount.includes('.')) {
      const [whole, decimal] = amount.split('.');
      const decimalPlaces = decimal.length;

      if (decimalPlaces > capabilities.nativeDecimals) {
        throw new Error(
          `Too many decimal places in amount: ${amount}. ` +
          `Maximum for ${capabilities.nativeTokenSymbol}: ${capabilities.nativeDecimals}`
        );
      }

      const multiplier = new BN(10).pow(new BN(capabilities.nativeDecimals));
      const wholeBN = new BN(whole || '0').mul(multiplier);
      const decimalBN = new BN(decimal).mul(
        new BN(10).pow(new BN(capabilities.nativeDecimals - decimalPlaces))
      );

      return wholeBN.add(decimalBN);
    }

    if (!/^\d+$/.test(amount)) {
      throw new Error(`Invalid amount format: ${amount}. Must be integer or decimal string.`);
    }

    return new BN(amount);
  }

  throw new Error(`Unsupported amount type: ${typeof amount}`);
}

