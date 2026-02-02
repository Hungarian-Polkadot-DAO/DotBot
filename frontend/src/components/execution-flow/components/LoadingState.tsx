/**
 * Loading State Component
 *
 * Displays loading indicator when execution is being prepared.
 * When frozen (historical), no spinning.
 */

import React from 'react';
import { Loader2, Clock } from 'lucide-react';

export interface LoadingStateProps {
  message?: string;
  /** When true (frozen/historical), show static icon, no spin. */
  isFrozen?: boolean;
}

const LoadingState: React.FC<LoadingStateProps> = ({
  message = 'Preparing transaction flow...',
  isFrozen = false
}) => {
  return (
    <div className="execution-flow-loading">
      {isFrozen ? (
        <Clock size={24} />
      ) : (
        <Loader2 className="animate-spin" size={24} />
      )}
      <p>{message}</p>
    </div>
  );
};

export default LoadingState;
