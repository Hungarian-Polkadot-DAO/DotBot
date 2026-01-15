/**
 * Execution Flow Component
 * 
 * Visual representation of the ExecutionArray.
 * Shows all steps that will happen and provides a single "Accept and Start" button.
 */

import React from 'react';
import type { ExecutionMessage, DotBot } from '@dotbot/core';
import { ExecutionArrayState } from '@dotbot/core/executionEngine/types';
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
  isFlowFailed
} from './executionFlowUtils';
import { startExecution } from '../../services/dotbotApi';
import './execution-flow.css';

export interface ExecutionFlowProps {
  // New API: Pass ExecutionMessage + DotBot instance
  executionMessage?: ExecutionMessage;
  dotbot?: DotBot;
  backendSessionId?: string | null; // Backend session ID for API calls (stateless mode)
  
  // Legacy API: Pass state directly
  state?: ExecutionArrayState | null;
  onAcceptAndStart?: () => void;
  onCancel?: () => void;
  show?: boolean;
}

const ExecutionFlow: React.FC<ExecutionFlowProps> = ({
  executionMessage,
  dotbot,
  backendSessionId,
  state,
  onAcceptAndStart,
  onCancel,
  show = true
}) => {
  // Removed verbose logging - was causing console spam
  
  // Use custom hooks for state management (passes backendSessionId for polling)
  const executionState = useExecutionFlowState(executionMessage, dotbot, state, backendSessionId);
  const { isExpanded, toggleExpand } = useExpandedItems();

  // Determine if we should show the component
  const shouldShow = executionMessage ? true : show;
  if (!shouldShow) {
    return null;
  }

  // If we have executionMessage, always show something (loading or content)
  // This ensures the component is visible while state is being fetched
  if (executionMessage) {
    // Show loading if we don't have state yet
    if (!executionState) {
      return (
        <div className="execution-flow-container">
          <ExecutionFlowHeader
            executionState={null}
            isWaitingForApproval={false}
            isExecuting={false}
          />
          <LoadingState />
        </div>
      );
    }

    // Show loading if state exists but has no items yet
    if (executionState.items.length === 0) {
      return (
        <div className="execution-flow-container">
          <ExecutionFlowHeader
            executionState={executionState}
            isWaitingForApproval={false}
            isExecuting={false}
          />
          <LoadingState />
        </div>
      );
    }

    // We have state with items - render the full component
    // (executionState is guaranteed to be truthy here)
  } else {
    // Legacy mode: need state to render
    if (!executionState) {
      return null;
    }

    // Show loading if state has no items
    if (executionState.items.length === 0) {
      return (
        <div className="execution-flow-container">
          <ExecutionFlowHeader
            executionState={executionState}
            isWaitingForApproval={false}
            isExecuting={false}
          />
          <LoadingState />
        </div>
      );
    }
  }

  // Final check - executionState must exist at this point
  if (!executionState) {
    return null;
  }

  // Handle execution through DotBot if using new API
  // Execution always happens on frontend (where signing handlers are available)
  // If backend has state, use it; otherwise rebuild from executionPlan locally
  const handleAcceptAndStart = async () => {
    if (executionMessage && dotbot) {
      // Check if we need to get state from backend (stateless mode)
      if (backendSessionId && (!dotbot.currentChat || !dotbot.currentChat.getExecutionArray(executionMessage.executionId))) {
        // Try to get state from backend (may fail if server restarted)
        // Use Promise.race with timeout to avoid blocking UI too long
        console.info('[ExecutionFlow] Starting execution from backend');
        try {
          const backendPromise = startExecution(backendSessionId, executionMessage.executionId, false);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Backend call timeout')), 2000)
          );
          
          const response = await Promise.race([backendPromise, timeoutPromise]) as Awaited<ReturnType<typeof startExecution>>;
          
          // Don't mutate props - WebSocket subscription will handle state updates
          // The backend startExecution call just triggers execution on backend
          // Frontend execution will rebuild from executionPlan if needed
          console.info('[ExecutionFlow] Backend execution started', response);
        } catch (error: any) {
          // Backend doesn't have state (e.g., server restarted) - that's OK
          // We'll rebuild from executionPlan locally
          if (error.message?.includes('404') || error.message?.includes('not found') || error.message?.includes('timeout')) {
            console.log('[ExecutionFlow] Backend state not found or timeout (server may have restarted), rebuilding from executionPlan locally');
          } else {
            console.warn('[ExecutionFlow] Failed to start execution on backend:', error);
          }
        }
      }
      
      // Execute on frontend (both stateful and stateless modes)
      // startExecution will rebuild ExecutionArray from executionPlan if needed
      // WebSocket subscription will update UI with state changes
      dotbot.startExecution(executionMessage.executionId, { autoApprove: false })
        .catch(error => {
          console.error('[ExecutionFlow] Execution failed:', error);
          // TODO: Add user-visible error notification
        });
      console.log('[ExecutionFlow] Started execution on frontend...');
    } else if (onAcceptAndStart) {
      onAcceptAndStart();
    }
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

  return (
    <div className="execution-flow-container" data-flow-status={flowStatus}>
      <ExecutionFlowHeader
        executionState={executionState}
        isWaitingForApproval={waitingForApproval}
        isExecuting={isExecuting}
        isFlowSuccessful={flowSuccessful}
        isFlowFailed={flowFailed}
      />

      {!hasActiveSimulation && !allSimulationsComplete && waitingForApproval && (
        <ApprovalMessage simulationEnabled={simulationEnabled} />
      )}

      <div className="execution-flow-items">
        {executionState.items.map((item, index) => (
          <ExecutionFlowItem
            key={item.id}
            item={item}
            index={index}
            isExpanded={isExpanded(item.id)}
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
        showCancel={false}
        showAccept={!!(onAcceptAndStart || executionMessage)}
        onAcceptAndStart={handleAcceptAndStart}
        onCancel={handleCancel}
      />
    </div>
  );
};

export default ExecutionFlow;
