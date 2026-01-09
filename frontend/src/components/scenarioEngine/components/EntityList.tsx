/**
 * Entity List Component
 * 
 * Displays list of entities or empty state
 */

import React from 'react';
import { EntityItem } from './EntityItem';

interface Entity {
  name: string;
  address: string;
  type: string;
  balance: string;
}

interface EntityListProps {
  entities: Entity[];
}

export const EntityList: React.FC<EntityListProps> = ({ entities }) => {
  if (entities.length === 0) {
    return (
      <div className="scenario-empty-state">
        <div className="scenario-empty-icon">▸▸▸</div>
        <div className="scenario-empty-text">
          No entities created yet.
        </div>
        <div className="scenario-empty-hint">
          Click "CREATE ENTITIES" below to generate test accounts.
        </div>
      </div>
    );
  }

  return (
    <>
      {entities.map((entity) => (
        <EntityItem
          key={entity.name}
          name={entity.name}
          address={entity.address}
          type={entity.type}
          balance={entity.balance}
        />
      ))}
    </>
  );
};

