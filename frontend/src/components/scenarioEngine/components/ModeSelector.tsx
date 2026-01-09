/**
 * Mode Selector Component
 * 
 * Reusable component for selecting execution mode (synthetic/emulated/live)
 */

import React from 'react';

export type ExecutionMode = 'synthetic' | 'emulated' | 'live';

interface ModeSelectorProps {
  mode: ExecutionMode;
  onModeChange: (mode: ExecutionMode) => void;
  label?: string;
  showEntityInfo?: boolean;
  entityCount?: number;
}

const MODE_DESCRIPTIONS: Record<ExecutionMode, string> = {
  synthetic: '→ Fast mocked tests (no blockchain)',
  emulated: '→ Realistic Chopsticks fork (simulated chain)',
  live: '→ Real Westend transactions (actual testnet)',
};

const MODE_TITLES: Record<ExecutionMode, string> = {
  synthetic: 'Synthetic: Mocked blockchain (fast, no real transactions)',
  emulated: 'Emulated: Chopsticks (realistic simulation with fork)',
  live: 'Live: Real Westend testnet (actual transactions)',
};

export const ModeSelector: React.FC<ModeSelectorProps> = ({
  mode,
  onModeChange,
  label = 'EXECUTION MODE:',
  showEntityInfo = false,
  entityCount = 0,
}) => {
  return (
    <div className="scenario-mode-selector">
      <div className="scenario-mode-label">{'>'} {label}</div>
      <div className="scenario-mode-options">
        <button
          className={`scenario-mode-button ${mode === 'synthetic' ? 'active' : ''}`}
          onClick={() => onModeChange('synthetic')}
          title={MODE_TITLES.synthetic}
        >
          SYNTHETIC
        </button>
        <button
          className={`scenario-mode-button ${mode === 'emulated' ? 'active' : ''}`}
          onClick={() => onModeChange('emulated')}
          title={MODE_TITLES.emulated}
        >
          CHOPSTICKS
        </button>
        <button
          className={`scenario-mode-button ${mode === 'live' ? 'active' : ''}`}
          onClick={() => onModeChange('live')}
          title={MODE_TITLES.live}
        >
          LIVE
        </button>
      </div>
      <div className="scenario-mode-description">
        {MODE_DESCRIPTIONS[mode]}
      </div>
      {showEntityInfo && entityCount > 0 && (
        <div className="scenario-entity-mode-info">
          {'>'} Entities created for: <strong>{mode.toUpperCase()}</strong> mode
        </div>
      )}
    </div>
  );
};

