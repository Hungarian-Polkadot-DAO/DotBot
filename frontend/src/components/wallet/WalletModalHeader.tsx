/**
 * WalletModalHeader Component
 * 
 * Header section with title and close button.
 * 
 * Will be part of @dotbot/react package.
 */

import React from 'react';
import { X } from 'lucide-react';
import walletIcon from '../../assets/wallet.svg';

interface WalletModalHeaderProps {
  isConnected: boolean;
  onClose: () => void;
}

const WalletModalHeader: React.FC<WalletModalHeaderProps> = ({ isConnected, onClose }) => {
  return (
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
  );
};

export default WalletModalHeader;

