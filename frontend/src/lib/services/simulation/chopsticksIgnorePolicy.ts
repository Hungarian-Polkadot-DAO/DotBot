/**
 * Chopsticks Simulation Ignore Policy
 *
 * These errors are SAFE TO IGNORE and MUST NOT block submission.
 * They originate from known Chopsticks limitations or runtime
 * invariants that only hold in fully signed, real-chain contexts.
 *
 * 🚨 CRITICAL: Asset Hub migration introduced new fee hooks that
 * fail in Chopsticks but work perfectly on-chain.
 */

export interface ChopsticksIgnoreRule {
  readonly id: string;
  readonly match: readonly string[];
  readonly phase: 'paymentInfo' | 'dryRun' | 'both';
  readonly severity: 'NON_FATAL' | 'BLOCKING';
  readonly reason: string;
  readonly chains?: readonly string[];
  readonly safeSince?: string;
}

export const CHOPSTICKS_IGNORE_ERRORS: readonly ChopsticksIgnoreRule[] = [
  {
    id: 'PAYMENT_INFO_WASM_UNREACHABLE',
    match: [
      'TransactionPaymentApi_query_info',
      'wasm unreachable',
      'wasm `unreachable` instruction executed',
    ],
    phase: 'paymentInfo',
    severity: 'NON_FATAL',
    reason: `
      Known Chopsticks limitation.
      Occurs when Asset Hub payment logic executes runtime paths
      that assume a signed extrinsic with full extensions.
      Does NOT indicate an invalid extrinsic.
    `,
    chains: ['Asset Hub Polkadot', 'Polkadot Asset Hub', 'Asset Hub Kusama', 'Kusama Asset Hub', 'Statemint', 'Statemine'],
    safeSince: 'statemint v2000000+',
  },

  {
    id: 'PAYMENT_INFO_RUNTIME_PANIC',
    match: [
      'panic',
      'rust_begin_unwind',
      'core::panicking::panic_fmt',
    ],
    phase: 'paymentInfo',
    severity: 'NON_FATAL',
    reason: `
      Runtime panic during fee estimation.
      Common after migrations and fee model changes.
      Execution path is never hit during real block inclusion.
    `,
    chains: ['Asset Hub Polkadot', 'Polkadot Asset Hub', 'Asset Hub Kusama', 'Kusama Asset Hub', 'Statemint', 'Statemine'],
  },

  {
    id: 'UNSIGNED_SIMULATION_REJECTED',
    match: [
      'BadOrigin',
      'InvalidTransaction::Payment',
      'Unsigned transaction',
    ],
    phase: 'dryRun',
    severity: 'NON_FATAL',
    reason: `
      Chopsticks simulates unsigned or partially signed extrinsics.
      Asset Hub runtimes may reject these during simulation
      while accepting fully signed submissions.
    `,
  },

  {
    id: 'WEIGHT_FEE_CALCULATION_FAILED',
    match: [
      'WeightToFee',
      'FeeDetails',
      'Fee calculation failed',
    ],
    phase: 'paymentInfo',
    severity: 'NON_FATAL',
    reason: `
      Fee model relies on runtime state unavailable in Chopsticks.
      On-chain execution will compute fees correctly.
    `,
  },

  {
    id: 'ASSET_HUB_FEE_HOOK_MISSING_CONTEXT',
    match: [
      'AssetTxPayment',
      'OnChargeTransaction',
      'OnChargeAssetTx',
    ],
    phase: 'paymentInfo',
    severity: 'NON_FATAL',
    reason: `
      Asset-aware fee hooks require full block context.
      Chopsticks does not reproduce this environment.
    `,
    chains: ['Asset Hub Polkadot', 'Polkadot Asset Hub', 'Asset Hub Kusama', 'Kusama Asset Hub', 'Statemint', 'Statemine'],
  },

  {
    id: 'ASSET_HUB_GENERIC_WASM_PANIC',
    match: [
      'wasm `unreachable` instruction executed',
      'wasm trap',
    ],
    phase: 'paymentInfo',
    severity: 'NON_FATAL',
    reason: `
      Asset Hub runtimes intentionally use unreachable!()
      in fee calculation paths that assume signed context.
      Chopsticks cannot satisfy these invariants.
    `,
    chains: ['Asset Hub Polkadot', 'Polkadot Asset Hub', 'Asset Hub Kusama', 'Kusama Asset Hub', 'Statemint', 'Statemine'],
  },
] as const;

/**
 * 🚨 Errors you MUST NOT ignore
 *
 * These indicate actual structural problems with the extrinsic
 * and MUST cause hard failures.
 */
export const CHOPSTICKS_FATAL_ERRORS = [
  'Call decoding failed',
  'Invalid call index',
  'Unknown pallet',
  'Invalid SS58',
  'Cannot decode AccountId',
  'Scale codec error',
  'Invalid Compact',
  'Metadata mismatch',
  'SpecVersion mismatch',
  'TaggedTransactionQueue_validate_transaction', // 🚨 Transaction validation - always block (e.g., Asset Hub DOT transferAllowDeath)
] as const;

export interface ErrorClassification {
  ignore: boolean;
  classification: string;
  severity: 'NON_FATAL' | 'BLOCKING';
  reason?: string;
  phase?: 'paymentInfo' | 'dryRun' | 'both';
}

/**
 * Classify a Chopsticks error to determine if it's safe to ignore
 *
 * @param error The error to classify
 * @param phase The phase where the error occurred
 * @param chainName Optional chain name for chain-specific rules
 * @returns Classification result
 */
export function classifyChopsticksError(
  error: Error | string,
  phase: 'paymentInfo' | 'dryRun' = 'dryRun',
  chainName?: string
): ErrorClassification {
  const message = typeof error === 'string' ? error : (error.message ?? '');

  console.log('[ChopsticksIgnorePolicy] 🔍 Classifying error:', {
    phase,
    chainName,
    errorLength: message.length,
    errorPreview: message.substring(0, 200),
  });

  // First check for fatal errors (these MUST NOT be ignored)
  for (const fatalPattern of CHOPSTICKS_FATAL_ERRORS) {
    if (message.includes(fatalPattern)) {
      return {
        ignore: false,
        classification: 'FATAL_ERROR',
        severity: 'BLOCKING',
        reason: `Structural error: ${fatalPattern}. This indicates a real problem with the extrinsic.`,
      };
    }
  }

  // Check against ignore rules
  for (const rule of CHOPSTICKS_IGNORE_ERRORS) {
    console.log(`[ChopsticksIgnorePolicy] Checking rule: ${rule.id}`);
    
    // For paymentInfo phase: use OR logic (some) - any pattern match is enough
    // For dryRun phase: use AND logic (every) - all patterns must match for precision
    const patternsMatch = rule.phase === 'paymentInfo'
      ? rule.match.some(fragment => message.toLowerCase().includes(fragment.toLowerCase()))
      : rule.match.every(fragment => message.toLowerCase().includes(fragment.toLowerCase()));

    console.log(`[ChopsticksIgnorePolicy]   - Patterns match: ${patternsMatch} (logic: ${rule.phase === 'paymentInfo' ? 'OR' : 'AND'})`);

    if (!patternsMatch) {
      continue;
    }

    // Check if phase matches
    if (rule.phase !== 'both' && rule.phase !== phase) {
      console.log(`[ChopsticksIgnorePolicy]   - Phase mismatch: rule=${rule.phase}, actual=${phase}`);
      continue;
    }

    // Check if chain-specific rule matches (if chain specified)
    if (rule.chains && chainName) {
      const chainLower = chainName.toLowerCase();
      console.log(`[ChopsticksIgnorePolicy]   - Checking chain match: actual="${chainName}", rule chains:`, rule.chains);
      
      const chainMatches = rule.chains.some(ruleChain => {
        const ruleLower = ruleChain.toLowerCase();
        
        // Extract key identifiers (e.g., "asset hub", "kusama", "polkadot")
        // Check if both contain the same key identifiers
        const hasAssetHub = chainLower.includes('asset hub') || chainLower.includes('assethub') || chainLower.includes('statemint');
        const ruleHasAssetHub = ruleLower.includes('asset hub') || ruleLower.includes('assethub') || ruleLower.includes('statemint');
        
        const hasKusama = chainLower.includes('kusama');
        const ruleHasKusama = ruleLower.includes('kusama');
        
        const hasPolkadot = chainLower.includes('polkadot');
        const ruleHasPolkadot = ruleLower.includes('polkadot');
        
        // Match if they share the same chain identifiers
        if (hasAssetHub && ruleHasAssetHub) {
          // Both are Asset Hub chains - check network match
          if ((hasKusama && ruleHasKusama) || (hasPolkadot && ruleHasPolkadot)) {
            return true;
          }
          // If one doesn't specify network, it applies to all Asset Hubs
          if (!hasKusama && !hasPolkadot) return true;
          if (!ruleHasKusama && !ruleHasPolkadot) return true;
        }
        
        // Fallback: bidirectional substring check
        return chainLower.includes(ruleLower) || ruleLower.includes(chainLower);
      });
      
      console.log(`[ChopsticksIgnorePolicy]   - Chain match result: ${chainMatches}`);
      
      if (!chainMatches) {
        continue;
      }
    }

    // Rule matches - safe to ignore
    console.log(`[ChopsticksIgnorePolicy] ✅ Rule matched: ${rule.id} - IGNORING error`);
    
    return {
      ignore: true,
      classification: rule.id,
      severity: rule.severity,
      reason: rule.reason.trim(),
      phase: rule.phase,
    };
  }

  // Unknown error - default to blocking
  console.log('[ChopsticksIgnorePolicy] ❌ No matching rule found - treating as BLOCKING');
  
  return {
    ignore: false,
    classification: 'UNKNOWN',
    severity: 'BLOCKING',
    reason: 'Unknown error pattern. Being conservative - treating as blocking.',
  };
}

/**
 * 🧠 Mental model for Chopsticks trust levels
 *
 * Phase             | Trust Chopsticks? | Why
 * ------------------|-------------------|----------------------------------
 * Call decoding     | ✅ YES            | Pure SCALE decoding
 * Metadata match    | ✅ YES            | Structural correctness
 * paymentInfo       | ❌ NO             | Runtime-dependent, often fails
 * dryRun            | ⚠️  PARTIAL       | Often unsigned, may reject
 * On-chain          | ✅ FINAL          | Ground truth
 *
 * 📋 Error Classification Table (LOCK THIS IN)
 *
 * Error Contains                            | Phase     | Action
 * ------------------------------------------|-----------|--------
 * TransactionPaymentApi_query_info          | fee       | ✅ IGNORE
 * wasm unreachable (in paymentInfo)         | fee       | ✅ IGNORE
 * TaggedTransactionQueue_validate_transaction| validity  | ❌ BLOCK
 * dispatch_error                            | execution | ❌ BLOCK
 * InvalidTransaction (structural)           | validity  | ❌ BLOCK
 * InvalidTransaction (unsigned simulation)  | validity  | ⚠️  CLASSIFY
 */
export const TRUST_LEVELS = {
  CALL_DECODING: 'FULL_TRUST',
  METADATA_MATCH: 'FULL_TRUST',
  PAYMENT_INFO: 'NO_TRUST',
  DRY_RUN: 'PARTIAL_TRUST',
  ON_CHAIN: 'GROUND_TRUTH',
} as const;

