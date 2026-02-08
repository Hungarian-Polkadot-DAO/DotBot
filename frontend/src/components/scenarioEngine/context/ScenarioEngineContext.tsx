/**
 * ScenarioEngine Context
 * 
 * Centralized state management for ScenarioEngine UI components.
 * Prevents render loops by batching updates and providing single source of truth.
 */

import React, { createContext, useContext, useReducer, useCallback, useRef, useEffect, useLayoutEffect, useState, startTransition } from 'react';
import type { ReportMessageData } from '../components/ReportMessage';

interface ExecutionPhase {
  phase: 'beginning' | 'cycle' | 'final-report' | null;
  messages: string[];
  stepCount: number;
  dotbotActivity?: string;
}

interface ScenarioEngineState {
  // Report state
  reportMessages: ReportMessageData[];
  
  // Execution state
  executionPhase: ExecutionPhase | null;
  statusMessage: string;
  isRunning: boolean;
  runningScenario: string | null;
  
  // Entity state
  entities: any[];
  
  // UI state
  activeTab: 'entities' | 'scenarios' | 'report';
  executionMode: 'synthetic' | 'emulated' | 'live';
  autoSubmit: boolean;
}

type ScenarioEngineAction =
  | { type: 'ADD_MESSAGE'; message: ReportMessageData }
  | { type: 'ADD_MESSAGES_BATCH'; messages: ReportMessageData[] } // Batch multiple messages at once
  | { type: 'CLEAR_REPORT' }
  | { type: 'SET_EXECUTION_PHASE'; phase: ExecutionPhase | null }
  | { type: 'UPDATE_EXECUTION_PHASE'; updater: (prev: ExecutionPhase) => ExecutionPhase }
  | { type: 'SET_STATUS_MESSAGE'; message: string }
  | { type: 'SET_RUNNING_SCENARIO'; scenario: string | null }
  | { type: 'SET_ENTITIES'; entities: any[] }
  | { type: 'SET_ACTIVE_TAB'; tab: 'entities' | 'scenarios' | 'report' }
  | { type: 'SET_EXECUTION_MODE'; mode: 'synthetic' | 'emulated' | 'live' }
  | { type: 'SET_AUTO_SUBMIT'; autoSubmit: boolean };

const initialState: ScenarioEngineState = {
  reportMessages: [],
  executionPhase: null,
  statusMessage: '',
  isRunning: false,
  runningScenario: null,
  entities: [],
  activeTab: 'entities',
  executionMode: 'live',
  autoSubmit: true,
};

function scenarioEngineReducer(
  state: ScenarioEngineState,
  action: ScenarioEngineAction
): ScenarioEngineState {
  switch (action.type) {
    case 'ADD_MESSAGE':
      // Check for duplicates
      const exists = state.reportMessages.some(m => m.id === action.message.id);
      if (exists) {
        return state;
      }
      return {
        ...state,
        reportMessages: [...state.reportMessages, action.message],
      };
    
    case 'ADD_MESSAGES_BATCH':
      // Add multiple messages at once (more efficient than individual dispatches)
      // Optimized: use Set for O(1) duplicate checking instead of O(n) array search
      if (action.messages.length === 0) {
        return state;
      }
      
      // Create Set of existing IDs for fast lookup
      const existingIds = new Set(state.reportMessages.map(m => m.id));
      
      // Filter out duplicates (O(n) where n is batch size, not total messages)
      const newMessages = action.messages.filter(m => !existingIds.has(m.id));
      
      if (newMessages.length === 0) {
        return state; // No new messages, avoid re-render
      }
      
      // Append new messages (creates new array reference for React)
      return {
        ...state,
        reportMessages: [...state.reportMessages, ...newMessages],
      };
    
    case 'CLEAR_REPORT':
      return {
        ...state,
        reportMessages: [],
      };
    
    case 'SET_EXECUTION_PHASE':
      return {
        ...state,
        executionPhase: action.phase,
      };
    
    case 'UPDATE_EXECUTION_PHASE':
      return {
        ...state,
        executionPhase: action.updater(state.executionPhase || {
          phase: null,
          messages: [],
          stepCount: 0,
        }),
      };
    
    case 'SET_STATUS_MESSAGE':
      return {
        ...state,
        statusMessage: action.message,
      };
    
    case 'SET_RUNNING_SCENARIO':
      // Use startTransition for non-urgent state updates to prevent blocking
      return {
        ...state,
        runningScenario: action.scenario,
        isRunning: action.scenario !== null,
      };
    
    case 'SET_ENTITIES':
      return {
        ...state,
        entities: action.entities,
      };
    
    case 'SET_ACTIVE_TAB':
      return {
        ...state,
        activeTab: action.tab,
      };
    
    case 'SET_EXECUTION_MODE':
      return {
        ...state,
        executionMode: action.mode,
      };
    
    case 'SET_AUTO_SUBMIT':
      return {
        ...state,
        autoSubmit: action.autoSubmit,
      };
    
    default:
      return state;
  }
}

interface ScenarioEngineContextValue {
  state: ScenarioEngineState;
  dispatch: React.Dispatch<ScenarioEngineAction>;
  
  // Convenience actions (batched/optimized)
  addMessage: (message: ReportMessageData) => void;
  clearReport: () => void;
  setExecutionPhase: (phase: ExecutionPhase | null) => void;
  updateExecutionPhase: (updater: (prev: ExecutionPhase) => ExecutionPhase) => void;
  setStatusMessage: (message: string) => void;
  setRunningScenario: (scenario: string | null) => void;
  setEntities: (entities: any[]) => void;
  setActiveTab: (tab: 'entities' | 'scenarios' | 'report') => void;
  setExecutionMode: (mode: 'synthetic' | 'emulated' | 'live') => void;
  setAutoSubmit: (autoSubmit: boolean) => void;
}

const ScenarioEngineContext = createContext<ScenarioEngineContextValue | null>(null);

export function ScenarioEngineProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(scenarioEngineReducer, initialState);
  
  // Explicit readiness state - gates all message processing
  const [isReady, setIsReady] = useState(true);
  
  // Component lifecycle tracking - prevents state updates after unmount
  const isMountedRef = useRef(true);
  
  // Batch executionPhase updates using requestAnimationFrame
  const phaseUpdateRafRef = useRef<number | null>(null);
  const pendingPhaseUpdateRef = useRef<((prev: ExecutionPhase) => ExecutionPhase) | null>(null);
  
  // Single scheduler for message batching - one RAF, one state machine
  const messageBatchRef = useRef<ReportMessageData[]>([]);
  const schedulerRafRef = useRef<number | null>(null);
  const isScheduledRef = useRef(false);
  
  // Track all active setTimeout IDs for chunk processing to enable cleanup
  const chunkTimeoutIdsRef = useRef<Set<number>>(new Set());
  
  const updateExecutionPhase = useCallback((updater: (prev: ExecutionPhase) => ExecutionPhase) => {
    // Guard: Don't schedule if unmounted
    if (!isMountedRef.current) {
      return;
    }
    
    // Cancel any pending RAF
    if (phaseUpdateRafRef.current !== null) {
      cancelAnimationFrame(phaseUpdateRafRef.current);
    }
    
    // Store the updater
    pendingPhaseUpdateRef.current = updater;
    
    // Schedule batched update
    phaseUpdateRafRef.current = requestAnimationFrame(() => {
      // Guard: Don't dispatch if unmounted
      if (!isMountedRef.current || !pendingPhaseUpdateRef.current) {
        phaseUpdateRafRef.current = null;
        return;
      }
      
      dispatch({
        type: 'UPDATE_EXECUTION_PHASE',
        updater: pendingPhaseUpdateRef.current,
      });
      pendingPhaseUpdateRef.current = null;
      phaseUpdateRafRef.current = null;
    });
  }, []);
  
  // Single scheduler function - processes queued messages in chunks
  // Uses one RAF, one state machine - no overlapping schedulers
  // All async operations are tracked and cleaned up on unmount
  const processMessageBatch = useCallback(() => {
    if (!isMountedRef.current || !isReady) {
      isScheduledRef.current = false;
      return;
    }
    
    // Clear scheduler flag first to prevent deadlock
    isScheduledRef.current = false;
    
    // Check if there are messages to process
    if (messageBatchRef.current.length === 0) {
      console.log('[ScenarioEngineContext] processMessageBatch: queue empty, nothing to do');
      return;
    }
    
    const batch = [...messageBatchRef.current];
    messageBatchRef.current = [];
    console.log('[ScenarioEngineContext] Processing batch of', batch.length, 'messages');
    
    // Process messages in chunks of 20 to prevent UI freeze
    const CHUNK_SIZE = 20;
    const chunks: ReportMessageData[][] = [];
    for (let i = 0; i < batch.length; i += CHUNK_SIZE) {
      chunks.push(batch.slice(i, i + CHUNK_SIZE));
    }
    
    // Process first chunk immediately (with mounted check)
    if (chunks.length > 0 && isMountedRef.current) {
      startTransition(() => {
        // Double-check mounted before dispatch
        if (isMountedRef.current) {
          dispatch({ type: 'ADD_MESSAGES_BATCH', messages: chunks[0] });
        }
      });
    }
    
    // Process remaining chunks with delays (30ms between chunks)
    // Track all timeout IDs for cleanup
    for (let i = 1; i < chunks.length; i++) {
      const timeoutId = window.setTimeout(() => {
        // Remove from tracking set
        chunkTimeoutIdsRef.current.delete(timeoutId);
        
        // Guard: Don't dispatch if unmounted or not ready
        if (!isMountedRef.current || !isReady) {
          return;
        }
        
        startTransition(() => {
          // Double-check mounted before dispatch
          if (isMountedRef.current) {
            dispatch({ type: 'ADD_MESSAGES_BATCH', messages: chunks[i] });
          }
        });
        
        // After last chunk, check if more messages arrived and reschedule if needed
        if (i === chunks.length - 1) {
          scheduleProcessing();
        }
      }, 30 * i);
      
      // Track timeout ID for cleanup
      chunkTimeoutIdsRef.current.add(timeoutId);
    }
    
    // If only one chunk, check for more messages immediately
    if (chunks.length === 1) {
      scheduleProcessing();
    }
  }, [isReady]);
  
  // Helper function to schedule message processing
  // Extracted to enable reuse and idempotent scheduling
  const scheduleProcessing = useCallback(() => {
    if (!isMountedRef.current || !isReady) {
      return;
    }
    
    if (messageBatchRef.current.length === 0) {
      return;
    }
    
    // Only schedule if not already scheduled (idempotent)
    if (!isScheduledRef.current) {
      isScheduledRef.current = true;
      schedulerRafRef.current = requestAnimationFrame(() => {
        if (isMountedRef.current) {
          processMessageBatch();
        } else {
          isScheduledRef.current = false;
        }
        schedulerRafRef.current = null;
      });
    }
  }, [isReady, processMessageBatch]);
  
  // Batched addMessage - gates all message producers
  const addMessageBatched = useCallback((message: ReportMessageData) => {
    if (!isMountedRef.current) {
      return;
    }
    
    messageBatchRef.current.push(message);
    
    if (!isReady) {
      return;
    }
    
    scheduleProcessing();
  }, [isReady, scheduleProcessing]);
  
  // Component lifecycle management
  useLayoutEffect(() => {
    isMountedRef.current = true;
    setIsReady(true);
    
    return () => {
      isMountedRef.current = false;
      // Reset scheduler flag before remount to prevent stale state
      isScheduledRef.current = false;
    };
  }, []);
  
  // Process any messages queued before ready state
  // Also acts as recovery mechanism if scheduler gets stuck
  useEffect(() => {
    if (isReady) {
      // Use scheduleProcessing which is idempotent and has all safety checks
      scheduleProcessing();
    }
  }, [isReady, scheduleProcessing]);
  
  // Watchdog: Detect and recover from stuck scheduler
  // If messages are queued but scheduler isn't running, force recovery
  useEffect(() => {
    if (!isReady) return;
    
    const watchdogInterval = setInterval(() => {
      if (!isMountedRef.current || !isReady) return;
      
      const hasQueuedMessages = messageBatchRef.current.length > 0;
      const schedulerRunning = isScheduledRef.current;
      
      // Stuck state: messages queued but scheduler not running
      if (hasQueuedMessages && !schedulerRunning) {
        console.warn('[ScenarioEngineContext] Watchdog: Stuck scheduler detected, forcing recovery (queue:', messageBatchRef.current.length, ')');
        isScheduledRef.current = false;
        scheduleProcessing();
      }
      
      // Orphaned state: scheduler flag true but RAF is null
      if (schedulerRunning && schedulerRafRef.current === null && hasQueuedMessages) {
        console.warn('[ScenarioEngineContext] Watchdog: Orphaned scheduler detected, forcing recovery (queue:', messageBatchRef.current.length, ')');
        isScheduledRef.current = false;
        scheduleProcessing();
      }
    }, 2000); // Check every 2 seconds
    
    return () => clearInterval(watchdogInterval);
  }, [isReady, scheduleProcessing]);
  
  // Cleanup on unmount - cancel all pending operations
  // This is the critical cleanup that prevents memory leaks
  useEffect(() => {
    return () => {
      // Mark as unmounted first to prevent any new operations
      isMountedRef.current = false;
      setIsReady(false);
      
      // Cancel all requestAnimationFrame callbacks
      if (phaseUpdateRafRef.current !== null) {
        cancelAnimationFrame(phaseUpdateRafRef.current);
        phaseUpdateRafRef.current = null;
      }
      if (schedulerRafRef.current !== null) {
        cancelAnimationFrame(schedulerRafRef.current);
        schedulerRafRef.current = null;
      }
      
      // Clear all chunk processing timeouts
      chunkTimeoutIdsRef.current.forEach((timeoutId) => {
        clearTimeout(timeoutId);
      });
      chunkTimeoutIdsRef.current.clear();
      
      // Reset scheduler state and clear queue for clean remount
      isScheduledRef.current = false;
      messageBatchRef.current = [];
    };
  }, []);
  
  const contextValue: ScenarioEngineContextValue = {
    state,
    dispatch,
    addMessage: addMessageBatched, // Use batched version to prevent UI freeze
    clearReport: useCallback(() => {
      // Guard: Don't dispatch if unmounted
      if (!isMountedRef.current) {
        return;
      }
      // Use startTransition to prevent blocking when clearing report at scenario start
      startTransition(() => {
        if (isMountedRef.current) {
          dispatch({ type: 'CLEAR_REPORT' });
        }
      });
    }, []),
    setExecutionPhase: useCallback((phase: ExecutionPhase | null) => {
      // Guard: Don't dispatch if unmounted
      if (!isMountedRef.current) {
        return;
      }
      // Clear any pending updates for phase changes
      if (phaseUpdateRafRef.current !== null) {
        cancelAnimationFrame(phaseUpdateRafRef.current);
        phaseUpdateRafRef.current = null;
      }
      // Use startTransition to prevent blocking on phase changes
      startTransition(() => {
        if (isMountedRef.current) {
          dispatch({ type: 'SET_EXECUTION_PHASE', phase });
        }
      });
    }, []),
    updateExecutionPhase,
    setStatusMessage: useCallback((message: string) => {
      // Guard: Don't dispatch if unmounted
      if (!isMountedRef.current) {
        return;
      }
      // Status messages are non-urgent, use startTransition
      startTransition(() => {
        if (isMountedRef.current) {
          dispatch({ type: 'SET_STATUS_MESSAGE', message });
        }
      });
    }, []),
    setRunningScenario: useCallback((scenario: string | null) => {
      // Guard: Don't dispatch if unmounted
      if (!isMountedRef.current) {
        return;
      }
      // Use startTransition to prevent blocking when starting scenario
      startTransition(() => {
        if (isMountedRef.current) {
          dispatch({ type: 'SET_RUNNING_SCENARIO', scenario });
        }
      });
    }, []),
    setEntities: useCallback((entities: any[]) => {
      // Guard: Don't dispatch if unmounted
      if (!isMountedRef.current) {
        return;
      }
      // Entity updates can be large, use startTransition
      startTransition(() => {
        if (isMountedRef.current) {
          dispatch({ type: 'SET_ENTITIES', entities });
        }
      });
    }, []),
    setActiveTab: useCallback((tab: 'entities' | 'scenarios' | 'report') => {
      // Guard: Don't dispatch if unmounted
      if (!isMountedRef.current) {
        return;
      }
      // Tab changes should not block UI
      startTransition(() => {
        if (isMountedRef.current) {
          dispatch({ type: 'SET_ACTIVE_TAB', tab });
        }
      });
    }, []),
    setExecutionMode: useCallback((mode: 'synthetic' | 'emulated' | 'live') => {
      // Guard: Don't dispatch if unmounted
      if (!isMountedRef.current) {
        return;
      }
      dispatch({ type: 'SET_EXECUTION_MODE', mode });
    }, []),
    setAutoSubmit: useCallback((autoSubmit: boolean) => {
      // Guard: Don't dispatch if unmounted
      if (!isMountedRef.current) {
        return;
      }
      dispatch({ type: 'SET_AUTO_SUBMIT', autoSubmit });
    }, []),
  };
  
  return (
    <ScenarioEngineContext.Provider value={contextValue}>
      {children}
    </ScenarioEngineContext.Provider>
  );
}

export function useScenarioEngineState() {
  const context = useContext(ScenarioEngineContext);
  if (!context) {
    throw new Error('useScenarioEngineState must be used within ScenarioEngineProvider');
  }
  return context;
}

// Selective hooks for performance (only re-render when specific state changes)
export function useReportMessages() {
  const { state } = useScenarioEngineState();
  return state.reportMessages;
}

export function useExecutionPhase() {
  const { state } = useScenarioEngineState();
  return state.executionPhase;
}

export function useStatusMessage() {
  const { state } = useScenarioEngineState();
  return state.statusMessage;
}

export function useRunningScenario() {
  const { state } = useScenarioEngineState();
  return [state.runningScenario, state.isRunning] as const;
}

export function useEntities() {
  const { state } = useScenarioEngineState();
  return state.entities;
}

export type { ExecutionPhase, ScenarioEngineState };
