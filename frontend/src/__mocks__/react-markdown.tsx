/**
 * Mock for react-markdown
 * Used in Jest tests to avoid ES module transformation issues
 */

import React from 'react';

const ReactMarkdown: React.FC<{ children?: string }> = ({ children }) => {
  return <div data-testid="react-markdown">{children}</div>;
};

export default ReactMarkdown;
