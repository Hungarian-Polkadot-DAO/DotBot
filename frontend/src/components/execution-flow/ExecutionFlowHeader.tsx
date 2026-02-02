/**
 * Execution Flow Header Component
 *
 * Displays the title, step count, summary badges, Restore/Rerun (frozen flows), and simulation status.
 */

import React from 'react';
import { RotateCcw, RefreshCw, Loader2 } from 'lucide-react';
import { ExecutionArrayState } from '@dotbot/core/executionEngine/types';
import { HeaderTitle, SummaryBadges, SimulationStatusLine } from './components';

export interface ExecutionFlowHeaderProps {
  executionState: ExecutionArrayState | null;
  isWaitingForApproval: boolean;
  isExecuting: boolean;
  isFlowSuccessful?: boolean;
  isFlowFailed?: boolean;
  isFrozen?: boolean;
  isComplete?: boolean;
  isInterrupted?: boolean;
  showRestore?: boolean;
  showRerun?: boolean;
  isRestoring?: boolean;
  isRerunning?: boolean;
  onRestore?: () => void;
  onRerun?: () => void;
}

const ExecutionFlowHeader: React.FC<ExecutionFlowHeaderProps> = ({
  executionState,
  isWaitingForApproval,
  isExecuting,
  isFlowSuccessful,
  isFlowFailed,
  isFrozen = false,
  isComplete = false,
  isInterrupted = false,
  showRestore = false,
  showRerun = false,
  isRestoring = false,
  isRerunning = false,
  onRestore,
  onRerun,
}) => {
  const showHistoryActions = isFrozen && (showRestore || showRerun);

  return (
    <div className="execution-flow-header">
      <div className="execution-flow-header-top">
        <HeaderTitle
          executionState={executionState}
          isWaitingForApproval={isWaitingForApproval}
          isExecuting={isExecuting}
          isFlowSuccessful={isFlowSuccessful}
          isFlowFailed={isFlowFailed}
          isFrozen={isFrozen}
          isComplete={isComplete}
          isInterrupted={isInterrupted}
        />

        <div className="execution-flow-header-actions">
          {!isWaitingForApproval && executionState && (
            <SummaryBadges
              executionState={executionState}
              isExecuting={isExecuting}
            />
          )}
          {showHistoryActions && (
            <div className="execution-flow-history-actions execution-flow-history-actions-in-header">
              {showRestore && onRestore && (
                <button
                  type="button"
                  className="execution-restore-btn"
                  onClick={onRestore}
                  disabled={isRestoring}
                  title="Restore this flow so you can Accept & Start"
                >
                  {isRestoring ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <RotateCcw size={16} />
                  )}
                  {isRestoring ? 'Restoring…' : 'Restore'}
                </button>
              )}
              {showRerun && onRerun && (
                <button
                  type="button"
                  className="execution-rerun-btn"
                  onClick={onRerun}
                  disabled={isRerunning}
                  title="Run the same plan again (new execution)"
                >
                  {isRerunning ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                  {isRerunning ? 'Starting…' : 'Rerun'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {executionState && (
        <SimulationStatusLine executionState={executionState} />
      )}
    </div>
  );
};

export default ExecutionFlowHeader;

