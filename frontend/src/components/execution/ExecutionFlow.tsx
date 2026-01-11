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
  useEffect(() => {
    if (!executionMessage || !dotbot || !dotbot.currentChat) {
      console.log('[ExecutionFlow] Not subscribing - missing:', {
        hasExecutionMessage: !!executionMessage,
        hasDotbot: !!dotbot,
        hasCurrentChat: !!dotbot?.currentChat
      });
      return;
    }

    const chatInstance = dotbot.currentChat;
    const executionId = executionMessage.executionId;

    console.log('[ExecutionFlow] Setting up subscription for:', executionId);

    // Function to update state from ExecutionArray or executionMessage
    const updateState = () => {
      // Get current state immediately from ExecutionArray if it exists
      // This ensures we see simulation progress even if component mounts after simulation starts
      const executionArray = chatInstance.getExecutionArray(executionId);
      if (executionArray) {
        const currentState = executionArray.getState();
        setLiveExecutionState(currentState);
        return true;
      } else if (executionMessage.executionArray) {
        // Fallback to executionMessage state if ExecutionArray not set yet
        console.log('[ExecutionFlow] Using state from executionMessage:', {
          itemsCount: executionMessage.executionArray.items.length
        });
        setLiveExecutionState(executionMessage.executionArray);
        return true;
      }
      return false;
    };

    // Try to get state immediately
    updateState();

    // If ExecutionArray doesn't exist yet, poll for it (in case it's being set asynchronously)
    let pollInterval: NodeJS.Timeout | null = null;
    if (!chatInstance.getExecutionArray(executionId) && !executionMessage.executionArray) {
      pollInterval = setInterval(() => {
        if (updateState()) {
          // Found ExecutionArray, stop polling
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        }
      }, 100); // Check every 100ms
    }

    // Subscribe to execution updates
    const unsubscribe = chatInstance.onExecutionUpdate(executionId, (updatedState) => {
      console.log('[ExecutionFlow] ✅ Received state update:', {
        executionId,
        itemsCount: updatedState.items.length,
        itemsWithSimulation: updatedState.items.filter(item => item.simulationStatus).length,
        itemsStatuses: updatedState.items.map(item => ({ 
          id: item.id, 
          status: item.status, 
          hasSim: !!item.simulationStatus,
          simPhase: item.simulationStatus?.phase 
        }))
      });
      setLiveExecutionState(updatedState);
      // Stop polling once we receive updates
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    });

    // Cleanup subscription and polling on unmount
    return () => {
      console.log('[ExecutionFlow] Cleaning up subscription for:', executionId);
      if (pollInterval) {
        clearInterval(pollInterval);
      }
      unsubscribe();
    };
  }, [executionMessage?.executionId, executionMessage?.executionArray, dotbot]);

  // Use live state if available, otherwise fall back to snapshot or legacy state
  const executionState = liveExecutionState || executionMessage?.executionArray || state;
  
  // Debug logging - must be after executionState is defined but before early returns
  useEffect(() => {
    if (executionState) {
      const simulationEnabled = isSimulationEnabled();
      const simulatingItems = executionState.items.filter(item => {
        if (!item.simulationStatus) return false;
        const isActivePhase = (
          item.status === 'pending' ||
          item.simulationStatus.phase === 'initializing' ||
          item.simulationStatus.phase === 'simulating' ||
          item.simulationStatus.phase === 'validating' ||
          item.simulationStatus.phase === 'analyzing' ||
          item.simulationStatus.phase === 'retrying' ||
          item.simulationStatus.phase === 'forking' ||
          item.simulationStatus.phase === 'executing'
        );
        return isActivePhase;
      });
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
  const simulatingItems = executionState.items.filter(item => 
    item.simulationStatus && (
      item.status === 'pending' ||
      item.simulationStatus.phase === 'initializing' ||
      item.simulationStatus.phase === 'simulating' ||
      item.simulationStatus.phase === 'validating' ||
      item.simulationStatus.phase === 'analyzing' ||
      item.simulationStatus.phase === 'retrying' ||
      item.simulationStatus.phase === 'forking' ||
      item.simulationStatus.phase === 'executing'
    )
  );
  const isSimulating = simulationEnabled && simulatingItems.length > 0;
  
  // Check simulation results - only count items that actually went through simulation
  const simulatedItems = executionState.items.filter(item => item.simulationStatus);
  const hasSimulationSuccess = simulatedItems.some(item => 
    item.simulationStatus?.phase === 'complete' || 
    (item.simulationStatus?.result?.success === true && item.status === 'ready')
  );
  const hasSimulationFailure = simulatedItems.some(item => 
    item.simulationStatus?.phase === 'error' || 
    (item.simulationStatus?.result?.success === false && item.status === 'failed')
  );
  const allSimulationsComplete = !isSimulating && simulatedItems.length > 0 && 
    simulatedItems.every(item => 
      item.simulationStatus?.phase === 'complete' || 
      item.simulationStatus?.phase === 'error' ||
      item.status === 'ready' || 
      item.status === 'failed'
    );
  const successCount = simulatedItems.filter(item => 
    item.simulationStatus?.phase === 'complete' || 
    (item.simulationStatus?.result?.success === true && item.status === 'ready')
  ).length;
  const failureCount = simulatedItems.filter(item => 
    item.simulationStatus?.phase === 'error' || 
    (item.simulationStatus?.result?.success === false && item.status === 'failed')
  ).length;
  
  // Check if flow is waiting for user approval (all items are pending/ready)
  const isWaitingForApproval = executionState.items.every(item => 
    item.status === 'pending' || item.status === 'ready'
  );
  
  // Check if flow is complete (all items in terminal states)
  const isComplete = executionState.items.every(item => 
    item.status === 'completed' || item.status === 'finalized' || item.status === 'failed' || item.status === 'cancelled'
  );
  
  // Determine if the whole flow is successful
  // Success = all items completed (no failures, no cancellations)
  const isFlowSuccessful = isComplete && executionState.items.every(item =>
    item.status === 'completed' || item.status === 'finalized'
  );
  
  // Determine if the whole flow failed
  // Failed = at least one item failed and flow is complete
  const isFlowFailed = isComplete && executionState.items.some(item =>
    item.status === 'failed'
  );
  
  // Check if flow is executing
  const isExecuting = !isComplete && (
    executionState.isExecuting || executionState.items.some(item => 
      item.status === 'executing' || item.status === 'signing' || item.status === 'broadcasting'
    )
  );

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
  const getSimulationBanner = () => {
    if (simulationEnabled && allSimulationsComplete && hasSimulationSuccess && !hasSimulationFailure && !isExecuting) {
      return <SimulationBanner type="success" successCount={successCount} />;
    }
    if (simulationEnabled && allSimulationsComplete && hasSimulationFailure) {
      return <SimulationBanner type="failure" failureCount={failureCount} />;
    }
    if (!simulationEnabled && isWaitingForApproval) {
      return <SimulationBanner type="disabled" />;
    }
    return null;
  };

  const simulationBanner = getSimulationBanner();
  const hasSimulationBanner = simulationBanner !== null;
  const hasActiveSimulation = simulationEnabled && isSimulating;

  return (
    <div className="execution-flow-container" data-flow-status={isFlowSuccessful ? 'success' : isFlowFailed ? 'failed' : isExecuting ? 'executing' : 'pending'}>
      <ExecutionFlowHeader
        executionState={executionState}
        isWaitingForApproval={isWaitingForApproval}
        isExecuting={isExecuting}
        isFlowSuccessful={isFlowSuccessful}
        isFlowFailed={isFlowFailed}
      />

      {/* Master Simulation Container - Shows overall simulation progress */}
      <SimulationContainer executionState={executionState} />

      {/* Legacy Simulation Banner - Only show if simulation is complete and container doesn't show it */}
      {simulationBanner && !isSimulating && allSimulationsComplete && (
        simulationBanner
      )}

      {/* Approval message (only show when no banner/container is active and simulation is not running) */}
      {!hasSimulationBanner && !hasActiveSimulation && !allSimulationsComplete && isWaitingForApproval && (
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
        isWaitingForApproval={isWaitingForApproval}
        isComplete={isComplete}
        isFlowSuccessful={isFlowSuccessful}
        isFlowFailed={isFlowFailed}
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
