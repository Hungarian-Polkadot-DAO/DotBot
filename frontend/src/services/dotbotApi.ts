/**
 * DotBot API Client
 * 
 * Frontend client for communicating with backend DotBot API.
 * All AI communication happens on the backend - this is just a thin client.
 */

import type { ChatResult, Environment, Network } from '@dotbot/core';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

/**
 * Helper to handle fetch errors with better error messages
 */
async function handleFetchError(response: Response, context: string): Promise<never> {
  let errorMessage = `Failed to ${context}`;
  
  if (!response.ok) {
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorData.error || errorMessage;
    } catch {
      errorMessage = `${errorMessage}: ${response.status} ${response.statusText}`;
    }
  }
  // Note: If response.ok is true, this function shouldn't be called
  // But if it is, we'll use a generic error message
  
  console.error(`[DotBot API] ${errorMessage}`, {
    url: response.url,
    status: response.status,
    statusText: response.statusText,
  });
  
  throw new Error(errorMessage);
}

export interface WalletAccount {
  address: string;
  name?: string;
  source: string;
}

export interface DotBotSession {
  sessionId: string;
  environment: Environment;
  network: Network;
  wallet: {
    address: string;
    name?: string;
    source: string;
  };
  currentChatId?: string | null;
}

export interface DotBotChatRequest {
  message: string;
  sessionId?: string;
  wallet: WalletAccount;
  environment?: Environment;
  network?: Network;
  conversationHistory?: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp?: number }>;
  provider?: string;
}

export interface DotBotChatResponse {
  success: boolean;
  result: ChatResult;
  sessionId: string;
  timestamp: string;
}

export interface DotBotSessionResponse {
  success: boolean;
  sessionId: string;
  environment: Environment;
  network: Network;
  wallet: {
    address: string;
    name?: string;
    source: string;
  };
  currentChatId?: string | null;
  timestamp: string;
}

/**
 * Create or get a DotBot session on the backend
 */
export async function createDotBotSession(
  wallet: WalletAccount,
  environment: Environment = 'mainnet',
  network?: Network,
  sessionId?: string
): Promise<DotBotSessionResponse> {
  try {
    // Use AbortController for timeout (90 seconds - RPC connection can be slow)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90 * 1000);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/dotbot/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          wallet,
          environment,
          network,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        await handleFetchError(response, 'create DotBot session');
      }

      try {
        return await response.json();
      } catch (jsonError) {
        throw new Error(
          `Invalid JSON response from backend API. ` +
          `The server may be experiencing issues. Please try again later.`
        );
      }
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        throw new Error(
          `Session creation timed out after 90 seconds. ` +
          `The backend may be slow to connect to RPC endpoints. ` +
          `Please try again or check your network connection.`
        );
      }
      throw fetchError;
    }
  } catch (error) {
    // Handle network errors (fetch failures, CORS, connection issues)
    // TypeError is thrown when fetch fails (network error, CORS, invalid URL, etc.)
    if (error instanceof TypeError) {
      throw new Error(
        `Cannot connect to backend API at ${API_BASE_URL}. ` +
        `Make sure the backend server is running and CORS is configured correctly.`
      );
    }
    throw error;
  }
}

/**
 * Get DotBot session info
 */
export async function getDotBotSession(sessionId: string): Promise<DotBotSessionResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/dotbot/session/${sessionId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      await handleFetchError(response, 'get DotBot session');
    }

    try {
      return await response.json();
    } catch (jsonError) {
      throw new Error(
        `Invalid JSON response from backend API. ` +
        `The server may be experiencing issues. Please try again later.`
      );
    }
  } catch (error) {
    // Handle network errors (fetch failures, CORS, connection issues)
    // TypeError is thrown when fetch fails (network error, CORS, invalid URL, etc.)
    if (error instanceof TypeError) {
      throw new Error(
        `Cannot connect to backend API at ${API_BASE_URL}. ` +
        `Make sure the backend server is running and CORS is configured correctly.`
      );
    }
    throw error;
  }
}

/**
 * Send a chat message to DotBot backend
 */
export async function sendDotBotMessage(
  request: DotBotChatRequest
): Promise<DotBotChatResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/dotbot/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: request.message,
        sessionId: request.sessionId,
        wallet: request.wallet,
        environment: request.environment,
        network: request.network,
        options: {
          conversationHistory: request.conversationHistory,
        },
        provider: request.provider,
      }),
    });

    if (!response.ok) {
      await handleFetchError(response, 'send message to DotBot');
    }

    return response.json();
  } catch (error) {
    // Handle network errors (fetch failures, CORS, connection issues)
    // TypeError is thrown when fetch fails (network error, CORS, invalid URL, etc.)
    if (error instanceof TypeError) {
      throw new Error(
        `Cannot connect to backend API at ${API_BASE_URL}. ` +
        `Make sure the backend server is running and CORS is configured correctly.`
      );
    }
    throw error;
  }
}

/**
 * Start execution of a prepared execution plan
 */
export async function startExecution(
  sessionId: string,
  executionId: string,
  autoApprove: boolean = false
): Promise<{ success: boolean; executionId: string; state: any; timestamp: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/dotbot/session/${sessionId}/execution/${executionId}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        autoApprove,
      }),
    });

    if (!response.ok) {
      await handleFetchError(response, 'start execution');
    }

    try {
      return await response.json();
    } catch (jsonError) {
      throw new Error(
        `Invalid JSON response from backend API. ` +
        `The server may be experiencing issues. Please try again later.`
      );
    }
  } catch (error) {
    // Handle network errors (fetch failures, CORS, connection issues)
    // TypeError is thrown when fetch fails (network error, CORS, invalid URL, etc.)
    if (error instanceof TypeError) {
      throw new Error(
        `Cannot connect to backend API at ${API_BASE_URL}. ` +
        `Make sure the backend server is running and CORS is configured correctly.`
      );
    }
    throw error;
  }
}

/**
 * Get execution state (for polling during preparation)
 */
export async function getExecutionState(
  sessionId: string,
  executionId: string
): Promise<{ success: boolean; executionId: string; state: any; timestamp: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/dotbot/session/${sessionId}/execution/${executionId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      await handleFetchError(response, 'get execution state');
    }

    return response.json();
  } catch (error) {
    // Handle network errors (fetch failures, CORS, connection issues)
    // TypeError is thrown when fetch fails (network error, CORS, invalid URL, etc.)
    if (error instanceof TypeError) {
      throw new Error(
        `Cannot connect to backend API at ${API_BASE_URL}. ` +
        `Make sure the backend server is running and CORS is configured correctly.`
      );
    }
    throw error;
  }
}

/**
 * Delete a DotBot session
 */
export async function deleteDotBotSession(sessionId: string): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/dotbot/session/${sessionId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      await handleFetchError(response, 'delete DotBot session');
    }

    try {
      return await response.json();
    } catch (jsonError) {
      throw new Error(
        `Invalid JSON response from backend API. ` +
        `The server may be experiencing issues. Please try again later.`
      );
    }
  } catch (error) {
    // Handle network errors (fetch failures, CORS, connection issues)
    // TypeError is thrown when fetch fails (network error, CORS, invalid URL, etc.)
    if (error instanceof TypeError) {
      throw new Error(
        `Cannot connect to backend API at ${API_BASE_URL}. ` +
        `Make sure the backend server is running and CORS is configured correctly.`
      );
    }
    throw error;
  }
}
