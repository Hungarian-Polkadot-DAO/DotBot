/**
 * ScenarioEngine Overlay
 * 
 * Matrix/console-styled interface for scenario testing and evaluation.
 * Appears as an overlay on the right side of the screen.
 */

import React, { useState, useEffect } from 'react';
import { ScenarioEngine, DotBot, Scenario } from '../../lib';
import { 
  HAPPY_PATH_TESTS,
  ADVERSARIAL_TESTS,
  JAILBREAK_TESTS,
  AMBIGUITY_TESTS,
  EDGE_CASE_TESTS,
  STRESS_TESTS,
  CONTEXT_AWARENESS_TESTS,
  KNOWLEDGE_TESTS,
} from '../../lib/scenarioEngine';
import { X, Play, Pause, RotateCcw, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import '../../styles/scenario-engine-overlay.css';

// Convert test prompts to scenario categories
const TEST_CATEGORIES = [
  { category: 'happy-path', name: 'Happy Path Tests', tests: HAPPY_PATH_TESTS },
  { category: 'adversarial', name: 'Security Tests', tests: ADVERSARIAL_TESTS },
  { category: 'jailbreak', name: 'Jailbreak Attempts', tests: JAILBREAK_TESTS },
  { category: 'ambiguity', name: 'Ambiguity Tests', tests: AMBIGUITY_TESTS },
  { category: 'edge-case', name: 'Edge Cases', tests: EDGE_CASE_TESTS },
  { category: 'stress', name: 'Stress Tests', tests: STRESS_TESTS },
  { category: 'context', name: 'Context Awareness', tests: CONTEXT_AWARENESS_TESTS },
  { category: 'knowledge', name: 'Knowledge Base', tests: KNOWLEDGE_TESTS },
];

// Entities will be created by the user
const EMPTY_ENTITIES: any[] = [];

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
  const [activeTab, setActiveTab] = useState<'entities' | 'scenarios' | 'report'>('entities');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['happy-path']));
  const [report, setReport] = useState<string>('');
  const [isTyping, setIsTyping] = useState(false);
  const [entities, setEntities] = useState<any[]>(EMPTY_ENTITIES);
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [isCreatingEntities, setIsCreatingEntities] = useState(false);
  
  // Subscribe to engine events
  useEffect(() => {
    const handleEvent = (event: any) => {
      if (event.type === 'inject-prompt') {
        // Engine wants to inject a prompt - send it through the UI
        handlePromptInjection(event.prompt);
      } else if (event.type === 'log') {
        // Append log messages to report
        appendToReport(`[${event.level.toUpperCase()}] ${event.message}\n`);
      } else if (event.type === 'scenario-complete') {
        setRunningScenario(null);
        const result = event.result;
        appendToReport(
          `\n[COMPLETE] ${result.success ? '✅ PASSED' : '❌ FAILED'}\n` +
          `[SCORE] ${result.evaluation.score}/100\n` +
          `[DURATION] ${result.duration}ms\n`
        );
      }
    };
    
    engine.addEventListener(handleEvent);
    
    return () => {
      engine.removeEventListener(handleEvent);
    };
  }, [engine]);
  
  /**
   * Handle prompt injection from ScenarioEngine
   * This runs the prompt through the normal UI flow
   */
  const handlePromptInjection = async (prompt: string) => {
    appendToReport(`[UI] Injecting prompt: "${prompt}"\n`);
    
    // Notify engine that we received the prompt
    const executor = engine.getExecutor();
    if (executor) {
      executor.notifyPromptProcessed();
    }
    
    // Send through normal UI (this will call dotbot.chat())
    await onSendMessage(prompt);
    
    // Get the result from the last chat
    if (dotbot.currentChat) {
      const messages = dotbot.currentChat.messages;
      const lastMessage = messages[messages.length - 1];
      
      if (lastMessage && (lastMessage.type === 'bot' || lastMessage.type === 'user')) {
        appendToReport(`[RESPONSE] Received from DotBot\n`);
        // Notify engine that response was received
        if (executor) {
          executor.notifyResponseReceived({
            response: lastMessage.content,
            // Add other fields as needed
          });
        }
      }
    }
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const typeText = async (text: string) => {
    setIsTyping(true);
    setReport('');
    
    for (let i = 0; i < text.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
      setReport(prev => prev + text[i]);
    }
    
    setIsTyping(false);
  };
  
  const appendToReport = (text: string) => {
    setReport(prev => prev + text);
  };
  
  // Tests are now full Scenario objects, no conversion needed

  const createEntities = async () => {
    setIsCreatingEntities(true);
    setActiveTab('report');
    
    appendToReport(`[INIT] EntityCreator initializing...\n`);
    appendToReport(`[MODE] Deterministic keypair generation\n`);
    appendToReport(`[SS58] Format: 42 (Westend)\n\n`);
    
    try {
      // Get environment from dotbot
      const environment = dotbot.getEnvironment();
      const chain = environment === 'mainnet' ? 'polkadot' : 'westend';
      
      // Create a dummy scenario with entities to trigger entity creation
      const dummyScenario: Scenario = {
        id: 'entity-setup',
        name: 'Entity Setup',
        description: 'Initialize test entities',
        category: 'happy-path',
        environment: {
          chain: chain as 'westend' | 'polkadot',
          mode: 'synthetic',
        },
        entities: [
          { name: 'Alice', type: 'keypair' },
          { name: 'Bob', type: 'keypair' },
          { name: 'Charlie', type: 'keypair' },
        ],
        walletState: {
          accounts: [
            { entityName: 'Alice', balance: '100 DOT' },
            { entityName: 'Bob', balance: '50 DOT' },
            { entityName: 'Charlie', balance: '50 DOT' },
          ]
        },
        steps: [],
        expectations: [],
      };
      
      // Actually run the scenario to create entities
      // Since steps array is empty, this will only set up entities
      await engine.runScenario(dummyScenario);
      
      // Get the created entities from the engine
      const engineEntities = Array.from(engine.getEntities().values());
      
      if (engineEntities.length > 0) {
        setEntities(engineEntities.map(e => ({
          name: e.name,
          address: e.address,
          type: e.type,
          balance: '0 DOT' // Real balance would come from chain query
        })));
        
        appendToReport(`[CREATE] ✅ ${engineEntities.length} entities created\n`);
        
        // Log each entity
        engineEntities.forEach(e => {
          appendToReport(`  • ${e.name}: ${e.address}\n`);
        });
        
        appendToReport(`\n[READY] Entities ready for testing\n\n`);
      } else {
        appendToReport(`[WARN] No entities were created\n\n`);
      }
      
    } catch (error) {
      appendToReport(`[ERROR] Failed to create entities: ${error}\n`);
      console.error('Entity creation failed:', error);
    }
    
    setIsCreatingEntities(false);
  };

  const runScenario = async (scenario: Scenario) => {
    setActiveTab('report');
    setRunningScenario(scenario.name);
    
    // Get the first step's input for the test description
    const firstStepInput = scenario.steps[0]?.input || scenario.name;
    
    appendToReport(
      `[TEST] ${firstStepInput}\n` +
      `[STATUS] Initializing...\n\n`
    );
    
    try {
      // Check if entities exist (for scenarios that need them)
      const engineEntities = Array.from(engine.getEntities().values());
      if (engineEntities.length === 0) {
        appendToReport(
          `[INFO] No test entities found.\n` +
          `[INFO] Entities will be created during scenario execution.\n` +
          `[TIP] You can pre-create entities in the ENTITIES tab for faster execution.\n\n`
        );
      }
      
      appendToReport(`[SCENARIO] Running: ${scenario.name}\n`);
      appendToReport(`[CATEGORY] ${scenario.category}\n`);
      appendToReport(`[ENVIRONMENT] ${scenario.environment?.mode || 'synthetic'} mode\n\n`);
      
      // Run the scenario through the real engine
      const result = await engine.runScenario(scenario);
      
      // Result is already appended by event handlers
      appendToReport(`\n[COMPLETE] Scenario execution finished\n`);
      
    } catch (error) {
      appendToReport(`\n[ERROR] Scenario failed: ${error}\n`);
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
          {/* Entities Tab */}
          {activeTab === 'entities' && (
            <div className="scenario-panel">
              <div className="scenario-panel-header">
                {'>'} TEST ENTITIES
              </div>
              <div className="scenario-entities">
                {entities.length === 0 ? (
                  <div className="scenario-empty-state">
                    <div className="scenario-empty-icon">▸▸▸</div>
                    <div className="scenario-empty-text">
                      No entities created yet.
                    </div>
                    <div className="scenario-empty-hint">
                      Click "CREATE ENTITIES" below to generate test accounts.
                    </div>
                  </div>
                ) : (
                  entities.map((entity) => (
                    <div key={entity.name} className="scenario-entity">
                      <div className="scenario-entity-name">
                        <span className="scenario-entity-bullet">▸</span>
                        {entity.name}
                      </div>
                      <div className="scenario-entity-details">
                        <div className="scenario-entity-address">{entity.address}</div>
                        <div className="scenario-entity-meta">
                          <span className="scenario-entity-type">{entity.type}</span>
                          <span className="scenario-entity-balance">{entity.balance}</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="scenario-panel-footer">
                <button 
                  className="scenario-btn scenario-btn-primary"
                  onClick={createEntities}
                  disabled={isCreatingEntities || entities.length > 0}
                >
                  {isCreatingEntities ? 'CREATING...' : entities.length > 0 ? 'ENTITIES CREATED' : 'CREATE ENTITIES'}
                </button>
              </div>
            </div>
          )}

          {/* Scenarios Tab */}
          {activeTab === 'scenarios' && (
            <div className="scenario-panel">
              <div className="scenario-panel-header">
                {'>'} TEST SCENARIOS
              </div>
              <div className="scenario-list">
                {TEST_CATEGORIES.map((category) => (
                  <div key={category.category} className="scenario-category">
                    <button
                      className="scenario-category-header"
                      onClick={() => toggleCategory(category.category)}
                    >
                      {expandedCategories.has(category.category) ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                      <span className="scenario-category-name">{category.name}</span>
                      <span className="scenario-category-count">
                        [{category.tests.length}]
                      </span>
                    </button>
                    
                    {expandedCategories.has(category.category) && (
                      <div className="scenario-category-items">
                        {category.tests.map((test, index) => (
                          <div key={`${category.category}-${index}`} className="scenario-item">
                            <div className="scenario-item-info">
                              <span className="scenario-item-bullet">▸</span>
                              <span className="scenario-item-name">{test.name}</span>
                            </div>
                            <button
                              className="scenario-item-run"
                              onClick={() => runScenario(test)}
                              disabled={runningScenario !== null}
                            >
                              <Play size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Report Tab */}
          {activeTab === 'report' && (
            <div className="scenario-panel">
              <div className="scenario-panel-header">
                {'>'} EXECUTION REPORT
              </div>
              <div className="scenario-report">
                <pre className="scenario-report-text">
                  {report || '> Awaiting scenario execution...\n> Run a scenario to see results.'}
                  {isTyping && <span className="scenario-cursor">█</span>}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ScenarioEngineOverlay;

