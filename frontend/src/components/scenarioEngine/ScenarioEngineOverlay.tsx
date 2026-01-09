/**
 * ScenarioEngine Overlay
 * 
 * Matrix/console-styled interface for scenario testing and evaluation.
 * Appears as an overlay on the right side of the screen.
 */

import React, { useState } from 'react';
import { ScenarioEngine, DotBot, Scenario } from '../../lib';
import { X } from 'lucide-react';
import { EntitiesTab } from './components/EntitiesTab';
import { ScenariosTab } from './components/ScenariosTab';
import { ReportTab } from './components/ReportTab';
import { useScenarioEngine } from './hooks/useScenarioEngine';
import { verifyEntities } from './utils/entityUtils';
import { TEST_CATEGORIES, TabType } from './constants';
import { ExecutionMode } from './components/ModeSelector';
import '../../styles/scenario-engine-overlay.css';

interface ScenarioEngineOverlayProps {
  engine: ScenarioEngine;
  dotbot: DotBot;
  onClose: () => void;
  onSendMessage: (message: string) => Promise<void>;
}

const ScenarioEngineOverlay: React.FC<ScenarioEngineOverlayProps> = ({ 
  engine, 
  dotbot, 
  onClose,
  onSendMessage 
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('entities');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['happy-path']));
  const [report, setReport] = useState<string>('');
  const [isCreatingEntities, setIsCreatingEntities] = useState(false);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('synthetic');

  const appendToReport = (text: string) => {
    setReport(prev => prev + text);
  };

  const { entities, runningScenario, setRunningScenario } = useScenarioEngine({
    engine,
    dotbot,
    onSendMessage,
    onAppendReport: appendToReport,
  });

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      next.has(category) ? next.delete(category) : next.add(category);
      return next;
    });
  };

  const createEntities = async () => {
    setIsCreatingEntities(true);
    
    try {
      const environment = dotbot.getEnvironment();
      const chain = environment === 'mainnet' ? 'polkadot' : 'westend';
      
      await engine.createEntities(
        [
          { name: 'Alice', type: 'keypair' },
          { name: 'Bob', type: 'keypair' },
          { name: 'Charlie', type: 'keypair' },
        ],
        { chain: chain as 'westend' | 'polkadot', mode: executionMode }
      );
      
      const engineEntities = Array.from(engine.getEntities().values());
      const entityData = engineEntities.map(e => ({
        name: e.name,
        address: e.address,
        type: e.type,
        mnemonic: e.mnemonic,
        balance: '0 DOT'
      }));
      
      appendToReport(`[CREATE] ${engineEntities.length} entities created (${executionMode} mode)\n`);
      engineEntities.forEach(e => {
        const mnemonicInfo = executionMode === 'live' ? ' (no mnemonic)' : (e.mnemonic ? ' (mnemonic)' : '');
        appendToReport(`  ${e.name}: ${e.address}${mnemonicInfo}\n`);
      });
      
      verifyEntities(entityData, executionMode, appendToReport);
      
    } catch (error) {
      appendToReport(`[ERROR] ${error}\n`);
      console.error('Entity creation failed:', error);
    } finally {
      setIsCreatingEntities(false);
    }
  };

  const runScenario = async (scenario: Scenario) => {
    setActiveTab('report');
    setRunningScenario(scenario.name);
    
    try {
      const state = engine.getState();
      const engineEntities = Array.from(engine.getEntities().values());
      
      if (engineEntities.length > 0 && state.entityMode !== executionMode) {
        appendToReport(`[WARN] Entity mode mismatch: ${state.entityMode} → ${executionMode}\n`);
      }
      
      const environment = dotbot.getEnvironment();
      const chain = environment === 'mainnet' ? 'polkadot' : 'westend';
      
      const modifiedScenario: Scenario = {
        ...scenario,
        environment: {
          chain: scenario.environment?.chain || (chain as 'westend' | 'polkadot'),
          mode: executionMode,
          ...scenario.environment?.chopsticksConfig && { chopsticksConfig: scenario.environment.chopsticksConfig },
        }
      };
      
      appendToReport(`[SCENARIO] ${scenario.name} (${executionMode})\n\n`);
      
      await engine.runScenario(modifiedScenario);
      
    } catch (error) {
      appendToReport(`[ERROR] ${error}\n`);
      console.error('Scenario execution failed:', error);
      setRunningScenario(null);
    }
  };

  return (
    <div className="scenario-overlay">
      <div className="scenario-overlay-content">
        {/* Header */}
        <div className="scenario-header">
          <div className="scenario-title">
            <span className="scenario-title-brackets">{'['}</span>
            <span className="scenario-title-text">SCENARIO_ENGINE</span>
            <span className="scenario-title-brackets">{']'}</span>
          </div>
          <button onClick={onClose} className="scenario-close">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="scenario-tabs">
          <button
            className={`scenario-tab ${activeTab === 'entities' ? 'active' : ''}`}
            onClick={() => setActiveTab('entities')}
          >
            {'>'} ENTITIES
          </button>
          <button
            className={`scenario-tab ${activeTab === 'scenarios' ? 'active' : ''}`}
            onClick={() => setActiveTab('scenarios')}
          >
            {'>'} SCENARIOS
          </button>
          <button
            className={`scenario-tab ${activeTab === 'report' ? 'active' : ''}`}
            onClick={() => setActiveTab('report')}
          >
            {'>'} REPORT
          </button>
        </div>

        {/* Content */}
        <div className="scenario-content">
          {activeTab === 'entities' && (
            <EntitiesTab
              engine={engine}
              dotbot={dotbot}
              mode={executionMode}
              onModeChange={setExecutionMode}
              entities={entities}
              isCreating={isCreatingEntities}
              onAppendReport={appendToReport}
              onCreateEntities={createEntities}
            />
          )}

          {activeTab === 'scenarios' && (
            <ScenariosTab
              categories={TEST_CATEGORIES}
              expandedCategories={expandedCategories}
              onToggleCategory={toggleCategory}
              mode={executionMode}
              onModeChange={setExecutionMode}
              onRunScenario={runScenario}
              runningScenario={runningScenario}
            />
          )}

          {activeTab === 'report' && (
            <ReportTab
              report={report}
              isTyping={false}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ScenarioEngineOverlay;
