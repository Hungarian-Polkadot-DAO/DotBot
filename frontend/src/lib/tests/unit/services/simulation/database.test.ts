/**
 * Unit tests for Chopsticks Database (IndexedDB)
 */

// Mock idb before imports
jest.mock('idb', () => ({
  openDB: jest.fn(),
}));

import { ChopsticksDatabase } from '../../../../services/simulation/database';
import { openDB } from 'idb';

describe('ChopsticksDatabase', () => {
  let mockDb: any;
  let mockTransaction: any;
  let mockStore: any;
  let mockIndex: any;
  let mockCursor: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockCursor = {
      value: null,
    };

    mockIndex = {
      openCursor: jest.fn().mockResolvedValue(mockCursor),
    };

    mockStore = {
      delete: jest.fn(),
      put: jest.fn(),
      get: jest.fn(),
      getFromIndex: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      index: jest.fn().mockReturnValue(mockIndex),
    };

    mockTransaction = {
      objectStore: jest.fn().mockReturnValue(mockStore),
      done: Promise.resolve(),
    };

    mockDb = {
      close: jest.fn(),
      transaction: jest.fn().mockReturnValue(mockTransaction),
      get: jest.fn(),
      getFromIndex: jest.fn(),
      delete: jest.fn(),
      put: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    };

    (openDB as jest.Mock).mockResolvedValue(mockDb);
  });

  describe('constructor', () => {
    it('should create database with correct name', () => {
      const db = new ChopsticksDatabase('test-db');

      expect(openDB).toHaveBeenCalledWith('test-db', 1, expect.any(Object));
    });

    it('should set up database schema on upgrade', () => {
      // Create a database instance to trigger openDB call
      new ChopsticksDatabase('test-db');
      
      const upgradeFn = (openDB as jest.Mock).mock.calls[0][2].upgrade;
      const mockDbUpgrade = {
        createObjectStore: jest.fn().mockReturnValue({
          createIndex: jest.fn(),
        }),
      };

      upgradeFn(mockDbUpgrade);

      expect(mockDbUpgrade.createObjectStore).toHaveBeenCalledWith('keyValue');
      expect(mockDbUpgrade.createObjectStore).toHaveBeenCalledWith('block', { keyPath: 'hash' });
    });
  });

  describe('close()', () => {
    it('should close database', async () => {
      const db = new ChopsticksDatabase('test-db');
      await db.close();

      expect(mockDb.close).toHaveBeenCalled();
    });
  });

  describe('saveBlock()', () => {
    it('should save block to database', async () => {
      const db = new ChopsticksDatabase('test-db');
      const block = { hash: '0x1234', number: 100 };

      await db.saveBlock(block as any);

      expect(mockDb.transaction).toHaveBeenCalledWith(['block'], 'readwrite');
      expect(mockStore.delete).toHaveBeenCalledWith('0x1234');
      expect(mockStore.put).toHaveBeenCalledWith(block);
    });
  });

  describe('queryBlock()', () => {
    it('should query block by hash', async () => {
      const db = new ChopsticksDatabase('test-db');
      const block = { hash: '0x1234', number: 100 };
      mockDb.get.mockResolvedValue(block);

      const result = await db.queryBlock('0x1234');

      expect(mockDb.get).toHaveBeenCalledWith('block', '0x1234');
      expect(result).toEqual(block);
    });

    it('should return null if block not found', async () => {
      const db = new ChopsticksDatabase('test-db');
      mockDb.get.mockResolvedValue(undefined);

      const result = await db.queryBlock('0x1234');

      expect(result).toBeNull();
    });
  });

  describe('queryBlockByNumber()', () => {
    it('should query block by number', async () => {
      const db = new ChopsticksDatabase('test-db');
      const block = { hash: '0x1234', number: 100 };
      mockDb.getFromIndex.mockResolvedValue(block);

      const result = await db.queryBlockByNumber(100);

      expect(mockDb.getFromIndex).toHaveBeenCalledWith('block', 'byNumber', 100);
      expect(result).toEqual(block);
    });

    it('should return null if block not found', async () => {
      const db = new ChopsticksDatabase('test-db');
      mockDb.getFromIndex.mockResolvedValue(undefined);

      const result = await db.queryBlockByNumber(100);

      expect(result).toBeNull();
    });
  });

  describe('queryHighestBlock()', () => {
    it('should query highest block', async () => {
      const db = new ChopsticksDatabase('test-db');
      const block = { hash: '0x1234', number: 100 };
      mockCursor.value = block;

      const result = await db.queryHighestBlock();

      expect(mockDb.transaction).toHaveBeenCalledWith('block');
      expect(mockIndex.openCursor).toHaveBeenCalledWith(null, 'prev');
      expect(result).toEqual(block);
    });

    it('should return null if no blocks', async () => {
      const db = new ChopsticksDatabase('test-db');
      mockCursor.value = null;

      const result = await db.queryHighestBlock();

      expect(result).toBeNull();
    });
  });

  describe('deleteBlock()', () => {
    it('should delete block by hash', async () => {
      const db = new ChopsticksDatabase('test-db');

      await db.deleteBlock('0x1234');

      expect(mockDb.delete).toHaveBeenCalledWith('block', '0x1234');
    });
  });

  describe('blocksCount()', () => {
    it('should return count of blocks', async () => {
      const db = new ChopsticksDatabase('test-db');
      mockDb.count.mockResolvedValue(5);

      const count = await db.blocksCount();

      expect(mockDb.count).toHaveBeenCalledWith('block');
      expect(count).toBe(5);
    });
  });

  describe('saveStorage()', () => {
    it('should save storage value', async () => {
      const db = new ChopsticksDatabase('test-db');

      await db.saveStorage('0x1234', '0x5678', '0x9abc');

      expect(mockDb.put).toHaveBeenCalledWith('keyValue', '0x9abc', '0x1234-0x5678');
    });

    it('should save null value', async () => {
      const db = new ChopsticksDatabase('test-db');

      await db.saveStorage('0x1234', '0x5678', null);

      expect(mockDb.put).toHaveBeenCalledWith('keyValue', null, '0x1234-0x5678');
    });
  });

  describe('queryStorage()', () => {
    it('should query storage value', async () => {
      const db = new ChopsticksDatabase('test-db');
      mockDb.get.mockResolvedValue('0x9abc');

      const result = await db.queryStorage('0x1234', '0x5678');

      expect(mockDb.get).toHaveBeenCalledWith('keyValue', '0x1234-0x5678');
      expect(result).toEqual({
        blockHash: '0x1234',
        key: '0x5678',
        value: '0x9abc',
      });
    });

    it('should return null if value not found', async () => {
      const db = new ChopsticksDatabase('test-db');
      mockDb.get.mockResolvedValue(undefined);

      const result = await db.queryStorage('0x1234', '0x5678');

      expect(result).toBeNull();
    });
  });
});

