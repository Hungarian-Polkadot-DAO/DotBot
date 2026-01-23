/**
 * Entities Tab Component
 * 
 * Manages entity creation and display
 */

import React from 'react';
import { Trash2, RefreshCw } from 'lucide-react';
import { ScenarioEngine, DotBot } from '@dotbot/core';
import { ModeSelector, ExecutionMode } from './ModeSelector';
import { EntityList } from './EntityList';

interface Entity {
  name: string;
  address: string;
  type: string;
  uri?: string;
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
  onClearEntities?: () => void;
  onRefreshBalances?: () => Promise<void>;
}

export const EntitiesTab: React.FC<EntitiesTabProps> = ({
  mode,
  onModeChange,
  entities,
  isCreating,
  onCreateEntities,
  onClearEntities,
  onRefreshBalances,
}) => {
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  
  const handleRefresh = async () => {
    if (!onRefreshBalances || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefreshBalances();
    } finally {
      setIsRefreshing(false);
    }
  };
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
        {entities.length > 0 && onRefreshBalances && (
          <button
            className="scenario-btn scenario-btn-secondary"
            onClick={handleRefresh}
            disabled={isRefreshing || isCreating}
            title="Refresh entity balances (auto-refreshes every 30s when tab is active)"
          >
            <RefreshCw size={14} style={{ marginRight: '8px', animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
            {isRefreshing ? 'REFRESHING...' : 'REFRESH BALANCES'}
          </button>
        )}
        {entities.length > 0 && onClearEntities && (
          <button
            className="scenario-btn scenario-btn-danger"
            onClick={onClearEntities}
            disabled={isCreating}
            title="Clear entities from ScenarioEngine state (addresses remain deterministic - tokens on-chain are unaffected)"
          >
            <Trash2 size={14} style={{ marginRight: '8px' }} />
            DELETE ENTITIES
          </button>
        )}
        {entities.length > 0 && (
          <>
            <div className="scenario-entity-warning">
              {'>'} Entities will be cleared if mode changes
            </div>
            <div className="scenario-entity-info">
              {'>'} Note: Addresses are deterministic. Tokens on these addresses remain on-chain.
            </div>
          </>
        )}
      </div>
    </div>
  );
};

