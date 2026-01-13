/**
 * Execution Flow Item Component
 * 
 * Displays a single execution item with expandable details
 */

import React from 'react';
import { ExecutionItem } from '@dotbot/core/executionEngine/types';
import { ItemHeader, ItemDetails } from './components';

export interface ExecutionFlowItemProps {
  item: ExecutionItem;
  index: number;
  isExpanded: boolean;
  onToggleExpand: (itemId: string) => void;
}

const ExecutionFlowItem: React.FC<ExecutionFlowItemProps> = ({
  item,
  index,
  isExpanded,
  onToggleExpand
}) => {
  const hasSimulationStatus = !!item.simulationStatus;
  
  // Determine simulation status for data attribute
  const simulationStatusAttr = 
    item.status === 'pending' && hasSimulationStatus ? 'simulating' :
    item.status === 'pending' && !hasSimulationStatus ? 'waiting' :
    item.status === 'ready' ? 'success' :
    item.status === 'failed' ? 'failed' : 'none';

  return (
    <div
      className={`execution-item ${item.status} ${isExpanded ? 'expanded' : ''}`}
      data-simulation-status={simulationStatusAttr}
    >
      <ItemHeader
        item={item}
        index={index}
        isExpanded={isExpanded}
        onToggleExpand={() => onToggleExpand(item.id)}
      />
      {isExpanded && <ItemDetails item={item} />}
    </div>
  );
};

export default ExecutionFlowItem;

