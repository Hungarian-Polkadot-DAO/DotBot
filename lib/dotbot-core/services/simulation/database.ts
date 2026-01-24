/**
 * Storage adapters for Chopsticks
 * Supports both browser (IndexedDB) and Node.js (in-memory) environments
 */

import { isBrowser } from '../../env';

/**
 * Block entry stored in the database
 * This matches the BlockEntry interface from @acala-network/chopsticks-core
 */
export interface BlockEntry {
  hash: `0x${string}`;
  number: number;
  header: `0x${string}`;
  parentHash: `0x${string}` | null;
  extrinsics: `0x${string}`[];
  storageDiff: Record<`0x${string}`, `0x${string}` | null> | null;
}

/**
 * Key-value storage entry
 */
export interface KeyValueEntry {
  blockHash: `0x${string}`;
  key: `0x${string}`;
  value: `0x${string}` | null;
}

/**
 * Database interface for Chopsticks storage
 * This matches the interface expected by @acala-network/chopsticks-core
 */
export interface Database {
  close(): Promise<void>;
  saveBlock(block: BlockEntry): Promise<void>;
  queryBlock(hash: `0x${string}`): Promise<BlockEntry | null>;
  queryBlockByNumber(number: number): Promise<BlockEntry | null>;
  queryHighestBlock(): Promise<BlockEntry | null>;
  deleteBlock(hash: `0x${string}`): Promise<void>;
  blocksCount(): Promise<number>;
  saveStorage(
    blockHash: `0x${string}`,
    key: `0x${string}`,
    value: `0x${string}` | null
  ): Promise<void>;
  queryStorage(
    blockHash: `0x${string}`,
    key: `0x${string}`
  ): Promise<KeyValueEntry | null>;
}

// Conditional import - only load idb types, actual import happens lazily
let idbModule: any = null;
async function getIdbModule() {
  if (!idbModule) {
    idbModule = await import('idb');
  }
  return idbModule;
}

/**
 * In-memory storage adapter for Chopsticks (Node.js)
 * 
 * For backend/Node.js use - data is stored in memory only (not persisted).
 * Useful for server-side DotBot instances where persistence is handled separately.
 */
export class InMemoryChopsticksDatabase implements Database {
  private blocks: Map<`0x${string}`, BlockEntry> = new Map();
  private blocksByNumber: Map<number, `0x${string}`> = new Map();
  private keyValue: Map<string, string | null> = new Map();

  constructor(_name: string) {
    // Name is stored for reference but not used in in-memory implementation
    // In a real scenario, you might want to namespace by name if multiple instances exist
  }

  async close(): Promise<void> {
    // No-op for in-memory storage
  }

  async saveBlock(block: BlockEntry): Promise<void> {
    // Delete old entry if block number changed
    const existingHash = this.blocksByNumber.get(block.number);
    if (existingHash && existingHash !== block.hash) {
      this.blocks.delete(existingHash);
    }
    
    this.blocks.set(block.hash, block);
    this.blocksByNumber.set(block.number, block.hash);
  }

  async queryBlock(hash: `0x${string}`): Promise<BlockEntry | null> {
    return this.blocks.get(hash) ?? null;
  }

  async queryBlockByNumber(number: number): Promise<BlockEntry | null> {
    const hash = this.blocksByNumber.get(number);
    if (!hash) return null;
    return this.blocks.get(hash) ?? null;
  }

  async queryHighestBlock(): Promise<BlockEntry | null> {
    if (this.blocksByNumber.size === 0) return null;
    
    const highestNumber = Math.max(...Array.from(this.blocksByNumber.keys()));
    const hash = this.blocksByNumber.get(highestNumber);
    if (!hash) return null;
    
    return this.blocks.get(hash) ?? null;
  }

  async deleteBlock(hash: `0x${string}`): Promise<void> {
    const block = this.blocks.get(hash);
    if (block) {
      this.blocks.delete(hash);
      this.blocksByNumber.delete(block.number);
    }
  }

  async blocksCount(): Promise<number> {
    return this.blocks.size;
  }

  async saveStorage(
    blockHash: `0x${string}`,
    key: `0x${string}`,
    value: `0x${string}` | null
  ): Promise<void> {
    const compositeKey = `${blockHash}-${key}`;
    this.keyValue.set(compositeKey, value);
  }

  async queryStorage(
    blockHash: `0x${string}`,
    key: `0x${string}`
  ): Promise<KeyValueEntry | null> {
    const compositeKey = `${blockHash}-${key}`;
    const val = this.keyValue.get(compositeKey);
    
    if (val !== undefined) {
      return { blockHash, key, value: val as `0x${string}` | null };
    }
    
    return null;
  }
}

/**
 * IndexedDB storage adapter for Chopsticks (Browser)
 * 
 * Note: This class should only be instantiated in browser environments.
 * Use createChopsticksDatabase() factory function for automatic environment detection.
 */
export class ChopsticksDatabase implements Database {
  private db: Promise<any>;

  constructor(name: string) {
    // Check if IndexedDB is available
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      throw new Error(
        'IndexedDB is not available. Use InMemoryChopsticksDatabase for Node.js environments or use createChopsticksDatabase() factory function.'
      );
    }

    // Use lazy import to avoid loading idb in Node.js at module load time
    // This allows the module to be imported in Node.js without errors
    this.db = (async () => {
      try {
        const idb = await getIdbModule();
        const { openDB } = idb;
        
        // Define schema inline since we can't use type imports in dynamic context
        return openDB(name, 1, {
          upgrade(db: any) {
            db.createObjectStore('keyValue');
            const blockStore = db.createObjectStore('block', { keyPath: 'hash' });
            blockStore.createIndex('byNumber', 'number');
          },
        });
      } catch (error) {
        throw new Error(`Failed to initialize IndexedDB: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
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
    const tx = database.transaction('block');
    const store = tx.objectStore('block');
    const index = store.index('byNumber');
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

/**
 * Factory function to create the appropriate database implementation
 * based on the runtime environment.
 * 
 * @param name Database name
 * @returns Database instance (IndexedDB in browser, in-memory in Node.js)
 */
export function createChopsticksDatabase(name: string): Database {
  // Check if we're in a browser environment with IndexedDB support
  if (isBrowser() && typeof indexedDB !== 'undefined') {
    try {
      return new ChopsticksDatabase(name);
    } catch (error) {
      // Fallback to in-memory if IndexedDB fails
      // Note: Logger not available in database.ts, but this is a warning that should be visible
      // IndexedDB unavailability is expected in Node.js environments
      return new InMemoryChopsticksDatabase(name);
    }
  }
  
  // Node.js or environment without IndexedDB - use in-memory
  return new InMemoryChopsticksDatabase(name);
}
