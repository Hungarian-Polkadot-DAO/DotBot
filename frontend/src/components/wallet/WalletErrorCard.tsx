/**
 * WalletErrorCard Component
 * 
 * Displays wallet connection errors.
 * 
 * Will be part of @dotbot/react package.
 */

import React from 'react';
import { AlertCircle } from 'lucide-react';

interface WalletErrorCardProps {
  error: string;
}

const WalletErrorCard: React.FC<WalletErrorCardProps> = ({ error }) => {
  return (
    <div className="wallet-error-card">
      <div className="wallet-error-content">
        <AlertCircle className="wallet-error-icon" />
        <div className="wallet-error-text">
          {error}
        </div>
      </div>
    </div>
  );
};

export default WalletErrorCard;

