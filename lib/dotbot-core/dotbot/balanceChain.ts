/**
 * Balance and chain: relay + asset hub balance, chain/version, friendly message from plan.
 */

import type { ExecutionPlan } from '../prompts/system/execution/types';

type DotBotInstance = any;

/** Relay + asset hub balance (free/reserved/frozen) and total free. */
export async function getBalance(dotbot: DotBotInstance): Promise<{
  relayChain: { free: string; reserved: string; frozen: string };
  assetHub: { free: string; reserved: string; frozen: string } | null;
  total: string;
}> {
  await dotbot.ensureRpcConnectionsReady();
  const relayAccountInfo = await dotbot.api!.query.system.account(dotbot.wallet.address);
  const relayData = relayAccountInfo.toJSON() as { data?: { free?: string; reserved?: string; frozen?: string; miscFrozen?: string } };
  const relayBalance = {
    free: relayData.data?.free || '0',
    reserved: relayData.data?.reserved || '0',
    frozen: relayData.data?.frozen || relayData.data?.miscFrozen || '0',
  };
  let assetHubBalance: { free: string; reserved: string; frozen: string } | null = null;
  if (dotbot.assetHubApi) {
    try {
      const assetHubAccountInfo = await dotbot.assetHubApi.query.system.account(dotbot.wallet.address);
      const assetHubData = assetHubAccountInfo.toJSON() as { data?: { free?: string; reserved?: string; frozen?: string; miscFrozen?: string } };
      assetHubBalance = {
        free: assetHubData.data?.free || '0',
        reserved: assetHubData.data?.reserved || '0',
        frozen: assetHubData.data?.frozen || assetHubData.data?.miscFrozen || '0',
      };
    } catch {
      dotbot.dotbotLogger.debug('Failed to fetch Asset Hub balance', undefined);
    }
  }
  const totalFree = BigInt(relayBalance.free) + (assetHubBalance ? BigInt(assetHubBalance.free) : BigInt(0));
  return { relayChain: relayBalance, assetHub: assetHubBalance, total: totalFree.toString() };
}

/** Chain name and runtime version from relay RPC. */
export async function getChainInfo(dotbot: DotBotInstance): Promise<{ chain: string; version: string }> {
  await dotbot.ensureRpcConnectionsReady();
  const [chain, version] = await Promise.all([dotbot.api!.rpc.system.chain(), dotbot.api!.rpc.system.version()]);
  return { chain: chain.toString(), version: version.toString() };
}

/** User-friendly message from execution plan (single or multi-step). */
export function generateFriendlyMessage(plan: ExecutionPlan, _completed: number, _failed: number): string {
  const totalSteps = plan.steps.length;
  if (totalSteps === 0) return 'Transaction prepared, but no operations to execute.';
  if (totalSteps === 1) {
    return `Transaction ready:\n\n**${plan.steps[0].description}**\n\nReview the details below and approve when ready.`;
  }
  const stepsList = plan.steps.map((s, i) => `${i + 1}. ${s.description}`).join('\n');
  return `${totalSteps} transactions ready:\n\n${stepsList}\n\nReview the details below and approve when ready.`;
}
