/**
 * Simulation Diagnostics
 * 
 * Helper functions to diagnose simulation issues
 */

import { isChopsticksAvailable } from './index';

export interface DiagnosticResult {
  success: boolean;
  message: string;
  details?: any;
}

/**
 * Run comprehensive diagnostics on simulation system
 */
export async function runSimulationDiagnostics(): Promise<{
  overall: 'healthy' | 'degraded' | 'failed';
  checks: Record<string, DiagnosticResult>;
}> {
  const checks: Record<string, DiagnosticResult> = {};

  // Check 1: Chopsticks availability
  try {
    const available = await isChopsticksAvailable();
    checks.chopsticks = {
      success: available,
      message: available 
        ? '✓ Chopsticks package is available'
        : '✗ Chopsticks package not found',
      details: { available },
    };
  } catch (error) {
    checks.chopsticks = {
      success: false,
      message: '✗ Error checking Chopsticks availability',
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }

  // Check 2: IndexedDB (used by Chopsticks for caching)
  try {
    const idbAvailable = typeof window !== 'undefined' && 'indexedDB' in window;
    checks.indexedDB = {
      success: idbAvailable,
      message: idbAvailable
        ? '✓ IndexedDB is available'
        : '✗ IndexedDB not available',
      details: { available: idbAvailable },
    };
  } catch (error) {
    checks.indexedDB = {
      success: false,
      message: '✗ Error checking IndexedDB',
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }

  // Check 3: Browser environment
  const isBrowser = typeof window !== 'undefined';
  checks.environment = {
    success: isBrowser,
    message: isBrowser
      ? '✓ Running in browser environment'
      : '✗ Not in browser environment',
    details: { 
      isBrowser,
      userAgent: (isBrowser && typeof navigator !== 'undefined') ? navigator.userAgent : 'N/A',
    },
  };

  // Overall health
  const allPassed = Object.values(checks).every(check => check.success);
  const somePassed = Object.values(checks).some(check => check.success);
  
  const overall = allPassed ? 'healthy' : somePassed ? 'degraded' : 'failed';

  return { overall, checks };
}

/**
 * Print diagnostics to console in a readable format
 */
export async function printSimulationDiagnostics(): Promise<void> {
  console.log('\n=== Simulation System Diagnostics ===\n');
  
  const { overall, checks } = await runSimulationDiagnostics();
  
  // Print each check
  for (const [name, result] of Object.entries(checks)) {
    console.log(`${result.success ? '✓' : '✗'} ${name}:`, result.message);
    if (result.details) {
      console.log('  Details:', result.details);
    }
  }
  
  // Overall status
  console.log('\n=== Overall Status ===');
  const statusEmoji = overall === 'healthy' ? '✓' : overall === 'degraded' ? '⚠️' : '✗';
  console.log(`${statusEmoji} System status: ${overall.toUpperCase()}`);
  
  // Recommendations
  if (overall !== 'healthy') {
    console.log('\n=== Recommendations ===');
    
    if (!checks.chopsticks.success) {
      console.log('• Install Chopsticks: npm install @acala-network/chopsticks-core');
      console.log('  → Without Chopsticks, only basic validation (paymentInfo) is available');
      console.log('  → This means runtime errors might not be caught before signing');
    }
    
    if (!checks.indexedDB.success) {
      console.log('• IndexedDB is not available');
      console.log('  → Chopsticks chain state caching will not work');
      console.log('  → Simulations will be slower');
    }
    
    if (!checks.environment.success) {
      console.log('• Not running in browser environment');
      console.log('  → Some features may not work');
    }
  } else {
    console.log('\n✓ All systems operational - full runtime validation available!');
  }
  
  console.log('\n=====================================\n');
}

/**
 * Quick check - returns true if simulation is fully functional
 */
export async function isSimulationHealthy(): Promise<boolean> {
  const { overall } = await runSimulationDiagnostics();
  return overall === 'healthy';
}

/**
 * Get human-readable status message
 */
export async function getSimulationStatus(): Promise<string> {
  const { overall, checks } = await runSimulationDiagnostics();
  
  if (overall === 'healthy') {
    return 'Simulation system fully operational - Chopsticks runtime validation available';
  } else if (overall === 'degraded') {
    if (!checks.chopsticks.success) {
      return 'Simulation degraded - Using basic validation only (paymentInfo). Install Chopsticks for full validation.';
    }
    return 'Simulation partially operational - Some features may not work';
  } else {
    return 'Simulation system not functional - Critical components missing';
  }
}

// Export for use in console
if (typeof window !== 'undefined') {
  (window as any).simulationDiagnostics = {
    run: printSimulationDiagnostics,
    check: isSimulationHealthy,
    status: getSimulationStatus,
  };
}

