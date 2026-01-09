/**
 * WalletModal Component
 * 
 * Main modal for wallet connection and management.
 * Orchestrates wallet state and delegates to sub-components.
 * 
 * Will be part of @dotbot/react package.
 */

import React, { useEffect, useCallback } from 'react';
import { Environment } from '../../lib/index';
import { useWalletStore } from '../../stores/walletStore';
import { WalletAccount } from '../../types/wallet';
import { web3AuthService } from '../../lib/services/web3AuthService';
import { useDebouncedClick } from '../../hooks/useDebounce';
import WalletModalHeader from './WalletModalHeader';
import WalletConnectedState from './WalletConnectedState';
import WalletDisconnectedState from './WalletDisconnectedState';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  environment?: Environment;
  onEnvironmentSwitch?: (environment: Environment) => void;
}

const WalletModal: React.FC<WalletModalProps> = ({ 
  isOpen, 
  onClose, 
  environment = 'mainnet',
  onEnvironmentSwitch 
}) => {
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
    if (isOpen) {
      if (!isConnected) {
      checkWalletStatus();
      } else {
        // Refresh accounts when already connected to show other available accounts
        refreshAccounts();
      }
    }
  }, [isOpen, isConnected, checkWalletStatus, refreshAccounts]);

  // Clear error when modal closes
  useEffect(() => {
    if (!isOpen) {
      clearError();
    }
  }, [isOpen, clearError]);

  const getAllAccounts = useCallback((): WalletAccount[] => {
    return availableWallets.flatMap(wallet => wallet.accounts);
  }, [availableWallets]);

  const handleConnectAccountInternal = useCallback(async (account: WalletAccount) => {
    console.log('Modal: Connecting to account:', account);
    
    const wasAlreadyConnected = isConnected;
    
    try {
      // CRITICAL: Authenticate first (this prompts user to sign)
      console.log('Modal: Calling web3AuthService.authenticate()...');
      const authResult = await web3AuthService.authenticate(account);
      
      if (!authResult.success) {
        throw new Error(authResult.error || 'Authentication failed');
      }
      
      console.log('Modal: Authentication result:', authResult);
      
      // Now update store state (store will verify authentication succeeded)
      await connectAccount(account);
      
      // Sync state after connection
      syncWithService();
      
      // Check if connection was successful
      const store = useWalletStore.getState();
      console.log('Modal: Post-connection state:', { isConnected: store.isConnected, error: store.error });
      
      if (store.isConnected && !store.error) {
        console.log('Modal: Connection successful');
        // Only close modal on initial connection, not when switching accounts
        if (!wasAlreadyConnected) {
        onClose();
        }
      }
    } catch (error) {
      console.error('Modal: Connection error:', error);
      // Error is already set in the store by connectAccount
    }
  }, [isConnected, connectAccount, syncWithService, onClose]);

  // Debounced version to prevent multiple rapid clicks
  // Hooks must be called before any conditional returns
  const handleConnectAccount = useDebouncedClick(handleConnectAccountInternal, 1000);

  const handleDisconnectInternal = useCallback(async () => {
    await disconnect();
    onClose();
  }, [disconnect, onClose]);

  // Debounced version to prevent multiple rapid clicks
  const handleDisconnect = useDebouncedClick(handleDisconnectInternal, 500);

  if (!isOpen) return null;

  const accounts = getAllAccounts();

  return (
    <div className="wallet-modal-overlay">
      <div className="wallet-modal-container">
        <WalletModalHeader 
          isConnected={isConnected}
          onClose={onClose}
        />

        <div className="wallet-modal-content">
          {isConnected && selectedAccount ? (
            <WalletConnectedState
              accountName={selectedAccount.name || ''}
              address={selectedAccount.address}
              source={selectedAccount.source}
              environment={environment}
              allAccounts={accounts}
              isConnecting={isConnecting}
              onDisconnect={handleDisconnect}
              onConnectAccount={handleConnectAccount}
              onRefreshAccounts={refreshAccounts}
              onEnvironmentSwitch={onEnvironmentSwitch || (() => {})}
            />
          ) : (
            <WalletDisconnectedState
              error={error}
              accounts={accounts}
              isConnecting={isConnecting}
              environment={environment}
              onConnectAccount={handleConnectAccount}
              onEnableWallet={enableWallet}
              onRefreshAccounts={refreshAccounts}
              onEnvironmentSwitch={onEnvironmentSwitch}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default WalletModal;
