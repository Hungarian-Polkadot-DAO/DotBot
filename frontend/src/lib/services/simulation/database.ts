/**
 * IndexedDB storage adapter for Chopsticks
 */

import type {
  BlockEntry,
  Database,
  KeyValueEntry,
} from '@acala-network/chopsticks-core';
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

interface CacheSchema extends DBSchema {
  keyValue: {
    key: string;
    value: string | null;
  };
  block: {
    key: string;
    value: BlockEntry;
    indexes: { byNumber: number };
  };
}

export class ChopsticksDatabase implements Database {
  private db: Promise<IDBPDatabase<CacheSchema>>;

  constructor(name: string) {
    this.db = openDB<CacheSchema>(name, 1, {
      upgrade(db) {
        db.createObjectStore('keyValue');
        const blockStore = db.createObjectStore('block', { keyPath: 'hash' });
        blockStore.createIndex('byNumber', 'number');
      },
    });
  }

  async close(): Promise<void> {
    const database = await this.db;
    database.close();
  }

  async saveBlock(block: BlockEntry): Promise<void> {
    const database = await this.db;
    const tx = database.transaction(['block'], 'readwrite');
    const store = tx.objectStore('block');
    store.delete(block.hash);
    store.put(block);
    await tx.done;
  }

  async queryBlock(hash: `0x${string}`): Promise<BlockEntry | null> {
    const database = await this.db;
    const block = await database.get('block', hash);
    return block ?? null;
  }

  async queryBlockByNumber(number: number): Promise<BlockEntry | null> {
    const database = await this.db;
    const block = await database.getFromIndex('block', 'byNumber', number);
    return block ?? null;
  }

  async queryHighestBlock(): Promise<BlockEntry | null> {
    const database = await this.db;
    const index = database.transaction('block').store.index('byNumber');
    const cursor = await index.openCursor(null, 'prev');
    return cursor?.value ?? null;
  }

  async deleteBlock(hash: `0x${string}`): Promise<void> {
    const database = await this.db;
    await database.delete('block', hash);
  }

  async blocksCount(): Promise<number> {
    const database = await this.db;
    return database.count('block');
  }

  async saveStorage(
    blockHash: `0x${string}`,
    key: `0x${string}`,
    value: `0x${string}` | null
  ): Promise<void> {
    const database = await this.db;
    const compositeKey = `${blockHash}-${key}`;
    await database.put('keyValue', value, compositeKey);
  }

  async queryStorage(
    blockHash: `0x${string}`,
    key: `0x${string}`
  ): Promise<KeyValueEntry | null> {
    const database = await this.db;
    const compositeKey = `${blockHash}-${key}`;
    const val = await database.get('keyValue', compositeKey);
    
    if (val !== undefined) {
      return { blockHash, key, value: val };
    }
    
    return null;
  }
}
