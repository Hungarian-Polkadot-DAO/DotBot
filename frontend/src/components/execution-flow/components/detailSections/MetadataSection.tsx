/**
 * Metadata Section
 * 
 * Displays metadata for an execution item
 */

import React from 'react';
import { ExecutionItem } from '../../../../lib/executionEngine/types';

export interface MetadataSectionProps {
  metadata?: ExecutionItem['metadata'];
}

export const MetadataSection: React.FC<MetadataSectionProps> = ({ metadata }) => {
  if (!metadata || Object.keys(metadata).length === 0) {
    return null;
  }

  return (
    <div className="execution-detail-section">
      <div className="execution-detail-label">Details</div>
      <div className="execution-metadata">
        {Object.entries(metadata).map(([key, value]) => {
          // Skip internal fields and API instance
          if (['amount', 'formattedAmount', 'transferCount', 'apiInstance'].includes(key)) {
            return null;
          }
          // Skip complex objects that might have circular references
          if (value && typeof value === 'object' && value.constructor && value.constructor.name !== 'Object' && value.constructor.name !== 'Array') {
            return null;
          }
          
          // Safe stringify
          let displayValue: string;
          try {
            displayValue = typeof value === 'string' ? value : JSON.stringify(value);
          } catch (e) {
            displayValue = '[Complex Object]';
          }
          
          return (
            <div key={key} className="metadata-row">
              <span className="metadata-key">{key}:</span>
              <span className="metadata-value">{displayValue}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
