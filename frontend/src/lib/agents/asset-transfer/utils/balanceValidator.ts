/**
 * Balance Validation Utilities
 * 
 * Provides balance validation functions for transfer operations.
 */

import { ApiPromise } from '@polkadot/api';
import { BN } from '@polkadot/util';
import { TransferCapabilities } from './transferCapabilities';
import { AgentError } from '../../types';
import { formatAmount } from './amountParser';

export interface BalanceValidationResult {
  sufficient: boolean;
  available: BN;
  required: BN;
  accountExists: boolean;
  free: BN;
  reserved: BN;
  frozen: BN;
  nonce: string;
}

/**
 * Validate balance and account existence
 */
export async function validateBalance(
  api: ApiPromise,
  address: string,
  amount: BN,
  fee: BN,
  capabilities: TransferCapabilities,
  validateBalance: boolean = true
): Promise<BalanceValidationResult> {
  const balance = await api.query.system.account(address);
  const balanceData = balance as any;
  const availableBN = new BN(balanceData.data?.free?.toString() || '0');
  const reservedBN = new BN(balanceData.data?.reserved?.toString() || '0');
  const frozenBN = new BN(balanceData.data?.frozen?.toString() || '0');
  const nonce = balanceData.nonce?.toString() || '0';

  const accountExists = availableBN.gt(new BN(0)) || new BN(nonce).gt(new BN(0));

  if (!accountExists) {
    throw new AgentError(
      `Account ${address.slice(0, 8)}...${address.slice(-8)} does not exist on ${capabilities.chainName}. ` +
      `After the November 2025 migration, you need to receive DOT on Asset Hub before you can send. ` +
      `Free balance: ${availableBN.toString()}, Nonce: ${nonce}`,
      'ACCOUNT_NOT_EXISTS',
      {
        chain: capabilities.chainName,
        address,
        free: availableBN.toString(),
        nonce,
      }
    );
  }

  const totalRequired = amount.add(fee);
  const sufficient = !validateBalance || availableBN.gte(totalRequired);

  if (!sufficient) {
    throw new AgentError(
      `Insufficient balance. Available: ${formatAmount(availableBN, capabilities.nativeDecimals)} ${capabilities.nativeTokenSymbol}, Required: ${formatAmount(totalRequired, capabilities.nativeDecimals)} ${capabilities.nativeTokenSymbol} (including fees)`,
      'INSUFFICIENT_BALANCE',
      {
        chain: capabilities.chainName,
        available: availableBN.toString(),
        required: totalRequired.toString(),
      }
    );
  }

  return {
    sufficient,
    available: availableBN,
    required: totalRequired,
    accountExists,
    free: availableBN,
    reserved: reservedBN,
    frozen: frozenBN,
    nonce,
  };
}

/**
 * Check if account exists on chain
 */
export async function checkAccountExists(
  api: ApiPromise,
  address: string
): Promise<boolean> {
  const balance = await api.query.system.account(address);
  const balanceData = balance as any;
  const availableBN = new BN(balanceData.data?.free?.toString() || '0');
  const nonce = balanceData.nonce?.toString() || '0';
  return availableBN.gt(new BN(0)) || new BN(nonce).gt(new BN(0));
}

/**
 * Check account reaping risk
 * Account is reaped if: (free_balance - fees - amount) < ED
 */
export function checkAccountReapingRisk(
  availableBN: BN,
  amountBN: BN,
  feeBN: BN,
  edBN: BN,
  keepAlive: boolean,
  capabilities: TransferCapabilities
): string | null {
  if (keepAlive) {
    return null;
  }

  const balanceAfterTransfer = availableBN.sub(amountBN).sub(feeBN);
  
  if (balanceAfterTransfer.lt(edBN)) {
    const willBeReaped = balanceAfterTransfer.lt(new BN(0)) || balanceAfterTransfer.lt(edBN);
    
    return `⚠️ ACCOUNT REAPING RISK: Using transferAllowDeath/transfer. ` +
      `After this transfer, sender balance will be: ${formatAmount(balanceAfterTransfer, capabilities.nativeDecimals)} ${capabilities.nativeTokenSymbol}. ` +
      `Existential Deposit (ED): ${formatAmount(edBN, capabilities.nativeDecimals)} ${capabilities.nativeTokenSymbol}. ` +
      `${willBeReaped ? 'ACCOUNT WILL BE REAPED' : 'Balance below ED - account may be reaped'}. ` +
      `Reaped accounts lose all state, nonces reset, locks/reserves removed. ` +
      `Use keepAlive=true to prevent account reaping.`;
  }

  return null;
}

