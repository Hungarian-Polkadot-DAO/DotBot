/**
 * Scenarios Tab Component
 * 
 * Displays and manages test scenarios
 */

import React from 'react';
import { Scenario } from '../../../lib';
import { ModeSelector, ExecutionMode } from './ModeSelector';
import { ScenarioCategory } from './ScenarioCategory';
import type { TestCategory } from '../constants';

interface ScenariosTabProps {
  categories: TestCategory[];
  expandedCategories: Set<string>;
  onToggleCategory: (category: string) => void;
  mode: ExecutionMode;
  onModeChange: (mode: ExecutionMode) => void;
  onRunScenario: (scenario: Scenario) => void;
  runningScenario: string | null;
}

export const ScenariosTab: React.FC<ScenariosTabProps> = ({
  categories,
  expandedCategories,
  onToggleCategory,
  mode,
  onModeChange,
  onRunScenario,
  runningScenario,
}) => {
  return (
    <div className="scenario-panel">
      <div className="scenario-panel-header">
        {'>'} TEST SCENARIOS
      </div>
      
      <ModeSelector
        mode={mode}
        onModeChange={onModeChange}
        label="EXECUTION MODE:"
      />
      
      <div className="scenario-list">
        {categories.map((category) => (
          <ScenarioCategory
            key={category.category}
            category={category.category}
            name={category.name}
            tests={category.tests}
            isExpanded={expandedCategories.has(category.category)}
            onToggle={() => onToggleCategory(category.category)}
            onRunScenario={onRunScenario}
            isRunning={runningScenario !== null}
          />
        ))}
      </div>
    </div>
  );
};

