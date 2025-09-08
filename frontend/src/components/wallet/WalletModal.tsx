import React, { useEffect } from 'react';
import { X, AlertCircle, RefreshCw } from 'lucide-react';
import { useWalletStore } from '../../stores/walletStore';
import { WalletAccount } from '../../types/wallet';
import walletIcon from '../../assets/wallet.svg';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WalletModal: React.FC<WalletModalProps> = ({ isOpen, onClose }) => {
  const {
    isConnected,
    selectedAccount,
    availableWallets,
    isConnecting,
    error,
    enableWallet,
    connectAccount,
    disconnect,
    refreshAccounts,
    checkWalletStatus,
    clearError,
    syncWithService
  } = useWalletStore();

  // Initialize wallet check when modal opens
  useEffect(() => {
    if (isOpen && !isConnected) {
      checkWalletStatus();
    }
  }, [isOpen, isConnected, checkWalletStatus]);

  // Clear error when modal closes
  useEffect(() => {
    if (!isOpen) {
      clearError();
    }
  }, [isOpen, clearError]);

  if (!isOpen) return null;

  const formatAddress = (address: string): string => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };

  const getAllAccounts = (): WalletAccount[] => {
    return availableWallets.flatMap(wallet => wallet.accounts);
  };

  const handleConnectAccount = async (account: WalletAccount) => {
    console.log('Modal: Connecting to account:', account);
    await connectAccount(account);
    
    // Sync state after connection attempt
    syncWithService();
    
    // Check if connection was successful
    const store = useWalletStore.getState();
    console.log('Modal: Post-connection state:', { isConnected: store.isConnected, error: store.error });
    
    if (store.isConnected && !store.error) {
      console.log('Modal: Connection successful, closing modal');
      onClose();
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    onClose();
  };

  return (
    <div className="wallet-modal-overlay">
      <div className="wallet-modal-container">
        {/* Header */}
        <div className="wallet-modal-header">
          <div className="wallet-modal-title">
            <img src={walletIcon} alt="Wallet" className="wallet-modal-icon" />
            <h2 className="wallet-modal-heading">
              {isConnected ? 'Wallet Connected' : 'Connect Wallet'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="wallet-modal-close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="wallet-modal-content">
          {isConnected && selectedAccount ? (
            // Connected state
            <div className="wallet-connected-state">
              <div className="wallet-account-card">
                <div className="wallet-status">
                  <div className="wallet-status-indicator"></div>
                  <span className="wallet-status-text">Connected</span>
                </div>
                <div className="wallet-account-info">
                  <div className="wallet-account-name">{selectedAccount.name}</div>
                  <div className="wallet-account-address">
                    {formatAddress(selectedAccount.address)}
                  </div>
                  <div className="wallet-account-source">
                    via {selectedAccount.source}
                  </div>
                </div>
              </div>
              
              <button
                onClick={handleDisconnect}
                className="wallet-disconnect-btn"
              >
                Disconnect Wallet
              </button>
            </div>
          ) : (
            // Not connected state
            <div className="wallet-disconnected-state">
              <p className="wallet-description">
                Connect with Talisman, Subwallet, or another Polkadot wallet extension to access DotBot.
              </p>

              {error && (
                <div className="wallet-error-card">
                  <div className="wallet-error-content">
                    <AlertCircle className="wallet-error-icon" />
                    <div className="wallet-error-text">
                      {error}
                    </div>
                  </div>
                </div>
              )}

              {getAllAccounts().length > 0 ? (
                // Show available accounts
                <div className="wallet-accounts-section">
                  <h3 className="wallet-accounts-title">Available Accounts:</h3>
                  {getAllAccounts().map((account, index) => (
                    <div
                      key={`${account.address}-${index}`}
                      className="wallet-account-item"
                    >
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
                        onClick={() => handleConnectAccount(account)}
                        disabled={isConnecting}
                        className="wallet-connect-btn"
                      >
                        {isConnecting ? 'Connecting...' : 'Connect'}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                // No accounts found - show enable/refresh options
                <div className="wallet-empty-state">
                  <div className="wallet-empty-content">
                    <img src={walletIcon} alt="Wallet" className="wallet-empty-icon" />
                    <p className="wallet-empty-text">
                      No wallet accounts detected
                    </p>
                  </div>
                  
                  <div className="wallet-actions">
                    <button
                      onClick={enableWallet}
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
                      onClick={refreshAccounts}
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
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WalletModal;
