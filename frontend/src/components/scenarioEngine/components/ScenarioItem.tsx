/**
 * Scenario Item Component
 * 
 * Displays a single scenario with run button
 */

import React from 'react';
import { Play } from 'lucide-react';
import { Scenario } from '../../../lib';

interface ScenarioItemProps {
  scenario: Scenario;
  onRun: (scenario: Scenario) => void;
  disabled: boolean;
}

export const ScenarioItem: React.FC<ScenarioItemProps> = ({
  scenario,
  onRun,
  disabled,
}) => {
  return (
    <div className="scenario-item">
      <div className="scenario-item-info">
        <span className="scenario-item-bullet">▸</span>
        <span className="scenario-item-name">{scenario.name}</span>
      </div>
      <button
        className="scenario-item-run"
        onClick={() => onRun(scenario)}
        disabled={disabled}
      >
        <Play size={14} />
      </button>
    </div>
  );
};

