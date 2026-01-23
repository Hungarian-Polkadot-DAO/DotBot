/**
 * Scenario Engine Hook
 * 
 * Manages scenario engine event handling and state
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { ScenarioEngine, DotBot, TestEntity } from '@dotbot/core';
import type { ReportMessageData } from '../components/ReportMessage';

interface ExecutionPhase {
  phase: 'beginning' | 'cycle' | 'final-report' | null;
  messages: string[];
  stepCount: number;
  dotbotActivity?: string;
}

interface UseScenarioEngineProps {
  engine: ScenarioEngine | null;
  dotbot: DotBot | null;
  onSendMessage: (message: string) => Promise<void>;
  onAddMessage: (message: ReportMessageData) => void;
  onClearReport?: () => void;
  onStatusChange?: (message: string) => void;
  onPhaseChange?: (phase: ExecutionPhase | null) => void;
  onUpdatePhase?: (updater: (prev: ExecutionPhase) => ExecutionPhase) => void; // For batched updates
  onSetEntities?: (entities: any[]) => void;
  onSetRunningScenario?: (scenario: string | null) => void;
  entitiesTabActive?: boolean; // Whether entities tab is currently active
  entities?: any[]; // Current entities list (to check if we should refresh)
}

export const useScenarioEngine = ({
  engine,
  dotbot,
  onSendMessage,
  onAddMessage,
  onClearReport,
  onStatusChange,
  onPhaseChange,
  onUpdatePhase,
  onSetEntities,
  onSetRunningScenario,
  entitiesTabActive = false,
  entities = [],
}: UseScenarioEngineProps) => {
  // NOTE: State is now managed by ScenarioEngineContext
  // This hook only handles event subscriptions and calls context methods via callbacks
  // No local state - all state updates go through callbacks to context

  // Query balance for an entity address
  // For Westend/Polkadot, balances are typically on Asset Hub after migration
  const queryEntityBalance = useCallback(async (address: string): Promise<string> => {
    if (!dotbot || !engine) {
      return '0 DOT';
    }
    
    try {
      const network = dotbot.getNetwork();
      const decimals = network === 'polkadot' ? 10 : 12;
      const token = network === 'polkadot' ? 'DOT' : network === 'kusama' ? 'KSM' : 'WND';
      
      // Try Asset Hub first (where balances are after migration)
      const assetHubApi = dotbot.getAssetHubApi();
      if (assetHubApi) {
        try {
          await assetHubApi.isReady;
          const accountInfo = await assetHubApi.query.system.account(address);
          const accountData = (accountInfo as any).data;
          const free = accountData?.free?.toString() || '0';
          
          const freeBN = BigInt(free);
          const divisor = BigInt(10 ** decimals);
          const whole = freeBN / divisor;
          const fractional = freeBN % divisor;
          
          // If Asset Hub has balance, use it
          if (whole > BigInt(0) || fractional > BigInt(0)) {
            if (whole === BigInt(0) && fractional === BigInt(0)) {
              // Fall through to check Relay Chain
            } else {
              // Format with up to 4 decimal places
              const fractionalStr = fractional.toString().padStart(decimals, '0');
              const trimmed = fractionalStr.replace(/0+$/, '').slice(0, 4);
              const formatted = trimmed ? `${whole}.${trimmed}` : whole.toString();
              return `${formatted} ${token}`;
            }
          }
        } catch (error) {
          // Asset Hub query failed, try Relay Chain
          console.debug(`Asset Hub balance query failed for ${address}, trying Relay Chain:`, error);
        }
      }
      
      // Fallback to Relay Chain
      const api = await dotbot.getApi();
      await api.isReady;
      
      const accountInfo = await api.query.system.account(address);
      const accountData = (accountInfo as any).data;
      const free = accountData?.free?.toString() || '0';
      
      const freeBN = BigInt(free);
      const divisor = BigInt(10 ** decimals);
      const whole = freeBN / divisor;
      const fractional = freeBN % divisor;
      
      if (whole === BigInt(0) && fractional === BigInt(0)) {
        return `0 ${token}`;
      }
      
      // Format with up to 4 decimal places
      const fractionalStr = fractional.toString().padStart(decimals, '0');
      const trimmed = fractionalStr.replace(/0+$/, '').slice(0, 4);
      const formatted = trimmed ? `${whole}.${trimmed}` : whole.toString();
      
      return `${formatted} ${token}`;
    } catch (error) {
      console.warn(`Failed to query balance for ${address}:`, error);
      return '—';
    }
  }, [dotbot, engine]);

  // Helper function to refresh all entity balances
  // Processes in chunks to prevent UI freeze
  const refreshEntityBalances = useCallback(async () => {
    if (!engine || !dotbot || !onSetEntitiesRef.current) {
      return;
    }
    
    try {
      const engineEntities = Array.from(engine.getEntities().values()) as TestEntity[];
      if (engineEntities.length === 0) {
        return; // No entities to refresh
      }
      
      // Process entities in chunks to prevent blocking UI
      const CHUNK_SIZE = 5; // Process 5 entities at a time
      const chunks: TestEntity[][] = [];
      for (let i = 0; i < engineEntities.length; i += CHUNK_SIZE) {
        chunks.push(engineEntities.slice(i, i + CHUNK_SIZE));
      }
      
      const updatedEntities: any[] = [];
      
      // Process chunks sequentially with small delays
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        
        // Query balances for chunk
        const chunkResults = await Promise.all(
          chunk.map(async (e: TestEntity) => {
            const balance = await queryEntityBalance(e.address);
            return {
              name: e.name,
              address: e.address,
              type: e.type,
              uri: e.uri,
              balance,
            };
          })
        );
        
        updatedEntities.push(...chunkResults);
        
        // Update state incrementally for each chunk (non-blocking)
        // Use setTimeout to defer state update to next tick
        if (chunkIndex === 0) {
          // First chunk: update immediately
          onSetEntitiesRef.current(updatedEntities);
        } else {
          // Subsequent chunks: update with small delay
          await new Promise(resolve => setTimeout(resolve, 50));
          onSetEntitiesRef.current([...updatedEntities]);
        }
      }
      
      // Final update with all entities
      onSetEntitiesRef.current(updatedEntities);
    } catch (error) {
      console.warn('[useScenarioEngine] Failed to refresh entity balances:', error);
    }
  }, [engine, dotbot, queryEntityBalance]);

  // Use refs for callbacks to prevent re-subscription on every render
  const onAddMessageRef = useRef(onAddMessage);
  const onClearReportRef = useRef(onClearReport);
  const onStatusChangeRef = useRef(onStatusChange);
  const onPhaseChangeRef = useRef(onPhaseChange);
  const onUpdatePhaseRef = useRef(onUpdatePhase);
  const onSetEntitiesRef = useRef(onSetEntities);
  const onSetRunningScenarioRef = useRef(onSetRunningScenario);
  
  // Update refs when callbacks change
  useEffect(() => {
    onAddMessageRef.current = onAddMessage;
    onClearReportRef.current = onClearReport;
    onStatusChangeRef.current = onStatusChange;
    onPhaseChangeRef.current = onPhaseChange;
    onUpdatePhaseRef.current = onUpdatePhase;
    onSetEntitiesRef.current = onSetEntities;
    onSetRunningScenarioRef.current = onSetRunningScenario;
  }, [onAddMessage, onClearReport, onStatusChange, onPhaseChange, onUpdatePhase, onSetEntities, onSetRunningScenario]);
  
  // Message ID counter (persists across renders)
  const messageIdCounterRef = useRef(0);
  const getNextMessageId = () => `msg-${++messageIdCounterRef.current}`;
  
  useEffect(() => {
    if (!engine || !dotbot) {
      console.log('[useScenarioEngine] Skipping subscription - engine:', !!engine, 'dotbot:', !!dotbot);
      return;
    }
    
    console.log('[useScenarioEngine] Setting up event listener');
    
    // Subscribe to DotBot events for automatic response capture
    // This should only happen once when engine/dotbot change, not on every callback change
    engine.subscribeToDotBot(dotbot);
    
    // Helper function to batch executionPhase updates
    // Uses context's updateExecutionPhase which already has batching via requestAnimationFrame
    const applyPhaseUpdate = (updater: (prev: ExecutionPhase) => ExecutionPhase) => {
      // Use context's batched update method if available, otherwise fall back to direct callback
      if (onUpdatePhaseRef.current) {
        onUpdatePhaseRef.current(updater);
      } else if (onPhaseChangeRef.current) {
        // Fallback: get current phase from context (would need to be passed, but for now use callback)
        // This is not ideal but maintains backward compatibility
        onPhaseChangeRef.current({
          phase: null,
          messages: [],
          stepCount: 0,
        });
      }
    };
    
    const handleEvent = (event: any) => {
      console.log('[useScenarioEngine] Event received:', event.type);
      if (event.type === 'report-update' || event.type === 'inject-prompt' || event.type === 'phase-start') {
        console.log('[useScenarioEngine] Important event details:', event);
      }
      
      if (event.type === 'report-update') {
        // Create a single message object for the content chunk
        // This is more efficient than splitting into individual lines
        const content = event.content || '';
        console.log('[useScenarioEngine] report-update content:', content.substring(0, 100), 'length:', content.length);
        if (content) {
          // Determine message type based on content
          let messageType: ReportMessageData['type'] = 'default';
          if (content.includes('[ERROR]') || content.includes('✗')) {
            messageType = 'error';
          } else if (content.includes('[WARN]') || content.includes('⚠️')) {
            messageType = 'warning';
          } else if (content.includes('[PHASE]') || content.includes('━━━')) {
            messageType = 'phase';
          } else if (content.includes('[INFO]') || content.includes('✓') || content.includes('✅')) {
            messageType = 'info';
          }
          
          const message: ReportMessageData = {
            id: getNextMessageId(),
            content: content,
            timestamp: Date.now(),
            type: messageType,
          };
          console.log('[useScenarioEngine] Calling onAddMessageRef with message:', message.id, message.content.substring(0, 50));
          onAddMessageRef.current(message);
        } else {
          console.warn('[useScenarioEngine] report-update event has empty content');
        }
        return;
      }
      
      if (event.type === 'report-clear') {
        // Report cleared - UI should clear its display
        onClearReportRef.current?.();
        messageIdCounterRef.current = 0; // Reset counter
        return;
      }
      
      if (event.type === 'phase-start') {
        const newPhase: ExecutionPhase = {
          phase: event.phase,
          messages: [],
          stepCount: 0,
        };
        onPhaseChangeRef.current?.(newPhase);
        // Report content is handled by ScenarioEngine - no need to append here
      } else if (event.type === 'phase-update') {
        applyPhaseUpdate(prev => ({
          ...prev,
          messages: [...prev.messages, event.message],
        }));
        // Report content is handled by ScenarioEngine - no need to append here
      } else if (event.type === 'dotbot-activity') {
        applyPhaseUpdate(prev => ({
          ...prev,
          dotbotActivity: event.activity,
        }));
        // Update status when execution completes
        if (event.activity.includes('Execution completed') || event.activity.includes('completed')) {
          onStatusChangeRef.current?.('');
        }
        // Report content is handled by ScenarioEngine - no need to append here
      } else if (event.type === 'inject-prompt') {
        // Note: inject-prompt events are now handled by App.tsx via useScenarioPrompt hook
        // This hook no longer needs to handle prompt injection
        onStatusChangeRef.current?.('Waiting for user to submit prompt...');
        // Track DotBot activity (just for UI status, not report)
        applyPhaseUpdate(prev => ({
          ...prev,
          dotbotActivity: `Waiting for user to submit prompt...`,
        }));
        // Report content is handled by ScenarioEngine - no need to append here
        // The "Prompt injected" message should NOT appear in the report
      } else if (event.type === 'log') {
        // Report content is handled by ScenarioEngine - no need to append here
        // Update status based on log messages
        const message = event.message.toLowerCase();
        if (message.includes('setting up entities')) {
          onStatusChangeRef.current?.('Setting up entities...');
        } else if (message.includes('setting up state') || message.includes('state setup')) {
          onStatusChangeRef.current?.('Setting up state...');
        } else if (message.includes('executing prompt')) {
          onStatusChangeRef.current?.('Executing prompt...');
        } else if (message.includes('starting evaluation') || message.includes('evaluating')) {
          onStatusChangeRef.current?.('Evaluating results...');
        } else if (message.includes('scenario completed')) {
          onStatusChangeRef.current?.('');
        }
      } else if (event.type === 'state-change' && event.state.entities) {
        const engineEntities = Array.from(event.state.entities.values()) as TestEntity[];
        
        // Query balances for all entities in chunks to prevent UI freeze
        // Use the same chunked approach as refreshEntityBalances
        (async () => {
          if (engineEntities.length === 0) {
            return;
          }
          
          // Process entities in chunks to prevent blocking UI
          const CHUNK_SIZE = 5; // Process 5 entities at a time
          const chunks: TestEntity[][] = [];
          for (let i = 0; i < engineEntities.length; i += CHUNK_SIZE) {
            chunks.push(engineEntities.slice(i, i + CHUNK_SIZE));
          }
          
          const updatedEntities: any[] = [];
          
          // Process chunks sequentially with small delays
          for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
            const chunk = chunks[chunkIndex];
            
            // Query balances for chunk
            const chunkResults = await Promise.all(
              chunk.map(async (e: TestEntity) => {
                const balance = await queryEntityBalance(e.address);
                return {
                  name: e.name,
                  address: e.address,
                  type: e.type,
                  uri: e.uri,
                  balance,
                };
              })
            );
            
            updatedEntities.push(...chunkResults);
            
            // Update state incrementally for each chunk (non-blocking)
            // Use setTimeout to defer state update to next tick
            if (chunkIndex === 0) {
              // First chunk: update immediately
              onSetEntitiesRef.current?.(updatedEntities);
            } else {
              // Subsequent chunks: update with small delay
              await new Promise(resolve => setTimeout(resolve, 50));
              onSetEntitiesRef.current?.(updatedEntities);
            }
          }
          
          // Final update with all entities
          onSetEntitiesRef.current?.(updatedEntities);
        })().catch((error) => {
          console.warn('[useScenarioEngine] Failed to query entity balances on state-change:', error);
        });
      } else if (event.type === 'scenario-complete') {
        onSetRunningScenarioRef.current?.(null);
        onStatusChangeRef.current?.('');
        // Report content is handled by ScenarioEngine - no need to append here
      } else if (event.type === 'step-start') {
        const stepNum = (event.index || 0) + 1;
        applyPhaseUpdate(prev => ({
          ...prev,
          stepCount: stepNum,
          messages: [...prev.messages, `Step ${stepNum} started`],
        }));
        // Report content is handled by ScenarioEngine - no need to append here
        onStatusChangeRef.current?.(`Executing step ${stepNum}...`);
      } else if (event.type === 'step-complete') {
        applyPhaseUpdate(prev => ({
          ...prev,
          messages: [...prev.messages, `Step completed`],
        }));
        
        // Track DotBot's response for status display
        if (event.result.response) {
          const responseType = event.result.response.type;
          const responseContent = event.result.response.content || '';
          const responsePreview = responseContent.substring(0, 150);
          
          applyPhaseUpdate(prev => ({
            ...prev,
            dotbotActivity: `Responded with ${responseType}: ${responsePreview}${responseContent.length > 150 ? '...' : ''}`,
          }));
        }
        
        // Report content is handled by ScenarioEngine - no need to append here
        onStatusChangeRef.current?.('Processing step result...');
      }
    };
    
    engine.addEventListener(handleEvent);
    console.log('[useScenarioEngine] Event listener registered');
    
    // Sync existing report content if scenario is already running
    // This handles the case where we subscribe after the scenario started
    // No timeout needed - context's isReady state gates processing
    // If not ready, message will be queued and processed when ready
    try {
      const currentReport = engine.getReport();
      if (currentReport && currentReport.trim()) {
        console.log('[useScenarioEngine] Syncing existing report content, length:', currentReport.length);
        // Determine message type based on content
        let messageType: ReportMessageData['type'] = 'default';
        if (currentReport.includes('[ERROR]') || currentReport.includes('✗')) {
          messageType = 'error';
        } else if (currentReport.includes('[WARN]') || currentReport.includes('⚠️')) {
          messageType = 'warning';
        } else if (currentReport.includes('[PHASE]') || currentReport.includes('━━━')) {
          messageType = 'phase';
        } else if (currentReport.includes('[INFO]') || currentReport.includes('✓') || currentReport.includes('✅')) {
          messageType = 'info';
        }
        
        // Create a single message for the existing content
        const syncMessage: ReportMessageData = {
          id: getNextMessageId(),
          content: currentReport,
          timestamp: Date.now(),
          type: messageType,
        };
        onAddMessageRef.current(syncMessage);
        console.log('[useScenarioEngine] Synced existing report as message:', syncMessage.id);
      }
    } catch (error) {
      console.warn('[useScenarioEngine] Failed to sync report:', error);
    }
    
    return () => {
      console.log('[useScenarioEngine] Cleaning up event listener');
      engine.removeEventListener(handleEvent);
      // Unsubscribe from DotBot when component unmounts
      engine.unsubscribeFromDotBot();
    };
    // queryEntityBalance is included because it's used inside handleEvent (line 274)
    // It's wrapped in useCallback with [dotbot, engine] deps, so it's stable when those don't change
  }, [engine, dotbot, queryEntityBalance]);

  // Periodic balance refresh - only when entities tab is active and entities exist
  // Uses a reasonable interval (30 seconds) to avoid excessive network traffic
  useEffect(() => {
    if (!engine || !dotbot || !entitiesTabActive || entities.length === 0) {
      return; // Don't refresh if tab is not active or no entities
    }

    const BALANCE_REFRESH_INTERVAL = 30000; // 30 seconds
    
    // Initial refresh after a short delay (to avoid immediate refresh on tab switch)
    const initialTimeout = setTimeout(() => {
      refreshEntityBalances();
    }, 1000);

    // Set up periodic refresh
    const intervalId = setInterval(() => {
      refreshEntityBalances();
    }, BALANCE_REFRESH_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(intervalId);
    };
  }, [engine, dotbot, entitiesTabActive, entities.length, refreshEntityBalances]);

  // Hook no longer returns state - all state is managed by context
  // This is a side-effect only hook (event subscriptions)
};

