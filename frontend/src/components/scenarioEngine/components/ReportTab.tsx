/**
 * Report Tab Component
 * 
 * Displays scenario execution report
 */

import React from 'react';

interface ReportTabProps {
  report: string;
  isTyping: boolean;
}

export const ReportTab: React.FC<ReportTabProps> = ({
  report,
  isTyping,
}) => {
  return (
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
  );
};

