import React, { useEffect } from 'react';
import { X, Wallet, AlertCircle, RefreshCw } from 'lucide-react';
import { useWalletStore } from '../../stores/walletStore';
import { WalletAccount } from '../../types/wallet';

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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center space-x-2">
            <Wallet className="w-5 h-5 text-blue-400" />
            <h2 className="text-xl font-semibold text-white">
              {isConnected ? 'Wallet Connected' : 'Connect Wallet'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {isConnected && selectedAccount ? (
            // Connected state
            <div className="space-y-4">
              <div className="bg-green-900 bg-opacity-30 border border-green-700 rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-2">
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                  <span className="text-green-400 font-medium">Connected</span>
                </div>
                <div className="text-white">
                  <div className="font-medium">{selectedAccount.name}</div>
                  <div className="text-sm text-gray-300 font-mono">
                    {formatAddress(selectedAccount.address)}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    via {selectedAccount.source}
                  </div>
                </div>
              </div>
              
              <button
                onClick={handleDisconnect}
                className="w-full bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-lg transition-colors"
              >
                Disconnect Wallet
              </button>
            </div>
          ) : (
            // Not connected state
            <div className="space-y-4">
              <p className="text-gray-300 text-sm">
                Connect with Talisman, Subwallet, or another Polkadot wallet extension to access DotBot.
              </p>

              {error && (
                <div className="bg-red-900 bg-opacity-30 border border-red-700 rounded-lg p-4">
                  <div className="flex items-start space-x-2">
                    <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <div className="text-red-300 text-sm whitespace-pre-line">
                      {error}
                    </div>
                  </div>
                </div>
              )}

              {getAllAccounts().length > 0 ? (
                // Show available accounts
                <div className="space-y-3">
                  <h3 className="text-white font-medium">Available Accounts:</h3>
                  {getAllAccounts().map((account, index) => (
                    <div
                      key={`${account.address}-${index}`}
                      className="border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="text-white font-medium">
                            {account.name || 'Unnamed Account'}
                          </div>
                          <div className="text-sm text-gray-300 font-mono">
                            {formatAddress(account.address)}
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            via {account.source}
                          </div>
                        </div>
                        <button
                          onClick={() => handleConnectAccount(account)}
                          disabled={isConnecting}
                          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white py-2 px-4 rounded-lg transition-colors disabled:cursor-not-allowed"
                        >
                          {isConnecting ? 'Connecting...' : 'Connect'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                // No accounts found - show enable/refresh options
                <div className="space-y-3">
                  <div className="text-center py-4">
                    <Wallet className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400 text-sm">
                      No wallet accounts detected
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <button
                      onClick={enableWallet}
                      disabled={isConnecting}
                      className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white py-3 px-4 rounded-lg transition-colors disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                    >
                      {isConnecting ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Enabling...</span>
                        </>
                      ) : (
                        <>
                          <Wallet className="w-4 h-4" />
                          <span>Enable Wallet Extensions</span>
                        </>
                      )}
                    </button>
                    
                    <button
                      onClick={refreshAccounts}
                      disabled={isConnecting}
                      className="w-full bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white py-2 px-4 rounded-lg transition-colors disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                    >
                      <RefreshCw className={`w-4 h-4 ${isConnecting ? 'animate-spin' : ''}`} />
                      <span>Refresh Connection</span>
                    </button>
                  </div>
                  
                  <div className="text-xs text-gray-400 text-center mt-4">
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
