/**
 * ScenarioEngine Overlay
 * 
 * Matrix/console-styled interface for scenario testing and evaluation.
 * Appears as an overlay on the right side of the screen.
 */

import React, { useState, useEffect } from 'react';
import { ScenarioEngine, DotBot, Scenario } from '@dotbot/core';
import { X } from 'lucide-react';
import { EntitiesTab } from './components/EntitiesTab';
import { ScenariosTab } from './components/ScenariosTab';
import { ReportTab } from './components/ReportTab';
import { useScenarioEngine } from './hooks/useScenarioEngine';
import { verifyEntities } from './utils/entityUtils';
import { 
  getScenarioChain, 
  getChainTypeDescription, 
  createModifiedScenario 
} from './utils/scenarioRunner';
import { TEST_CATEGORIES, TabType } from './constants';
import { ExecutionMode } from './components/ModeSelector';
import '../../styles/scenario-engine-overlay.css';

interface ScenarioEngineOverlayProps {
  engine: ScenarioEngine;
  dotbot: DotBot;
  onClose: () => void;
  onSendMessage: (message: string) => Promise<any>;
  onAutoSubmitChange?: (autoSubmit: boolean) => void;
  autoSubmit?: boolean;
}

const ScenarioEngineOverlay: React.FC<ScenarioEngineOverlayProps> = ({ 
  engine, 
  dotbot, 
  onClose,
  onSendMessage,
  onAutoSubmitChange,
  autoSubmit: propAutoSubmit
}) => {
  // Close on ESC key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);
  const [activeTab, setActiveTab] = useState<TabType>('entities');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['state-allocation', 'happy-path']));
  const [report, setReport] = useState<string>('');
  const [isCreatingEntities, setIsCreatingEntities] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [executionPhase, setExecutionPhase] = useState<{ phase: 'beginning' | 'cycle' | 'final-report' | null; messages: string[]; stepCount: number; dotbotActivity?: string } | null>(null);
  // Only LIVE mode is implemented - synthetic/emulated are TODO
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('live');
  // Auto-submit toggle: true = auto-submit injected prompts, false = manual submit
  const [autoSubmit, setAutoSubmit] = useState<boolean>(propAutoSubmit ?? true);
  
  // Sync with prop if provided
  useEffect(() => {
    if (propAutoSubmit !== undefined) {
      setAutoSubmit(propAutoSubmit);
    }
  }, [propAutoSubmit]);
  
  const handleAutoSubmitToggle = (value: boolean) => {
    setAutoSubmit(value);
    onAutoSubmitChange?.(value);
  };

  const appendToReport = (text: string) => {
    setReport(prev => prev + text);
  };

  const clearReport = () => {
    setReport('');
  };

  const clearEntities = () => {
    engine.clearEntities();
    appendToReport(`[NUKE] All entities cleared\n`);
  };

  const { entities, runningScenario, setRunningScenario } = useScenarioEngine({
    engine,
    dotbot,
    onSendMessage,
    onAppendReport: appendToReport,
    onStatusChange: setStatusMessage,
    onPhaseChange: setExecutionPhase,
  });
  
  const handleEndScenario = async () => {
    if (!engine.isScenarioRunning()) {
      return;
    }
    
    try {
      await engine.endScenarioEarly();
      setRunningScenario(null);
      setStatusMessage('');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      appendToReport(`[ERROR] Failed to end scenario: ${errorMessage}\n`);
      console.error('Failed to end scenario:', error);
    }
  };

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
        uri: e.uri,
        balance: '0 DOT'
      }));
      
      appendToReport(`[CREATE] ${engineEntities.length} entities created (${executionMode} mode)\n`);
      engineEntities.forEach(e => {
        const uriInfo = executionMode === 'live' ? ' (no URI - security)' : (e.uri ? ` (${e.uri})` : '');
        appendToReport(`  ${e.name}: ${e.address}${uriInfo}\n`);
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
      
      const chain = getScenarioChain(scenario, dotbot);
      const chainType = getChainTypeDescription(chain);
      const modifiedScenario = createModifiedScenario(scenario, chain, executionMode);
      
      appendToReport(`[INFO] Using chain: ${chain} (${chainType})\n`);
      appendToReport(`[SCENARIO] ${scenario.name} (${executionMode})\n\n`);
      
      await engine.runScenario(modifiedScenario);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      appendToReport(`[ERROR] Scenario failed: ${errorMessage}\n`);
      console.error('Scenario execution failed:', error);
    } finally {
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
          <div className="scenario-header-controls">
            <label className="scenario-toggle" title={autoSubmit ? "Auto-submit enabled (prompts sent automatically)" : "Manual submit (review prompts before sending)"}>
              <span className="scenario-toggle-label">AUTO:</span>
              <input
                type="checkbox"
                checked={autoSubmit}
                onChange={(e) => handleAutoSubmitToggle(e.target.checked)}
                className="scenario-toggle-input"
              />
              <span className="scenario-toggle-slider"></span>
            </label>
          <button onClick={onClose} className="scenario-close">
            <X size={18} />
          </button>
          </div>
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
              onClearEntities={clearEntities}
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
              isTyping={!!runningScenario}
              isRunning={!!runningScenario}
              statusMessage={statusMessage}
              executionPhase={executionPhase}
              onClear={clearReport}
              onEndScenario={handleEndScenario}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ScenarioEngineOverlay;
