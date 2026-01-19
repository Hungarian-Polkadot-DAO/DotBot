/**
 * Scenario Engine Hook
 * 
 * Manages scenario engine event handling and state
 */

import { useState, useEffect, useRef } from 'react';
import { ScenarioEngine, DotBot, TestEntity } from '@dotbot/core';

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
  onAppendReport: (text: string) => void;
  onClearReport?: () => void;
  onStatusChange?: (message: string) => void;
  onPhaseChange?: (phase: ExecutionPhase) => void;
}

export const useScenarioEngine = ({
  engine,
  dotbot,
  onSendMessage,
  onAppendReport,
  onClearReport,
  onStatusChange,
  onPhaseChange,
}: UseScenarioEngineProps) => {
  const [entities, setEntities] = useState<any[]>([]);
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  // executionPhase state is used to track phase updates and pass to onPhaseChange callback
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [executionPhase, setExecutionPhase] = useState<ExecutionPhase>({
    phase: null,
    messages: [],
    stepCount: 0,
  });

  // Query balance for an entity address
  // For Westend/Polkadot, balances are typically on Asset Hub after migration
  const queryEntityBalance = async (address: string): Promise<string> => {
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
  };

  // Use refs for callbacks to prevent re-subscription on every render
  const onAppendReportRef = useRef(onAppendReport);
  const onClearReportRef = useRef(onClearReport);
  const onStatusChangeRef = useRef(onStatusChange);
  const onPhaseChangeRef = useRef(onPhaseChange);
  
  // Update refs when callbacks change
  useEffect(() => {
    onAppendReportRef.current = onAppendReport;
    onClearReportRef.current = onClearReport;
    onStatusChangeRef.current = onStatusChange;
    onPhaseChangeRef.current = onPhaseChange;
  }, [onAppendReport, onClearReport, onStatusChange, onPhaseChange]);
  
  useEffect(() => {
    if (!engine || !dotbot) {
      return;
    }
    
    // Subscribe to DotBot events for automatic response capture
    // This should only happen once when engine/dotbot change, not on every callback change
    engine.subscribeToDotBot(dotbot);
    
    const handleEvent = (event: any) => {
      // Report is now built inside ScenarioEngine - just pass through updates
      if (event.type === 'report-update') {
        onAppendReportRef.current(event.content);
        return;
      }
      
      if (event.type === 'report-clear') {
        // Report cleared - UI should clear its display
        // Clear the report state in the frontend
        onClearReportRef.current?.();
        return;
      }
      
      if (event.type === 'phase-start') {
        const newPhase: ExecutionPhase = {
          phase: event.phase,
          messages: [],
          stepCount: 0,
        };
        setExecutionPhase(newPhase);
        onPhaseChangeRef.current?.(newPhase);
        // Report content is handled by ScenarioEngine - no need to append here
      } else if (event.type === 'phase-update') {
        setExecutionPhase(prev => {
          const updated = {
            ...prev,
            messages: [...prev.messages, event.message],
          };
          onPhaseChangeRef.current?.(updated);
          return updated;
        });
        // Report content is handled by ScenarioEngine - no need to append here
      } else if (event.type === 'dotbot-activity') {
        setExecutionPhase(prev => {
          const updated = {
            ...prev,
            dotbotActivity: event.activity,
          };
          onPhaseChangeRef.current?.(updated);
          return updated;
        });
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
        setExecutionPhase(prev => {
          const updated = {
            ...prev,
            dotbotActivity: `Waiting for user to submit prompt...`,
          };
          onPhaseChangeRef.current?.(updated);
          return updated;
        });
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
        
        // Query balances for all entities
        Promise.all(
          engineEntities.map(async (e: TestEntity) => {
            const balance = await queryEntityBalance(e.address);
            return {
              name: e.name,
              address: e.address,
              type: e.type,
              uri: e.uri,
              balance,
            };
          })
        ).then(setEntities);
      } else if (event.type === 'scenario-complete') {
        setRunningScenario(null);
        onStatusChangeRef.current?.('');
        // Report content is handled by ScenarioEngine - no need to append here
      } else if (event.type === 'step-start') {
        const stepNum = (event.index || 0) + 1;
        setExecutionPhase(prev => {
          const updated = {
            ...prev,
            stepCount: stepNum,
            messages: [...prev.messages, `Step ${stepNum} started`],
          };
          onPhaseChangeRef.current?.(updated);
          return updated;
        });
        // Report content is handled by ScenarioEngine - no need to append here
        onStatusChangeRef.current?.(`Executing step ${stepNum}...`);
      } else if (event.type === 'step-complete') {
        setExecutionPhase(prev => {
          const updated = {
            ...prev,
            messages: [...prev.messages, `Step completed`],
          };
          onPhaseChangeRef.current?.(updated);
          return updated;
        });
        
        // Track DotBot's response for status display
        if (event.result.response) {
          const responseType = event.result.response.type;
          const responseContent = event.result.response.content || '';
          const responsePreview = responseContent.substring(0, 150);
          
          setExecutionPhase(prev => {
            const updated = {
              ...prev,
              dotbotActivity: `Responded with ${responseType}: ${responsePreview}${responseContent.length > 150 ? '...' : ''}`,
            };
            onPhaseChangeRef.current?.(updated);
            return updated;
          });
        }
        
        // Report content is handled by ScenarioEngine - no need to append here
        onStatusChangeRef.current?.('Processing step result...');
      }
    };
    
    engine.addEventListener(handleEvent);
    
    return () => {
      engine.removeEventListener(handleEvent);
      // Unsubscribe from DotBot when component unmounts
      engine.unsubscribeFromDotBot();
    };
  }, [engine, dotbot]); // Only depend on engine and dotbot, not callbacks

  return {
    entities,
    runningScenario,
    setRunningScenario,
  };
};

