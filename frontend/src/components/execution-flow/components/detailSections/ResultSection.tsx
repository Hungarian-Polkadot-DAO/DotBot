/**
 * Result Section
 * 
 * Displays result information for a completed execution item
 */

import React from 'react';
import { ExecutionItem } from '../../../../lib/executionEngine/types';

export interface ResultSectionProps {
  item: ExecutionItem;
  isItemCompleted: boolean;
}

export const ResultSection: React.FC<ResultSectionProps> = ({ item, isItemCompleted }) => {
  if (!isItemCompleted || !item.result) {
    return null;
  }

  return (
    <div className="execution-detail-section execution-detail-success">
      <div className="execution-detail-label">Result</div>
      <div className="execution-detail-value">
        {item.result.txHash && (
          <div className="result-hash">
            <span>Tx:</span> {item.result.txHash}
          </div>
        )}
        {item.result.blockHash && (
          <div className="result-hash">
            <span>Block:</span> {item.result.blockHash}
          </div>
        )}
      </div>
    </div>
  );
};
