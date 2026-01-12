/**
 * Custom hook for managing expanded items state
 */

import { useState, useCallback } from 'react';

/**
 * Hook to manage which execution items are expanded
 */
export function useExpandedItems() {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((itemId: string) => {
    setExpandedItems(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(itemId)) {
        newExpanded.delete(itemId);
      } else {
        newExpanded.add(itemId);
      }
      return newExpanded;
    });
  }, []);

  const isExpanded = useCallback((itemId: string) => {
    return expandedItems.has(itemId);
  }, [expandedItems]);

  return {
    expandedItems,
    toggleExpand,
    isExpanded
  };
}
