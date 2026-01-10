/**
 * Settings Modal
 * 
 * Global application settings including ScenarioEngine activation.
 */

import React, { useEffect, useState } from 'react';
import { X, Beaker, Shield } from 'lucide-react';
import { getSimulationConfig, updateSimulationConfig } from '../../lib/executionEngine/simulation/simulationConfig';
import '../../styles/settings-modal.css';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  scenarioEngineEnabled: boolean;
  onToggleScenarioEngine: (enabled: boolean) => void;
  isMainnet: boolean;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  scenarioEngineEnabled,
  onToggleScenarioEngine,
  isMainnet,
}) => {
  // Read current simulation config state
  const [simulationConfig, setSimulationConfig] = useState(getSimulationConfig());

  // Update state when modal opens to get latest config
  useEffect(() => {
    if (isOpen) {
      setSimulationConfig(getSimulationConfig());
    }
  }, [isOpen]);

  // Close on ESC key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const handleSimulationToggle = (enabled: boolean) => {
    updateSimulationConfig({ enabled });
    setSimulationConfig(getSimulationConfig());
  };

  if (!isOpen) return null;

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="settings-modal-header">
          <h2 className="settings-modal-title">Settings</h2>
          <button onClick={onClose} className="settings-modal-close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="settings-modal-content">
          {/* ScenarioEngine Section */}
          <div className="settings-section">
            <div className="settings-section-header">
              <Beaker className="settings-section-icon" />
              <h3 className="settings-section-title">Testing & Evaluation</h3>
            </div>

            <div className="settings-option">
              <div className="settings-option-info">
                <div className="settings-option-label">Activate ScenarioEngine</div>
                <div className="settings-option-description">
                  Enable the ScenarioEngine overlay for testing and evaluation.
                  {isMainnet && (
                    <span className="settings-warning"> (Only available on Testnet)</span>
                  )}
                </div>
              </div>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={scenarioEngineEnabled}
                  onChange={(e) => onToggleScenarioEngine(e.target.checked)}
                  disabled={isMainnet}
                />
                <span className="settings-toggle-slider"></span>
              </label>
            </div>
          </div>

          {/* Transaction Simulation Section */}
          <div className="settings-section">
            <div className="settings-section-header">
              <Shield className="settings-section-icon" />
              <h3 className="settings-section-title">Transaction Simulation</h3>
            </div>

            <div className="settings-option">
              <div className="settings-option-info">
                <div className="settings-option-label">Enable Transaction Simulation</div>
                <div className="settings-option-description">
                  Simulate transactions using Chopsticks before signing to preview effects and catch errors early.
                  This adds 1-3 seconds of latency but improves safety by validating transactions before execution.
                </div>
              </div>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={simulationConfig.enabled}
                  onChange={(e) => handleSimulationToggle(e.target.checked)}
                />
                <span className="settings-toggle-slider"></span>
              </label>
            </div>
          </div>

          {/* Future settings sections - TODO */}
          <div className="settings-section">
            <h3 className="settings-section-title">General</h3>
            <div className="settings-placeholder">TODO: General settings</div>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">Advanced</h3>
            <div className="settings-placeholder">TODO: Advanced settings</div>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">About</h3>
            <div className="settings-placeholder">TODO: About info</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;

