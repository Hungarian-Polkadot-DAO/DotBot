/**
 * Execution Flow Header Component
 * 
 * Displays the title, step count, summary badges, and overall simulation status
 */

import React from 'react';
import { Loader2 } from 'lucide-react';
import { ExecutionArrayState } from '../../lib/executionEngine/types';
import { isSimulationEnabled } from '../../lib/executionEngine/simulation/simulationConfig';
import { getSimulationStats, areAllSimulationsComplete } from './simulationUtils';
import SimulationStatus from '../simulation/SimulationStatus';

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
  const simulationEnabled = isSimulationEnabled();
  
  // Get overall simulation status (from first simulating item or first completed item)
  let overallSimulationStatus = null;
  if (executionState && simulationEnabled) {
    const simulationStats = getSimulationStats(executionState);
    const isSimulating = simulationStats.totalSimulating > 0;
    const allSimulationsComplete = areAllSimulationsComplete(executionState.items, isSimulating);
    
    // Find the first simulating item for overall status
    const simulatingItem = simulationStats.simulatingItems[0];
    // If no simulating items, find the first item with simulation status
    const itemWithSimulation = simulatingItem || executionState.items.find(item => item.simulationStatus);
    
    if (itemWithSimulation?.simulationStatus) {
      // Use the first item's simulation status as overall status
      overallSimulationStatus = itemWithSimulation.simulationStatus;
    }
  }

  if (!executionState) {
    return (
      <div className="execution-flow-header">
        <div className="execution-flow-title">
          <h3>Execution Flow</h3>
          <span className="execution-flow-count">Preparing...</span>
        </div>
      </div>
    );
  }

  // Determine header title based on flow state
  let headerTitle = 'Execution Flow';
  if (isWaitingForApproval) {
    headerTitle = 'Review Transaction Flow';
  } else if (isFlowSuccessful) {
    headerTitle = '✓ Flow Completed Successfully';
  } else if (isFlowFailed) {
    headerTitle = '✗ Flow Failed';
  } else if (isExecuting) {
    headerTitle = 'Executing Flow';
  }

  return (
    <div className="execution-flow-header">
      <div className="execution-flow-header-top">
        <div className="execution-flow-title">
          <h3>{headerTitle}</h3>
          <span className="execution-flow-count">
            {executionState.totalItems} step{executionState.totalItems !== 1 ? 's' : ''}
          </span>
        </div>
        
        {!isWaitingForApproval && (
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
        )}
      </div>
      
      {/* Overall Simulation Status - Show in header as a line when simulation is active or complete */}
      {simulationEnabled && overallSimulationStatus && (
        <div className="execution-flow-simulation-status">
          <SimulationStatus
            phase={overallSimulationStatus.phase}
            message={overallSimulationStatus.message}
            progress={overallSimulationStatus.progress}
            details={overallSimulationStatus.details}
            chain={overallSimulationStatus.chain}
            result={overallSimulationStatus.result}
            compact={true}
          />
        </div>
      )}
    </div>
  );
};

export default ExecutionFlowHeader;

