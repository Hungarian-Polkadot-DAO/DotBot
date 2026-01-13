import React, { useState, useEffect } from 'react';
import { useWalletStore } from '../../stores/walletStore';
import WalletModal from './WalletModal';
import EnvironmentBadge from './EnvironmentBadge';
import walletIcon from '../../assets/wallet.svg';
import { Environment } from '@dotbot/core';

interface WalletButtonProps {
  environment?: Environment;
  onEnvironmentSwitch: (environment: Environment) => void;
}

const WalletButton: React.FC<WalletButtonProps> = ({ 
  environment = 'mainnet',
  onEnvironmentSwitch 
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const {
    isConnected,
    selectedAccount,
    initialize
  } = useWalletStore();

  // Initialize wallet state on component mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  const formatAddress = (address: string): string => {
    if (!address) return '';
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const handleOpenModal = () => {
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
  };

  return (
    <>
      <button
        onClick={handleOpenModal}
        className={`wallet-btn ${isConnected ? 'connected' : 'disconnected'}`}
      >
        <img src={walletIcon} alt="Wallet" className="wallet-icon" />
        <span className="wallet-address">
          {isConnected && selectedAccount 
            ? formatAddress(selectedAccount.address)
            : 'Connect Wallet'
          }
        </span>
        {isConnected && (
          <EnvironmentBadge environment={environment} className="wallet-environment-badge" />
        )}
      </button>

      <WalletModal 
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        environment={environment}
        onEnvironmentSwitch={onEnvironmentSwitch}
      />
    </>
  );
};

export default WalletButton;
