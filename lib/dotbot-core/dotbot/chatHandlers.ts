/**
 * Chat response handlers: turn LLM output into chat updates and (when a plan exists) preparation.
 * Used by DotBot.chat() after getLLMResponse() to handle text-only vs execution-plan replies.
 */

import type { ExecutionPlan } from '../prompts/system/execution/types';
import type { ExecutionArrayState } from '../executionEngine/types';
import { ExecutionPreparationError } from '../errors';
import type { ChatResult, ChatOptions } from './types';

type DotBotInstance = any;

/** Handle a text-only reply: strip code fences, append to chat, optionally refresh title. */
export async function handleConversationResponse(
  dotbot: DotBotInstance,
  llmResponse: string
): Promise<ChatResult> {
  if (dotbot.currentChat) {
    dotbot.currentChat.setExecution(null);
  }

  const cleanedResponse = llmResponse
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

  if (dotbot.currentChat) {
    await dotbot.currentChat.addBotMessage(cleanedResponse);
    dotbot.emit({ type: 'bot-message-added', message: cleanedResponse, timestamp: Date.now() });
    if (!dotbot.currentChat.title || dotbot.currentChat.title.startsWith('Chat -')) {
      await dotbot.currentChat.autoGenerateTitle();
    }
  }

  return {
    response: cleanedResponse,
    executed: false,
    success: true,
    completed: 0,
    failed: 0,
  };
}

/**
 * Reply that includes an execution plan: prepare execution (or skip if frontend will do it),
 * then add a friendly "review and accept" message. On error, ask LLM for a user-facing explanation.
 */
export async function handleExecutionResponse(
  dotbot: DotBotInstance,
  llmResponse: string,
  plan: ExecutionPlan,
  options?: ChatOptions
): Promise<ChatResult> {
  dotbot.dotbotLogger.info(
    { planId: plan.id, stepsCount: plan.steps.length, originalRequest: plan.originalRequest },
    'ExecutionPlan was created, preparing execution'
  );

  let executionArrayState: ExecutionArrayState | undefined;
  let executionId: string | undefined;

  try {
    // Frontend-only: no backend orchestration; generate id for UI to use.
    if (!dotbot._stateful && !dotbot._backendSimulation) {
      executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      dotbot.dotbotLogger.info(
        { planId: plan.id, executionId, stepsCount: plan.steps.length },
        'Skipping backend orchestration - frontend will handle'
      );
    } else {
      const result = await dotbot.prepareExecution(plan);
      if (result) {
        executionArrayState = result;
        executionId = result.id;
      } else if (dotbot.currentChat) {
        // Stateful path may return void; resolve id from chat message.
        const messages = dotbot.currentChat.getDisplayMessages();
        const execMsg = messages.find(
          (m: { type: string; executionPlan?: { id: string } }) =>
            m.type === 'execution' && m.executionPlan?.id === plan.id
        ) as { executionId?: string } | undefined;
        executionId = execMsg?.executionId;
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const isExecutionMessageError = error instanceof ExecutionPreparationError;
    const errorDetails = {
      error: errorMsg,
      planId: plan.id,
      originalRequest: plan.originalRequest,
      stepsCount: plan.steps.length,
      isExecutionMessageError,
      hasCurrentChat: !!dotbot.currentChat,
      stateful: dotbot._stateful,
      backendSimulation: dotbot._backendSimulation,
    };
    dotbot.dotbotLogger.error(errorDetails, 'ExecutionPlan was not created - preparation failed');

    // Ask LLM for a user-facing message so we don't surface raw errors.
    const errorContextMessage = isExecutionMessageError
      ? `I encountered a technical issue while trying to prepare the transaction you requested ("${plan.originalRequest || 'your request'}"). The system failed to create the execution flow interface.\n\nError details: ${errorMsg}\n\nPlease provide a friendly, apologetic message to the user explaining that you encountered a technical issue and couldn't prepare the transaction. Suggest they try again. Respond with helpful TEXT only - do NOT generate another ExecutionPlan. Do NOT say you prepared anything.`
      : `I tried to prepare the transaction you requested ("${plan.originalRequest || 'your request'}"), but it failed with this error:\n\n${errorMsg}\n\nPlease provide a helpful explanation of what went wrong. Respond with helpful TEXT only - do NOT generate another ExecutionPlan. Do NOT say you prepared anything.`;

    const errorResponse = await dotbot.getLLMResponse(errorContextMessage, options);
    dotbot.emit({ type: 'chat-error', error: error instanceof Error ? error : new Error(errorMsg) });

    if (dotbot.currentChat) {
      await dotbot.currentChat.addBotMessage(errorResponse);
    } else {
      dotbot.dotbotLogger.error(errorDetails, 'CRITICAL: Cannot save error message - currentChat is null');
    }

    return {
      response: errorResponse,
      plan: undefined,
      executed: false,
      success: false,
      completed: 0,
      failed: 1,
    };
  }

  const originalRequestText = plan.originalRequest ? ` for: "${plan.originalRequest}"` : '';
  const friendlyMessage = `I've prepared a transaction flow with ${plan.steps.length} step${plan.steps.length !== 1 ? 's' : ''}${originalRequestText}. Review the details below and click "Accept and Start" when ready.`;

  dotbot.dotbotLogger.info({ planId: plan.id, stepsCount: plan.steps.length, message: friendlyMessage }, 'Execution prepared');

  if (dotbot.currentChat) {
    await dotbot.currentChat.addBotMessage(friendlyMessage);
    if (!dotbot.currentChat.title || dotbot.currentChat.title.startsWith('Chat -')) {
      await dotbot.currentChat.autoGenerateTitle();
    }
  }

  return {
    response: friendlyMessage,
    plan,
    executionArrayState,
    executionId: executionId || executionArrayState?.id,
    executed: false,
    success: true,
    completed: 0,
    failed: 0,
  };
}
