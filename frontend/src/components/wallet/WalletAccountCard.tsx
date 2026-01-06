/**
 * WalletAccountCard Component
 * 
 * Displays connected wallet account information.
 * 
 * Will be part of @dotbot/react package.
 */

import React from 'react';
import { Environment } from '../../lib';
import EnvironmentBadge from './EnvironmentBadge';

interface WalletAccountCardProps {
  accountName: string;
  address: string;
  source: string;
  environment: Environment;
}

const WalletAccountCard: React.FC<WalletAccountCardProps> = ({
  accountName,
  address,
  source,
  environment
}) => {
  const formatAddress = (address: string): string => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };

  return (
    <div className="wallet-account-card">
      <div className="wallet-account-info">
        <div className="wallet-account-header">
          <div className="wallet-account-name">{accountName}</div>
          <EnvironmentBadge environment={environment} />
        </div>
        <div className="wallet-account-address">
          {formatAddress(address)}
        </div>
        <div className="wallet-account-source">
          via {source}
        </div>
      </div>
    </div>
  );
};

export default WalletAccountCard;

