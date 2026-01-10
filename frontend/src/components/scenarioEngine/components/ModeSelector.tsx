/**
 * Mode Selector Component
 * 
 * Reusable component for selecting execution mode (synthetic/emulated/live)
 * 
 * Currently: Only LIVE mode is fully implemented.
 * Synthetic and Emulated modes are disabled (TODO for future implementation).
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
  synthetic: '→ TODO: Fast mocked tests (DISABLED - not implemented)',
  emulated: '→ TODO: Chopsticks fork (DISABLED - not implemented)',
  live: '→ Real Westend transactions (actual testnet)',
};

const MODE_TITLES: Record<ExecutionMode, string> = {
  synthetic: 'Synthetic: DISABLED - TODO: Requires DotBot API mocking',
  emulated: 'Emulated: DISABLED - TODO: Requires DotBot reconnection to Chopsticks',
  live: 'Live: Real Westend testnet (actual transactions) - READY',
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
          className={`scenario-mode-button ${mode === 'synthetic' ? 'active' : ''} disabled`}
          onClick={() => {/* Disabled - TODO */}}
          title={MODE_TITLES.synthetic}
          disabled
          style={{ opacity: 0.4, cursor: 'not-allowed' }}
        >
          SYNTHETIC
        </button>
        <button
          className={`scenario-mode-button ${mode === 'emulated' ? 'active' : ''} disabled`}
          onClick={() => {/* Disabled - TODO */}}
          title={MODE_TITLES.emulated}
          disabled
          style={{ opacity: 0.4, cursor: 'not-allowed' }}
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

