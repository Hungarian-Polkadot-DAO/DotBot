/**
 * WalletDisconnectedState Component
 * 
 * Displays the disconnected wallet state with accounts list or empty state.
 * 
 * Will be part of @dotbot/react package.
 */

import React from 'react';
import { Environment } from '../../lib';
import { WalletAccount } from '../../types/wallet';
import WalletErrorCard from './WalletErrorCard';
import WalletAccountsList from './WalletAccountsList';
import WalletEmptyState from './WalletEmptyState';

interface WalletDisconnectedStateProps {
  error: string | null;
  accounts: WalletAccount[];
  isConnecting: boolean;
  environment: Environment;
  onConnectAccount: (account: WalletAccount) => void;
  onEnableWallet: () => void;
  onRefreshAccounts: () => void;
  onEnvironmentSwitch?: (environment: Environment) => void;
}

const WalletDisconnectedState: React.FC<WalletDisconnectedStateProps> = ({
  error,
  accounts,
  isConnecting,
  environment,
  onConnectAccount,
  onEnableWallet,
  onRefreshAccounts,
  onEnvironmentSwitch
}) => {
  return (
    <div className="wallet-disconnected-state">
      <p className="wallet-description">
        Connect with Talisman, Subwallet, or another Polkadot wallet extension to access DotBot.
      </p>

      {error && <WalletErrorCard error={error} />}

      {accounts.length > 0 ? (
        <WalletAccountsList
          accounts={accounts}
          isConnecting={isConnecting}
          environment={environment}
          onConnectAccount={onConnectAccount}
          onRefreshAccounts={onRefreshAccounts}
          onEnvironmentSwitch={onEnvironmentSwitch}
        />
      ) : (
        <WalletEmptyState
          isConnecting={isConnecting}
          onEnableWallet={onEnableWallet}
          onRefreshAccounts={onRefreshAccounts}
        />
      )}
    </div>
  );
};

export default WalletDisconnectedState;

