/**
 * Item Header Component
 * 
 * Displays the header for a single execution item
 */

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { ExecutionItem } from '@dotbot/core/executionEngine/types';
import { getStatusIcon, getStatusLabel, getStatusColor } from '../executionStatusUtils';
import { isSimulationEnabled } from '@dotbot/core/executionEngine/simulation/simulationConfig';

export interface ItemHeaderProps {
  item: ExecutionItem;
  index: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

const ItemHeader: React.FC<ItemHeaderProps> = ({
  item,
  index,
  isExpanded,
  onToggleExpand
}) => {
  const simulationEnabled = isSimulationEnabled();
  const hasDetails = !!(item.warnings?.length || item.metadata || item.simulationStatus);

  return (
    <div
      className="execution-item-header"
      onClick={onToggleExpand}
    >
      <div className="execution-item-main">
        <div className="execution-item-number">{index + 1}</div>
        {getStatusIcon(item.status)}
        <div className="execution-item-content">
          <div className="execution-item-description">{item.description}</div>
          <div className="execution-item-meta">
            {item.estimatedFee && item.status !== 'pending' && (
              <span className="execution-item-fee">Fee: {item.estimatedFee}</span>
            )}
            <span
              className={`execution-item-status status-${item.status}`}
              style={{ color: getStatusColor(item.status) }}
            >
              {getStatusLabel(item.status, simulationEnabled)}
            </span>
          </div>
        </div>
      </div>
      {hasDetails && (
        <ChevronRight
          className={`execution-item-chevron ${isExpanded ? 'expanded' : ''}`}
        />
      )}
    </div>
  );
};

export default ItemHeader;
