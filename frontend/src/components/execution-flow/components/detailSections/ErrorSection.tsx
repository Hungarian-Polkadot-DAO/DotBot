/**
 * Error Section
 * 
 * Displays error information for a failed execution item
 */

import React from 'react';
import { ExecutionItem } from '@dotbot/core/executionEngine/types';

export interface ErrorSectionProps {
  item: ExecutionItem;
  isItemFailed: boolean;
}

export const ErrorSection: React.FC<ErrorSectionProps> = ({ item, isItemFailed }) => {
  if (!isItemFailed || !item.error) {
    return null;
  }

  return (
    <div className="execution-detail-section execution-detail-error">
      <div className="execution-detail-label">Error</div>
      <div className="execution-detail-value">{item.error}</div>
    </div>
  );
};
