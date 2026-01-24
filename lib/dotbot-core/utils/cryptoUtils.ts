/**
 * Crypto Utilities
 * 
 * Safe wrapper for Polkadot crypto initialization that prevents unhandled promise rejections
 */

import { isReady, waitReady } from '@polkadot/wasm-crypto';

export const cryptoIsReady = isReady;

/**
 * Wait for crypto to be ready
 * 
 * This is a safe wrapper that ensures all errors are properly caught
 * to prevent "Pause on exceptions" in production environments.
 * 
 * @returns Promise that resolves to true if crypto is ready, false otherwise
 */
export async function cryptoWaitReady(): Promise<boolean> {
  try {
    // Wait for crypto to initialize
    await waitReady();
    
    // Verify it's actually ready
    if (!isReady()) {
      // Log the error but don't throw - return false instead
      // This prevents unhandled promise rejections in production
      console.warn('Unable to initialize @polkadot/util-crypto - crypto is not ready after waitReady()');
      return false;
    }
    
    return true;
  } catch (error) {
    // Catch any errors from waitReady() or other operations
    // Log but don't throw - return false instead
    console.warn('Error initializing @polkadot/util-crypto:', error);
    return false;
  }
}
