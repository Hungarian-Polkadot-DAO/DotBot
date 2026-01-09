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
  return (
    <div className="scenario-entity">
      <div className="scenario-entity-name">
        <span className="scenario-entity-bullet">▸</span>
        {name}
      </div>
      <div className="scenario-entity-details">
        <div className="scenario-entity-address">{address}</div>
        <div className="scenario-entity-meta">
          <span className="scenario-entity-type">{type}</span>
          <span className="scenario-entity-balance">{balance}</span>
        </div>
      </div>
    </div>
  );
};

