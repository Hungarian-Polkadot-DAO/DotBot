/**
 * Scenario Engine Hook
 * 
 * Manages scenario engine event handling and state
 */

import { useState, useEffect } from 'react';
import { ScenarioEngine, DotBot, Scenario, TestEntity } from '../../../lib';
import { useChatInput } from '../../../contexts/ChatInputContext';

interface UseScenarioEngineProps {
  engine: ScenarioEngine;
  dotbot: DotBot;
  onSendMessage: (message: string) => Promise<void>;
  onAppendReport: (text: string) => void;
}

export const useScenarioEngine = ({
  engine,
  dotbot,
  onSendMessage,
  onAppendReport,
}: UseScenarioEngineProps) => {
  const [entities, setEntities] = useState<any[]>([]);
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const { setInputValue, setPendingPrompt, setExecutor } = useChatInput();

  const handlePromptInjection = async (prompt: string) => {
    const executor = engine.getExecutor();
    executor?.notifyPromptProcessed();
    
    // Fill the ChatInput but DON'T send the message
    // User can review and submit manually
    setInputValue(prompt);
    
    // Store the prompt and executor reference for App.tsx to detect submission
    setPendingPrompt(prompt);
    setExecutor(executor);
  };

  useEffect(() => {
    const handleEvent = (event: any) => {
      if (event.type === 'inject-prompt') {
        handlePromptInjection(event.prompt);
      } else if (event.type === 'log') {
        onAppendReport(`[${event.level.toUpperCase()}] ${event.message}\n`);
      } else if (event.type === 'state-change' && event.state.entities) {
        const engineEntities = Array.from(event.state.entities.values()) as TestEntity[];
        setEntities(engineEntities.map((e: TestEntity) => ({
          name: e.name,
          address: e.address,
          type: e.type,
          uri: e.uri,
          balance: '0 DOT'
        })));
      } else if (event.type === 'scenario-complete') {
        setRunningScenario(null);
        const result = event.result;
        onAppendReport(
          `\n[COMPLETE] ${result.success ? '✅ PASSED' : '❌ FAILED'}\n` +
          `[SCORE] ${result.evaluation.score}/100\n` +
          `[DURATION] ${result.duration}ms\n`
        );
      }
    };
    
    engine.addEventListener(handleEvent);
    return () => engine.removeEventListener(handleEvent);
  }, [engine, dotbot, onSendMessage, onAppendReport]);

  return {
    entities,
    runningScenario,
    setRunningScenario,
  };
};

