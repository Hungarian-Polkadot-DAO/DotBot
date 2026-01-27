import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import './SimulationStatus.css';
import { formatAmount, formatFee } from '../utils/formatAmount';

interface SimulationStatusProps {
  phase: 'initializing' | 'forking' | 'executing' | 'analyzing' | 'complete' | 'error' | 'validating' | 'simulating' | 'retrying';
  message: string;
  progress?: number;
  details?: string;
  chain?: string;
  result?: {
    success: boolean;
    estimatedFee?: string;
    validationMethod?: 'chopsticks' | 'paymentInfo';
    balanceChanges?: Array<{ value: string; change: 'send' | 'receive' }>;
    runtimeInfo?: Record<string, any>;
    error?: string;
    wouldSucceed?: boolean;
  };
  /** Compact/inline mode - displays as a single line instead of a box */
  compact?: boolean;
}

const SimulationStatus: React.FC<SimulationStatusProps> = ({
  phase,
  message,
  progress,
  details,
  chain,
  result,
  compact = false
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const getPhaseIcon = () => {
    switch (phase) {
      case 'initializing':
      case 'validating':
        return '🔧';
      case 'forking':
        return '🌿';
      case 'executing':
      case 'simulating':
        return '⚡';
      case 'analyzing':
        return '🔍';
      case 'complete':
        return '✅';
      case 'error':
        return '❌';
      case 'retrying':
        return '🔄';
      default:
        return '⏳';
    }
  };

  const getPhaseColor = () => {
    switch (phase) {
      case 'initializing':
      case 'validating':
        return 'var(--accent-color)';
      case 'forking':
        return '#10b981';
      case 'executing':
      case 'simulating':
        return '#f59e0b';
      case 'analyzing':
        return '#3b82f6';
      case 'complete':
        return '#10b981';
      case 'error':
        return '#ef4444';
      case 'retrying':
        return '#8b5cf6';
      default:
        return '#6b7280';
    }
  };

  const showDetails = result && (phase === 'complete' || phase === 'error');

  // Compact/inline mode - single line display
  if (compact) {
    return (
      <div className="simulation-status simulation-status-compact">
        <div className="simulation-status-header">
          <span className="simulation-icon" style={{ color: getPhaseColor() }}>
            {getPhaseIcon()}
          </span>
          <span className="simulation-message">{message}</span>
          {chain && (
            <span className="simulation-chain-badge">{chain}</span>
          )}
          {progress !== undefined && (
            <div className="simulation-progress-inline">
              <div 
                className="simulation-progress-bar"
                style={{ 
                  width: `${progress}%`,
                  backgroundColor: getPhaseColor()
                }}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // Full box mode
  return (
    <div className="simulation-status">
      <div className="simulation-status-header">
        <span className="simulation-icon" style={{ color: getPhaseColor() }}>
          {getPhaseIcon()}
        </span>
        <span className="simulation-message">{message}</span>
        {chain && (
          <span className="simulation-chain-badge">{chain}</span>
        )}
        {showDetails && (
          <button
            className="simulation-expand-btn"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? 'Hide details' : 'Show details'}
          >
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        )}
      </div>
      
      {progress !== undefined && (
        <div className="simulation-progress">
          <div 
            className="simulation-progress-bar"
            style={{ 
              width: `${progress}%`,
              backgroundColor: getPhaseColor()
            }}
          />
        </div>
      )}
      
      {details && (
        <div className="simulation-details">{details}</div>
      )}

      {showDetails && result && isExpanded && (
        <div className="simulation-result-details">
          <div className="result-section">
            <div className="result-row">
              <span className="result-label">Validation Method:</span>
              <span className="result-value">
                {result.validationMethod === 'chopsticks' ? (
                  <span className="method-badge chopsticks">🌿 Chopsticks (Runtime Simulation)</span>
                ) : (
                  <span className="method-badge paymentinfo">⚠️ PaymentInfo (Structure Only)</span>
                )}
              </span>
            </div>

            {result.estimatedFee && (
              <div className="result-row">
                <span className="result-label">Estimated Fee:</span>
                <span className="result-value fee">{formatFee(result.estimatedFee, chain)}</span>
              </div>
            )}

            {result.balanceChanges && result.balanceChanges.length > 0 && (
              <div className="result-row">
                <span className="result-label">Balance Changes:</span>
                <div className="result-value balance-changes">
                  {result.balanceChanges.map((change, idx) => (
                    <div key={idx} className={`balance-change ${change.change}`}>
                      {change.change === 'send' ? '➖' : '➕'} {formatAmount(change.value, chain)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.runtimeInfo && Object.keys(result.runtimeInfo).length > 0 && (
              <div className="result-row">
                <span className="result-label">Runtime Info:</span>
                <div className="result-value runtime-info">
                  {result.runtimeInfo.validated !== undefined && (
                    <div className="info-item">
                      <span className="info-key">Validated:</span>
                      <span className={`info-value ${result.runtimeInfo.validated ? 'success' : 'warning'}`}>
                        {result.runtimeInfo.validated ? '✓ Yes' : '⚠ No'}
                      </span>
                    </div>
                  )}
                  {result.runtimeInfo.events !== undefined && (
                    <div className="info-item">
                      <span className="info-key">Events:</span>
                      <span className="info-value">{result.runtimeInfo.events}</span>
                    </div>
                  )}
                  {result.runtimeInfo.weight && (
                    <div className="info-item">
                      <span className="info-key">Weight:</span>
                      <span className="info-value">{result.runtimeInfo.weight}</span>
                    </div>
                  )}
                  {result.runtimeInfo.class && (
                    <div className="info-item">
                      <span className="info-key">Class:</span>
                      <span className="info-value">{result.runtimeInfo.class}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {result.error && (
              <div className="result-row error-row">
                <span className="result-label">Error:</span>
                <span className="result-value error-text">{result.error}</span>
              </div>
            )}

            {result.wouldSucceed !== undefined && (
              <div className="result-row">
                <span className="result-label">Would Succeed:</span>
                <span className={`result-value ${result.wouldSucceed ? 'success' : 'error'}`}>
                  {result.wouldSucceed ? '✓ Yes' : '✗ No'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SimulationStatus;
