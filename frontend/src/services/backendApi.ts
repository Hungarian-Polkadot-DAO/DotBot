/**
 * Backend API Client
 * Handles communication with the DotBot backend server
 */

const BACKEND_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

export interface ChatRequest {
  message: string;
  context?: any;
  provider?: 'asi-one' | 'claude';
}

export interface ChatResponse {
  success: boolean;
  response: string;
  provider: string;
  timestamp: string;
}

export interface ErrorResponse {
  error: string | boolean;
  message: string;
  code?: string;
  timestamp: string;
}

/**
 * Send a chat message to the backend AI service
 */
export async function sendChatMessage(request: ChatRequest): Promise<string> {
  const response = await fetch(`${BACKEND_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error: ErrorResponse = await response.json();
    throw new Error(error.message || 'Failed to send chat message');
  }

  const data: ChatResponse = await response.json();
  return data.response;
}

/**
 * Get available AI providers
 */
export async function getAvailableProviders(): Promise<string[]> {
  const response = await fetch(`${BACKEND_URL}/api/chat/providers`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch providers');
  }

  const data = await response.json();
  return data.providers;
}

/**
 * Check backend health
 */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/health`);
    return response.ok;
  } catch (error) {
    console.error('[Backend API] Health check failed:', error);
    return false;
  }
}
