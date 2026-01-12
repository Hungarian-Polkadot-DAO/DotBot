/**
 * Simulation Status Line Component
 * 
 * Displays overall simulation status as a compact line in the header
 */

import React from 'react';
import { ExecutionArrayState } from '../../../lib/executionEngine/types';
import { isSimulationEnabled } from '../../../lib/executionEngine/simulation/simulationConfig';
import { getSimulationStats, areAllSimulationsComplete } from '../simulationUtils';
import SimulationStatus from './SimulationStatus';

export interface SimulationStatusLineProps {
  executionState: ExecutionArrayState;
}

const SimulationStatusLine: React.FC<SimulationStatusLineProps> = ({
  executionState
}) => {
  const simulationEnabled = isSimulationEnabled();
  
  if (!simulationEnabled) {
    return null;
  }

  const simulationStats = getSimulationStats(executionState);
  
  // Find the first simulating item for overall status
  const simulatingItem = simulationStats.simulatingItems[0];
  // If no simulating items, find the first item with simulation status
  const itemWithSimulation = simulatingItem || executionState.items.find(item => item.simulationStatus);
  
  if (!itemWithSimulation?.simulationStatus) {
    return null;
  }

  const overallSimulationStatus = itemWithSimulation.simulationStatus;

  return (
    <div className="execution-flow-simulation-status">
      <SimulationStatus
        phase={overallSimulationStatus.phase}
        message={overallSimulationStatus.message}
        progress={overallSimulationStatus.progress}
        details={overallSimulationStatus.details}
        chain={overallSimulationStatus.chain}
        result={overallSimulationStatus.result}
        compact={false}
      />
    </div>
  );
};

export default SimulationStatusLine;
