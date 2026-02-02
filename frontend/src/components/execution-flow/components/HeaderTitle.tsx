/**
 * Header Title Component
 *
 * Displays the execution flow title and step count.
 * Frozen = historical (snapshot); running = live ExecutionArray.
 */

import React from 'react';
import { ExecutionArrayState } from '@dotbot/core/executionEngine/types';

export interface HeaderTitleProps {
  executionState: ExecutionArrayState | null;
  isWaitingForApproval: boolean;
  isExecuting: boolean;
  isFlowSuccessful?: boolean;
  isFlowFailed?: boolean;
  isFrozen?: boolean;
  isComplete?: boolean;
  isInterrupted?: boolean;
}

const HeaderTitle: React.FC<HeaderTitleProps> = ({
  executionState,
  isWaitingForApproval,
  isExecuting,
  isFlowSuccessful,
  isFlowFailed,
  isFrozen = false,
  isComplete = false,
  isInterrupted = false
}) => {
  if (!executionState) {
    return (
      <div className="execution-flow-title">
        <h3>Execution Flow</h3>
        <span className="execution-flow-count">
          {isFrozen ? '—' : 'Preparing...'}
        </span>
      </div>
    );
  }

  let headerTitle = 'Execution Flow';
  let countLabel = `${executionState.totalItems} step${executionState.totalItems !== 1 ? 's' : ''}`;

  if (isFrozen) {
    if (isComplete) {
      headerTitle = isFlowSuccessful ? '✓ Completed' : isFlowFailed ? '✗ Failed' : 'Completed';
      countLabel = 'All steps done';
    } else if (isInterrupted) {
      headerTitle = 'Interrupted';
      countLabel = 'Incomplete — use Restore to continue';
    } else {
      headerTitle = 'Execution Flow';
    }
  } else {
    if (isWaitingForApproval) {
      headerTitle = 'Review Transaction Flow';
    } else if (isFlowSuccessful) {
      headerTitle = '✓ Flow Completed Successfully';
    } else if (isFlowFailed) {
      headerTitle = '✗ Flow Failed';
    } else if (isExecuting) {
      headerTitle = 'Executing Flow';
    }
  }

  return (
    <div className="execution-flow-title">
      <h3>{headerTitle}</h3>
      <span className="execution-flow-count">{countLabel}</span>
    </div>
  );
};

export default HeaderTitle;
