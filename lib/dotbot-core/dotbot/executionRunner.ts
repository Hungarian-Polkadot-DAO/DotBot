/**
 * Execution runner: start execution after user clicks "Accept & Start".
 * Stateful: get/rebuild ExecutionArray from chat, validate sessions, then run.
 * Stateless: load sessions/plan from DotBot maps, rebuild ExecutionArray, run, then cleanup.
 */

import type { ExecutionOptions } from '../executionEngine/types';
import type { ExecutionSession } from '../rpcManager';
import type { ExecutionPlan } from '../prompts/system/execution/types';
import { prepareExecution } from './executionPreparation';

type DotBotInstance = any;

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
    const executionMessage = dotbot.currentChat.getDisplayMessages().find(
      (m: { type: string; executionId?: string }) => m.type === 'execution' && m.executionId === executionId
    ) as { executionId?: string; executionPlan?: unknown; executionArray?: unknown; id?: string } | undefined;

    let plan = executionMessage?.executionPlan;
    // Fallback: e.g. message came from WebSocket without plan.
    if (!plan && executionMessage?.executionArray) {
      dotbot.dotbotLogger.debug({ executionId }, 'ExecutionPlan missing, extracting from state');
      const extractedPlan = dotbot.currentChat.extractExecutionPlanFromState(executionMessage.executionArray);
      if (extractedPlan) {
        plan = extractedPlan;
        await dotbot.currentChat.updateExecutionMessage(executionMessage.id!, { executionPlan: plan });
        dotbot.dotbotLogger.info({ executionId }, 'Extracted and saved ExecutionPlan from state');
      }
    }

    if (plan) {
      await prepareExecution(dotbot, plan as ExecutionPlan, executionId, true); // skipSimulation: already ran at prepare
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
