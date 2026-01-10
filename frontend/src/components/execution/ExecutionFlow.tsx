/**
 * Execution Flow Component
 * 
 * Visual representation of the ExecutionArray.
 * Shows all steps that will happen and provides a single "Accept and Start" button.
 */

import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Clock, Loader2, AlertTriangle, ChevronRight, Play, X, ChevronDown, ChevronUp } from 'lucide-react';
import { ExecutionItem, ExecutionArrayState, SimulationStatus as SimulationStatusType } from '../../lib/executionEngine/types';
import type { ExecutionMessage, DotBot } from '../../lib';
import { isSimulationEnabled } from '../../lib/executionEngine/simulation/simulationConfig';
import { BN } from '@polkadot/util';
import '../../styles/execution-flow.css';

export interface ExecutionFlowProps {
  // New API: Pass ExecutionMessage + DotBot instance
  executionMessage?: ExecutionMessage;
  dotbot?: DotBot;
  
  // Legacy API: Pass state directly
  state?: ExecutionArrayState | null;
  onAcceptAndStart?: () => void;
  onCancel?: () => void;
  show?: boolean;
}

const ExecutionFlow: React.FC<ExecutionFlowProps> = ({
  executionMessage,
  dotbot,
  state,
  onAcceptAndStart,
  onCancel,
  show = true
}) => {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  // Live execution state - updates when execution progresses
  const [liveExecutionState, setLiveExecutionState] = useState<ExecutionArrayState | null>(null);

  // Subscribe to execution updates when using new API (executionMessage + dotbot)
  useEffect(() => {
    if (!executionMessage || !dotbot || !dotbot.currentChat) {
      return;
    }

    const chatInstance = dotbot.currentChat;
    const executionId = executionMessage.executionId;

    // Subscribe to execution updates
    const unsubscribe = chatInstance.onExecutionUpdate(executionId, (updatedState) => {
      setLiveExecutionState(updatedState);
    });

    // Cleanup subscription on unmount
    return () => {
      unsubscribe();
    };
  }, [executionMessage?.executionId, dotbot]);

  // Use live state if available, otherwise fall back to snapshot or legacy state
  const executionState = liveExecutionState || executionMessage?.executionArray || state;
  const shouldShow = executionMessage ? (executionState?.items.length ?? 0) > 0 : show;

  if (!shouldShow || !executionState || executionState.items.length === 0) {
    return null;
  }

  // Handle execution through DotBot if using new API
  const handleAcceptAndStart = async () => {
    if (executionMessage && dotbot) {
      try {
        await dotbot.startExecution(executionMessage.executionId, { autoApprove: false });
      } catch (error) {
        console.error('Failed to start execution:', error);
      }
    } else if (onAcceptAndStart) {
      onAcceptAndStart();
    }
  };

  const handleCancel = () => {
    // TODO: Cancel execution through ChatInstance if using new API
    if (onCancel) {
      onCancel();
    }
  };

  // Check if simulation is enabled and if any items are being simulated
  // An item is simulating if it has simulationStatus and is in pending state
  const simulationEnabled = isSimulationEnabled();
  const simulatingItems = executionState.items.filter(item => 
    item.simulationStatus && item.status === 'pending'
  );
  const isSimulating = simulationEnabled && simulatingItems.length > 0;
  const simulatingCount = simulatingItems.length;
  
  // Check simulation results - only count items that actually went through simulation
  const simulatedItems = executionState.items.filter(item => item.simulationStatus);
  const hasSimulationSuccess = simulatedItems.some(item => 
    item.simulationStatus?.phase === 'complete' || 
    (item.simulationStatus?.result?.success === true && item.status === 'ready')
  );
  const hasSimulationFailure = simulatedItems.some(item => 
    item.simulationStatus?.phase === 'error' || 
    (item.simulationStatus?.result?.success === false && item.status === 'failed')
  );
  const allSimulationsComplete = !isSimulating && simulatedItems.length > 0 && 
    simulatedItems.every(item => 
      item.simulationStatus?.phase === 'complete' || 
      item.simulationStatus?.phase === 'error' ||
      item.status === 'ready' || 
      item.status === 'failed'
    );
  const successCount = simulatedItems.filter(item => 
    item.simulationStatus?.phase === 'complete' || 
    (item.simulationStatus?.result?.success === true && item.status === 'ready')
  ).length;
  const failureCount = simulatedItems.filter(item => 
    item.simulationStatus?.phase === 'error' || 
    (item.simulationStatus?.result?.success === false && item.status === 'failed')
  ).length;
  
  // Check if flow is waiting for user approval (all items are pending/ready)
  const isWaitingForApproval = executionState.items.every(item => 
    item.status === 'pending' || item.status === 'ready'
  );
  
  // Check if flow is complete (all items in terminal states)
  const isComplete = executionState.items.every(item => 
    item.status === 'completed' || item.status === 'finalized' || item.status === 'failed' || item.status === 'cancelled'
  );
  
  // Check if flow is executing
  // Only consider executing if NOT complete and either:
  // 1. The executionState flag says so, OR
  // 2. Any item is actively executing/signing/broadcasting
  const isExecuting = !isComplete && (
    executionState.isExecuting || executionState.items.some(item => 
      item.status === 'executing' || item.status === 'signing' || item.status === 'broadcasting'
    )
  );

  const toggleExpand = (itemId: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };

  const getStatusIcon = (status: ExecutionItem['status']) => {
    switch (status) {
      case 'completed':
      case 'finalized':
        return <CheckCircle2 className="status-icon status-success" />;
      case 'failed':
        return <XCircle className="status-icon status-error" />;
      case 'cancelled':
        return <XCircle className="status-icon status-cancelled" />;
      case 'signing':
      case 'broadcasting':
      case 'executing':
        return <Loader2 className="status-icon status-executing animate-spin" />;
      case 'ready':
        return <Clock className="status-icon status-ready" />;
      case 'pending':
        return <Loader2 className="status-icon status-pending animate-spin" />;
      default:
        return <Clock className="status-icon status-pending" />;
    }
  };

  const getStatusLabel = (status: ExecutionItem['status']) => {
    switch (status) {
      case 'pending': 
        // Only show "Simulating..." if simulation is actually enabled
        return simulationEnabled ? 'Simulating...' : 'Ready';
      case 'ready': return 'Ready';
      case 'executing': return 'Executing';
      case 'signing': return 'Signing...';
      case 'broadcasting': return 'Broadcasting...';
      case 'in_block': return 'In Block';
      case 'finalized': return 'Finalized';
      case 'completed': return 'Completed';
      case 'failed': return 'Failed';
      case 'cancelled': return 'Cancelled';
      default: return status;
    }
  };

  const getStatusColor = (status: ExecutionItem['status']) => {
    switch (status) {
      case 'completed':
      case 'finalized':
        return 'var(--status-success)';
      case 'failed':
        return 'var(--status-error)';
      case 'cancelled':
        return 'var(--status-cancelled)';
      case 'signing':
      case 'broadcasting':
      case 'executing':
        return 'var(--status-executing)';
      case 'ready':
        return 'var(--status-ready)';
      default:
        return 'var(--status-pending)';
    }
  };

  // Inline SimulationStatus component (integrated from SimulationStatus.tsx)
  const formatAmount = (planck: string): string => {
    try {
      const bn = new BN(planck);
      const dot = bn.div(new BN(10).pow(new BN(10)));
      const remainder = bn.mod(new BN(10).pow(new BN(10)));
      const decimals = remainder.div(new BN(10).pow(new BN(8))).toNumber();
      return `${dot.toString()}.${decimals.toString().padStart(2, '0')} DOT`;
    } catch {
      return `${planck} Planck`;
    }
  };

  interface InlineSimulationStatusProps {
    phase: SimulationStatusType['phase'];
    message: string;
    progress?: number;
    details?: string;
    chain?: string;
    result?: SimulationStatusType['result'];
  }

  const InlineSimulationStatus: React.FC<InlineSimulationStatusProps> = ({
    phase,
    message,
    progress,
    details,
    chain,
    result
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
                  <span className="result-value fee">{formatAmount(result.estimatedFee)}</span>
                </div>
              )}

              {result.balanceChanges && result.balanceChanges.length > 0 && (
                <div className="result-row">
                  <span className="result-label">Balance Changes:</span>
                  <div className="result-value balance-changes">
                    {result.balanceChanges.map((change, idx) => (
                      <div key={idx} className={`balance-change ${change.change}`}>
                        {change.change === 'send' ? '➖' : '➕'} {formatAmount(change.value)}
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

  return (
    <div className="execution-flow-container">
      {/* Header */}
      <div className="execution-flow-header">
        <div className="execution-flow-title">
          <h3>{isWaitingForApproval ? 'Review Transaction Flow' : 'Execution Flow'}</h3>
          <span className="execution-flow-count">
            {executionState.totalItems} step{executionState.totalItems !== 1 ? 's' : ''}
          </span>
        </div>
        
        {!isWaitingForApproval && (
        <div className="execution-flow-summary">
            {executionState.completedItems > 0 && (
              <span className="summary-badge summary-success">
                {executionState.completedItems} completed
            </span>
          )}
            {isExecuting && (
            <span className="summary-badge summary-executing">
                <Loader2 className="animate-spin inline mr-1" size={12} />
                executing
            </span>
          )}
            {executionState.failedItems > 0 && (
            <span className="summary-badge summary-error">
                {executionState.failedItems} failed
            </span>
          )}
        </div>
        )}
      </div>

      {/* Simulation Success Banner - Only show when all simulations complete successfully */}
      {simulationEnabled && allSimulationsComplete && hasSimulationSuccess && !hasSimulationFailure && !isExecuting && (
        <div className="simulation-banner simulation-success">
          <div className="banner-icon">
            <CheckCircle2 size={20} />
          </div>
          <div className="banner-content">
            <div className="banner-title">✓ Simulation Successful</div>
            <div className="banner-description">
              {successCount} transaction{successCount !== 1 ? 's' : ''} passed simulation and {successCount !== 1 ? 'are' : 'is'} ready to execute. Review the details below and click "Accept and Start" to proceed.
            </div>
          </div>
        </div>
      )}

      {simulationEnabled && allSimulationsComplete && hasSimulationFailure && (
        <div className="simulation-banner simulation-failure">
          <div className="banner-icon">
            <AlertTriangle size={20} />
          </div>
          <div className="banner-content">
            <div className="banner-title">⚠ Simulation Failed</div>
            <div className="banner-description">
              {failureCount} transaction{failureCount !== 1 ? 's' : ''} failed simulation. {failureCount === 1 ? 'This transaction would fail' : 'These transactions would fail'} on-chain. Review the error{failureCount !== 1 ? 's' : ''} below for details.
            </div>
          </div>
        </div>
      )}

      {/* Show simulation disabled message when simulation is off and waiting for approval */}
      {!simulationEnabled && isWaitingForApproval && (
        <div className="simulation-banner simulation-disabled">
          <div className="banner-icon">
            <AlertTriangle size={20} />
          </div>
          <div className="banner-content">
            <div className="banner-title">Transaction simulation is disabled</div>
            <div className="banner-description">
              Transactions will be sent directly to your wallet for signing without pre-execution simulation.
            </div>
          </div>
        </div>
      )}

      {/* Approval message (only show when no banner is active and simulation is not running) */}
      {(() => {
        const hasSimulationBanner = 
          (simulationEnabled && allSimulationsComplete && hasSimulationSuccess && !hasSimulationFailure && !isExecuting) ||
          (simulationEnabled && allSimulationsComplete && hasSimulationFailure) ||
          (!simulationEnabled && isWaitingForApproval);
        
        // Don't show approval message if simulation is in progress (status is shown in items)
        const hasActiveSimulation = simulationEnabled && isSimulating;
        
        return !hasSimulationBanner && !hasActiveSimulation && !allSimulationsComplete && isWaitingForApproval && (
          <div className="execution-flow-intro">
            <p>Review the steps below. Once you accept, your wallet will ask you to sign each transaction.</p>
          </div>
        );
      })()}

      {/* Items List */}
      <div className="execution-flow-items">
        {executionState.items.map((item, index) => {
          const isExpanded = expandedItems.has(item.id);
          const isItemExecuting = item.status === 'executing' || item.status === 'signing' || item.status === 'broadcasting';
          const isItemCompleted = item.status === 'completed' || item.status === 'finalized';
          const isItemFailed = item.status === 'failed';

          return (
            <div
              key={item.id}
              className={`execution-item ${item.status} ${isExpanded ? 'expanded' : ''}`}
              data-simulation-status={
                item.status === 'pending' ? 'simulating' :
                item.status === 'ready' ? 'success' :
                item.status === 'failed' ? 'failed' : 'none'
              }
            >
              {/* Item Header */}
              <div
                className="execution-item-header"
                onClick={() => toggleExpand(item.id)}
              >
                <div className="execution-item-main">
                  <div className="execution-item-number">{index + 1}</div>
                  {getStatusIcon(item.status)}
                  <div className="execution-item-content">
                    <div className="execution-item-description">{item.description}</div>
                    <div className="execution-item-meta">
                      {item.estimatedFee && item.status !== 'pending' && (
                        <span className="execution-item-fee">Fee: {item.estimatedFee}</span>
                      )}
                      <span
                        className={`execution-item-status status-${item.status}`}
                        style={{ color: getStatusColor(item.status) }}
                      >
                        {getStatusLabel(item.status)}
                      </span>
                    </div>
                  </div>
                </div>
                {(item.warnings?.length || item.metadata || item.simulationStatus) && (
                <ChevronRight
                  className={`execution-item-chevron ${isExpanded ? 'expanded' : ''}`}
                />
                )}
              </div>

              {/* Simulation Status - Show inline when simulation is active */}
              {item.simulationStatus && item.status === 'pending' && (
                <div className="execution-item-simulation">
                  <InlineSimulationStatus
                    phase={item.simulationStatus.phase}
                    message={item.simulationStatus.message}
                    progress={item.simulationStatus.progress}
                    details={item.simulationStatus.details}
                    chain={item.simulationStatus.chain}
                    result={item.simulationStatus.result}
                  />
                </div>
              )}

              {/* Item Details (Expanded) */}
              {isExpanded && (
                <div className="execution-item-details">
                  {/* Simulation Status - Show detailed simulation progress in expanded view too */}
                  {item.simulationStatus && item.status !== 'pending' && (
                    <div className="execution-detail-section">
                      <div className="execution-detail-label">Simulation Status</div>
                      <div className="execution-detail-value">
                        <InlineSimulationStatus
                          phase={item.simulationStatus.phase}
                          message={item.simulationStatus.message}
                          progress={item.simulationStatus.progress}
                          details={item.simulationStatus.details}
                          chain={item.simulationStatus.chain}
                          result={item.simulationStatus.result}
                        />
                      </div>
                    </div>
                  )}

                  {/* Warnings */}
                  {item.warnings && item.warnings.length > 0 && (
                    <div className="execution-detail-section">
                      <div className="execution-detail-label">
                        <AlertTriangle className="warning-icon" size={14} />
                        Information
                      </div>
                      <ul className="execution-warnings-list">
                        {item.warnings.map((warning, idx) => (
                          <li key={idx}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Metadata */}
                  {item.metadata && Object.keys(item.metadata).length > 0 && (
                    <div className="execution-detail-section">
                      <div className="execution-detail-label">Details</div>
                      <div className="execution-metadata">
                        {Object.entries(item.metadata).map(([key, value]) => {
                          // Skip internal fields and API instance
                          if (['amount', 'formattedAmount', 'transferCount', 'apiInstance'].includes(key)) {
                            return null;
                          }
                          // Skip complex objects that might have circular references
                          if (value && typeof value === 'object' && value.constructor && value.constructor.name !== 'Object' && value.constructor.name !== 'Array') {
                            return null;
                          }
                          
                          // Safe stringify
                          let displayValue: string;
                          try {
                            displayValue = typeof value === 'string' ? value : JSON.stringify(value);
                          } catch (e) {
                            displayValue = '[Complex Object]';
                          }
                          
                          return (
                            <div key={key} className="metadata-row">
                              <span className="metadata-key">{key}:</span>
                              <span className="metadata-value">{displayValue}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {isItemFailed && item.error && (
                    <div className="execution-detail-section execution-detail-error">
                      <div className="execution-detail-label">Error</div>
                      <div className="execution-detail-value">{item.error}</div>
                    </div>
                  )}

                  {/* Result */}
                  {isItemCompleted && item.result && (
                    <div className="execution-detail-section execution-detail-success">
                      <div className="execution-detail-label">Result</div>
                      <div className="execution-detail-value">
                        {item.result.txHash && (
                          <div className="result-hash">
                            <span>Tx:</span> {item.result.txHash.slice(0, 10)}...{item.result.txHash.slice(-8)}
                          </div>
                        )}
                        {item.result.blockHash && (
                          <div className="result-hash">
                            <span>Block:</span> {item.result.blockHash.slice(0, 10)}...{item.result.blockHash.slice(-8)}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Executing indicator */}
                  {isItemExecuting && (
                    <div className="execution-item-executing">
                      <Loader2 className="animate-spin" size={16} />
                      <span>Processing...</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="execution-flow-footer">
        {isWaitingForApproval ? (
          /* Approval Actions */
          <div className="execution-flow-approval-actions">
            {(onCancel || executionMessage) && (
              <button
                onClick={handleCancel}
                className="execution-cancel-btn"
              >
                <X size={16} />
                Cancel
              </button>
            )}
            {(onAcceptAndStart || executionMessage) && (
              <button
                onClick={handleAcceptAndStart}
                className="execution-accept-btn"
                disabled={isSimulating}
                title={isSimulating ? 'Waiting for simulation to complete...' : 'Accept and start execution'}
              >
                <Play size={16} />
                {isSimulating ? 'Simulating...' : 'Accept and Start'}
              </button>
            )}
          </div>
        ) : (
          /* Progress Bar */
        <div className="execution-flow-progress">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{
                width: `${(executionState.completedItems / executionState.totalItems) * 100}%`
              }}
            />
          </div>
          <div className="progress-text">
            {executionState.completedItems} / {executionState.totalItems} completed
              {isComplete && executionState.failedItems === 0 && ' ✓'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExecutionFlow;

