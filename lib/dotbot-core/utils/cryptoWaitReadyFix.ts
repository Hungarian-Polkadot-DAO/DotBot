/**
 * Fixed cryptoWaitReady implementation
 * 
 * This fixes the "Pause on exceptions" issue in production by ensuring
 * all errors are properly caught and never become unhandled promise rejections.
 * 
 * Replace the problematic implementation with this one.
 */

import { isReady, waitReady } from '@polkadot/wasm-crypto';

export const cryptoIsReady = isReady;

/**
 * Wait for crypto to be ready
 * 
 * FIXED VERSION: Uses async/await with proper error handling to prevent
 * unhandled promise rejections that cause "Pause on exceptions" in production.
 * 
 * @returns Promise that resolves to true if ready, false if failed
 */
export async function cryptoWaitReady(): Promise<boolean> {
  try {
    // Wait for crypto initialization
    await waitReady();
    
    // Verify it's actually ready
    if (!isReady()) {
      // Log warning but return false instead of throwing
      // This prevents unhandled promise rejections
      console.warn('Unable to initialize @polkadot/util-crypto - isReady() returned false after waitReady()');
      return false;
    }
    
    return true;
  } catch (error) {
    // Catch ALL errors (from waitReady() or any other source)
    // Return false instead of throwing to prevent unhandled rejections
    console.warn('Error initializing @polkadot/util-crypto:', error);
    return false;
  }
}
