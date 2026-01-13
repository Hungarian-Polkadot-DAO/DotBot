/**
 * Scenario Item Component
 * 
 * Displays a single scenario with run button and expandable details
 */

import React, { useState } from 'react';
import { Play, ChevronDown, ChevronRight } from 'lucide-react';
import { Scenario } from '@dotbot/core';

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
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={`scenario-item ${isExpanded ? 'expanded' : ''}`}>
      <div className="scenario-item-header">
        <div className="scenario-item-info">
          <button
            className="scenario-item-expand"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? 'Hide details' : 'Show details'}
          >
            {isExpanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </button>
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
      
      {isExpanded && (
        <div className="scenario-item-details">
          {/* Description */}
          {scenario.description && (
            <div className="scenario-detail-section">
              <div className="scenario-detail-label">Description</div>
              <div className="scenario-detail-value">{scenario.description}</div>
            </div>
          )}

          {/* Category */}
          <div className="scenario-detail-section">
            <div className="scenario-detail-label">Category</div>
            <div className="scenario-detail-value">
              <span className="scenario-detail-badge">{scenario.category}</span>
            </div>
          </div>

          {/* Tags */}
          {scenario.tags && scenario.tags.length > 0 && (
            <div className="scenario-detail-section">
              <div className="scenario-detail-label">Tags</div>
              <div className="scenario-detail-value">
                <div className="scenario-detail-tags">
                  {scenario.tags.map((tag, idx) => (
                    <span key={idx} className="scenario-detail-tag">{tag}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Environment */}
          {scenario.environment && (
            <div className="scenario-detail-section">
              <div className="scenario-detail-label">Environment</div>
              <div className="scenario-detail-value">
                <span className="scenario-detail-badge">{scenario.environment.chain}</span>
                <span className="scenario-detail-separator">•</span>
                <span className="scenario-detail-badge">{scenario.environment.mode}</span>
              </div>
            </div>
          )}

          {/* Steps */}
          <div className="scenario-detail-section">
            <div className="scenario-detail-label">Steps</div>
            <div className="scenario-detail-value">
              {scenario.steps.length} step{scenario.steps.length !== 1 ? 's' : ''}
              {scenario.steps.length > 0 && (
                <div className="scenario-detail-steps">
                  {scenario.steps.map((step, idx) => (
                    <div key={idx} className="scenario-detail-step">
                      <span className="scenario-detail-step-type">{step.type}</span>
                      {step.type === 'prompt' && step.input && (
                        <span className="scenario-detail-step-content">
                          {step.input.length > 60 
                            ? `${step.input.substring(0, 60)}...` 
                            : step.input}
                        </span>
                      )}
                      {step.type === 'action' && step.action && (
                        <span className="scenario-detail-step-content">
                          {step.action.type}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Expectations */}
          <div className="scenario-detail-section">
            <div className="scenario-detail-label">Expectations</div>
            <div className="scenario-detail-value">
              {scenario.expectations.length} expectation{scenario.expectations.length !== 1 ? 's' : ''}
              {scenario.expectations.length > 0 && (
                <div className="scenario-detail-expectations">
                  {scenario.expectations.map((expectation, idx) => (
                    <div key={idx} className="scenario-detail-expectation">
                      {expectation.responseType && (
                        <div className="scenario-detail-expectation-item">
                          <span className="scenario-detail-expectation-label">Response type:</span>
                          <span className="scenario-detail-badge">{expectation.responseType}</span>
                        </div>
                      )}
                      {expectation.expectedAgent && (
                        <div className="scenario-detail-expectation-item">
                          <span className="scenario-detail-expectation-label">Agent:</span>
                          <span className="scenario-detail-expectation-value">{expectation.expectedAgent}</span>
                        </div>
                      )}
                      {expectation.expectedFunction && (
                        <div className="scenario-detail-expectation-item">
                          <span className="scenario-detail-expectation-label">Function:</span>
                          <span className="scenario-detail-expectation-value">{expectation.expectedFunction}</span>
                        </div>
                      )}
                      {expectation.shouldContain && expectation.shouldContain.length > 0 && (
                        <div className="scenario-detail-expectation-item">
                          <span className="scenario-detail-expectation-label">Should contain:</span>
                          <div className="scenario-detail-tags">
                            {expectation.shouldContain.map((item, i) => (
                              <span key={i} className="scenario-detail-tag">{item}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {expectation.shouldNotContain && expectation.shouldNotContain.length > 0 && (
                        <div className="scenario-detail-expectation-item">
                          <span className="scenario-detail-expectation-label">Should NOT contain:</span>
                          <div className="scenario-detail-tags">
                            {expectation.shouldNotContain.map((item, i) => (
                              <span key={i} className="scenario-detail-tag">{item}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {expectation.shouldMention && expectation.shouldMention.length > 0 && (
                        <div className="scenario-detail-expectation-item">
                          <span className="scenario-detail-expectation-label">Should mention:</span>
                          <div className="scenario-detail-tags">
                            {expectation.shouldMention.map((item, i) => (
                              <span key={i} className="scenario-detail-tag">{item}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {expectation.shouldAskFor && expectation.shouldAskFor.length > 0 && (
                        <div className="scenario-detail-expectation-item">
                          <span className="scenario-detail-expectation-label">Should ask for:</span>
                          <div className="scenario-detail-tags">
                            {expectation.shouldAskFor.map((item, i) => (
                              <span key={i} className="scenario-detail-tag">{item}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {expectation.shouldWarn && expectation.shouldWarn.length > 0 && (
                        <div className="scenario-detail-expectation-item">
                          <span className="scenario-detail-expectation-label">Should warn:</span>
                          <div className="scenario-detail-tags">
                            {expectation.shouldWarn.map((item, i) => (
                              <span key={i} className="scenario-detail-tag">{item}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {expectation.shouldReject !== undefined && (
                        <div className="scenario-detail-expectation-item">
                          <span className="scenario-detail-expectation-label">Should reject:</span>
                          <span className="scenario-detail-badge">{expectation.shouldReject ? 'Yes' : 'No'}</span>
                          {expectation.rejectionReason && (
                            <span className="scenario-detail-expectation-value"> ({expectation.rejectionReason})</span>
                          )}
                        </div>
                      )}
                      {expectation.expectedParams && Object.keys(expectation.expectedParams).length > 0 && (
                        <div className="scenario-detail-expectation-item">
                          <span className="scenario-detail-expectation-label">Expected params:</span>
                          <span className="scenario-detail-expectation-value">
                            {JSON.stringify(expectation.expectedParams, null, 2)}
                          </span>
                        </div>
                      )}
                      {expectation.customValidator && (
                        <div className="scenario-detail-expectation-item">
                          <span className="scenario-detail-expectation-label">Custom validator:</span>
                          <span className="scenario-detail-expectation-value">Yes</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Entities */}
          {scenario.entities && scenario.entities.length > 0 && (
            <div className="scenario-detail-section">
              <div className="scenario-detail-label">Entities</div>
              <div className="scenario-detail-value">
                <div className="scenario-detail-entities">
                  {scenario.entities.map((entity, idx) => (
                    <span key={idx} className="scenario-detail-entity">
                      {entity.name} ({entity.type})
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Wallet State */}
          {scenario.walletState && scenario.walletState.accounts && scenario.walletState.accounts.length > 0 && (
            <div className="scenario-detail-section">
              <div className="scenario-detail-label">Wallet State</div>
              <div className="scenario-detail-value">
                <div className="scenario-detail-wallet">
                  {scenario.walletState.accounts.map((account, idx) => (
                    <div key={idx} className="scenario-detail-wallet-account">
                      <span className="scenario-detail-entity-name">{account.entityName}</span>
                      <span className="scenario-detail-separator">:</span>
                      <span className="scenario-detail-balance">{account.balance}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Constraints */}
          {scenario.constraints && (
            <div className="scenario-detail-section">
              <div className="scenario-detail-label">Constraints</div>
              <div className="scenario-detail-value">
                {scenario.constraints.maxRetries && (
                  <div>Max retries: {scenario.constraints.maxRetries}</div>
                )}
                {scenario.constraints.timeout && (
                  <div>Timeout: {scenario.constraints.timeout}ms</div>
                )}
                {scenario.constraints.allowRealTx !== undefined && (
                  <div>Allow real transactions: {scenario.constraints.allowRealTx ? 'Yes' : 'No'}</div>
                )}
                {scenario.constraints.requireConfirmation !== undefined && (
                  <div>Require confirmation: {scenario.constraints.requireConfirmation ? 'Yes' : 'No'}</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

