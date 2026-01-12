/**
 * Summary Badges Component
 * 
 * Displays summary badges for completed, executing, and failed items
 */

import React from 'react';
import { Loader2 } from 'lucide-react';
import { ExecutionArrayState } from '../../../lib/executionEngine/types';

export interface SummaryBadgesProps {
  executionState: ExecutionArrayState;
  isExecuting: boolean;
}

const SummaryBadges: React.FC<SummaryBadgesProps> = ({
  executionState,
  isExecuting
}) => {
  return (
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
  );
};

export default SummaryBadges;
