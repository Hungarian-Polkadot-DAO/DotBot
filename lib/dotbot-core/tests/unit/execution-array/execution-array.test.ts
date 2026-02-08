/**
 * Unit tests for ExecutionArray
 */

import { ExecutionArray } from '../../../executionEngine/executionArray';
import { ExecutionStatus, ExecutionItem } from '../../../executionEngine/types';
import { AgentResult } from '../../../agents/types';
import {
  createMockAgentResult,
  createMockAgentResults,
  wait,
} from './fixturesTestHelpers';

describe('ExecutionArray', () => {
  let executionArray: ExecutionArray;

  beforeEach(() => {
    // Disable simulation by default for tests
    const { disableSimulation } = require('../../../executionEngine/simulation/simulationConfig');
    disableSimulation();
    executionArray = new ExecutionArray();
  });

  describe('Core Queue Operations', () => {
    it('should add item and return unique ID', () => {
      const agentResult = createMockAgentResult();
      const id = executionArray.add(agentResult);

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.startsWith('exec_')).toBe(true);
    });

    it('should create ExecutionItem with correct structure', () => {
      const agentResult = createMockAgentResult({
        description: 'Transfer 1 DOT',
        estimatedFee: '0.01 DOT',
        warnings: ['Low balance'],
        metadata: { amount: '1' },
        executionType: 'extrinsic',
      });

      const id = executionArray.add(agentResult);
      const item = executionArray.getItem(id);

      expect(item).toBeDefined();
      // When simulation is disabled, items start as 'ready' (not 'pending')
      expect(item?.status).toBe('ready');
      expect(item?.description).toBe('Transfer 1 DOT');
      expect(item?.estimatedFee).toBe('0.01 DOT');
      expect(item?.warnings).toEqual(['Low balance']);
      expect(item?.metadata).toEqual({ amount: '1' });
      expect(item?.executionType).toBe('extrinsic');
      expect(item?.agentResult).toEqual(agentResult);
      expect(item?.index).toBe(0);
      expect(item?.createdAt).toBeDefined();
    });

    it('should add multiple items with sequential indices', () => {
      const results = createMockAgentResults(3);
      const ids = executionArray.addMultiple(results);

      expect(ids).toHaveLength(3);
      expect(ids.every(id => typeof id === 'string')).toBe(true);

      const items = executionArray.getItems();
      expect(items).toHaveLength(3);
      expect(items[0].index).toBe(0);
      expect(items[1].index).toBe(1);
      expect(items[2].index).toBe(2);
    });

    it('should retrieve item by ID', () => {
      const id = executionArray.add(createMockAgentResult());
      const item = executionArray.getItem(id);

      expect(item).toBeDefined();
      expect(item?.id).toBe(id);
    });

    it('should return undefined for non-existent ID', () => {
      const item = executionArray.getItem('non-existent-id');
      expect(item).toBeUndefined();
    });

    it('should return copy of items array', () => {
      executionArray.add(createMockAgentResult());
      const items1 = executionArray.getItems();
      const items2 = executionArray.getItems();

      expect(items1).not.toBe(items2); // Different references
      expect(items1).toEqual(items2); // Same content
    });

    it('should check if empty correctly', () => {
      expect(executionArray.isEmpty()).toBe(true);
      executionArray.add(createMockAgentResult());
      expect(executionArray.isEmpty()).toBe(false);
    });

    it('should return correct length', () => {
      expect(executionArray.getLength()).toBe(0);
      executionArray.add(createMockAgentResult());
      expect(executionArray.getLength()).toBe(1);
      executionArray.add(createMockAgentResult());
      expect(executionArray.getLength()).toBe(2);
    });
  });

  describe('Status Management', () => {
    let itemId: string;

    beforeEach(() => {
      executionArray.clear();
      itemId = executionArray.add(createMockAgentResult());
    });

    it('should update status correctly', () => {
      executionArray.updateStatus(itemId, 'executing');
      const item = executionArray.getItem(itemId);
      expect(item?.status).toBe('executing');
    });

    it('should set startedAt for signing/broadcasting', () => {
      executionArray.updateStatus(itemId, 'signing');
      const item = executionArray.getItem(itemId);
      expect(item?.startedAt).toBeDefined();
      expect(typeof item?.startedAt).toBe('number');
    });

    it('should set completedAt for final states', () => {
      const finalStates: ExecutionStatus[] = ['completed', 'finalized', 'failed', 'cancelled'];
      
      for (const status of finalStates) {
        const id = executionArray.add(createMockAgentResult());
        executionArray.updateStatus(id, status);
        const item = executionArray.getItem(id);
        expect(item?.completedAt).toBeDefined();
      }
    });

    it('should store error message when provided', () => {
      executionArray.updateStatus(itemId, 'failed', 'Transaction failed');
      const item = executionArray.getItem(itemId);
      expect(item?.error).toBe('Transaction failed');
    });

    it('should handle invalid ID gracefully', () => {
      expect(() => {
        executionArray.updateStatus('invalid-id', 'completed');
      }).not.toThrow();
    });

    it('should filter items by status', () => {
      // Clear the item from beforeEach for this test
      executionArray.clear();
      
      const id1 = executionArray.add(createMockAgentResult());
      const id2 = executionArray.add(createMockAgentResult());
      const id3 = executionArray.add(createMockAgentResult());

      executionArray.updateStatus(id1, 'completed');
      executionArray.updateStatus(id2, 'failed');
      // id3 remains ready (simulation disabled by default)

      expect(executionArray.getItemsByStatus('ready')).toHaveLength(1);
      expect(executionArray.getItemsByStatus('completed')).toHaveLength(1);
      expect(executionArray.getItemsByStatus('failed')).toHaveLength(1);
    });

    it('should get pending items', () => {
      const id1 = executionArray.add(createMockAgentResult());
      const id2 = executionArray.add(createMockAgentResult());
      // Manually set items to 'pending' for testing (simulating when simulation is enabled)
      executionArray.updateStatus(id1, 'pending');
      executionArray.updateStatus(id2, 'pending');
      executionArray.updateStatus(itemId, 'completed');

      const pending = executionArray.getPendingItems();
      expect(pending).toHaveLength(2);
      expect(pending.every(item => item.status === 'pending')).toBe(true);
    });

    it('should get ready items (pending and ready)', () => {
      // Clear the item from beforeEach for this test
      executionArray.clear();
      
      const id1 = executionArray.add(createMockAgentResult());
      const id2 = executionArray.add(createMockAgentResult());
      
      // id1 remains ready (simulation disabled by default)
      // Manually set id2 to 'pending' to test both statuses
      executionArray.updateStatus(id2, 'pending');

      const ready = executionArray.getReadyItems();
      expect(ready).toHaveLength(2);
      expect(ready.some(item => item.status === 'ready')).toBe(true);
      expect(ready.some(item => item.status === 'pending')).toBe(true);
    });
  });

  describe('State Tracking', () => {
    it('should return correct initial state', () => {
      const state = executionArray.getState();

      expect(state.totalItems).toBe(0);
      expect(state.completedItems).toBe(0);
      expect(state.failedItems).toBe(0);
      expect(state.cancelledItems).toBe(0);
      expect(state.currentIndex).toBe(-1);
      expect(state.isExecuting).toBe(false);
      expect(state.isPaused).toBe(false);
      expect(state.items).toEqual([]);
    });

    it('should count completed items correctly', () => {
      const id1 = executionArray.add(createMockAgentResult());
      const id2 = executionArray.add(createMockAgentResult());
      const id3 = executionArray.add(createMockAgentResult());

      executionArray.updateStatus(id1, 'completed');
      executionArray.updateStatus(id2, 'finalized');
      // id3 remains ready (simulation disabled by default)

      const state = executionArray.getState();
      expect(state.completedItems).toBe(2);
      expect(state.totalItems).toBe(3);
    });

    it('should count failed and cancelled items correctly', () => {
      const id1 = executionArray.add(createMockAgentResult());
      const id2 = executionArray.add(createMockAgentResult());

      executionArray.updateStatus(id1, 'failed');
      executionArray.updateStatus(id2, 'cancelled');

      const state = executionArray.getState();
      expect(state.failedItems).toBe(1);
      expect(state.cancelledItems).toBe(1);
    });

    it('should track currentIndex', () => {
      executionArray.setCurrentIndex(2);
      const state = executionArray.getState();
      expect(state.currentIndex).toBe(2);
    });

    it('should track isExecuting flag', () => {
      executionArray.setExecuting(true);
      expect(executionArray.getState().isExecuting).toBe(true);
      executionArray.setExecuting(false);
      expect(executionArray.getState().isExecuting).toBe(false);
    });

    it('should track isPaused flag', () => {
      executionArray.pause();
      expect(executionArray.getState().isPaused).toBe(true);
      executionArray.resume();
      expect(executionArray.getState().isPaused).toBe(false);
    });
  });

  describe('Callbacks', () => {
    it('should fire status callback on status update', async () => {
      const callback = jest.fn();
      executionArray.onStatusUpdate(callback);

      const id = executionArray.add(createMockAgentResult());
      executionArray.updateStatus(id, 'executing');

      // Wait for deferred callback (updateStatus uses deferred notifications)
      await wait(50);

      expect(callback).toHaveBeenCalled();
      expect(callback.mock.calls[0][0].id).toBe(id);
      expect(callback.mock.calls[0][0].status).toBe('executing');
    });

    it('should fire progress callback on changes', async () => {
      const callback = jest.fn();
      executionArray.onProgress(callback);

      executionArray.add(createMockAgentResult());
      
      // Wait for deferred callback - need to wait for both setTimeout calls
      // (scheduleNotification uses setTimeout(0), then flushNotifications uses setTimeout(0) again)
      await wait(50);
      
      expect(callback).toHaveBeenCalled();

      const state = callback.mock.calls[0][0];
      expect(state.totalItems).toBe(1);
    });

    it('should fire error callback only on failures', () => {
      const errorCallback = jest.fn();
      executionArray.onError(errorCallback);

      const id = executionArray.add(createMockAgentResult());
      executionArray.updateStatus(id, 'executing');
      expect(errorCallback).not.toHaveBeenCalled();

      executionArray.updateStatus(id, 'failed', 'Test error');
      expect(errorCallback).toHaveBeenCalled();
      expect(errorCallback.mock.calls[0][0].id).toBe(id);
      expect(errorCallback.mock.calls[0][1].message).toBe('Test error');
    });

    it('should allow multiple subscribers', async () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      executionArray.onStatusUpdate(callback1);
      executionArray.onStatusUpdate(callback2);

      const id = executionArray.add(createMockAgentResult());
      executionArray.updateStatus(id, 'executing');

      // Wait for deferred callback (updateStatus uses deferred notifications)
      await wait(50);

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    it('should allow unsubscribe', async () => {
      const callback = jest.fn();
      const unsubscribe = executionArray.onStatusUpdate(callback);

      const id = executionArray.add(createMockAgentResult());
      await wait(20);
      
      executionArray.updateStatus(id, 'executing');
      await wait(20);
      
      expect(callback).toHaveBeenCalledTimes(2); // Once from add, once from updateStatus

      unsubscribe();
      executionArray.updateStatus(id, 'completed');
      await wait(20);
      
      expect(callback).toHaveBeenCalledTimes(2); // Not called again after unsubscribe
    });
  });

  describe('Item Management', () => {
    it('should remove item by ID', () => {
      const id1 = executionArray.add(createMockAgentResult());
      const id2 = executionArray.add(createMockAgentResult());
      const id3 = executionArray.add(createMockAgentResult());

      const removed = executionArray.remove(id2);
      expect(removed).toBe(true);
      expect(executionArray.getLength()).toBe(2);
      expect(executionArray.getItem(id2)).toBeUndefined();
    });

    it('should update indices after removal', () => {
      const id1 = executionArray.add(createMockAgentResult());
      const id2 = executionArray.add(createMockAgentResult());
      const id3 = executionArray.add(createMockAgentResult());

      executionArray.remove(id1);

      const items = executionArray.getItems();
      expect(items[0].index).toBe(0);
      expect(items[1].index).toBe(1);
    });

    it('should return false when removing non-existent item', () => {
      const removed = executionArray.remove('non-existent');
      expect(removed).toBe(false);
    });

    it('should clear all items and reset state', () => {
      executionArray.add(createMockAgentResult());
      executionArray.add(createMockAgentResult());
      executionArray.setCurrentIndex(1);
      executionArray.setExecuting(true);
      executionArray.pause();

      executionArray.clear();

      expect(executionArray.isEmpty()).toBe(true);
      expect(executionArray.getState().currentIndex).toBe(-1);
      expect(executionArray.getState().isExecuting).toBe(false);
      expect(executionArray.getState().isPaused).toBe(false);
    });

    it('should filter items by execution type', () => {
      executionArray.add(createMockAgentResult({ executionType: 'extrinsic' }));
      executionArray.add(createMockAgentResult({ executionType: 'data_fetch' }));
      executionArray.add(createMockAgentResult({ executionType: 'extrinsic' }));

      const extrinsics = executionArray.getItemsByType('extrinsic');
      expect(extrinsics).toHaveLength(2);

      const dataFetches = executionArray.getItemsByType('data_fetch');
      expect(dataFetches).toHaveLength(1);
    });
  });

  describe('Result Management', () => {
    it('should update result for item', () => {
      const id = executionArray.add(createMockAgentResult());
      const result = { hash: '0x123', blockNumber: 12345 };

      executionArray.updateResult(id, result);

      const item = executionArray.getItem(id);
      expect(item?.result).toEqual(result);
    });

    it('should handle invalid ID gracefully when updating result', () => {
      expect(() => {
        executionArray.updateResult('invalid-id', {});
      }).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle operations on empty array', () => {
      expect(executionArray.isEmpty()).toBe(true);
      expect(executionArray.getLength()).toBe(0);
      expect(executionArray.getPendingItems()).toEqual([]);
      expect(executionArray.getState().totalItems).toBe(0);
    });

    it('should preserve all AgentResult fields in ExecutionItem', () => {
      const agentResult = createMockAgentResult({
        description: 'Test',
        estimatedFee: '0.01',
        warnings: ['Warning'],
        metadata: { key: 'value' },
        data: { some: 'data' },
      });

      const id = executionArray.add(agentResult);
      const item = executionArray.getItem(id);

      expect(item?.agentResult).toEqual(agentResult);
      expect(item?.description).toBe(agentResult.description);
      expect(item?.estimatedFee).toBe(agentResult.estimatedFee);
      expect(item?.warnings).toEqual(agentResult.warnings);
      expect(item?.metadata).toEqual(agentResult.metadata);
    });
  });
});

