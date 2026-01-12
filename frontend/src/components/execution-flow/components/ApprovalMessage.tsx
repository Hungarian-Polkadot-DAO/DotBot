/**
 * Approval Message Component
 * 
 * Displays message when waiting for user approval
 */

import React from 'react';
import { isSimulationEnabled } from '../../../lib/executionEngine/simulation/simulationConfig';

export interface ApprovalMessageProps {
  simulationEnabled?: boolean;
}

const ApprovalMessage: React.FC<ApprovalMessageProps> = ({ 
  simulationEnabled 
}) => {
  const enabled = simulationEnabled ?? isSimulationEnabled();
  
  return (
    <div className="execution-flow-intro">
      <p>
        {enabled 
          ? 'Review the steps below. Once you accept, your wallet will ask you to sign each transaction.'
          : 'Review the steps below. Simulation is disabled - transactions will be sent directly to the network. Once you accept, your wallet will ask you to sign each transaction.'}
      </p>
    </div>
  );
};

export default ApprovalMessage;
