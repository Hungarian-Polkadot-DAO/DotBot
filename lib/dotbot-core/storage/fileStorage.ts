/**
 * File-based storage for Node.js (persists to disk)
 * Safe for Docker containers when mounted to a volume
 * 
 * Implements the Storage interface for compatibility with browser localStorage API
 */

import { isNode } from '../env';
import type { Storage } from '../env';

export class FileStorage implements Storage {
  private storageDir: string;
  private fs: any;
  private path: any;

  constructor(storageDir: string) {
    this.storageDir = storageDir;
    
    // Dynamic import for Node.js modules (won't break browser builds)
    if (isNode()) {
      try {
        this.fs = require('fs');
        this.path = require('path');
        
        // Ensure storage directory exists
        if (!this.fs.existsSync(this.storageDir)) {
          this.fs.mkdirSync(this.storageDir, { recursive: true });
        }
      } catch (error) {
        console.error('Failed to initialize FileStorage:', error);
        throw error;
      }
    }
  }

  private getFilePath(key: string): string {
    // Sanitize key to make it safe for filesystem
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return this.path.join(this.storageDir, `${safeKey}.json`);
  }

  getItem(key: string): string | null {
    if (!this.fs) return null;
    
    try {
      const filePath = this.getFilePath(key);
      if (!this.fs.existsSync(filePath)) {
        return null;
      }
      const data = this.fs.readFileSync(filePath, 'utf8');
      return data;
    } catch (error) {
      console.error(`FileStorage.getItem error for key ${key}:`, error);
      return null;
    }
  }

  setItem(key: string, value: string): void {
    if (!this.fs) return;
    
    try {
      const filePath = this.getFilePath(key);
      this.fs.writeFileSync(filePath, value, 'utf8');
    } catch (error) {
      console.error(`FileStorage.setItem error for key ${key}:`, error);
    }
  }

  removeItem(key: string): void {
    if (!this.fs) return;
    
    try {
      const filePath = this.getFilePath(key);
      if (this.fs.existsSync(filePath)) {
        this.fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error(`FileStorage.removeItem error for key ${key}:`, error);
    }
  }

  clear(): void {
    if (!this.fs) return;
    
    try {
      const files = this.fs.readdirSync(this.storageDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          this.fs.unlinkSync(this.path.join(this.storageDir, file));
        }
      }
    } catch (error) {
      console.error('FileStorage.clear error:', error);
    }
  }

  get length(): number {
    if (!this.fs) return 0;
    
    try {
      const files = this.fs.readdirSync(this.storageDir);
      return files.filter((file: string) => file.endsWith('.json')).length;
    } catch {
      return 0;
    }
  }

  key(index: number): string | null {
    if (!this.fs) return null;
    
    try {
      const files = this.fs.readdirSync(this.storageDir)
        .filter((file: string) => file.endsWith('.json'))
        .map((file: string) => {
          // Convert filename back to original key (remove .json and unsanitize)
          // Note: We can't perfectly reverse sanitization, so we return the filename
          // For FileStorage, keys are stored as filenames
          return file.replace(/\.json$/, '');
        });
      return files[index] || null;
    } catch {
      return null;
    }
  }
}
