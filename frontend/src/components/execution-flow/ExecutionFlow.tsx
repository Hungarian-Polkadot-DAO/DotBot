/**
 * Execution Flow Component
 * 
 * Visual representation of the ExecutionArray.
 * Shows all steps that will happen and provides a single "Accept and Start" button.
 */

import React, { useState, useCallback } from 'react';
import type { ExecutionMessage, DotBot } from '@dotbot/core';
import type { ExecutionArrayState } from '@dotbot/core/executionEngine/types';
import { isSimulationEnabled } from '@dotbot/core/executionEngine/simulation/simulationConfig';
import { useExecutionFlowState, useExpandedItems } from './hooks';
import { LoadingState, ApprovalMessage } from './components';
import ExecutionFlowHeader from './ExecutionFlowHeader';
import ExecutionFlowItem from './ExecutionFlowItem';
import ExecutionFlowFooter from './ExecutionFlowFooter';
import {
  areAllSimulationsComplete,
  getSimulationStats
} from './simulationUtils';
import {
  isWaitingForApproval,
  isFlowComplete,
  isFlowExecuting,
  isFlowSuccessful,
  isFlowFailed,
  isFlowInterrupted,
} from './executionFlowUtils';
import { handleAcceptAndStart, handleRestore, handleRerun } from './executionHandlers';
import './execution-flow.css';

export interface ExecutionFlowProps {
  executionMessage?: ExecutionMessage;
  dotbot?: DotBot;
  state?: ExecutionArrayState | null;
  onAcceptAndStart?: () => void;
  onCancel?: () => void;
  /** Call before Restore to prevent scroll-to-bottom. */
  onSuppressScrollRequest?: () => void;
  show?: boolean;
}

const ExecutionFlow: React.FC<ExecutionFlowProps> = ({
  executionMessage,
  dotbot,
  state,
  onAcceptAndStart,
  onCancel,
  onSuppressScrollRequest,
  show = true
}) => {
  const executionState = useExecutionFlowState(executionMessage, dotbot, state);
  const { isExpanded, toggleExpand } = useExpandedItems();
  const [isRestoring, setIsRestoring] = useState(false);
  const [isRerunning, setIsRerunning] = useState(false);

  const onRestoreHandler = useCallback(async () => {
    if (!executionMessage || !dotbot) return;
    onSuppressScrollRequest?.();
    setIsRestoring(true);
    try {
      await handleRestore(executionMessage, dotbot);
    } finally {
      setIsRestoring(false);
    }
  }, [executionMessage, dotbot, onSuppressScrollRequest]);

  const onRerunHandler = useCallback(async () => {
    if (!executionMessage || !dotbot) return;
    onSuppressScrollRequest?.();
    setIsRerunning(true);
    try {
      await handleRerun(executionMessage, dotbot);
    } finally {
      setIsRerunning(false);
    }
  }, [executionMessage, dotbot, onSuppressScrollRequest]);

  const shouldShow = executionMessage ? true : show;
  if (!shouldShow) {
    return null;
  }

  const hasLiveArray = !!(executionMessage && dotbot?.currentChat?.getExecutionArray(executionMessage.executionId));
  const isFrozenForLoading = !!executionMessage && !hasLiveArray;

  const renderLoadingState = (state: typeof executionState) => (
    <div className={`execution-flow-container ${isFrozenForLoading ? 'frozen' : ''}`.trim()}>
      <ExecutionFlowHeader
        executionState={state}
        isWaitingForApproval={false}
        isExecuting={false}
        isFrozen={isFrozenForLoading}
        isComplete={false}
        isInterrupted={false}
      />
      <LoadingState isFrozen={isFrozenForLoading} />
    </div>
  );

  // Show loading if no state or no items
  if (!executionState) {
    return executionMessage ? renderLoadingState(null) : null;
  }

  if (executionState.items.length === 0) {
    return renderLoadingState(executionState);
  }

  // Handle execution through DotBot if using new API
  const onAcceptAndStartHandler = () => {
    handleAcceptAndStart(executionMessage, dotbot, onAcceptAndStart);
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    }
  };

  // Calculate flow state
  const simulationEnabled = isSimulationEnabled();
  const simulationStats = getSimulationStats(executionState);
  const isSimulating = simulationEnabled && simulationStats.totalSimulating > 0;
  const allSimulationsComplete = areAllSimulationsComplete(executionState.items, isSimulating);
  const waitingForApproval = isWaitingForApproval(executionState);
  const isComplete = isFlowComplete(executionState);
  const isExecuting = isFlowExecuting(executionState);
  const flowSuccessful = isFlowSuccessful(executionState);
  const flowFailed = isFlowFailed(executionState);
  const hasActiveSimulation = simulationEnabled && isSimulating;

  const flowStatus = flowSuccessful ? 'success' : flowFailed ? 'failed' : isExecuting ? 'executing' : 'pending';

  const isFrozen = !!executionMessage && !hasLiveArray;
  const interrupted = isFlowInterrupted(executionState);
  const showRestore = isFrozen && interrupted;
  const showRerun = isFrozen && isComplete && (flowSuccessful || flowFailed);
  const showAccept = !isFrozen && !!(onAcceptAndStart || executionMessage);

  const frozenClass = isFrozen
    ? isComplete
      ? 'frozen frozen-completed'
      : 'frozen frozen-interrupted'
    : '';

  return (
    <div
      className={`execution-flow-container ${frozenClass}`.trim()}
      data-flow-status={flowStatus}
    >
      <ExecutionFlowHeader
        executionState={executionState}
        isWaitingForApproval={waitingForApproval}
        isExecuting={isExecuting}
        isFlowSuccessful={flowSuccessful}
        isFlowFailed={flowFailed}
        isFrozen={isFrozen}
        isComplete={isComplete}
        isInterrupted={interrupted}
        showRestore={showRestore}
        showRerun={showRerun}
        isRestoring={isRestoring}
        isRerunning={isRerunning}
        onRestore={onRestoreHandler}
        onRerun={onRerunHandler}
      />

      {!isFrozen && !hasActiveSimulation && !allSimulationsComplete && waitingForApproval && (
        <ApprovalMessage simulationEnabled={simulationEnabled} />
      )}

      <div className="execution-flow-items">
        {executionState.items.map((item, index) => {
          const itemIsExpanded = isExpanded(item.id);
          return (
            <ExecutionFlowItem
              key={item.id}
              item={item}
              index={index}
              isExpanded={itemIsExpanded}
              onToggleExpand={toggleExpand}
              isFrozen={isFrozen}
            />
          );
        })}
      </div>

      <ExecutionFlowFooter
        executionState={executionState}
        isWaitingForApproval={waitingForApproval}
        isComplete={isComplete}
        isFlowSuccessful={flowSuccessful}
        isFlowFailed={flowFailed}
        isSimulating={isSimulating}
        showCancel={false}
        showAccept={showAccept}
        isFrozen={isFrozen}
        onAcceptAndStart={onAcceptAndStartHandler}
        onCancel={handleCancel}
      />
    </div>
  );
};

export default ExecutionFlow;
