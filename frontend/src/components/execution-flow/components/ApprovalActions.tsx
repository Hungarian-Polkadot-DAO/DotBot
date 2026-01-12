/**
 * Approval Actions Component
 * 
 * Displays approval buttons (Accept & Start, Cancel)
 */

import React from 'react';
import { Play, X } from 'lucide-react';

export interface ApprovalActionsProps {
  showCancel: boolean;
  showAccept: boolean;
  isSimulating: boolean;
  onAcceptAndStart: () => void;
  onCancel: () => void;
}

const ApprovalActions: React.FC<ApprovalActionsProps> = ({
  showCancel,
  showAccept,
  isSimulating,
  onAcceptAndStart,
  onCancel
}) => {
  return (
    <div className="execution-flow-approval-actions">
      {showCancel && (
        <button
          onClick={onCancel}
          className="execution-cancel-btn"
        >
          <X size={16} />
          Cancel
        </button>
      )}
      {showAccept && (
        <button
          onClick={onAcceptAndStart}
          className="execution-accept-btn"
          disabled={isSimulating}
          title={isSimulating ? 'Waiting for simulation to complete...' : 'Accept and start execution'}
        >
          <Play size={16} />
          {isSimulating ? 'Simulating...' : 'Accept and Start'}
        </button>
      )}
    </div>
  );
};

export default ApprovalActions;
