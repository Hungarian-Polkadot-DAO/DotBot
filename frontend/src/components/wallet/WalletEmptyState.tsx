/**
 * WalletEmptyState Component
 * 
 * Displays when no wallet accounts are detected.
 * 
 * Will be part of @dotbot/react package.
 */

import React from 'react';
import { RefreshCw } from 'lucide-react';
import walletIcon from '../../assets/wallet.svg';

interface WalletEmptyStateProps {
  isConnecting: boolean;
  onEnableWallet: () => void;
  onRefreshAccounts: () => void;
}

const WalletEmptyState: React.FC<WalletEmptyStateProps> = ({
  isConnecting,
  onEnableWallet,
  onRefreshAccounts
}) => {
  return (
    <div className="wallet-empty-state">
      <div className="wallet-empty-content">
        <img src={walletIcon} alt="Wallet" className="wallet-empty-icon" />
        <p className="wallet-empty-text">
          No wallet accounts detected
        </p>
      </div>
      
      <div className="wallet-actions">
        <button
          onClick={onEnableWallet}
          disabled={isConnecting}
          className="wallet-enable-btn"
        >
          {isConnecting ? (
            <>
              <RefreshCw className="wallet-btn-icon animate-spin" />
              <span>Enabling...</span>
            </>
          ) : (
            <>
              <img src={walletIcon} alt="Wallet" className="wallet-btn-icon" />
              <span>Enable Wallet Extensions</span>
            </>
          )}
        </button>
        
        <button
          onClick={onRefreshAccounts}
          disabled={isConnecting}
          className="wallet-refresh-btn"
        >
          <RefreshCw className={`wallet-btn-icon ${isConnecting ? 'animate-spin' : ''}`} />
          <span>Refresh Connection</span>
        </button>
      </div>
      
      <div className="wallet-help-text">
        Make sure you have a Polkadot wallet extension installed and unlocked
      </div>
    </div>
  );
};

export default WalletEmptyState;

