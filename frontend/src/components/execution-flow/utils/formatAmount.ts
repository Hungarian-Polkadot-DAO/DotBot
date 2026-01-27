/**
 * UI amount formatting utilities
 * Wraps core formatAmount from amountParser.ts with network detection and token symbols
 */

import { BN } from '@polkadot/util';
import { formatAmount as formatAmountCore } from '@dotbot/core/agents/asset-transfer/utils/amountParser';
import { detectNetworkFromChainName, getNetworkDecimals, getNetworkTokenSymbol } from '@dotbot/core/prompts/system/knowledge/networkUtils';
import type { Network } from '@dotbot/core/prompts/system/knowledge/types';

export function formatAmount(
  planck: string,
  chain?: string | null,
  network?: Network,
  decimalPlaces: number = 2
): string {
  try {
    const bn = new BN(planck);
    
    let detectedNetwork: Network = 'polkadot';
    if (network) {
      detectedNetwork = network;
    } else if (chain) {
      detectedNetwork = detectNetworkFromChainName(chain);
    }
    
    const decimals = getNetworkDecimals(detectedNetwork);
    const tokenSymbol = getNetworkTokenSymbol(detectedNetwork);
    
    if (bn.isZero()) {
      return `0 ${tokenSymbol}`;
    }
    
    const minDisplay = new BN(10).pow(new BN(decimals - decimalPlaces));
    if (bn.lt(minDisplay)) {
      const minValue = (1 / Math.pow(10, decimalPlaces)).toFixed(decimalPlaces);
      return `< ${minValue} ${tokenSymbol}`;
    }
    
    const formattedNumber = formatAmountCore(bn, decimals);
    const parts = formattedNumber.split('.');
    let finalNumber: string;
    
    if (parts.length === 1) {
      finalNumber = decimalPlaces > 0 ? `${parts[0]}.${'0'.repeat(decimalPlaces)}` : parts[0];
    } else {
      const currentDecimals = parts[1].length;
      if (currentDecimals < decimalPlaces) {
        finalNumber = `${parts[0]}.${parts[1].padEnd(decimalPlaces, '0')}`;
      } else if (currentDecimals > decimalPlaces) {
        finalNumber = `${parts[0]}.${parts[1].slice(0, decimalPlaces)}`;
      } else {
        finalNumber = formattedNumber;
      }
    }
    
    return `${finalNumber} ${tokenSymbol}`;
  } catch (error) {
    let tokenSymbol = 'DOT';
    try {
      if (chain) {
        tokenSymbol = getNetworkTokenSymbol(detectNetworkFromChainName(chain));
      } else if (network) {
        tokenSymbol = getNetworkTokenSymbol(network);
      }
    } catch {
      // Keep default DOT
    }
    
    return `${planck} ${tokenSymbol} (raw)`;
  }
}

export function formatAmountFromItem(
  planck: string,
  metadata?: Record<string, any>,
  chainFromSimulation?: string | null,
  decimalPlaces: number = 2
): string {
  const chain = (metadata?.chain as string | undefined) || chainFromSimulation || undefined;
  const network = metadata?.network as Network | undefined;
  return formatAmount(planck, chain, network, decimalPlaces);
}

export function formatFee(
  planck: string,
  chain?: string | null,
  network?: Network
): string {
  return formatAmount(planck, chain, network, 6);
}

export function formatFeeFromItem(
  planck: string,
  metadata?: Record<string, any>,
  chainFromSimulation?: string | null
): string {
  return formatAmountFromItem(planck, metadata, chainFromSimulation, 6);
}
