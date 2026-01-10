/**
 * Entity Item Component
 * 
 * Displays a single test entity (Alice, Bob, etc.)
 */

import React from 'react';

interface EntityItemProps {
  name: string;
  address: string;
  type: string;
  balance: string;
}

export const EntityItem: React.FC<EntityItemProps> = ({
  name,
  address,
  type,
  balance,
}) => {
  // Format type for display
  const typeLabel = type === 'keypair' ? 'Keypair' : type === 'multisig' ? 'Multisig' : type === 'proxy' ? 'Proxy' : type;
  
  return (
    <div className="scenario-entity">
      <div className="scenario-entity-name">
        <span className="scenario-entity-bullet">▸</span>
        {name}
      </div>
      <div className="scenario-entity-details">
        <div className="scenario-entity-address">{address}</div>
        <div className="scenario-entity-meta">
          <span className="scenario-entity-type">{typeLabel}</span>
          <span className="scenario-entity-separator">•</span>
          <span className="scenario-entity-balance">{balance}</span>
        </div>
      </div>
    </div>
  );
};

