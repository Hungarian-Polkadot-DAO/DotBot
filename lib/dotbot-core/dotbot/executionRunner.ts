/**
 * Execution runner: start execution after user clicks "Accept & Start".
 * Stateful: get/rebuild ExecutionArray from chat, validate sessions, then run.
 * Stateless: load sessions/plan from DotBot maps, rebuild ExecutionArray, run, then cleanup.
 *
 * Also: restoreExecution (rebuild in place, no run), retryExecution (new execution from same plan, prepare + start).
 */

import type { ExecutionOptions } from '../executionEngine/types';
import type { ExecutionSession } from '../rpcManager';
import type { ExecutionPlan } from '../prompts/system/execution/types';
import type { ExecutionMessage } from '../chat/types';
import { prepareExecution, addExecutionMessageEarly } from './executionPreparation';

type DotBotInstance = any;

/** Resolve ExecutionPlan from message (stored or extracted from state). */
async function getPlanFromMessage(
  dotbot: DotBotInstance,
  executionMessage: { executionPlan?: ExecutionPlan; executionArray?: unknown; id?: string } | undefined
): Promise<ExecutionPlan | null> {
  if (!executionMessage) return null;
  let plan = executionMessage.executionPlan ?? null;
  if (!plan && executionMessage.executionArray) {
    const extracted = dotbot.currentChat?.extractExecutionPlanFromState(executionMessage.executionArray as import('../executionEngine/types').ExecutionArrayState);
    if (extracted) {
      plan = extracted;
      if (executionMessage.id) {
        await dotbot.currentChat?.updateExecutionMessage(executionMessage.id, { executionPlan: extracted });
      }
    }
  }
  return plan;
}

/** Find execution message by executionId in current chat. */
function findExecutionMessage(
  dotbot: DotBotInstance,
  executionId: string
): { executionPlan?: ExecutionPlan; executionArray?: unknown; id?: string } | undefined {
  return dotbot.currentChat
    ?.getDisplayMessages()
    .find(
      (m: { type: string; executionId?: string }) => m.type === 'execution' && m.executionId === executionId
    ) as { executionPlan?: ExecutionPlan; executionArray?: unknown; id?: string } | undefined;
}

async function validateExecutionSession(session: ExecutionSession): Promise<boolean> {
  if (!session.isActive) return false;
  return await session.isConnected();
}

/** Start execution: stateless path uses DotBot maps; stateful uses chat and may rebuild from plan. */
export async function startExecution(
  dotbot: DotBotInstance,
  executionId: string,
  options?: ExecutionOptions
): Promise<void> {
  await dotbot.ensureRpcConnectionsReady();

  if (!dotbot._stateful) {
    return startExecutionStateless(dotbot, executionId, options);
  }

  if (!dotbot.currentChat) {
    throw new Error('No active chat. Cannot start execution.');
  }

  let executionArray = dotbot.currentChat.getExecutionArray(executionId);
  const needsRebuild = !executionArray || (executionArray.isInterrupted() && dotbot.currentChat);

  if (needsRebuild) {
    const executionMessage = findExecutionMessage(dotbot, executionId);
    const plan = await getPlanFromMessage(dotbot, executionMessage);

    if (plan) {
      await prepareExecution(dotbot, plan, executionId, true);
      executionArray = dotbot.currentChat.getExecutionArray(executionId);
      if (!executionArray) throw new Error('Failed to rebuild execution array');
    } else if (!executionArray) {
      throw new Error(`Execution ${executionId} not found. It may not have been prepared yet.`);
    }
  } else {
    // Existing array: ensure sessions still valid (e.g. after lazy RPC connect).
    if (!(await dotbot.currentChat.validateExecutionSessions())) {
      dotbot.dotbotLogger.warn({ executionId }, 'Execution sessions expired, recreating...');
      try {
        await dotbot.currentChat.initializeExecutionSessions(dotbot.relayChainManager, dotbot.assetHubManager);
        if (!(await dotbot.currentChat.validateExecutionSessions())) {
          throw new Error('Failed to recreate execution sessions.');
        }
      } catch (recreateError) {
        const msg = recreateError instanceof Error ? recreateError.message : 'Unknown error';
        throw new Error(`Execution session expired and could not be recreated: ${msg}. Please prepare the execution again.`);
      }
    }
  }

  if (!executionArray) {
    throw new Error(`Execution ${executionId} not found after preparation.`);
  }

  const executioner = dotbot.executionSystem.getExecutioner();
  await executioner.execute(executionArray, options);
}

/** Stateless: load sessions/plan from DotBot, check TTL and session validity, rebuild, execute, cleanup. */
export async function startExecutionStateless(
  dotbot: DotBotInstance,
  executionId: string,
  options?: ExecutionOptions
): Promise<void> {
  const sessions = dotbot.executionSessions.get(executionId);
  const plan = dotbot.executionPlans.get(executionId);

  if (!sessions || !plan) {
    throw new Error(`Execution ${executionId} not found. It may have expired or not been prepared yet.`);
  }

  const age = Date.now() - sessions.createdAt;
  const SESSION_TTL_MS = dotbot.SESSION_TTL_MS ?? 15 * 60 * 1000;
  if (age > SESSION_TTL_MS) {
    dotbot.cleanupExecutionSessions(executionId);
    throw new Error(
      `Execution ${executionId} has expired (${Math.round(age / 60000)} minutes old). Maximum session lifetime is ${SESSION_TTL_MS / 60000} minutes. Please prepare the execution again.`
    );
  }

  const relayChainValid = await validateExecutionSession(sessions.relayChain);
  const assetHubValid = !sessions.assetHub || (await validateExecutionSession(sessions.assetHub));
  if (!relayChainValid || !assetHubValid) {
    cleanupExecutionSessions(dotbot, executionId);
    throw new Error(`Execution ${executionId} has expired. Sessions are no longer valid. Please prepare the execution again.`);
  }

  dotbot.dotbotLogger.info({ executionId }, 'startExecutionStateless: Rebuilding ExecutionArray');
  const executionArray = await dotbot.executionSystem.orchestrateExecutionArray(
    plan,
    sessions.relayChain,
    sessions.assetHub,
    executionId
  );
  dotbot.dotbotLogger.info({ executionId, itemsCount: executionArray.getItems().length }, 'startExecutionStateless: Starting execution');

  const executioner = dotbot.executionSystem.getExecutioner();
  await executioner.execute(executionArray, options);
  cleanupExecutionSessions(dotbot, executionId);
}

/** Clean up one execution's sessions/plan/state (stateless). */
export function cleanupExecutionSessions(dotbot: DotBotInstance, executionId: string): void {
  const sessions = dotbot.executionSessions.get(executionId);
  if (sessions) {
    dotbot.executionSessions.delete(executionId);
    dotbot.executionPlans.delete(executionId);
    dotbot.executionStates.delete(executionId);
    dotbot.executionArrays.delete(executionId);
    dotbot.dotbotLogger.debug({ executionId }, 'Cleaned up execution sessions, plan, state, and ExecutionArray');
  }
}

/** Clean up expired execution sessions (call periodically). Returns count cleaned. */
export function cleanupExpiredExecutions(dotbot: DotBotInstance): number {
  const now = Date.now();
  const SESSION_TTL_MS = dotbot.SESSION_TTL_MS ?? 15 * 60 * 1000;
  let cleaned = 0;
  for (const [executionId, sessions] of dotbot.executionSessions.entries()) {
    const age = now - sessions.createdAt;
    if (age > SESSION_TTL_MS) {
      cleanupExecutionSessions(dotbot, executionId);
      cleaned++;
      dotbot.dotbotLogger.info({ executionId, ageMinutes: Math.round(age / 60000) }, 'Cleaned up expired execution session');
    }
  }
  return cleaned;
}

/**
 * Restore an interrupted execution (rebuild ExecutionArray in place, no run).
 * Stateful only. After restore, user can click "Accept & Start" to run.
 */
export async function restoreExecution(dotbot: DotBotInstance, executionId: string): Promise<void> {
  await dotbot.ensureRpcConnectionsReady();
  if (!dotbot._stateful) {
    throw new Error('restoreExecution is only supported in stateful mode.');
  }
  if (!dotbot.currentChat) {
    throw new Error('No active chat. Cannot restore execution.');
  }
  const executionMessage = findExecutionMessage(dotbot, executionId);
  const plan = await getPlanFromMessage(dotbot, executionMessage);
  if (!plan) {
    throw new Error(`Execution ${executionId} has no plan. Cannot restore.`);
  }
  await prepareExecution(dotbot, plan, executionId, true);
  dotbot.dotbotLogger.info({ executionId }, 'Execution restored; user can Accept & Start');
}

/**
 * Retry: create a new execution from the same plan (new executionId, new message, prepare + start).
 * Stateful only. Uses executionMessage.executionPlan or extracts from executionArray state.
 */
export async function retryExecution(
  dotbot: DotBotInstance,
  executionMessage: ExecutionMessage,
  options?: ExecutionOptions
): Promise<void> {
  await dotbot.ensureRpcConnectionsReady();
  if (!dotbot._stateful) {
    throw new Error('retryExecution is only supported in stateful mode.');
  }
  if (!dotbot.currentChat) {
    throw new Error('No active chat. Cannot retry execution.');
  }
  const plan = await getPlanFromMessage(dotbot, executionMessage);
  if (!plan) {
    throw new Error('Execution has no plan. Cannot retry.');
  }
  const newExecutionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  await addExecutionMessageEarly(dotbot, newExecutionId, plan);
  await prepareExecution(dotbot, plan, newExecutionId, true);
  await startExecution(dotbot, newExecutionId, options);
  dotbot.dotbotLogger.info({ executionId: newExecutionId, fromExecutionId: executionMessage.executionId }, 'Retry execution started');
}
