import React, { useState, useEffect } from 'react';
import { Wallet, ChevronDown } from 'lucide-react';
import { useWalletStore } from '../../stores/walletStore';
import WalletModal from './WalletModal';

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
        className={`
          flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200
          ${isConnected 
            ? 'bg-green-600 hover:bg-green-700 text-white' 
            : 'bg-blue-600 hover:bg-blue-700 text-white'
          }
          border border-transparent hover:border-opacity-20 hover:border-white
          shadow-lg hover:shadow-xl
        `}
      >
        <Wallet className="w-4 h-4" />
        <span className="font-medium">
          {isConnected && selectedAccount 
            ? formatAddress(selectedAccount.address)
            : 'Connect Wallet'
          }
        </span>
        {isConnected && (
          <ChevronDown className="w-3 h-3 opacity-70" />
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
