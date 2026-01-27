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
import { formatFeeFromItem } from '../utils/formatAmount';

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

  const simulationStatus = item.simulationStatus;
  const simulationResult = simulationStatus?.result;
  const simulationFee = simulationResult?.estimatedFee;
  const simulationPhase = simulationStatus?.phase;
  const simulationChain = simulationStatus?.chain;
  
  let feeDisplay: string | null = null;
  if (item.estimatedFee || simulationFee) {
    // If simulationStatus exists, it means simulation ran
    // If result exists OR phase is 'complete', simulation completed successfully
    // Show "from simulation" if simulation completed, otherwise "approximated"
    const hasSimulation = !!simulationStatus;
    const simulationCompleted = !!simulationResult || simulationPhase === 'complete';
    
    if (hasSimulation && simulationCompleted) {
      // Prefer fee from simulation result, fallback to item.estimatedFee (which was updated from simulation)
      const realFee = simulationFee || item.estimatedFee;
      if (realFee && realFee !== '0') {
        feeDisplay = `${formatFeeFromItem(realFee, item.metadata, simulationChain)} (from simulation)`;
      }
    } else {
      // No simulation completed yet, show approximated fee
      const feeToShow = item.estimatedFee || simulationFee || '0';
      if (feeToShow !== '0') {
        feeDisplay = `${formatFeeFromItem(feeToShow, item.metadata, simulationChain)} (approximated)`;
      } else {
        feeDisplay = '0';
      }
    }
  }

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
            {feeDisplay && (
              <span className="execution-item-fee">
                Fee: {feeDisplay}
              </span>
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
