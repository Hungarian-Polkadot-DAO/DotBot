/**
 * RPC Manager
 * 
 * Main exports for RPC endpoint management
 */

// Types
export type { Network, EndpointHealth, RpcManagerConfig } from './types';

// Endpoints
export { RpcEndpoints } from './endpoints';

// Execution Session
export { ExecutionSession } from './ExecutionSession';

// RPC Manager
export { RpcManager } from './RpcManager';

// Factory Functions
export {
  getEndpointsForNetwork,
  createRpcManagersForNetwork,
  createPolkadotRelayChainManager,
  createPolkadotAssetHubManager,
  createKusamaRelayChainManager,
  createKusamaAssetHubManager,
  createWestendRelayChainManager,
  createWestendAssetHubManager,
  createRelayChainManager,
  createAssetHubManager,
} from './factories';
