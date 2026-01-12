/**
 * Executing Indicator
 * 
 * Displays processing indicator for an executing item
 */

import React from 'react';
import { Loader2 } from 'lucide-react';

export interface ExecutingIndicatorProps {
  isItemExecuting: boolean;
}

export const ExecutingIndicator: React.FC<ExecutingIndicatorProps> = ({ isItemExecuting }) => {
  if (!isItemExecuting) {
    return null;
  }

  return (
    <div className="execution-item-executing">
      <Loader2 className="animate-spin" size={16} />
      <span>Processing...</span>
    </div>
  );
};
