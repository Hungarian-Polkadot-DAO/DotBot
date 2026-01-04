/**
 * Unit tests for Agent Registry
 */

// Mock the agent classes before imports
jest.mock('../../../agents/asset-transfer', () => ({
  AssetTransferAgent: jest.fn().mockImplementation(() => ({
    getAgentName: jest.fn().mockReturnValue('AssetTransferAgent'),
    initialize: jest.fn(),
  })),
}));

import {
  AGENT_REGISTRY,
  getAgentByClassName,
  getAllAgentClassNames,
  createAgent,
  AgentRegistryEntry,
} from '../../../agents/index';
import { AssetTransferAgent } from '../../../agents/asset-transfer';

describe('Agent Registry', () => {
  describe('AGENT_REGISTRY', () => {
    it('should contain registered agents', () => {
      expect(AGENT_REGISTRY).toBeDefined();
      expect(Array.isArray(AGENT_REGISTRY)).toBe(true);
      expect(AGENT_REGISTRY.length).toBeGreaterThan(0);
    });

    it('should have correct structure for each entry', () => {
      AGENT_REGISTRY.forEach(entry => {
        expect(entry).toHaveProperty('agentClass');
        expect(entry).toHaveProperty('className');
        expect(entry).toHaveProperty('displayName');
        expect(typeof entry.className).toBe('string');
        expect(typeof entry.displayName).toBe('string');
        expect(typeof entry.agentClass).toBe('function');
      });
    });

    it('should include AssetTransferAgent', () => {
      const assetTransferEntry = AGENT_REGISTRY.find(
        entry => entry.className === 'AssetTransferAgent'
      );
      
      expect(assetTransferEntry).toBeDefined();
      expect(assetTransferEntry!.agentClass).toBe(AssetTransferAgent);
      expect(assetTransferEntry!.displayName).toBe('Asset Transfer Agent');
    });
  });

  describe('getAgentByClassName()', () => {
    it('should find agent by class name', () => {
      const entry = getAgentByClassName('AssetTransferAgent');

      expect(entry).toBeDefined();
      expect(entry!.className).toBe('AssetTransferAgent');
      expect(entry!.displayName).toBe('Asset Transfer Agent');
      expect(entry!.agentClass).toBe(AssetTransferAgent);
    });

    it('should return undefined for non-existent agent', () => {
      const entry = getAgentByClassName('NonExistentAgent');

      expect(entry).toBeUndefined();
    });

    it('should be case-sensitive', () => {
      const entry = getAgentByClassName('assettransferagent'); // lowercase

      expect(entry).toBeUndefined();
    });

    it('should handle empty string', () => {
      const entry = getAgentByClassName('');

      expect(entry).toBeUndefined();
    });
  });

  describe('getAllAgentClassNames()', () => {
    it('should return array of all class names', () => {
      const classNames = getAllAgentClassNames();

      expect(Array.isArray(classNames)).toBe(true);
      expect(classNames.length).toBeGreaterThan(0);
      expect(classNames).toContain('AssetTransferAgent');
    });

    it('should return only class names, not full entries', () => {
      const classNames = getAllAgentClassNames();

      classNames.forEach(className => {
        expect(typeof className).toBe('string');
        expect(className).not.toHaveProperty('agentClass');
        expect(className).not.toHaveProperty('displayName');
      });
    });

    it('should match registry length', () => {
      const classNames = getAllAgentClassNames();

      expect(classNames.length).toBe(AGENT_REGISTRY.length);
    });
  });

  describe('createAgent()', () => {
    it('should create agent instance by class name', () => {
      const agent = createAgent('AssetTransferAgent');

      expect(agent).toBeDefined();
      expect(agent).not.toBeNull();
      expect(AssetTransferAgent).toHaveBeenCalled();
    });

    it('should return null for non-existent agent', () => {
      const agent = createAgent('NonExistentAgent');

      expect(agent).toBeNull();
    });

    it('should create new instance each time', () => {
      const agent1 = createAgent('AssetTransferAgent');
      const agent2 = createAgent('AssetTransferAgent');

      expect(agent1).not.toBe(agent2); // Different instances
      expect(AssetTransferAgent).toHaveBeenCalledTimes(2);
    });

    it('should handle empty string', () => {
      const agent = createAgent('');

      expect(agent).toBeNull();
    });

    it('should create agent with correct type', () => {
      const agent = createAgent('AssetTransferAgent');

      expect(agent).toBeDefined();
      // Agent should have getAgentName method (from BaseAgent)
      if (agent && typeof agent.getAgentName === 'function') {
        expect(agent.getAgentName()).toBe('AssetTransferAgent');
      }
    });
  });
});

