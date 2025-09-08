import React, { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { useWalletStore } from '../../stores/walletStore';
import WalletModal from './WalletModal';
import walletIcon from '../../assets/wallet.svg';

const WalletButton: React.FC = () => {
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
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
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
        <span>
          {isConnected && selectedAccount 
            ? formatAddress(selectedAccount.address)
            : 'Connect Wallet'
          }
        </span>
        {isConnected && (
          <ChevronDown style={{ width: '12px', height: '12px', opacity: 0.7 }} />
        )}
      </button>

      <WalletModal 
        isOpen={isModalOpen}
        onClose={handleCloseModal}
      />
    </>
  );
};

export default WalletButton;
