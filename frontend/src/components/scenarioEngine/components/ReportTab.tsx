/**
 * Report Tab Component
 * 
 * Displays scenario execution report with typing animation and auto-scroll
 */

import React, { useState, useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';

interface ReportTabProps {
  report: string;
  isTyping: boolean;
  isRunning?: boolean;  // Whether a scenario is currently running
  onClear?: () => void;
}

export const ReportTab: React.FC<ReportTabProps> = ({
  report,
  isTyping: externalIsTyping,
  isRunning = false,
  onClear,
}) => {
  // Initialize displayedText to current report on mount (no animation for existing content)
  const [displayedText, setDisplayedText] = useState(() => report);
  const [isTyping, setIsTyping] = useState(false);
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
          const currentLength = lastProcessedLength + charIndex + 1;
          // Make sure we don't go beyond current report length
          if (currentLength <= currentReportLength) {
            setDisplayedText(report.slice(0, currentLength));
            charIndex++;
            timeoutRef.current = setTimeout(typeNextChar, 20); // 20ms per character
          } else {
            setIsTyping(false);
            lastProcessedLengthRef.current = currentReportLength;
            setDisplayedText(report);
          }
        } else {
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

  return (
    <div className="scenario-panel">
      <div className="scenario-panel-header">
        <span>{'>'} EXECUTION REPORT</span>
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
      <div className="scenario-report" ref={reportRef} onClick={handleClick}>
        <pre className="scenario-report-text">
          {displayedText || '> Awaiting scenario execution...\n> Run a scenario to see results.'}
          {isTyping && <span className="scenario-cursor">█</span>}
          {isRunning && !isTyping && <span className="scenario-loading-dots">...</span>}
        </pre>
      </div>
    </div>
  );
};

