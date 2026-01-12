/**
 * Progress Bar Component
 * 
 * Displays execution progress with completion status
 */

import React from 'react';
import { ExecutionArrayState } from '../../../lib/executionEngine/types';

export interface ProgressBarProps {
  executionState: ExecutionArrayState;
  isFlowSuccessful?: boolean;
  isFlowFailed?: boolean;
  isComplete: boolean;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  executionState,
  isFlowSuccessful,
  isFlowFailed,
  isComplete
}) => {
  // Determine completion message
  let completionMessage = '';
  if (isFlowSuccessful) {
    completionMessage = ' ✓ All transactions succeeded!';
  } else if (isFlowFailed) {
    completionMessage = ` ✗ ${executionState.failedItems} transaction${executionState.failedItems !== 1 ? 's' : ''} failed`;
  } else if (isComplete) {
    completionMessage = ' ✓';
  }

  const progressPercent = (executionState.completedItems / executionState.totalItems) * 100;

  return (
    <div className="execution-flow-progress">
      <div className="progress-bar">
        <div
          className={`progress-fill ${isFlowSuccessful ? 'progress-success' : isFlowFailed ? 'progress-failed' : ''}`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      <div className="progress-text">
        {executionState.completedItems} / {executionState.totalItems} completed
        {completionMessage}
      </div>
    </div>
  );
};

export default ProgressBar;
