/**
 * Test utilities - Custom render function
 */

import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ThemeProvider } from '../contexts/ThemeContext';
import { WebSocketProvider } from '../contexts/WebSocketContext';

/**
 * Custom render function that wraps components with necessary providers
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options?: {
    sessionId?: string | null;
    autoConnect?: boolean;
  } & Omit<RenderOptions, 'wrapper'>
) {
  const { sessionId = 'test-session', autoConnect = false, ...renderOptions } = options || {};
  
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        cacheTime: 0,
      },
    },
  });

  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <WebSocketProvider sessionId={sessionId} autoConnect={autoConnect}>
            {children}
          </WebSocketProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  };

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

// Re-export everything from @testing-library/react
export * from '@testing-library/react';
