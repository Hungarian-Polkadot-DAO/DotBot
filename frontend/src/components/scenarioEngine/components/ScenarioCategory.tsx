/**
 * Scenario Category Component
 * 
 * Displays a collapsible category of scenarios
 */

import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Scenario } from '../../../lib';
import { ScenarioItem } from './ScenarioItem';

interface ScenarioCategoryProps {
  category: string;
  name: string;
  tests: Scenario[];
  isExpanded: boolean;
  onToggle: () => void;
  onRunScenario: (scenario: Scenario) => void;
  isRunning: boolean;
}

export const ScenarioCategory: React.FC<ScenarioCategoryProps> = ({
  category,
  name,
  tests,
  isExpanded,
  onToggle,
  onRunScenario,
  isRunning,
}) => {
  return (
    <div className="scenario-category">
      <button
        className="scenario-category-header"
        onClick={onToggle}
      >
        {isExpanded ? (
          <ChevronDown size={16} />
        ) : (
          <ChevronRight size={16} />
        )}
        <span className="scenario-category-name">{name}</span>
        <span className="scenario-category-count">
          [{tests.length}]
        </span>
      </button>
      
      {isExpanded && (
        <div className="scenario-category-items">
          {tests.map((test, index) => (
            <ScenarioItem
              key={`${category}-${index}`}
              scenario={test}
              onRun={onRunScenario}
              disabled={isRunning}
            />
          ))}
        </div>
      )}
    </div>
  );
};

