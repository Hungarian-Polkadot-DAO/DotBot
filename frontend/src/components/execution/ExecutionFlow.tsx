/**
 * Execution Flow Component
 * 
 * Visual representation of the ExecutionArray.
 * Shows all steps that will happen and provides a single "Accept and Start" button.
 */

import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Clock, Loader2, AlertTriangle, ChevronRight, Play, X } from 'lucide-react';
import { ExecutionItem, ExecutionArrayState } from '../../lib/executionEngine/types';
import type { ExecutionMessage, DotBot } from '../../lib';
import { shouldSimulate } from '../../lib/executionEngine/simulation/executionSimulator';
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

  // Check if simulation is enabled and if any items are being simulated (pending status)
  // Only consider items as "simulating" if simulation is actually enabled
  const simulationEnabled = shouldSimulate();
  const isSimulating = simulationEnabled && executionState.items.some(item => item.status === 'pending');
  const simulatingCount = executionState.items.filter(item => item.status === 'pending').length;
  
  // Check simulation results
  const hasSimulationSuccess = executionState.items.some(item => item.status === 'ready');
  const hasSimulationFailure = executionState.items.some(item => item.status === 'failed');
  const allSimulationsComplete = !isSimulating && (hasSimulationSuccess || hasSimulationFailure);
  const successCount = executionState.items.filter(item => item.status === 'ready').length;
  const failureCount = executionState.items.filter(item => item.status === 'failed').length;
  
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

      {/* Simulation Status Banners */}
      {isSimulating && (
        <div className="simulation-banner simulation-in-progress">
          <div className="banner-icon">
            <Loader2 className="animate-spin" size={20} />
          </div>
          <div className="banner-content">
            <div className="banner-title">Simulation in Progress</div>
            <div className="banner-description">
              Running {simulatingCount} transaction{simulatingCount !== 1 ? 's' : ''} through blockchain simulation to verify {simulatingCount !== 1 ? 'they' : 'it'} will succeed before you sign...
            </div>
          </div>
        </div>
      )}

      {allSimulationsComplete && hasSimulationSuccess && !hasSimulationFailure && !isExecuting && (
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

      {allSimulationsComplete && hasSimulationFailure && (
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

      {/* Approval message (only show when no banner is active) */}
      {!isSimulating && !allSimulationsComplete && isWaitingForApproval && (
        <div className="execution-flow-intro">
          <p>Review the steps below. Once you accept, your wallet will ask you to sign each transaction.</p>
        </div>
      )}

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
                {(item.warnings?.length || item.metadata) && (
                <ChevronRight
                  className={`execution-item-chevron ${isExpanded ? 'expanded' : ''}`}
                />
                )}
              </div>

              {/* Item Details (Expanded) */}
              {isExpanded && (
                <div className="execution-item-details">
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

