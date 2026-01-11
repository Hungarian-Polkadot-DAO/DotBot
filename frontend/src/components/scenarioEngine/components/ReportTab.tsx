/**
 * Report Tab Component
 * 
 * Displays scenario execution report with typing animation and auto-scroll
 */

import React, { useState, useEffect, useRef } from 'react';
import { Trash2, Square, Copy, Check } from 'lucide-react';

interface ExecutionPhase {
  phase: 'beginning' | 'cycle' | 'final-report' | null;
  messages: string[];
  stepCount: number;
  dotbotActivity?: string;
}

interface ReportTabProps {
  report: string;
  isTyping: boolean;
  isRunning?: boolean;  // Whether a scenario is currently running
  statusMessage?: string;  // Current status message (e.g., "Executing prompt...")
  executionPhase?: ExecutionPhase | null;  // Current execution phase and activity
  onClear?: () => void;
  onEndScenario?: () => void;  // Callback to end scenario early
}

export const ReportTab: React.FC<ReportTabProps> = ({
  report,
  isTyping: externalIsTyping,
  isRunning = false,
  statusMessage,
  executionPhase,
  onClear,
  onEndScenario,
}) => {
  // Initialize displayedText to current report on mount (no animation for existing content)
  const [displayedText, setDisplayedText] = useState(() => report);
  const [isTyping, setIsTyping] = useState(false);
  const [copied, setCopied] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastProcessedLengthRef = useRef<number>(report.length);

  // Auto-scroll to bottom when text changes
  useEffect(() => {
    if (reportRef.current) {
      // Use requestAnimationFrame for smooth scrolling
      requestAnimationFrame(() => {
        if (reportRef.current) {
          reportRef.current.scrollTop = reportRef.current.scrollHeight;
        }
      });
    }
  }, [displayedText, isTyping]);

  // Typing animation effect - only animate NEW text
  useEffect(() => {
    if (report === '') {
      setDisplayedText('');
      setIsTyping(false);
      lastProcessedLengthRef.current = 0;
      return;
    }

    const lastProcessedLength = lastProcessedLengthRef.current;

    // If report is shorter than what we've processed, it was cleared/reset
    if (report.length < lastProcessedLength) {
      setDisplayedText(report);
      setIsTyping(false);
      lastProcessedLengthRef.current = report.length;
      return;
    }

    // If report has new content beyond what we've already processed
    if (report.length > lastProcessedLength) {
      // Immediately show everything we've already processed (no animation)
      const alreadyProcessed = report.slice(0, lastProcessedLength);
      if (displayedText.length < lastProcessedLength) {
        setDisplayedText(alreadyProcessed);
      }

      // Only animate the NEW characters
      const newChars = report.slice(lastProcessedLength);
      
      // If there's a very large backlog (e.g., ongoing process with many steps),
      // skip animation entirely to keep up with real-time updates
      if (newChars.length > 500) {
        // Skip animation for very large updates - show immediately
        setDisplayedText(report);
        lastProcessedLengthRef.current = report.length;
        setIsTyping(false);
        return;
      }
      
      let charIndex = 0;
      setIsTyping(true);

      const typeNextChar = () => {
        // Check if report has changed (might have been cleared or updated)
        const currentReportLength = report.length;
        if (currentReportLength < lastProcessedLengthRef.current) {
          // Report was cleared, stop typing
          setIsTyping(false);
          lastProcessedLengthRef.current = currentReportLength;
          setDisplayedText(report);
          return;
        }

        if (charIndex < newChars.length) {
          const currentLength = lastProcessedLength + charIndex;
          const unprintedChars = newChars.length - charIndex;
          
          // Make sure we don't go beyond current report length
          if (currentLength < currentReportLength) {
            // Batch process multiple characters when there's a large backlog
            // This keeps the display responsive during ongoing processes with many steps
            let charsToProcess = 1;
            let delay = 20; // Default delay
            
            if (unprintedChars > 100) {
              // Very large backlog: process 50 chars at a time, no delay
              charsToProcess = 50;
              delay = 0;
            } else if (unprintedChars > 50) {
              // Large backlog: process 20 chars at a time, minimal delay
              charsToProcess = 20;
              delay = 1;
            } else if (unprintedChars > 10) {
              // Medium backlog: process 5 chars at a time, fast
              charsToProcess = 5;
              delay = 5;
            }
            
            // Don't process more than what's available
            charsToProcess = Math.min(charsToProcess, newChars.length - charIndex, currentReportLength - currentLength);
            
            setDisplayedText(report.slice(0, currentLength + charsToProcess));
            charIndex += charsToProcess;
            
            timeoutRef.current = setTimeout(typeNextChar, delay);
          } else {
            // Caught up - show everything
            setIsTyping(false);
            lastProcessedLengthRef.current = currentReportLength;
            setDisplayedText(report);
          }
        } else {
          // Finished processing new chars
          setIsTyping(false);
          lastProcessedLengthRef.current = currentReportLength;
          setDisplayedText(report);
        }
      };

      typeNextChar();
    } else {
      // Report hasn't changed, just ensure displayedText matches
      if (displayedText.length !== report.length) {
        setDisplayedText(report);
      }
      lastProcessedLengthRef.current = report.length;
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [report]);

  const handleClear = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setDisplayedText('');
    setIsTyping(false);
    if (onClear) {
      onClear();
    }
  };

  const handleClick = () => {
    // Finish typing animation immediately when clicked
    if (isTyping && timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setDisplayedText(report);
      setIsTyping(false);
      lastProcessedLengthRef.current = report.length;
    }
  };

  const handleCopy = async () => {
    try {
      // Copy the full report text (not just displayedText, in case typing is still in progress)
      await navigator.clipboard.writeText(report || displayedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy report:', err);
    }
  };

  return (
    <div className="scenario-panel">
      <div className="scenario-panel-header">
        <span>{'>'} EXECUTION REPORT</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          {isRunning && onEndScenario && (
            <button
              onClick={onEndScenario}
              className="scenario-end-button"
              title="End scenario early and jump to evaluation"
              style={{
                background: 'rgba(255, 165, 0, 0.2)',
                border: '1px solid rgba(255, 165, 0, 0.5)',
                color: '#ffa500',
                padding: '4px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <Square size={12} />
              End Scenario
            </button>
          )}
          {(report || displayedText) && (
            <button
              onClick={handleCopy}
              className="scenario-copy-button"
              title={copied ? "Copied!" : "Copy report to clipboard"}
              style={{
                background: copied ? 'rgba(34, 197, 94, 0.2)' : 'transparent',
                border: copied ? '1px solid rgba(34, 197, 94, 0.5)' : '1px solid transparent',
                color: copied ? '#22c55e' : 'inherit',
                padding: '4px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.2s',
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          )}
          {onClear && displayedText && (
            <button
              onClick={handleClear}
              className="scenario-clear-button"
              title="Clear console"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="scenario-report" ref={reportRef} onClick={handleClick}>
        <pre className="scenario-report-text">
          {displayedText || '> Awaiting scenario execution...\n> Run a scenario to see results.'}
          {isTyping && <span className="scenario-cursor">█</span>}
          {isRunning && !isTyping && executionPhase && (
            <span className="scenario-status-message">
              {executionPhase.phase === 'beginning' && 'Setting up...'}
              {executionPhase.phase === 'cycle' && (
                executionPhase.dotbotActivity 
                  ? `DotBot: ${executionPhase.dotbotActivity.substring(0, 50)}${executionPhase.dotbotActivity.length > 50 ? '...' : ''}`
                  : `Executing step ${executionPhase.stepCount}...`
              )}
              {executionPhase.phase === 'final-report' && 'Generating final report...'}
              {!executionPhase.phase && statusMessage && statusMessage}
              {!executionPhase.phase && !statusMessage && 'Running...'}
            </span>
          )}
          {isRunning && !isTyping && !executionPhase && statusMessage && (
            <span className="scenario-status-message">{statusMessage}</span>
          )}
          {isRunning && !isTyping && !executionPhase && !statusMessage && (
            <span className="scenario-loading-dots">...</span>
          )}
        </pre>
      </div>
    </div>
  );
};

