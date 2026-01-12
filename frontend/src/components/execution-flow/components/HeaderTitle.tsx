/**
 * Header Title Component
 * 
 * Displays the execution flow title and step count
 */

import React from 'react';
import { ExecutionArrayState } from '../../../lib/executionEngine/types';

export interface HeaderTitleProps {
  executionState: ExecutionArrayState | null;
  isWaitingForApproval: boolean;
  isExecuting: boolean;
  isFlowSuccessful?: boolean;
  isFlowFailed?: boolean;
}

const HeaderTitle: React.FC<HeaderTitleProps> = ({
  executionState,
  isWaitingForApproval,
  isExecuting,
  isFlowSuccessful,
  isFlowFailed
}) => {
  if (!executionState) {
    return (
      <div className="execution-flow-title">
        <h3>Execution Flow</h3>
        <span className="execution-flow-count">Preparing...</span>
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
    <div className="execution-flow-title">
      <h3>{headerTitle}</h3>
      <span className="execution-flow-count">
        {executionState.totalItems} step{executionState.totalItems !== 1 ? 's' : ''}
      </span>
    </div>
  );
};

export default HeaderTitle;
