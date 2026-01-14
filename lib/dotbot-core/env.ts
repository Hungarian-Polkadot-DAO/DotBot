/**
 * Environment abstraction layer
 * Works in both browser (Create React App) and Node.js environments
 */

// Type definitions for browser globals in Node.js environment
declare const window: (Window & typeof globalThis) | undefined;
declare const localStorage: Storage | undefined;

/**
 * Get environment variable
 * In browser: tries REACT_APP_* first, falls back to regular name
 * In Node.js: uses regular process.env
 */
export function getEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) {
    // Try REACT_APP_ prefixed version first (CRA convention)
    const reactAppKey = key.startsWith('REACT_APP_') ? key : `REACT_APP_${key}`;
    return process.env[reactAppKey] || process.env[key];
  }
  return undefined;
}

/**
 * Check if running in browser environment
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.document !== 'undefined';
}

/**
 * Check if running in Node.js environment
 */
export function isNode(): boolean {
  return typeof process !== 'undefined' && 
         process.versions != null && 
         process.versions.node != null;
}

/**
 * Get storage interface (localStorage in browser, in-memory in Node.js)
 */
export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

class MemoryStorage implements Storage {
  private data: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.data.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }
}

let storageInstance: Storage | null = null;

export function getStorage(): Storage {
  if (storageInstance) {
    return storageInstance;
  }

  if (isBrowser() && typeof localStorage !== 'undefined') {
    storageInstance = localStorage as Storage;
  } else {
    // Node.js or environment without localStorage
    storageInstance = new MemoryStorage();
  }

  return storageInstance;
}

/**
 * Set custom storage implementation (useful for testing)
 */
export function setStorage(storage: Storage): void {
  storageInstance = storage;
}
