/**
 * Entity List Component
 * 
 * Displays list of entities or empty state.
 * Optimized for large lists with scrolling.
 */

import React, { useMemo } from 'react';
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

const MAX_VISIBLE_ENTITIES = 50; // Show first 50, then scroll

export const EntityList: React.FC<EntityListProps> = ({ entities }) => {
  const { visibleEntities, hasMore } = useMemo(() => {
    if (entities.length <= MAX_VISIBLE_ENTITIES) {
      return { visibleEntities: entities, hasMore: false };
    }
    return {
      visibleEntities: entities.slice(0, MAX_VISIBLE_ENTITIES),
      hasMore: true,
    };
  }, [entities]);

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
    <div className="scenario-entities-container">
      {hasMore && (
        <div className="scenario-entities-count">
          Showing {MAX_VISIBLE_ENTITIES} of {entities.length} entities (scroll to see more)
        </div>
      )}
      <div className="scenario-entities-list">
        {visibleEntities.map((entity) => (
          <EntityItem
            key={entity.name}
            name={entity.name}
            address={entity.address}
            type={entity.type}
            balance={entity.balance}
          />
        ))}
        {hasMore && (
          <div className="scenario-entities-more">
            ... and {entities.length - MAX_VISIBLE_ENTITIES} more (scroll to view)
          </div>
        )}
      </div>
    </div>
  );
};

