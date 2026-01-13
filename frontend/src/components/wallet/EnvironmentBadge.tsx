/**
 * EnvironmentBadge Component
 * 
 * Displays the current environment (Mainnet/Testnet) with a colored indicator dot.
 * Matches the design from Figma mockups.
 */

import React from 'react';
import '../../styles/environment-badge.css';
import { Environment } from '@dotbot/core';

interface EnvironmentBadgeProps {
  environment: Environment;
  className?: string;
}

const EnvironmentBadge: React.FC<EnvironmentBadgeProps> = ({ environment, className = '' }) => {
  const isMainnet = environment === 'mainnet';
  
  return (
    <div className={`environment-badge ${isMainnet ? 'mainnet' : 'testnet'} ${className}`}>
      <div className="environment-badge-dot"></div>
      <span className="environment-badge-text">
        {isMainnet ? 'Mainnet' : 'Testnet'}
      </span>
    </div>
  );
};

export default EnvironmentBadge;

