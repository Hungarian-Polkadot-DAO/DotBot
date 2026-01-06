/**
 * WalletConnectedState Component
 * 
 * Displays the connected wallet state with account info, other accounts, and disconnect button.
 * 
 * Will be part of @dotbot/react package.
 */

import React from 'react';
import { Plus } from 'lucide-react';
import { Environment } from '../../lib';
import { WalletAccount } from '../../types/wallet';
import WalletAccountCard from './WalletAccountCard';
import WalletAccountItem from './WalletAccountItem';
import EnvironmentSwitch from './EnvironmentSwitch';

interface WalletConnectedStateProps {
  accountName: string;
  address: string;
  source: string;
  environment: Environment;
  allAccounts: WalletAccount[];
  isConnecting: boolean;
  onDisconnect: () => void;
  onConnectAccount: (account: WalletAccount) => void;
  onRefreshAccounts: () => void;
  onEnvironmentSwitch: (environment: Environment) => void;
}

const WalletConnectedState: React.FC<WalletConnectedStateProps> = ({
  accountName,
  address,
  source,
  environment,
  allAccounts,
  isConnecting,
  onDisconnect,
  onConnectAccount,
  onRefreshAccounts,
  onEnvironmentSwitch
}) => {
  // Filter out the currently connected account
  const otherAccounts = allAccounts.filter(
    account => account.address !== address
  );

  return (
    <div className="wallet-connected-state">
      <WalletAccountCard
        accountName={accountName}
        address={address}
        source={source}
        environment={environment}
      />

      {otherAccounts.length > 0 && (
        <div className="wallet-accounts-section">
          <h3 className="wallet-accounts-title">Other Accounts:</h3>
          {otherAccounts.map((account, index) => (
            <WalletAccountItem
              key={`${account.address}-${index}`}
              account={account}
              isConnecting={isConnecting}
              onConnect={onConnectAccount}
            />
          ))}
        </div>
      )}

      {/* Add Account Button */}
      <button
        onClick={onRefreshAccounts}
        className="wallet-add-account-btn"
        disabled={isConnecting}
      >
        <Plus className="wallet-add-icon" size={20} />
        <span>Add Account</span>
      </button>

      <EnvironmentSwitch
        environment={environment}
        onSwitch={onEnvironmentSwitch}
        variant="modal"
        explanatoryText={false}
      />
      
      <button
        onClick={onDisconnect}
        className="wallet-disconnect-btn"
      >
        Disconnect Wallet
      </button>
    </div>
  );
};

export default WalletConnectedState;

