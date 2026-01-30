/**
 * Execution preparation: orchestrate plan, create RPC sessions, add/update chat messages.
 * Stateful path: chat owns sessions; we add an execution message early, then orchestrate and update it.
 * Stateless path: we own sessions/plan/state in DotBot maps; no chat required.
 */

import type { ExecutionPlan } from '../prompts/system/execution/types';
import type { ExecutionArrayState } from '../executionEngine/types';
import type { ExecutionSession } from '../rpcManager';
import { ExecutionArray } from '../executionEngine/executionArray';
import { DotBotError, ExecutionPreparationError } from '../errors';
import { DotBotEventType } from './types';

type DotBotInstance = any;

/** Add an execution message to chat with just the plan (no ExecutionArray yet). Shows "Preparing..." in UI. */
export async function addExecutionMessageEarly(
  dotbot: DotBotInstance,
  executionId: string,
  plan: ExecutionPlan
): Promise<boolean> {
  if (!dotbot.currentChat) {
    dotbot.dotbotLogger.error(
      { executionId, planId: plan.id, stateful: dotbot._stateful },
      'addExecutionMessageEarly: currentChat is null'
    );
    return false;
  }
  const existingMessage = dotbot.currentChat.getDisplayMessages().find(
    (m: { type: string; executionId?: string }) => m.type === 'execution' && m.executionId === executionId
  ) as { executionId?: string } | undefined;
  if (existingMessage) {
    dotbot.dotbotLogger.debug({ executionId, planId: plan.id }, 'ExecutionMessage already exists');
    return true; // idempotent
  }
  await dotbot.currentChat.addExecutionMessage(executionId, plan);
  dotbot.dotbotLogger.info({ executionId, planId: plan.id, stepsCount: plan.steps.length }, 'ExecutionPlan sent to frontend');
  dotbot.emit({
    type: DotBotEventType.EXECUTION_MESSAGE_ADDED,
    executionId,
    plan,
    timestamp: Date.now(),
  });
  return true;
}

/** After orchestration: find the existing execution message and set ExecutionArray + state. */
export async function updateExecutionInChat(
  dotbot: DotBotInstance,
  executionArray: ExecutionArray,
  plan: ExecutionPlan
): Promise<void> {
  if (!dotbot.currentChat) return;
  const state = executionArray.getState();
  const existingMessage = dotbot.currentChat.getDisplayMessages().find(
    (m: { type: string; executionId?: string }) => m.type === 'execution' && (m as { executionId?: string }).executionId === state.id
  ) as { id: string } | undefined;
  if (!existingMessage) {
    dotbot.dotbotLogger.error({ executionId: state.id }, 'ExecutionMessage not found for update');
    return;
  }
  await dotbot.currentChat.updateExecutionMessage(existingMessage.id, {
    executionArray: state,
    executionPlan: plan,
  });
  dotbot.currentChat.setExecutionArray(state.id, executionArray);
  dotbot.emit({
    type: DotBotEventType.EXECUTION_MESSAGE_UPDATED,
    executionId: state.id,
    timestamp: Date.now(),
  });
  dotbot.dotbotLogger.debug({ executionId: state.id }, 'ExecutionArray set in chat');
}

/** Prepare execution: stateful (chat + sessions) or stateless (DotBot-owned sessions). */
export async function prepareExecution(
  dotbot: DotBotInstance,
  plan: ExecutionPlan,
  executionId?: string,
  skipSimulation = false
): Promise<ExecutionArrayState | void> {
  await dotbot.ensureRpcConnectionsReady();
  const finalExecutionId = executionId || `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  dotbot.dotbotLogger.info(
    { executionId: finalExecutionId, planId: plan.id, stepsCount: plan.steps.length, stateful: dotbot._stateful },
    'prepareExecution: Starting'
  );

  if (!dotbot._stateful) {
    return prepareExecutionStateless(dotbot, plan, finalExecutionId, skipSimulation);
  }

  if (!dotbot.currentChat) {
    dotbot.dotbotLogger.error({ planId: plan.id }, 'prepareExecution failed: No active chat');
    throw new DotBotError('No active chat. Cannot prepare execution.', 'NO_ACTIVE_CHAT', { planId: plan.id });
  }

  try {
    await dotbot.currentChat.initializeExecutionSessions(dotbot.relayChainManager, dotbot.assetHubManager);
    const sessions = dotbot.currentChat.getExecutionSessions();
    if (!sessions.relayChain) {
      dotbot.dotbotLogger.error(
        { executionId: finalExecutionId, hasRelayChain: !!sessions.relayChain, hasAssetHub: !!sessions.assetHub },
        'prepareExecution failed: Failed to create execution sessions'
      );
      throw new ExecutionPreparationError('Failed to create execution sessions', {
        executionId: finalExecutionId,
        hasRelayChain: !!sessions.relayChain,
        hasAssetHub: !!sessions.assetHub,
      });
    }

    // Add message first so UI shows "Preparing..."; then orchestrate and update in afterOrchestrate.
    const messageAdded = await addExecutionMessageEarly(dotbot, finalExecutionId, plan);
    if (!messageAdded) {
      dotbot.dotbotLogger.error(
        { executionId: finalExecutionId, planId: plan.id },
        'prepareExecution: Could not add ExecutionMessage to chat'
      );
      throw new ExecutionPreparationError(
        'Failed to add ExecutionMessage to chat. The execution flow could not be created.',
        { executionId: finalExecutionId, planId: plan.id, hasCurrentChat: !!dotbot.currentChat }
      );
    }

    await dotbot.executionSystem.prepareExecutionArray(
      plan,
      sessions.relayChain,
      sessions.assetHub,
      dotbot.relayChainManager,
      dotbot.assetHubManager,
      dotbot.wallet.address,
      dotbot.config?.onSimulationStatus,
      finalExecutionId,
      {
        afterOrchestrate: async (executionArray: ExecutionArray) => {
          await updateExecutionInChat(dotbot, executionArray, plan);
          if (!skipSimulation) await new Promise((r) => setTimeout(r, 100));
        },
        skipSimulation,
      }
    );

    dotbot.dotbotLogger.info({ executionId: finalExecutionId, planId: plan.id }, 'prepareExecution: Completed');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    dotbot.dotbotLogger.error(
      { error: errorMsg, executionId: finalExecutionId, planId: plan.id },
      'prepareExecution: Error'
    );
    if (dotbot.currentChat) dotbot.currentChat.cleanupExecutionSessions();
    throw error;
  }
}

/** Stateless: create sessions, store in DotBot maps, orchestrate, optionally simulate, return state. */
export async function prepareExecutionStateless(
  dotbot: DotBotInstance,
  plan: ExecutionPlan,
  executionId: string,
  skipSimulation: boolean
): Promise<ExecutionArrayState> {
  try {
    dotbot.dotbotLogger.debug({ executionId }, 'prepareExecutionStateless: Creating sessions');
    const relayChainSession = await dotbot.relayChainManager.createExecutionSession();
    let assetHubSession: ExecutionSession | null = null;
    try {
      assetHubSession = await dotbot.assetHubManager.createExecutionSession();
    } catch {
      dotbot.dotbotLogger.debug({ executionId }, 'Asset Hub session creation failed (expected in some cases)');
    }

    // Store for later startExecutionStateless (TTL enforced there).
    dotbot.executionSessions.set(executionId, {
      relayChain: relayChainSession,
      assetHub: assetHubSession,
      createdAt: Date.now(),
    });
    dotbot.executionPlans.set(executionId, plan);

    dotbot.dotbotLogger.info({ executionId, stepsCount: plan.steps.length }, 'prepareExecutionStateless: Orchestrating');
    const executionArray = await dotbot.executionSystem.orchestrateExecutionArray(
      plan,
      relayChainSession,
      assetHubSession,
      executionId
    );
    dotbot.executionArrays.set(executionId, executionArray);
    dotbot.executionStates.set(executionId, executionArray.getState());

    // Optional: e.g. broadcast to WebSocket before simulation.
    if (dotbot.config?.onExecutionReady && dotbot.currentChat) {
      try {
        dotbot.config.onExecutionReady(executionId, dotbot.currentChat);
      } catch (err) {
        dotbot.dotbotLogger.error(
          { executionId, error: err instanceof Error ? err.message : String(err) },
          'prepareExecutionStateless: onExecutionReady error'
        );
      }
    }

    // Keep stored state in sync for polling/WebSocket.
    const unsubscribeProgress = executionArray.onProgress(() => {
      dotbot.executionStates.set(executionId, executionArray.getState());
    });

    if (!skipSimulation && dotbot._backendSimulation) {
      dotbot.dotbotLogger.info({ executionId }, 'prepareExecutionStateless: Running simulation');
      await dotbot.executionSystem.runSimulation(
        executionArray,
        dotbot.wallet.address,
        relayChainSession,
        assetHubSession,
        dotbot.relayChainManager,
        dotbot.assetHubManager,
        dotbot.config?.onSimulationStatus
      );
    }
    unsubscribeProgress();

    const state = executionArray.getState();
    dotbot.executionStates.set(executionId, state);
    dotbot.dotbotLogger.info({ executionId, planId: plan.id, itemsCount: state.items.length }, 'prepareExecutionStateless: Completed');
    return state;
  } catch (error) {
    // Clean up so a retry can prepare again.
    dotbot.executionSessions.delete(executionId);
    dotbot.executionPlans.delete(executionId);
    dotbot.executionStates.delete(executionId);
    dotbot.executionArrays.delete(executionId);
    const errorMsg = error instanceof Error ? error.message : String(error);
    dotbot.dotbotLogger.error(
      { error: errorMsg, executionId, planId: plan.id, originalRequest: plan.originalRequest },
      'prepareExecutionStateless: Error'
    );
    throw error;
  }
}
