/**
 * Chat Component
 * 
 * Main conversation UI that manages the message list and renders
 * different item types (text messages, execution flows, system notifications).
 * 
 * This component will be part of @dotbot/react package.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DotBot, ConversationItem, DotBotEvent, DotBotEventType } from '@dotbot/core';
import MessageList from './MessageList';
import ConversationItems from './ConversationItems';
import ChatInput from './ChatInput';
import TypingIndicator from './TypingIndicator';

interface InjectedPrompt {
  prompt: string;
  timestamp: number;
}

interface ChatProps {
  dotbot: DotBot;
  onSendMessage: (message: string) => Promise<any>;
  isTyping?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Injected prompt from ScenarioEngine (optional) */
  injectedPrompt?: InjectedPrompt | null;
  /** Callback when injected prompt is processed */
  onPromptProcessed?: () => void;
  /** Auto-submit injected prompts (default: true) */
  autoSubmit?: boolean;
  /** Incremented by parent when messages are added so Chat re-reads getDisplayMessages() */
  conversationRefresh?: number;
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
  conversationRefresh = 0,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [showInjectionEffect, setShowInjectionEffect] = useState(false);
  const processedTimestampRef = useRef<number | null>(null);
  const activeTimersRef = useRef<{ submit?: NodeJS.Timeout; effect?: NodeJS.Timeout } | null>(null);
  const suppressScrollRef = useRef(false);

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
    if (!injectedPrompt?.prompt) {
      processedTimestampRef.current = null;
      activeTimersRef.current = null;
      return;
    }
    
    // Prevent re-processing the same injection (check timestamp to handle re-renders)
    if (processedTimestampRef.current === injectedPrompt.timestamp) {
      return; // Skip without cleanup - timers from first run continue uninterrupted
    }
    
    // Clear any existing timers from previous injection (different timestamp)
    if (activeTimersRef.current) {
      if (activeTimersRef.current.submit) clearTimeout(activeTimersRef.current.submit);
      if (activeTimersRef.current.effect) clearTimeout(activeTimersRef.current.effect);
    }
    
    const trimmedPrompt = injectedPrompt.prompt.trim();
    processedTimestampRef.current = injectedPrompt.timestamp;
    setInputValue(trimmedPrompt);
    setShowInjectionEffect(true);
    
    // Notify ScenarioEngine that prompt was filled (unblocks waitForPromptProcessed)
    onPromptProcessed?.();
    
    // Reset injection effect after animation
    const effectTimer = setTimeout(() => {
      setShowInjectionEffect(false);
    }, 2000);
    
    // Auto-submit if enabled
    if (autoSubmit) {
      const submitTimer = setTimeout(async () => {
        setInputValue('');
        try {
          await onSendMessage(trimmedPrompt);
          activeTimersRef.current = null;
        } catch (error) {
          console.error('[Chat] Failed to submit injected prompt:', error);
          activeTimersRef.current = null;
        }
      }, 100);
      
      // Store timers in ref (persists across re-renders)
      activeTimersRef.current = { submit: submitTimer, effect: effectTimer };
    } else {
      activeTimersRef.current = { effect: effectTimer };
    }
    
    // No cleanup function - we manage timers manually via activeTimersRef
    // This prevents React from cancelling timers when component re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectedPrompt, autoSubmit]);

  // Get conversation items from ChatInstance
  // Use state to track messages so React detects changes
  const [conversationItems, setConversationItems] = useState<ConversationItem[]>(() => 
    dotbot.currentChat?.getDisplayMessages() || []
  );
  
  // Use a ref to track the last known length to avoid dependency issues
  const lastLengthRef = useRef(conversationItems.length);
  
  // Update conversation items when chat changes or messages are added
  useEffect(() => {
    if (!dotbot.currentChat) {
      setConversationItems([]);
      lastLengthRef.current = 0;
      return;
    }
    
    // Update conversation items from ChatInstance
    const updateItems = () => {
      if (!dotbot.currentChat) {
        setConversationItems([]);
        lastLengthRef.current = 0;
        return;
      }
      const items = dotbot.currentChat.getDisplayMessages();
      setConversationItems(items);
      lastLengthRef.current = items.length;
    };
    
    updateItems();
    
    // Subscribe to DotBot events to detect when messages are added or updated
    const handleDotBotEvent = (event: DotBotEvent) => {
      // When any message is added or updated, update the items
      if (event.type === DotBotEventType.USER_MESSAGE_ADDED ||
          event.type === DotBotEventType.BOT_MESSAGE_ADDED ||
          event.type === DotBotEventType.EXECUTION_MESSAGE_ADDED || 
          event.type === DotBotEventType.EXECUTION_MESSAGE_UPDATED ||
          event.type === DotBotEventType.CHAT_LOADED) {
        // Small delay to ensure message is in the array
        setTimeout(updateItems, 0);
      }
    };
    
    dotbot.addEventListener(handleDotBotEvent);
    
    // Also poll for changes (fallback in case events aren't fired)
    const pollInterval = setInterval(() => {
      if (!dotbot.currentChat) return;
      const currentItems = dotbot.currentChat.getDisplayMessages();
      // Only update if the count changed
      if (currentItems.length !== lastLengthRef.current) {
        updateItems();
      }
    }, 200); // Check every 200ms
    
    return () => {
      dotbot.removeEventListener(handleDotBotEvent);
      clearInterval(pollInterval);
    };
  }, [dotbot, dotbot.currentChat?.id, conversationRefresh]);
  
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
      <MessageList suppressScrollRef={suppressScrollRef}>
        <ConversationItems
          key={refreshKey}
          items={conversationItems}
          dotbot={dotbot}
          onSuppressScrollRequest={() => {
            suppressScrollRef.current = true;
          }}
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

