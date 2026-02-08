/**
 * Simulation Status Line Component
 * 
 * Displays overall simulation status as a compact line in the header
 */

import React from 'react';
import { ExecutionArrayState } from '@dotbot/core/executionEngine/types';
import { isSimulationEnabled } from '@dotbot/core/executionEngine/simulation/simulationConfig';
import { getSimulationStats } from '../simulationUtils';
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

  const simulatingItem = simulationStats.simulatingItems[0];
  const failedItem = executionState.items.find(
    item => item.simulationStatus?.phase === 'error' || item.simulationStatus?.result?.success === false
  );
  const itemWithSimulation = simulatingItem || failedItem || executionState.items.find(item => item.simulationStatus);

  if (!itemWithSimulation?.simulationStatus) {
    return null;
  }

  const overallSimulationStatus = itemWithSimulation.simulationStatus;
  const simulatedItems = executionState.items.filter(item => item.simulationStatus && item.estimatedFee);
  const cumulativeFee =
    simulatedItems.length > 1
      ? simulatedItems.reduce((sum, item) => sum + BigInt(item.estimatedFee!), BigInt(0)).toString()
      : undefined;
  const result =
    cumulativeFee !== undefined && overallSimulationStatus.result
      ? { ...overallSimulationStatus.result, estimatedFee: cumulativeFee }
      : overallSimulationStatus.result;

  return (
    <div className="execution-flow-simulation-status">
      <SimulationStatus
        phase={overallSimulationStatus.phase}
        message={overallSimulationStatus.message}
        progress={overallSimulationStatus.progress}
        details={overallSimulationStatus.details}
        chain={overallSimulationStatus.chain}
        result={result}
        compact={false}
      />
    </div>
  );
};

export default SimulationStatusLine;
