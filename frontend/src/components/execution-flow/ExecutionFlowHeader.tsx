/**
 * Execution Flow Header Component
 * 
 * Displays the title, step count, summary badges, and overall simulation status
 */

import React from 'react';
import { ExecutionArrayState } from '@dotbot/core/executionEngine/types';
import { HeaderTitle, SummaryBadges, SimulationStatusLine } from './components';

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
  return (
    <div className="execution-flow-header">
      <div className="execution-flow-header-top">
        <HeaderTitle
          executionState={executionState}
          isWaitingForApproval={isWaitingForApproval}
          isExecuting={isExecuting}
          isFlowSuccessful={isFlowSuccessful}
          isFlowFailed={isFlowFailed}
        />
        
        {!isWaitingForApproval && executionState && (
          <SummaryBadges
            executionState={executionState}
            isExecuting={isExecuting}
          />
        )}
      </div>
      
      {executionState && (
        <SimulationStatusLine executionState={executionState} />
      )}
    </div>
  );
};

export default ExecutionFlowHeader;

