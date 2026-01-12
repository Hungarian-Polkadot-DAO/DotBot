/**
 * Loading State Component
 * 
 * Displays loading indicator when execution is being prepared
 */

import React from 'react';
import { Loader2 } from 'lucide-react';

export interface LoadingStateProps {
  message?: string;
}

const LoadingState: React.FC<LoadingStateProps> = ({ 
  message = 'Preparing transaction flow...' 
}) => {
  return (
    <div className="execution-flow-loading">
      <Loader2 className="animate-spin" size={24} />
      <p>{message}</p>
    </div>
  );
};

export default LoadingState;
