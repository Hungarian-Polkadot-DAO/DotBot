/**
 * Unit tests for Network Utilities
 */

import {
  getNetworkMetadata,
  detectNetworkFromChainName,
  getNetworkTokenSymbol,
  getNetworkDecimals,
  getNetworkSS58Format,
  isTestnet,
  getRelayChainEndpoints,
  getAssetHubEndpoints,
  getSupportedNetworks,
  getProductionNetworks,
  getTestnets,
  isValidNetwork,
  parseNetwork,
  isSameNetwork,
  getNetworkDisplayName,
  getNetworkDescription,
} from '../../../../../prompts/system/knowledge/networkUtils';
import {
  getKnowledgeBaseForNetwork,
  formatKnowledgeBaseForNetwork,
} from '../../../../../prompts/system/knowledge';
import type { Network } from '../../../../../prompts/system/knowledge/types';

describe('Network Utilities', () => {
  describe('getNetworkMetadata', () => {
    it('should return correct metadata for Polkadot', () => {
      const metadata = getNetworkMetadata('polkadot');
      expect(metadata.network).toBe('polkadot');
      expect(metadata.nativeToken).toBe('DOT');
      expect(metadata.decimals).toBe(10);
      expect(metadata.ss58Format).toBe(0);
      expect(metadata.isTestnet).toBe(false);
      expect(metadata.rpcEndpoints.relay.length).toBeGreaterThan(0);
      expect(metadata.rpcEndpoints.assetHub.length).toBeGreaterThan(0);
    });

    it('should return correct metadata for Kusama', () => {
      const metadata = getNetworkMetadata('kusama');
      expect(metadata.network).toBe('kusama');
      expect(metadata.nativeToken).toBe('KSM');
      expect(metadata.decimals).toBe(12);
      expect(metadata.ss58Format).toBe(2);
      expect(metadata.isTestnet).toBe(false);
    });

    it('should return correct metadata for Westend', () => {
      const metadata = getNetworkMetadata('westend');
      expect(metadata.network).toBe('westend');
      expect(metadata.nativeToken).toBe('WND');
      expect(metadata.decimals).toBe(12);
      expect(metadata.ss58Format).toBe(42);
      expect(metadata.isTestnet).toBe(true);
    });

    it('should return undefined for unknown network', () => {
      const metadata = getNetworkMetadata('unknown' as Network);
      expect(metadata).toBeUndefined();
    });
  });

  describe('detectNetworkFromChainName', () => {
    it('should detect Westend from chain name', () => {
      expect(detectNetworkFromChainName('Westend')).toBe('westend');
      expect(detectNetworkFromChainName('westend')).toBe('westend');
      expect(detectNetworkFromChainName('WESTEND')).toBe('westend');
      expect(detectNetworkFromChainName('Westend Development')).toBe('westend');
      // Note: Westmint is asset hub and typically has "westend" in the chain name anyway
    });

    it('should detect Kusama from chain name', () => {
      expect(detectNetworkFromChainName('Kusama')).toBe('kusama');
      expect(detectNetworkFromChainName('kusama')).toBe('kusama');
      expect(detectNetworkFromChainName('KUSAMA')).toBe('kusama');
      expect(detectNetworkFromChainName('Kusama CC3')).toBe('kusama');
    });

    it('should default to Polkadot for unknown chains', () => {
      expect(detectNetworkFromChainName('Polkadot')).toBe('polkadot');
      expect(detectNetworkFromChainName('Unknown Chain')).toBe('polkadot');
      expect(detectNetworkFromChainName('')).toBe('polkadot');
    });
  });

  describe('getNetworkTokenSymbol', () => {
    it('should return correct token symbol for each network', () => {
      expect(getNetworkTokenSymbol('polkadot')).toBe('DOT');
      expect(getNetworkTokenSymbol('kusama')).toBe('KSM');
      expect(getNetworkTokenSymbol('westend')).toBe('WND');
    });

    it('should throw for invalid network', () => {
      expect(() => getNetworkTokenSymbol('invalid' as Network)).toThrow();
    });
  });

  describe('getNetworkDecimals', () => {
    it('should return correct decimals for each network', () => {
      expect(getNetworkDecimals('polkadot')).toBe(10);
      expect(getNetworkDecimals('kusama')).toBe(12);
      expect(getNetworkDecimals('westend')).toBe(12);
    });

    it('should throw for invalid network', () => {
      expect(() => getNetworkDecimals('invalid' as Network)).toThrow();
    });
  });

  describe('getNetworkSS58Format', () => {
    it('should return correct SS58 format for each network', () => {
      expect(getNetworkSS58Format('polkadot')).toBe(0);
      expect(getNetworkSS58Format('kusama')).toBe(2);
      expect(getNetworkSS58Format('westend')).toBe(42);
    });

    it('should throw for invalid network', () => {
      expect(() => getNetworkSS58Format('invalid' as Network)).toThrow();
    });
  });

  describe('isTestnet', () => {
    it('should correctly identify testnets', () => {
      expect(isTestnet('polkadot')).toBe(false);
      expect(isTestnet('kusama')).toBe(false);
      expect(isTestnet('westend')).toBe(true);
    });
  });

  describe('getRelayChainEndpoints', () => {
    it('should return relay chain endpoints for each network', () => {
      const polkadotEndpoints = getRelayChainEndpoints('polkadot');
      expect(polkadotEndpoints.length).toBeGreaterThan(0);
      expect(polkadotEndpoints[0]).toContain('wss://');

      const kusamaEndpoints = getRelayChainEndpoints('kusama');
      expect(kusamaEndpoints.length).toBeGreaterThan(0);
      expect(kusamaEndpoints[0]).toContain('wss://');

      const westendEndpoints = getRelayChainEndpoints('westend');
      expect(westendEndpoints.length).toBeGreaterThan(0);
      expect(westendEndpoints[0]).toContain('wss://');
    });
  });

  describe('getAssetHubEndpoints', () => {
    it('should return asset hub endpoints for each network', () => {
      const polkadotEndpoints = getAssetHubEndpoints('polkadot');
      expect(polkadotEndpoints.length).toBeGreaterThan(0);
      expect(polkadotEndpoints[0]).toContain('wss://');

      const kusamaEndpoints = getAssetHubEndpoints('kusama');
      expect(kusamaEndpoints.length).toBeGreaterThan(0);
      expect(kusamaEndpoints[0]).toContain('wss://');

      const westendEndpoints = getAssetHubEndpoints('westend');
      expect(westendEndpoints.length).toBeGreaterThan(0);
      expect(westendEndpoints[0]).toContain('wss://');
    });
  });

  describe('getSupportedNetworks', () => {
    it('should return all supported networks', () => {
      const networks = getSupportedNetworks();
      expect(networks).toEqual(['polkadot', 'kusama', 'westend']);
    });
  });

  describe('getProductionNetworks', () => {
    it('should return only production networks', () => {
      const networks = getProductionNetworks();
      expect(networks).toEqual(['polkadot', 'kusama']);
      expect(networks).not.toContain('westend');
    });
  });

  describe('getTestnets', () => {
    it('should return only testnets', () => {
      const networks = getTestnets();
      expect(networks).toEqual(['westend']);
      expect(networks).not.toContain('polkadot');
      expect(networks).not.toContain('kusama');
    });
  });

  describe('isValidNetwork', () => {
    it('should validate network strings', () => {
      expect(isValidNetwork('polkadot')).toBe(true);
      expect(isValidNetwork('kusama')).toBe(true);
      expect(isValidNetwork('westend')).toBe(true);
      expect(isValidNetwork('invalid')).toBe(false);
      expect(isValidNetwork('')).toBe(false);
    });
  });

  describe('parseNetwork', () => {
    it('should parse valid network strings', () => {
      expect(parseNetwork('polkadot')).toBe('polkadot');
      expect(parseNetwork('kusama')).toBe('kusama');
      expect(parseNetwork('westend')).toBe('westend');
    });

    it('should return fallback for invalid networks', () => {
      expect(parseNetwork('invalid')).toBe('polkadot');
      expect(parseNetwork(undefined)).toBe('polkadot');
      expect(parseNetwork('')).toBe('polkadot');
    });

    it('should use custom fallback', () => {
      expect(parseNetwork('invalid', 'kusama')).toBe('kusama');
      expect(parseNetwork(undefined, 'westend')).toBe('westend');
    });
  });

  describe('isSameNetwork', () => {
    it('should compare networks correctly', () => {
      expect(isSameNetwork('polkadot', 'polkadot')).toBe(true);
      expect(isSameNetwork('kusama', 'kusama')).toBe(true);
      expect(isSameNetwork('polkadot', 'kusama')).toBe(false);
      expect(isSameNetwork('polkadot', 'westend')).toBe(false);
    });
  });

  describe('getNetworkDisplayName', () => {
    it('should return correct display names', () => {
      expect(getNetworkDisplayName('polkadot')).toBe('Polkadot');
      expect(getNetworkDisplayName('kusama')).toBe('Kusama');
      expect(getNetworkDisplayName('westend')).toBe('Westend Testnet');
    });

    it('should return undefined for invalid network', () => {
      expect(getNetworkDisplayName('invalid' as Network)).toBeUndefined();
    });
  });

  describe('getNetworkDescription', () => {
    it('should return descriptions for all networks', () => {
      const polkadotDesc = getNetworkDescription('polkadot');
      expect(polkadotDesc).toContain('mainnet');
      
      const kusamaDesc = getNetworkDescription('kusama');
      expect(kusamaDesc).toContain('canary');
      
      const westendDesc = getNetworkDescription('westend');
      expect(westendDesc).toContain('testnet');
    });

    it('should return undefined for invalid network', () => {
      expect(getNetworkDescription('invalid' as Network)).toBeUndefined();
    });
  });

  describe('getKnowledgeBaseForNetwork', () => {
    it('should return knowledge base for each network', async () => {
      const polkadotKB = await getKnowledgeBaseForNetwork('polkadot');
      expect(polkadotKB).toBeDefined();
      expect(polkadotKB.parachains).toBeDefined();
      expect(polkadotKB.parachains.length).toBeGreaterThan(0);

      const westendKB = await getKnowledgeBaseForNetwork('westend');
      expect(westendKB).toBeDefined();
      expect(westendKB.parachains).toBeDefined();
      expect(westendKB.parachains.length).toBeGreaterThan(0);

      const kusamaKB = await getKnowledgeBaseForNetwork('kusama');
      expect(kusamaKB).toBeDefined();
      // Should fallback to Polkadot for now
    });
  });

  describe('formatKnowledgeBaseForNetwork', () => {
    it('should format knowledge base for each network', () => {
      const polkadotFormatted = formatKnowledgeBaseForNetwork('polkadot');
      expect(typeof polkadotFormatted).toBe('string');
      expect(polkadotFormatted.length).toBeGreaterThan(0);
      expect(polkadotFormatted).toContain('Knowledge Base');

      const westendFormatted = formatKnowledgeBaseForNetwork('westend');
      expect(typeof westendFormatted).toBe('string');
      expect(westendFormatted.length).toBeGreaterThan(0);
      expect(westendFormatted).toContain('Knowledge Base');
    });
  });
});

