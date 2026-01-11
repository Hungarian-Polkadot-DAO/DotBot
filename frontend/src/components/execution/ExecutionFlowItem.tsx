/**
 * Execution Flow Item Component
 * 
 * Displays a single execution item with expandable details
 */

import React from 'react';
import { AlertTriangle, ChevronRight, Loader2 } from 'lucide-react';
import { ExecutionItem } from '../../lib/executionEngine/types';
import { getStatusIcon, getStatusLabel, getStatusColor } from './executionStatusUtils';
import SimulationStatus from '../simulation/SimulationStatus';
import { isSimulationEnabled } from '../../lib/executionEngine/simulation/simulationConfig';

export interface ExecutionFlowItemProps {
  item: ExecutionItem;
  index: number;
  isExpanded: boolean;
  onToggleExpand: (itemId: string) => void;
}

const ExecutionFlowItem: React.FC<ExecutionFlowItemProps> = ({
  item,
  index,
  isExpanded,
  onToggleExpand
}) => {
  const simulationEnabled = isSimulationEnabled();
  const isItemExecuting = item.status === 'executing' || item.status === 'signing' || item.status === 'broadcasting';
  const isItemCompleted = item.status === 'completed' || item.status === 'finalized';
  const isItemFailed = item.status === 'failed';
  const isItemPending = item.status === 'pending';
  const hasSimulationStatus = !!item.simulationStatus;
  
  // Determine if simulation has started (any phase) or completed
  const simulationStarted = hasSimulationStatus && item.simulationStatus && (
    item.simulationStatus.phase === 'initializing' ||
    item.simulationStatus.phase === 'simulating' ||
    item.simulationStatus.phase === 'validating' ||
    item.simulationStatus.phase === 'analyzing' ||
    item.simulationStatus.phase === 'retrying' ||
    item.simulationStatus.phase === 'forking' ||
    item.simulationStatus.phase === 'executing' ||
    item.simulationStatus.phase === 'complete' ||
    item.simulationStatus.phase === 'error'
  );
  
  // Only show "waiting" if:
  // - Item is pending
  // - Simulation is enabled
  // - Simulation hasn't started yet (no status or status hasn't been set)
  const isWaitingForSimulation = isItemPending && simulationEnabled && !simulationStarted;

  return (
    <div
      className={`execution-item ${item.status} ${isExpanded ? 'expanded' : ''}`}
      data-simulation-status={
        item.status === 'pending' && hasSimulationStatus ? 'simulating' :
        item.status === 'pending' && !hasSimulationStatus ? 'waiting' :
        item.status === 'ready' ? 'success' :
        item.status === 'failed' ? 'failed' : 'none'
      }
    >
      {/* Item Header */}
      <div
        className="execution-item-header"
        onClick={() => onToggleExpand(item.id)}
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
                {getStatusLabel(item.status, simulationEnabled)}
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

      {/* Waiting for simulation (item is pending but simulation hasn't started yet) */}
      {isWaitingForSimulation && (
        <div className="execution-item-simulation">
          <div className="simulation-status-waiting">
            <Loader2 className="animate-spin" size={16} />
            <span>Waiting for simulation to start...</span>
          </div>
        </div>
      )}

      {/* Simulation Status - Show inline when simulation exists and item is pending/ready (before execution) */}
      {/* Also show if simulation is in progress (any active phase) */}
      {item.simulationStatus && (
        item.status === 'pending' || 
        item.status === 'ready' ||
        item.simulationStatus.phase === 'initializing' ||
        item.simulationStatus.phase === 'simulating' ||
        item.simulationStatus.phase === 'validating' ||
        item.simulationStatus.phase === 'analyzing' ||
        item.simulationStatus.phase === 'retrying' ||
        item.simulationStatus.phase === 'forking' ||
        item.simulationStatus.phase === 'executing' ||
        item.simulationStatus.phase === 'error' ||
        item.simulationStatus.phase === 'complete'
      ) && (
        <div className="execution-item-simulation">
          <SimulationStatus
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
                <SimulationStatus
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
                    <span>Tx:</span> {item.result.txHash}
                  </div>
                )}
                {item.result.blockHash && (
                  <div className="result-hash">
                    <span>Block:</span> {item.result.blockHash}
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
};

export default ExecutionFlowItem;

