/**
 * Entities Tab Component
 * 
 * Manages entity creation and display
 */

import React from 'react';
import { ScenarioEngine, DotBot } from '../../../lib';
import { ModeSelector, ExecutionMode } from './ModeSelector';
import { EntityList } from './EntityList';

interface Entity {
  name: string;
  address: string;
  type: string;
  mnemonic?: string;
  balance: string;
}

interface EntitiesTabProps {
  engine: ScenarioEngine;
  dotbot: DotBot;
  mode: ExecutionMode;
  onModeChange: (mode: ExecutionMode) => void;
  entities: Entity[];
  isCreating: boolean;
  onAppendReport: (text: string) => void;
  onCreateEntities: () => Promise<void>;
}

export const EntitiesTab: React.FC<EntitiesTabProps> = ({
  mode,
  onModeChange,
  entities,
  isCreating,
  onCreateEntities,
}) => {
  return (
    <div className="scenario-panel">
      <div className="scenario-panel-header">
        {'>'} TEST ENTITIES
      </div>
      
      <ModeSelector
        mode={mode}
        onModeChange={onModeChange}
        label="ENTITY MODE:"
        showEntityInfo={true}
        entityCount={entities.length}
      />
      
      <div className="scenario-entities">
        <EntityList entities={entities} />
      </div>
      
      <div className="scenario-panel-footer">
        <button 
          className="scenario-btn scenario-btn-primary"
          onClick={onCreateEntities}
          disabled={isCreating}
        >
          {isCreating 
            ? 'CREATING...' 
            : entities.length > 0 
              ? `RECREATE ENTITIES (${mode.toUpperCase()})` 
              : 'CREATE ENTITIES'}
        </button>
        {entities.length > 0 && (
          <div className="scenario-entity-warning">
            {'>'} Entities will be cleared if mode changes
          </div>
        )}
      </div>
    </div>
  );
};

