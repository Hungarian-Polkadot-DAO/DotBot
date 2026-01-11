/**
 * Simulation Container Component
 * 
 * Master/container component that shows overall simulation progress for the entire ExecutionFlow.
 * Displays unified simulation status, progress, and summary for all transactions.
 */

import React from 'react';
import { Loader2, CheckCircle2, AlertTriangle, Play } from 'lucide-react';
import { ExecutionArrayState } from '../../lib/executionEngine/types';
import { isSimulationEnabled } from '../../lib/executionEngine/simulation/simulationConfig';

export interface SimulationContainerProps {
  executionState: ExecutionArrayState;
}

const SimulationContainer: React.FC<SimulationContainerProps> = ({ executionState }) => {
  const simulationEnabled = isSimulationEnabled();
  
  if (!simulationEnabled) {
    return null; // Don't show simulation container if simulation is disabled
  }

  // Get all items that should be simulated
  const itemsToSimulate = executionState.items.filter(
    item => item.executionType === 'extrinsic' && item.agentResult?.extrinsic
  );

  if (itemsToSimulate.length === 0) {
    return null; // No items to simulate
  }

  // Calculate simulation statistics
  const itemsWithSimulation = itemsToSimulate.filter(item => item.simulationStatus);
  const simulatingItems = itemsWithSimulation.filter(item => {
    if (!item.simulationStatus) return false;
    const phase = item.simulationStatus.phase;
    return (
      item.status === 'pending' ||
      phase === 'initializing' ||
      phase === 'simulating' ||
      phase === 'validating' ||
      phase === 'analyzing' ||
      phase === 'retrying' ||
      phase === 'forking' ||
      phase === 'executing'
    );
  });

  const completedItems = itemsWithSimulation.filter(item => 
    item.simulationStatus?.phase === 'complete' || 
    (item.simulationStatus?.result?.success === true && item.status === 'ready')
  );

  const failedItems = itemsWithSimulation.filter(item => 
    item.simulationStatus?.phase === 'error' || 
    (item.simulationStatus?.result?.success === false && item.status === 'failed')
  );

  const isSimulating = simulatingItems.length > 0;
  const allComplete = !isSimulating && itemsWithSimulation.length === itemsToSimulate.length && 
    itemsWithSimulation.every(item => 
      item.simulationStatus?.phase === 'complete' || 
      item.simulationStatus?.phase === 'error' ||
      item.status === 'ready' || 
      item.status === 'failed'
    );

  // Calculate overall progress
  const totalItems = itemsToSimulate.length;
  const completedCount = completedItems.length + failedItems.length;
  const progressPercent = totalItems > 0 ? Math.round((completedCount / totalItems) * 100) : 0;

  // Get current simulation phase and message from the first simulating item
  let currentPhase: string | null = null;
  let currentMessage: string | null = null;
  let currentProgress: number | undefined = undefined;

  if (simulatingItems.length > 0) {
    const firstSimulating = simulatingItems[0];
    if (firstSimulating.simulationStatus) {
      currentPhase = firstSimulating.simulationStatus.phase;
      currentMessage = firstSimulating.simulationStatus.message;
      currentProgress = firstSimulating.simulationStatus.progress;
    }
  }

  // Determine container state
  if (allComplete) {
    // All simulations complete - show summary
    const allSuccess = failedItems.length === 0;
    return (
      <div className="simulation-container simulation-complete">
        <div className="simulation-container-header">
          <div className="simulation-container-icon">
            {allSuccess ? (
              <CheckCircle2 size={20} className="text-green-500" />
            ) : (
              <AlertTriangle size={20} className="text-yellow-500" />
            )}
          </div>
          <div className="simulation-container-content">
            <div className="simulation-container-title">
              {allSuccess ? '✓ Simulation Complete' : '⚠ Simulation Complete with Errors'}
            </div>
            <div className="simulation-container-description">
              {allSuccess ? (
                <>
                  All {totalItems} transaction{totalItems !== 1 ? 's' : ''} passed simulation and {totalItems !== 1 ? 'are' : 'is'} ready to execute.
                </>
              ) : (
                <>
                  {completedItems.length} passed, {failedItems.length} failed. Review the details below.
                </>
              )}
            </div>
          </div>
        </div>
        {totalItems > 1 && (
          <div className="simulation-container-progress-bar">
            <div 
              className="simulation-container-progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  if (isSimulating) {
    // Simulation in progress
    const currentItemIndex = itemsWithSimulation.length;
    const isSequential = totalItems > 1;
    
    return (
      <div className="simulation-container simulation-active">
        <div className="simulation-container-header">
          <div className="simulation-container-icon">
            <Loader2 size={20} className="animate-spin text-blue-500" />
          </div>
          <div className="simulation-container-content">
            <div className="simulation-container-title">
              {isSequential ? (
                <>Simulating Transaction Flow ({currentItemIndex + 1}/{totalItems})</>
              ) : (
                <>Simulating Transaction</>
              )}
            </div>
            <div className="simulation-container-description">
              {currentMessage || 'Preparing simulation...'}
              {isSequential && currentItemIndex > 0 && (
                <span className="simulation-container-sequential-note">
                  {' '}(Previous {currentItemIndex} transaction{currentItemIndex !== 1 ? 's' : ''} completed)
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="simulation-container-progress-bar">
          <div 
            className="simulation-container-progress-fill simulation-container-progress-active"
            style={{ 
              width: currentProgress !== undefined 
                ? `${currentProgress}%` 
                : `${progressPercent}%` 
            }}
          />
        </div>
        {isSequential && (
          <div className="simulation-container-items-status">
            {itemsToSimulate.map((item, index) => {
              const simStatus = item.simulationStatus;
              const isCurrent = index === currentItemIndex;
              const isDone = index < currentItemIndex;
              const isPending = index > currentItemIndex;
              
              return (
                <div 
                  key={item.id}
                  className={`simulation-container-item-status ${
                    isCurrent ? 'current' : isDone ? 'done' : 'pending'
                  }`}
                >
                  <div className="simulation-container-item-number">{index + 1}</div>
                  <div className="simulation-container-item-status-icon">
                    {isDone ? (
                      <CheckCircle2 size={14} className="text-green-500" />
                    ) : isCurrent ? (
                      <Loader2 size={14} className="animate-spin text-blue-500" />
                    ) : (
                      <Play size={14} className="text-gray-400" />
                    )}
                  </div>
                  <div className="simulation-container-item-description">
                    {item.description}
                  </div>
                  {isCurrent && simStatus?.phase && (
                    <div className="simulation-container-item-phase">
                      {simStatus.phase}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Waiting to start simulation
  if (itemsWithSimulation.length === 0) {
    return (
      <div className="simulation-container simulation-waiting">
        <div className="simulation-container-header">
          <div className="simulation-container-icon">
            <Loader2 size={20} className="animate-spin text-gray-400" />
          </div>
          <div className="simulation-container-content">
            <div className="simulation-container-title">Preparing Simulation</div>
            <div className="simulation-container-description">
              Setting up simulation environment for {totalItems} transaction{totalItems !== 1 ? 's' : ''}...
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default SimulationContainer;

