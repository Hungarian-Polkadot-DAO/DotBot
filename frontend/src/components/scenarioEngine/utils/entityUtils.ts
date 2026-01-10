/**
 * Entity Utilities
 * 
 * Helper functions for entity validation and management
 */

interface Entity {
  name: string;
  address: string;
  type: string;
  uri?: string;
}

/**
 * Verify entity creation was successful
 */
export const verifyEntities = (
  entities: Entity[],
  mode: string,
  appendToReport: (text: string) => void
): void => {
  const requiredNames = ['Alice', 'Bob', 'Charlie'];
  const createdNames = entities.map(e => e.name);
  const missing = requiredNames.filter(n => !createdNames.includes(n));
  
  if (missing.length > 0) {
    appendToReport(`[VERIFY] ❌ Missing: ${missing.join(', ')}\n`);
    return;
  }
  
  const invalidAddresses = entities.filter(e => 
    !e.address || !e.address.startsWith('5') || e.address.length < 40 || e.address.length > 50
  );
  
  if (invalidAddresses.length > 0) {
    appendToReport(`[VERIFY] ❌ Invalid addresses: ${invalidAddresses.map(e => e.name).join(', ')}\n`);
    return;
  }
  
  if (mode === 'live') {
    const withURIs = entities.filter(e => e.uri);
    if (withURIs.length > 0) {
      appendToReport(`[VERIFY] ⚠️ Live mode should not expose URIs (security)\n`);
    }
  } else {
    const withoutURIs = entities.filter(e => !e.uri);
    if (withoutURIs.length > 0) {
      appendToReport(`[VERIFY] ⚠️ Missing URIs: ${withoutURIs.map(e => e.name).join(', ')} (cannot sign)\n`);
    }
  }
  
  appendToReport(`[VERIFY] ✅ All ${entities.length} entities valid\n`);
};

