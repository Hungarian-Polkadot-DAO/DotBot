/**
 * Simulation Status Section
 * 
 * Displays simulation status in item details
 */

import React from 'react';
import { ExecutionItem } from '@dotbot/core/executionEngine/types';
import SimulationStatus from '../SimulationStatus';

export interface SimulationStatusSectionProps {
  item: ExecutionItem;
}

export const SimulationStatusSection: React.FC<SimulationStatusSectionProps> = ({ item }) => {
  if (!item.simulationStatus || item.status === 'pending') {
    return null;
  }

  return (
    <div className="execution-detail-section">
      <div className="execution-detail-label">Simulation Status</div>
      <div className="execution-detail-value">
        <SimulationStatus
          phase={item.simulationStatus.phase}
          message={item.simulationStatus.message}
          progress={item.simulationStatus.progress}
          details={item.simulationStatus.details}
          chain={item.simulationStatus.chain}
          result={item.simulationStatus.result}
        />
      </div>
    </div>
  );
};
