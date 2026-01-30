/**
 * RPC lifecycle: ensure relay (and optionally asset hub) connected, init execution system.
 * Lazy-loads on first use.
 */

import { ApiPromise } from '@polkadot/api';
import { BrowserWalletSigner } from '../executionEngine/signers/browserSigner';
import { detectNetworkFromChainName } from '../prompts/system/knowledge';

type DotBotInstance = any;

/** Connect relay + optional asset hub, init execution system and signer if not yet done. */
export async function ensureRpcConnectionsReady(dotbot: DotBotInstance): Promise<void> {
  if (dotbot.executionSystemInitialized && dotbot.api) return;

  dotbot.rpcLogger.debug({ network: dotbot.network }, 'ensureRpcConnectionsReady: Connecting (lazy loading)');

  if (!dotbot.api) {
    dotbot.api = await dotbot.relayChainManager.getReadApi();
    const relayChainEndpoint = dotbot.relayChainManager.getCurrentEndpoint();
    dotbot.rpcLogger.info({ endpoint: relayChainEndpoint, chain: 'relay' }, `Connected to Relay Chain via: ${relayChainEndpoint}`);
    try {
      const chainInfo = await dotbot.api.rpc.system.chain();
      const detectedNetwork = detectNetworkFromChainName(chainInfo.toString());
      if (detectedNetwork !== dotbot.network) {
        dotbot.rpcLogger.warn({ detected: detectedNetwork, configured: dotbot.network }, 'Network mismatch detected');
      }
    } catch {
      // skip
    }
  }

  let assetHubApi: ApiPromise | null = null;
  if (!dotbot.assetHubApi) {
    try {
      assetHubApi = await dotbot.assetHubManager.getReadApi();
      dotbot.rpcLogger.info(
        { endpoint: dotbot.assetHubManager.getCurrentEndpoint(), chain: 'asset-hub' },
        'Connected to Asset Hub'
      );
      dotbot._setAssetHubApi(assetHubApi);
    } catch (error) {
      dotbot.rpcLogger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Asset Hub connection failed, will retry when needed');
    }
  } else {
    assetHubApi = dotbot.assetHubApi;
  }

  if (!dotbot.executionSystemInitialized) {
    const signer = new BrowserWalletSigner({ autoApprove: dotbot.config.autoApprove || false });
    if (dotbot.config.onSigningRequest) signer.setSigningRequestHandler(dotbot.config.onSigningRequest);
    if (dotbot.config.onBatchSigningRequest) signer.setBatchSigningRequestHandler(dotbot.config.onBatchSigningRequest);
    dotbot.executionSystem.initialize(
      dotbot.api!,
      dotbot.wallet,
      signer,
      assetHubApi,
      dotbot.relayChainManager,
      dotbot.assetHubManager,
      dotbot.config?.onSimulationStatus
    );
    dotbot.executionSystemInitialized = true;
    dotbot.rpcLogger.debug({}, 'Execution system initialized (lazy loading)');
  }
}
