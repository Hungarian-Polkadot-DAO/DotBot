/**
 * LoadingOverlay Component
 * 
 * Shows a loading overlay with spinner and message during async operations
 * (e.g., network switching, chat loading)
 */

import React from 'react';
import './LoadingOverlay.css';

interface LoadingOverlayProps {
  isVisible: boolean;
  message?: string;
  subMessage?: string;
}

const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  isVisible,
  message = 'Loading...',
  subMessage,
}) => {
  if (!isVisible) return null;

  return (
    <div className="loading-overlay">
      <div className="loading-overlay-content">
        <div className="loading-overlay-spinner"></div>
        <div className="loading-overlay-message">{message}</div>
        {subMessage && (
          <div className="loading-overlay-submessage">{subMessage}</div>
        )}
      </div>
    </div>
  );
};

export default LoadingOverlay;

