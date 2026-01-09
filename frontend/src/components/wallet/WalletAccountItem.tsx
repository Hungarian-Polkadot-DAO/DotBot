/**
 * WalletAccountItem Component
 * 
 * Individual account item in the accounts list.
 * 
 * Will be part of @dotbot/react package.
 */

import React, { useCallback } from 'react';
import { WalletAccount } from '../../types/wallet';
import { useDebouncedClick } from '../../hooks/useDebounce';

interface WalletAccountItemProps {
  account: WalletAccount;
  isConnecting: boolean;
  onConnect: (account: WalletAccount) => void;
}

const WalletAccountItem: React.FC<WalletAccountItemProps> = ({
  account,
  isConnecting,
  onConnect
}) => {
  const formatAddress = (address: string): string => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };

  // Debounced connect handler to prevent multiple rapid clicks
  const handleConnect = useDebouncedClick(
    useCallback(() => {
      onConnect(account);
    }, [onConnect, account]),
    1000
  );

  return (
    <div className="wallet-account-item">
      <div className="wallet-account-details">
        <div className="wallet-account-name">
          {account.name || 'Unnamed Account'}
        </div>
        <div className="wallet-account-address">
          {formatAddress(account.address)}
        </div>
        <div className="wallet-account-source">
          via {account.source}
        </div>
      </div>
      <button
        onClick={handleConnect}
        disabled={isConnecting}
        className="wallet-connect-btn"
      >
        {isConnecting ? 'Connecting...' : 'Connect'}
      </button>
    </div>
  );
};

export default WalletAccountItem;

