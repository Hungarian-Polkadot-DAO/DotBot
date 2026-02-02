/**
 * Execution Flow Footer Component
 *
 * Displays approval actions or progress bar. Restore/Rerun live in the header.
 */

import React from 'react';
import { ExecutionArrayState } from '@dotbot/core/executionEngine/types';
import { ApprovalActions, ProgressBar } from './components';

export interface ExecutionFlowFooterProps {
  executionState: ExecutionArrayState;
  isWaitingForApproval: boolean;
  isComplete: boolean;
  isFlowSuccessful?: boolean;
  isFlowFailed?: boolean;
  isSimulating: boolean;
  showCancel: boolean;
  showAccept: boolean;
  isFrozen?: boolean;
  onAcceptAndStart: () => void;
  onCancel: () => void;
}

const ExecutionFlowFooter: React.FC<ExecutionFlowFooterProps> = ({
  executionState,
  isWaitingForApproval,
  isComplete,
  isFlowSuccessful,
  isFlowFailed,
  isSimulating,
  showCancel,
  showAccept,
  isFrozen = false,
  onAcceptAndStart,
  onCancel,
}) => {
  const showApprovalRow = isWaitingForApproval && !isFrozen;

  return (
    <div className="execution-flow-footer">
      {showApprovalRow ? (
        <ApprovalActions
          showCancel={showCancel}
          showAccept={showAccept}
          isSimulating={isSimulating}
          onAcceptAndStart={onAcceptAndStart}
          onCancel={onCancel}
        />
      ) : (
        <ProgressBar
          executionState={executionState}
          isFlowSuccessful={isFlowSuccessful}
          isFlowFailed={isFlowFailed}
          isComplete={isComplete}
        />
      )}
    </div>
  );
};

export default ExecutionFlowFooter;

