/**
 * EnvironmentSwitch Component
 * 
 * Allows switching between mainnet and testnet environments.
 * 
 * Variants:
 * - "modal": Full explanation with text, used in WalletModal
 * - "compact": Small toggle button like ThemeToggle, for header/toolbar
 */

import React, { useState } from 'react';
import { Info, Loader2 } from 'lucide-react';
import { Environment } from '../../lib';
import '../../styles/environment-switch.css';

interface EnvironmentSwitchProps {
  environment: Environment;
  onSwitch: (environment: Environment) => Promise<void> | void;
  variant?: 'modal' | 'compact';
  disabled?: boolean;
  explanatoryText?: boolean;
}

const EnvironmentSwitch: React.FC<EnvironmentSwitchProps> = ({
  environment,
  onSwitch,
  variant = 'modal',
  disabled = false,
  explanatoryText = true
}) => {
  const [isSwitching, setIsSwitching] = useState(false);
  const isMainnet = environment === 'mainnet';

  const handleSwitch = async () => {
    if (isSwitching) return;

    const newEnvironment: Environment = isMainnet ? 'testnet' : 'mainnet';
    
    setIsSwitching(true);
    try {
      await onSwitch(newEnvironment);
    } catch (error) {
      console.error('Environment switch failed:', error);
    } finally {
      setIsSwitching(false);
    }
  };

  // Compact variant - small button like ThemeToggle
  if (variant === 'compact') {
    return (
      <button
        onClick={handleSwitch}
        disabled={isSwitching}
        className="environment-switch-compact"
        title={`Switch to ${isMainnet ? 'Testnet' : 'Mainnet'}`}
      >
        {isSwitching ? (
          <Loader2 className="environment-switch-icon animate-spin" size={18} />
        ) : (
          <span className="environment-switch-label">
            {isMainnet ? 'T' : 'M'}
          </span>
        )}
      </button>
    );
  }

  // Modal variant - full explanation section
  return (
    <div className="environment-switch-modal">
      {isMainnet ? (
        // On Mainnet - encourage trying testnet
        <div className="environment-switch-content">
          <div className="environment-switch-header-row">
            <div className="environment-switch-header">
              <Info className="environment-switch-info-icon" size={18} />
              <span className="environment-switch-title">Try out testnet?</span>
            </div>
            <button
              onClick={handleSwitch}
              disabled={isSwitching}
              className="environment-switch-btn"
            >
              {isSwitching ? (
                <>
                  <Loader2 className="environment-switch-spinner" size={14} />
                  <span>Switching...</span>
                </>
              ) : (
                <span>Use Testnet</span>
              )}
            </button>
          </div>
          
          {explanatoryText && (
            <p className="environment-switch-description">
              Testnet is perfect for experimenting with DotBot without using real tokens. 
              It's a safe environment to learn and test blockchain operations.
            </p>
          )}
        </div>
      ) : (
        // On Testnet - option to switch back
        <div className="environment-switch-content">
          <div className="environment-switch-header-row">
            <div className="environment-switch-header">
              <Info className="environment-switch-info-icon testnet" size={18} />
              <span className="environment-switch-title">Switch back to mainnet?</span>
            </div>
            <button
              onClick={handleSwitch}
              disabled={isSwitching}
              className="environment-switch-btn mainnet"
            >
              {isSwitching ? (
                <>
                  <Loader2 className="environment-switch-spinner" size={14} />
                  <span>Switching...</span>
                </>
              ) : (
                <span>Use Mainnet</span>
              )}
            </button>
          </div>
          
          {explanatoryText && (
            <p className="environment-switch-description">
              You're currently on testnet. Switch back to mainnet to use real tokens 
              and interact with the live Polkadot network.
            </p>
          )}
          
          <div className="environment-switch-faucet">
            <span className="environment-switch-faucet-label">Need more testnet tokens?</span>
            <a 
              href="https://faucet.polkadot.io/westend" 
              target="_blank" 
              rel="noopener noreferrer"
              className="environment-switch-faucet-link"
            >
              faucet.polkadot.io/westend
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default EnvironmentSwitch;

