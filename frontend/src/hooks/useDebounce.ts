/**
 * useDebounce Hook
 * 
 * Prevents rapid successive calls to a function.
 * Useful for preventing double/triple clicks on buttons.
 */

import { useRef, useCallback } from 'react';

/**
 * Returns a debounced version of the callback function
 * @param callback The function to debounce
 * @param delay Delay in milliseconds (default: 300ms)
 * @returns Debounced function
 */
export function useDebounce<T extends (...args: any[]) => any>(
  callback: T,
  delay: number = 300
): T {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isPendingRef = useRef<boolean>(false);

  const debouncedCallback = useCallback(
    ((...args: Parameters<T>) => {
      // If already pending, ignore the call
      if (isPendingRef.current) {
        return;
      }

      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Set pending flag
      isPendingRef.current = true;

      // Set timeout to execute callback
      timeoutRef.current = setTimeout(() => {
        callback(...args);
        isPendingRef.current = false;
        timeoutRef.current = null;
      }, delay);
    }) as T,
    [callback, delay]
  );

  return debouncedCallback;
}

/**
 * Hook to prevent rapid successive clicks
 * Returns a debounced click handler that ignores clicks while processing
 * @param callback The function to call on click
 * @param delay Delay in milliseconds (default: 500ms for button clicks)
 * @returns Debounced click handler
 */
export function useDebouncedClick<T extends (...args: any[]) => any>(
  callback: T,
  delay: number = 500
): T {
  const isProcessingRef = useRef<boolean>(false);

  return useCallback(
    ((...args: Parameters<T>) => {
      // If already processing, ignore the click
      if (isProcessingRef.current) {
        return;
      }

      // Set processing flag
      isProcessingRef.current = true;

      // Execute callback
      const result = callback(...args);

      // If callback returns a promise, wait for it to complete
      if (result instanceof Promise) {
        result
          .catch((error) => {
            // Log error but don't throw - let the component handle it
            console.error('Debounced click handler error:', error);
          })
          .finally(() => {
            // Reset processing flag after delay
            setTimeout(() => {
              isProcessingRef.current = false;
            }, delay);
          });
      } else {
        // Reset processing flag after delay
        setTimeout(() => {
          isProcessingRef.current = false;
        }, delay);
      }

      return result;
    }) as T,
    [callback, delay]
  );
}

