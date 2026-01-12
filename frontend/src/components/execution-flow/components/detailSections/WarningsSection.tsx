/**
 * Warnings Section
 * 
 * Displays warnings/information for an execution item
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';

export interface WarningsSectionProps {
  warnings?: string[];
}

export const WarningsSection: React.FC<WarningsSectionProps> = ({ warnings }) => {
  if (!warnings || warnings.length === 0) {
    return null;
  }

  return (
    <div className="execution-detail-section">
      <div className="execution-detail-label">
        <AlertTriangle className="warning-icon" size={14} />
        Information
      </div>
      <ul className="execution-warnings-list">
        {warnings.map((warning, idx) => (
          <li key={idx}>{warning}</li>
        ))}
      </ul>
    </div>
  );
};
