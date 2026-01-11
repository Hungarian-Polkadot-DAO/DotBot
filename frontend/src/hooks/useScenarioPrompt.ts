/**
 * Scenario Prompt Hook
 * 
 * Clean hook for listening to ScenarioEngine prompt injection events.
 * Replaces ChatInputContext with a simple, event-based approach.
 * 
 * Part of @dotbot/react package.
 */

import { useState, useEffect, useCallback } from 'react';
import type { ScenarioEngine } from '../lib';

interface InjectedPrompt {
  prompt: string;
  timestamp: number;
}

interface UseScenarioPromptReturn {
  /** The currently injected prompt (null if none) */
  injectedPrompt: InjectedPrompt | null;
  /** Clear the injected prompt */
  clearPrompt: () => void;
  /** Notify that prompt was processed (filled into input) */
  notifyPromptProcessed: () => void;
  /** Notify that response was received */
  notifyResponseReceived: (result: any) => void;
}

/**
 * Hook to listen for ScenarioEngine prompt injections.
 * 
 * Usage:
 * ```tsx
 * const { injectedPrompt, clearPrompt, notifyPromptProcessed } = useScenarioPrompt(scenarioEngine);
 * 
 * // When prompt is injected, fill the chat input
 * useEffect(() => {
 *   if (injectedPrompt) {
 *     setInputValue(injectedPrompt.prompt);
 *     notifyPromptProcessed();
 *   }
 * }, [injectedPrompt]);
 * ```
 */
export const useScenarioPrompt = (
  engine: ScenarioEngine | null
): UseScenarioPromptReturn => {
  const [injectedPrompt, setInjectedPrompt] = useState<InjectedPrompt | null>(null);

  useEffect(() => {
    if (!engine) return;

    const handleEvent = (event: any) => {
      if (event.type === 'inject-prompt') {
        setInjectedPrompt({
          prompt: event.prompt,
          timestamp: Date.now(),
        });
      }
    };

    engine.addEventListener(handleEvent);

    return () => {
      engine.removeEventListener(handleEvent);
    };
  }, [engine]);

  const clearPrompt = useCallback(() => {
    setInjectedPrompt(null);
  }, []);

  const notifyPromptProcessed = useCallback(() => {
    if (!engine) return;
    const executor = engine.getExecutor();
    executor?.notifyPromptProcessed();
  }, [engine]);

  const notifyResponseReceived = useCallback((result: any) => {
    if (!engine) return;
    const executor = engine.getExecutor();
    executor?.notifyResponseReceived(result);
  }, [engine]);

  return {
    injectedPrompt,
    clearPrompt,
    notifyPromptProcessed,
    notifyResponseReceived,
  };
};

