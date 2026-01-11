/**
 * Execution Flow Component
 * 
 * Visual representation of the ExecutionArray.
 * Shows all steps that will happen and provides a single "Accept and Start" button.
 */

import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { ExecutionArrayState } from '../../lib/executionEngine/types';
import type { ExecutionMessage, DotBot } from '../../lib';
import { isSimulationEnabled } from '../../lib/executionEngine/simulation/simulationConfig';
import ExecutionFlowHeader from './ExecutionFlowHeader';
import SimulationBanner from './SimulationBanner';
import SimulationContainer from './SimulationContainer';
import ExecutionFlowItem from './ExecutionFlowItem';
import ExecutionFlowFooter from './ExecutionFlowFooter';
import {
  isItemSimulating,
  areAllSimulationsComplete,
  getSimulationStats
} from './simulationUtils';
import {
  setupExecutionSubscription,
  isWaitingForApproval,
  isFlowComplete,
  isFlowExecuting,
  isFlowSuccessful,
  isFlowFailed,
  getSimulationBannerType,
  getSimulationBannerProps
} from './executionFlowUtils';
import '../../styles/execution-flow.css';

export interface ExecutionFlowProps {
  // New API: Pass ExecutionMessage + DotBot instance
  executionMessage?: ExecutionMessage;
  dotbot?: DotBot;
  
  // Legacy API: Pass state directly
  state?: ExecutionArrayState | null;
  onAcceptAndStart?: () => void;
  onCancel?: () => void;
  show?: boolean;
}

const ExecutionFlow: React.FC<ExecutionFlowProps> = ({
  executionMessage,
  dotbot,
  state,
  onAcceptAndStart,
  onCancel,
  show = true
}) => {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  // Live execution state - updates when execution progresses
  const [liveExecutionState, setLiveExecutionState] = useState<ExecutionArrayState | null>(null);

  // Subscribe to execution updates when using new API (executionMessage + dotbot)
  // Only re-subscribe if executionId changes (not on every state update)
  useEffect(() => {
    if (!executionMessage || !dotbot) {
      return;
    }

    const cleanup = setupExecutionSubscription(
      executionMessage,
      dotbot,
      setLiveExecutionState
    );

    return cleanup;
  }, [executionMessage?.executionId, dotbot]);

  // Use live state if available, otherwise fall back to snapshot or legacy state
  const executionState = liveExecutionState || executionMessage?.executionArray || state;
  
  // Debug logging - must be after executionState is defined but before early returns
  useEffect(() => {
    if (executionState) {
      const simulationEnabled = isSimulationEnabled();
      const simulatingItems = executionState.items.filter(isItemSimulating);
      const isSimulating = simulationEnabled && simulatingItems.length > 0;
    }
  }, [executionState]);
  
  // Determine if we should show the component
  // For executionMessage: always show if message exists (even if state is empty/loading)
  // For legacy: use show prop
  const shouldShow = executionMessage 
    ? true  // Always show if executionMessage exists
    : show;

  // If we shouldn't show at all, return null
  if (!shouldShow) {
    return null;
  }

  // If we have an executionMessage but no state yet, show minimal structure
  // This ensures the component is visible immediately and can receive updates
  if (executionMessage && !executionState) {
    return (
      <div className="execution-flow-container">
        <ExecutionFlowHeader
          executionState={null}
          isWaitingForApproval={false}
          isExecuting={false}
        />
        <div className="execution-flow-loading">
          <Loader2 className="animate-spin" size={24} />
          <p>Preparing transaction flow...</p>
        </div>
      </div>
    );
  }

  // If we have state but no items, show loading state (items are being added)
  // But still show the structure so SimulationContainer can appear
  if (executionState && executionState.items.length === 0) {
    return (
      <div className="execution-flow-container">
        <ExecutionFlowHeader
          executionState={executionState}
          isWaitingForApproval={false}
          isExecuting={false}
        />
        <SimulationContainer executionState={executionState} />
        <div className="execution-flow-loading">
          <Loader2 className="animate-spin" size={24} />
          <p>Preparing transaction flow...</p>
        </div>
      </div>
    );
  }

  // If no executionState at all (legacy mode), return null
  if (!executionState) {
    return null;
  }

  // Handle execution through DotBot if using new API
  const handleAcceptAndStart = async () => {
    if (executionMessage && dotbot) {
      try {
        await dotbot.startExecution(executionMessage.executionId, { autoApprove: false });
      } catch (error) {
        console.error('Failed to start execution:', error);
      }
    } else if (onAcceptAndStart) {
      onAcceptAndStart();
    }
  };

  const handleCancel = () => {
    // TODO: Cancel execution through ChatInstance if using new API
    if (onCancel) {
      onCancel();
    }
  };

  // Check if simulation is enabled and if any items are being simulated
  const simulationEnabled = isSimulationEnabled();
  const simulationStats = getSimulationStats(executionState);
  const isSimulating = simulationEnabled && simulationStats.totalSimulating > 0;
  
  // Check simulation results
  const hasSimulationSuccess = simulationStats.totalCompleted > 0;
  const hasSimulationFailure = simulationStats.totalFailed > 0;
  const allSimulationsComplete = areAllSimulationsComplete(
    executionState.items,
    isSimulating
    );
  const successCount = simulationStats.totalCompleted;
  const failureCount = simulationStats.totalFailed;
  
  // Calculate flow state
  const waitingForApproval = isWaitingForApproval(executionState);
  const isComplete = isFlowComplete(executionState);
  const isExecuting = isFlowExecuting(executionState);
  const flowSuccessful = isFlowSuccessful(executionState);
  const flowFailed = isFlowFailed(executionState);

  const toggleExpand = (itemId: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };

  // Determine which simulation banner to show
  const bannerType = getSimulationBannerType(
    simulationEnabled,
    allSimulationsComplete,
    hasSimulationSuccess,
    hasSimulationFailure,
    isExecuting,
    waitingForApproval
  );
  const bannerProps = getSimulationBannerProps(bannerType, successCount, failureCount);
  const simulationBanner = bannerProps ? <SimulationBanner {...bannerProps} /> : null;
  const hasSimulationBanner = bannerType !== null;
  const hasActiveSimulation = simulationEnabled && isSimulating;

  return (
    <div className="execution-flow-container" data-flow-status={flowSuccessful ? 'success' : flowFailed ? 'failed' : isExecuting ? 'executing' : 'pending'}>
      <ExecutionFlowHeader
        executionState={executionState}
        isWaitingForApproval={waitingForApproval}
        isExecuting={isExecuting}
        isFlowSuccessful={flowSuccessful}
        isFlowFailed={flowFailed}
      />

      {/* Master Simulation Container - Shows overall simulation progress */}
      <SimulationContainer executionState={executionState} />

      {/* Legacy Simulation Banner - Only show if simulation is complete and container doesn't show it */}
      {simulationBanner && !isSimulating && allSimulationsComplete && (
        simulationBanner
      )}

      {/* Approval message (only show when no banner/container is active and simulation is not running) */}
      {!hasSimulationBanner && !hasActiveSimulation && !allSimulationsComplete && waitingForApproval && (
        <div className="execution-flow-intro">
          <p>Review the steps below. Once you accept, your wallet will ask you to sign each transaction.</p>
        </div>
      )}

      {/* Items List */}
      <div className="execution-flow-items">
        {executionState.items.map((item, index) => (
          <ExecutionFlowItem
            key={item.id}
            item={item}
            index={index}
            isExpanded={expandedItems.has(item.id)}
            onToggleExpand={toggleExpand}
          />
        ))}
      </div>

      <ExecutionFlowFooter
        executionState={executionState}
        isWaitingForApproval={waitingForApproval}
        isComplete={isComplete}
        isFlowSuccessful={flowSuccessful}
        isFlowFailed={flowFailed}
        isSimulating={isSimulating}
        showCancel={!!(onCancel || executionMessage)}
        showAccept={!!(onAcceptAndStart || executionMessage)}
        onAcceptAndStart={handleAcceptAndStart}
        onCancel={handleCancel}
      />
    </div>
  );
};

export default ExecutionFlow;
