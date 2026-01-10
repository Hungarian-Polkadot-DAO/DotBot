/**
 * ChatInput Context
 * 
 * Provides a way for ScenarioEngine to set the chat input value
 * without using global window object.
 */

import React, { createContext, useContext, useState, useCallback } from 'react';

interface ChatInputContextType {
  /** Set the chat input value (for ScenarioEngine) */
  setInputValue: (value: string) => void;
  /** Register a setter function (called by Chat component) */
  registerSetter: (setter: (value: string) => void) => void;
  /** Current pending prompt from ScenarioEngine */
  pendingPrompt: string | null;
  /** Set pending prompt (for detecting user submission) */
  setPendingPrompt: (prompt: string | null) => void;
  /** Executor reference (for notifying after response) */
  executor: any;
  /** Set executor reference */
  setExecutor: (executor: any) => void;
  /** Track when injection happens (for visual effects) */
  lastInjectionTime: number;
  /** Trigger injection animation */
  triggerInjection: () => void;
}

const ChatInputContext = createContext<ChatInputContextType | undefined>(undefined);

/**
 * Hook to access ChatInput context
 */
export const useChatInput = () => {
  const context = useContext(ChatInputContext);
  if (context === undefined) {
    throw new Error('useChatInput must be used within a ChatInputProvider');
  }
  return context;
};

interface ChatInputProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component for ChatInput context
 */
export const ChatInputProvider: React.FC<ChatInputProviderProps> = ({ children }) => {
  const [inputSetter, setInputSetter] = useState<((value: string) => void) | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [executor, setExecutor] = useState<any>(null);
  const [lastInjectionTime, setLastInjectionTime] = useState<number>(0);

  const registerSetter = useCallback((setter: (value: string) => void) => {
    setInputSetter(() => setter);
  }, []);

  const setInputValue = useCallback((value: string) => {
    if (inputSetter) {
      inputSetter(value);
      // Trigger visual effect
      setLastInjectionTime(Date.now());
    } else {
      console.warn('[ChatInputContext] Input setter not registered yet');
    }
  }, [inputSetter]);

  const triggerInjection = useCallback(() => {
    setLastInjectionTime(Date.now());
  }, []);

  return (
    <ChatInputContext.Provider
      value={{
        setInputValue,
        registerSetter,
        pendingPrompt,
        setPendingPrompt,
        executor,
        setExecutor,
        lastInjectionTime,
        triggerInjection,
      }}
    >
      {children}
    </ChatInputContext.Provider>
  );
};

