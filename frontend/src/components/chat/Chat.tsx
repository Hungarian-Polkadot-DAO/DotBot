/**
 * Chat Component
 * 
 * Main conversation UI that manages the message list and renders
 * different item types (text messages, execution flows, system notifications).
 * 
 * This component will be part of @dotbot/react package.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { DotBot, ConversationItem, DotBotEvent } from '@dotbot/core';
import MessageList from './MessageList';
import ConversationItems from './ConversationItems';
import ChatInput from './ChatInput';
import TypingIndicator from './TypingIndicator';

interface ChatProps {
  dotbot: DotBot;
  onSendMessage: (message: string) => Promise<any>;
  isTyping?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Injected prompt from ScenarioEngine (optional) */
  injectedPrompt?: string | null;
  /** Callback when injected prompt is processed */
  onPromptProcessed?: () => void;
  /** Auto-submit injected prompts (default: true) */
  autoSubmit?: boolean;
  /** Backend session ID for API calls (stateless mode) */
  backendSessionId?: string | null;
}

const Chat: React.FC<ChatProps> = ({
  dotbot,
  onSendMessage,
  isTyping = false,
  disabled = false,
  placeholder = "Type your message...",
  injectedPrompt = null,
  onPromptProcessed,
  autoSubmit = true,
  backendSessionId = null,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [showInjectionEffect, setShowInjectionEffect] = useState(false);
  const processedPromptRef = useRef<string | null>(null);

  const handleSubmit = useCallback(async () => {
    const trimmedValue = inputValue.trim();
    if (trimmedValue && !isTyping && !disabled) {
      // Clear input immediately to prevent double submission
      setInputValue('');
      await onSendMessage(trimmedValue);
    }
  }, [inputValue, isTyping, disabled, onSendMessage]);

  // Handle injected prompt from ScenarioEngine
  useEffect(() => {
    if (injectedPrompt) {
      const trimmedPrompt = injectedPrompt.trim();
      
      // Prevent re-processing the same prompt (avoid infinite loop)
      if (processedPromptRef.current === trimmedPrompt) {
        return;
      }
      
      // Prevent processing if already typing (avoid race conditions)
      if (isTyping || disabled) {
        return;
      }
      
      processedPromptRef.current = trimmedPrompt;
      setInputValue(trimmedPrompt);
      setShowInjectionEffect(true);
      
      // Notify that prompt was filled into input (this unblocks waitForPromptProcessed)
      // This happens BEFORE submission - the executor will then wait for the response
      onPromptProcessed?.();
      
      // Auto-submit injected prompts if enabled (ScenarioEngine can work both ways)
      let submitTimer: NodeJS.Timeout | null = null;
      if (autoSubmit) {
        // Small delay to ensure input is set and UI is ready
        submitTimer = setTimeout(async () => {
          // Double-check conditions before submitting
          const canSubmit = !isTyping && !disabled && trimmedPrompt && processedPromptRef.current === trimmedPrompt;
          
          if (canSubmit) {
            console.log('[Chat] Auto-submitting injected prompt:', trimmedPrompt.substring(0, 50) + '...');
            // Mark as submitted to prevent re-submission
            processedPromptRef.current = null;
            setInputValue('');
            try {
              // Send the message - the ScenarioEngine will receive the response via DotBot events
              await onSendMessage(trimmedPrompt);
              console.log('[Chat] Successfully sent injected prompt');
            } catch (error) {
              console.error('[Chat] Failed to submit injected prompt:', error);
              // Clear the processed ref so it can be retried
              processedPromptRef.current = null;
            }
          } else {
            // Conditions changed, don't send but still clear the processed ref
            console.warn('[Chat] Cannot auto-submit prompt - conditions not met:', {
              isTyping,
              disabled,
              hasPrompt: !!trimmedPrompt,
              refMatches: processedPromptRef.current === trimmedPrompt
            });
            processedPromptRef.current = null;
          }
        }, 100);
      } else {
        console.log('[Chat] Auto-submit disabled - waiting for manual submission');
      }
      
      // Reset injection effect after animation
      const timer = setTimeout(() => {
        setShowInjectionEffect(false);
      }, 2000);
      
      return () => {
        clearTimeout(timer);
        if (submitTimer) {
          clearTimeout(submitTimer);
        }
      };
    } else {
      // Clear processed prompt ref when no prompt is injected
      processedPromptRef.current = null;
    }
  }, [injectedPrompt, onPromptProcessed, isTyping, disabled, onSendMessage, autoSubmit]);

  // Get conversation items from ChatInstance
  const conversationItems: ConversationItem[] = dotbot.currentChat?.getDisplayMessages() || [];
  
  // Subscribe to DotBot events to detect when new execution messages are added
  // This ensures ExecutionFlow appears immediately when executionMessage is added (before executionArray exists)
  useEffect(() => {
    const handleDotBotEvent = (event: DotBotEvent) => {
      // When a new execution message is added, force re-render
      if (event.type === 'execution-message-added') {
        setRefreshKey(prev => prev + 1);
      }
    };
    
    dotbot.addEventListener(handleDotBotEvent);
    
    return () => {
      dotbot.removeEventListener(handleDotBotEvent);
    };
  }, [dotbot]);
  
  // Force re-render when executionArray is added to execution messages
  // This ensures ExecutionFlow updates when executionArray state changes
  // Use ref to track if we've already set up polling to prevent duplicate intervals
  const pollingRef = useRef<boolean>(false);
  
  useEffect(() => {
    if (!dotbot.currentChat) return;
    
    const hasExecutionMessages = conversationItems.some(item => item.type === 'execution');
    if (!hasExecutionMessages) {
      pollingRef.current = false;
      return;
    }
    
    // Check if executionArrays already exist - no need to poll
    const currentItems = dotbot.currentChat.getDisplayMessages();
    const hasExecutionArrays = currentItems.some(
      item => item.type === 'execution' && (item as any).executionArray
    );
    
    if (hasExecutionArrays) {
      pollingRef.current = false;
      // Only trigger refresh if we haven't already (avoid unnecessary re-renders)
      return;
    }
    
    // Prevent multiple polling intervals from being created
    if (pollingRef.current) {
      return;
    }
    
    pollingRef.current = true;
    
    // Poll for executionArray updates with timeout and max attempts
    let attempts = 0;
    const maxAttempts = 20; // 3 seconds max (20 * 150ms) - reduced from 40
    const pollInterval = 150; // Check every 150ms
    
    const interval = setInterval(() => {
      attempts++;
      const items = dotbot.currentChat?.getDisplayMessages() || [];
      const foundExecutionArrays = items.some(
        item => item.type === 'execution' && (item as any).executionArray
      );
      
      if (foundExecutionArrays || attempts >= maxAttempts) {
        pollingRef.current = false;
        if (foundExecutionArrays) {
        setRefreshKey(prev => prev + 1);
        }
        clearInterval(interval);
      }
    }, pollInterval);
    
    return () => {
      pollingRef.current = false;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dotbot.currentChat, conversationItems.length]);

  return (
    <div className="chat-container">
      {/* Messages */}
      <MessageList>
        <ConversationItems 
          key={refreshKey}
          items={conversationItems}
          dotbot={dotbot}
          backendSessionId={backendSessionId}
        />
        
        {/* Typing indicator */}
        {isTyping && <TypingIndicator />}
      </MessageList>

      {/* Input area */}
      <ChatInput
              value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
              placeholder={placeholder}
              disabled={disabled}
        isTyping={isTyping}
        showInjectionEffect={showInjectionEffect}
                />
    </div>
  );
};

export default Chat;

