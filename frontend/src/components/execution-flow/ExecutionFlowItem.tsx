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
  /** When true (frozen/historical flow), no spinning, muted styling. */
  isFrozen?: boolean;
}

const ExecutionFlowItem: React.FC<ExecutionFlowItemProps> = ({
  item,
  index,
  isExpanded,
  onToggleExpand,
  isFrozen = false
}) => {
  const hasSimulationStatus = !!item.simulationStatus;
  const simulationStatusAttr = item.status === 'pending' && hasSimulationStatus ? 'simulating' :
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
        isFrozen={isFrozen}
      />
      {isExpanded && <ItemDetails item={item} />}
    </div>
  );
};

export default ExecutionFlowItem;

