/**
 * Execution Flow Header Component
 * 
 * Displays the title, step count, and summary badges
 */

import React from 'react';
import { Loader2 } from 'lucide-react';
import { ExecutionArrayState } from '../../lib/executionEngine/types';

export interface ExecutionFlowHeaderProps {
  executionState: ExecutionArrayState | null;
  isWaitingForApproval: boolean;
  isExecuting: boolean;
  isFlowSuccessful?: boolean;
  isFlowFailed?: boolean;
}

const ExecutionFlowHeader: React.FC<ExecutionFlowHeaderProps> = ({
  executionState,
  isWaitingForApproval,
  isExecuting,
  isFlowSuccessful,
  isFlowFailed
}) => {
  if (!executionState) {
    return (
      <div className="execution-flow-header">
        <div className="execution-flow-title">
          <h3>Execution Flow</h3>
          <span className="execution-flow-count">Preparing...</span>
        </div>
      </div>
    );
  }

  // Determine header title based on flow state
  let headerTitle = 'Execution Flow';
  if (isWaitingForApproval) {
    headerTitle = 'Review Transaction Flow';
  } else if (isFlowSuccessful) {
    headerTitle = '✓ Flow Completed Successfully';
  } else if (isFlowFailed) {
    headerTitle = '✗ Flow Failed';
  } else if (isExecuting) {
    headerTitle = 'Executing Flow';
  }

  return (
    <div className="execution-flow-header">
      <div className="execution-flow-title">
        <h3>{headerTitle}</h3>
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
  );
};

export default ExecutionFlowHeader;

