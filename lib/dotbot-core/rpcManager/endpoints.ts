/**
 * RPC Endpoints
 * 
 * Predefined RPC endpoints organized by network
 */

export const RpcEndpoints = {
  // Polkadot Mainnet
  POLKADOT_RELAY_CHAIN: [
    'wss://polkadot.api.onfinality.io/public-ws',        // OnFinality
    'wss://polkadot-rpc.dwellir.com',                    // Dwellir public
    'wss://rpc.ibp.network/polkadot',                    // IBP network
    'wss://polkadot.dotters.network',                    // Dotters
    'wss://rpc-polkadot.luckyfriday.io',                 // LuckyFriday
    'wss://dot-rpc.stakeworld.io',                       // Stakeworld
    'wss://polkadot.public.curie.radiumblock.co/ws',     // RadiumBlock
    'wss://rockx-dot.w3node.com/polka-public-dot/ws',    // RockX public
    'wss://polkadot.rpc.subquery.network/public/ws',     // SubQuery
    'wss://polkadot.api.integritee.network/ws',          // Integritee (community)
    'wss://rpc.polkadot.io',                             // Parity (official)
  ],
  POLKADOT_ASSET_HUB: [
    'wss://statemint.api.onfinality.io/public-ws',       // OnFinality Asset Hub
    'wss://statemint-rpc.dwellir.com',                   // Dwellir Asset Hub
    'wss://dot-rpc.stakeworld.io/assethub',              // Stakeworld Asset Hub
    'wss://sys.ibp.network/statemint',                   // IBP network Asset Hub
    'wss://rpc-asset-hub.polkadot.io',                   // Parity Asset Hub (official)
  ],

  // Kusama Canary Network
  KUSAMA_RELAY_CHAIN: [
    'wss://kusama.api.onfinality.io/public-ws',          // OnFinality
    'wss://kusama-rpc.dwellir.com',                      // Dwellir
    'wss://rpc.ibp.network/kusama',                      // IBP network
    'wss://kusama.dotters.network',                      // Dotters
    'wss://ksm-rpc.stakeworld.io',                       // Stakeworld
    'wss://kusama.public.curie.radiumblock.co/ws',       // RadiumBlock
    'wss://rpc.polkadot.io/kusama',                      // Parity (mirror)
  ],
  KUSAMA_ASSET_HUB: [
    'wss://statemine.api.onfinality.io/public-ws',       // OnFinality Statemine
    'wss://statemine-rpc.dwellir.com',                   // Dwellir Statemine
    'wss://ksm-rpc.stakeworld.io/assethub',              // Stakeworld Statemine
    'wss://sys.ibp.network/statemine',                   // IBP network Statemine
    'wss://rpc.polkadot.io/ksmstatemine',                // Parity (mirror)
  ],

  // Westend Testnet
  // Ordered by reliability: best endpoints first based on real-world testing
  WESTEND_RELAY_CHAIN: [
    'wss://rpc.ibp.network/westend',                     // IBP network Westend (fast & reliable)
    'wss://westend.api.onfinality.io/public-ws',         // OnFinality Westend (reliable)
    'wss://westend-rpc-tn.dwellir.com',                  // Dwellir Westend Tunisia (backup)
    'wss://westend-rpc.polkadot.io',                     // Parity Westend (official but can be slow)
    'wss://westend-rpc.dwellir.com',                     // Dwellir Westend (often has issues)
    'wss://westend.public.curie.radiumblock.co/ws',      // RadiumBlock Westend
  ],
  WESTEND_ASSET_HUB: [
    'wss://westend-asset-hub-rpc.polkadot.io',           // Parity Westend Asset Hub (official)
    'wss://westmint.api.onfinality.io/public-ws',        // OnFinality Westend Asset Hub
    'wss://sys.ibp.network/westmint',                    // IBP network Westend Asset Hub
  ],

  ROCSTAR_RELAY_CHAIN: [
    'wss://rococo-rpc.polkadot.io',                      // Rococo
  ],
  ROCSTAR_ASSET_HUB: [
    'wss://rococo-asset-hub-rpc.polkadot.io',            // Rococo Asset Hub
  ],

  // Legacy or Aliases
  RELAY_CHAIN: [] as string[],
  ASSET_HUB: [] as string[],
};

// Set legacy aliases to Polkadot for backward compatibility
RpcEndpoints.RELAY_CHAIN = RpcEndpoints.POLKADOT_RELAY_CHAIN;
RpcEndpoints.ASSET_HUB = RpcEndpoints.POLKADOT_ASSET_HUB;
