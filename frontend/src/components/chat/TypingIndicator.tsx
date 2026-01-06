/**
 * TypingIndicator Component
 * 
 * Animated typing indicator shown when DotBot is processing.
 * 
 */

import React from 'react';

const TypingIndicator: React.FC = () => {
  return (
    <div className="message bot">
      <div className="message-avatar bot">D</div>
      <div className="message-content">
        <div className="typing-indicator">
          <div className="typing-dot"></div>
          <div className="typing-dot"></div>
          <div className="typing-dot"></div>
        </div>
      </div>
    </div>
  );
};

export default TypingIndicator;

