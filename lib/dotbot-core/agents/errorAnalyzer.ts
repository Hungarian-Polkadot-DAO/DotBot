/**
 * Error Analysis System
 * 
 * Classifies errors into user errors (don't retry) vs system errors (retry with correction)
 * Provides intelligent error analysis and retry strategies
 */

export type ErrorCategory = 
  | 'USER_ERROR'           // User input issues - don't retry
  | 'CONFIGURATION_ERROR'  // Wrong chain/API - retry with correction
  | 'NETWORK_ERROR'        // Temporary network issues - retry
  | 'UNKNOWN_ERROR';       // Unknown - try once more

export interface ErrorAnalysis {
  category: ErrorCategory;
  shouldRetry: boolean;
  suggestedFix?: string;
  userMessage: string;
  technicalDetails: string;
}

export interface RetryStrategy {
  tryAlternateChain?: boolean;
  tryDifferentEndpoint?: boolean;
  tryKeepAlive?: boolean;
  tryTransferAllowDeath?: boolean;
  adjustParameters?: Record<string, any>;
}

/**
 * Analyze an error and determine if it's user error or system error
 */
export function analyzeError(error: Error | string): ErrorAnalysis {
  const errorMessage = typeof error === 'string' ? error : error.message;
  const errorLower = errorMessage.toLowerCase();

  // ===== USER ERRORS (Don't Retry) =====
  
  // Insufficient balance
  if (
    errorLower.includes('insufficient balance') ||
    errorLower.includes('insufficientbalance') ||
    errorLower.includes('balances.insufficientbalance') ||
    errorLower.includes('funds are too low') ||
    errorLower.includes('balance too low')
  ) {
    return {
      category: 'USER_ERROR',
      shouldRetry: false,
      userMessage: 'Insufficient balance for this transaction including fees',
      technicalDetails: errorMessage,
    };
  }

  // Invalid address
  if (
    errorLower.includes('invalid address') ||
    errorLower.includes('badaddress') ||
    errorLower.includes('address validation') ||
    errorLower.includes('malformed address')
  ) {
    return {
      category: 'USER_ERROR',
      shouldRetry: false,
      userMessage: 'Invalid recipient address provided',
      technicalDetails: errorMessage,
    };
  }

  // Existential deposit
  if (
    errorLower.includes('existential deposit') ||
    errorLower.includes('existentialdeposit') ||
    errorLower.includes('balances.existentialdeposit') ||
    errorLower.includes('below minimum') ||
    errorLower.includes('would be reaped')
  ) {
    return {
      category: 'USER_ERROR',
      shouldRetry: false,
      userMessage: 'Transfer amount would leave account below minimum balance (existential deposit)',
      technicalDetails: errorMessage,
    };
  }

  // Amount validation
  if (
    errorLower.includes('invalid amount') ||
    errorLower.includes('amount too low') ||
    errorLower.includes('amount must be')
  ) {
    return {
      category: 'USER_ERROR',
      shouldRetry: false,
      userMessage: 'Invalid transfer amount',
      technicalDetails: errorMessage,
    };
  }

  // ===== CONFIGURATION ERRORS (Retry with Correction) =====
  
  // Wrong chain / Asset not found
  if (
    errorLower.includes('unknown asset') ||
    errorLower.includes('asset not found') ||
    errorLower.includes('invalid asset') ||
    errorLower.includes('assetnotfound')
  ) {
    return {
      category: 'CONFIGURATION_ERROR',
      shouldRetry: true,
      suggestedFix: 'Try alternate chain',
      userMessage: 'Asset not available on this chain',
      technicalDetails: errorMessage,
    };
  }

  // Call not found / Invalid pallet
  if (
    errorLower.includes('call not found') ||
    errorLower.includes('pallet not found') ||
    errorLower.includes('method not found') ||
    errorLower.includes('unknown call')
  ) {
    return {
      category: 'CONFIGURATION_ERROR',
      shouldRetry: true,
      suggestedFix: 'Try alternate chain or method',
      userMessage: 'Transaction method not available on this chain',
      technicalDetails: errorMessage,
    };
  }

  // WASM unreachable (runtime panic)
  // Also catch InvalidTransaction which often indicates wrong chain
  if (
    errorLower.includes('wasm unreachable') ||
    errorLower.includes('wasm trap') ||
    errorLower.includes('unreachable instruction') ||
    errorLower.includes('invalidtransaction') ||
    (errorLower.includes('invalid') && errorLower.includes('transaction'))
  ) {
    return {
      category: 'CONFIGURATION_ERROR',
      shouldRetry: true,
      suggestedFix: 'Try alternate chain',
      userMessage: 'Runtime validation failed - possibly wrong chain',
      technicalDetails: errorMessage,
    };
  }

  // Module errors (dispatch errors from pallets)
  if (
    errorLower.includes('module error') ||
    errorLower.includes('dispatcherror') ||
    errorLower.includes('dispatch error')
  ) {
    // Some module errors are user errors (e.g., balance issues)
    // Others are configuration errors (wrong chain)
    // For now, treat as configuration error and let retry logic handle it
    return {
      category: 'CONFIGURATION_ERROR',
      shouldRetry: true,
      suggestedFix: 'Check transaction parameters or try alternate chain',
      userMessage: 'Transaction validation failed at runtime',
      technicalDetails: errorMessage,
    };
  }

  // Token errors (balance-related but might be chain-specific)
  if (
    errorLower.includes('tokenerror') ||
    errorLower.includes('token error') ||
    errorLower.includes('funds unavailable') ||
    errorLower.includes('liquidityrestrictions')
  ) {
    return {
      category: 'CONFIGURATION_ERROR',
      shouldRetry: true,
      suggestedFix: 'Try alternate chain',
      userMessage: 'Token/balance error - might need different chain',
      technicalDetails: errorMessage,
    };
  }

  // Provider/Consumer issues (Asset Hub specific)
  if (
    errorLower.includes('noproviders') ||
    errorLower.includes('system.noproviders') ||
    errorLower.includes('no providers') ||
    errorLower.includes('consumers remaining')
  ) {
    return {
      category: 'CONFIGURATION_ERROR',
      shouldRetry: true,
      suggestedFix: 'Try Relay Chain instead',
      userMessage: 'Account state issue on Asset Hub',
      technicalDetails: errorMessage,
    };
  }

  // ===== NETWORK ERRORS (Retry) =====
  
  if (
    errorLower.includes('network') ||
    errorLower.includes('timeout') ||
    errorLower.includes('connection') ||
    errorLower.includes('rpc error') ||
    errorLower.includes('disconnected')
  ) {
    return {
      category: 'NETWORK_ERROR',
      shouldRetry: true,
      suggestedFix: 'Retry same operation',
      userMessage: 'Network connection issue',
      technicalDetails: errorMessage,
    };
  }

  // ===== UNKNOWN ERRORS (Try once more) =====
  
  return {
    category: 'UNKNOWN_ERROR',
    shouldRetry: true,
    suggestedFix: 'Try alternate chain once',
    userMessage: 'Unexpected error occurred',
    technicalDetails: errorMessage,
  };
}

/**
 * Determine retry strategy based on error analysis
 * Analyzes the specific error and suggests targeted fixes
 * Does NOT randomly try combinations - only fixes what the error indicates
 */
export function getRetryStrategy(
  analysis: ErrorAnalysis,
  attemptNumber: number,
  currentChain: 'assetHub' | 'relay',
  _currentKeepAlive: boolean
): RetryStrategy | null {
  if (analysis.category === 'USER_ERROR') {
    return null;
  }

  if (attemptNumber >= 5) {
    return null;
  }

  const strategy: RetryStrategy = {};
  const errorLower = analysis.technicalDetails.toLowerCase();

  // Analyze specific error patterns and suggest targeted fixes
  if (analysis.category === 'CONFIGURATION_ERROR') {
    // WASM unreachable or InvalidTransaction usually means wrong chain
    if (
      errorLower.includes('wasm unreachable') ||
      errorLower.includes('invalidtransaction') ||
      errorLower.includes('taggedtransactionqueue')
    ) {
      strategy.tryAlternateChain = true;
      return strategy;
    }

    // NoProviders on Asset Hub - try Relay Chain
    if (errorLower.includes('noproviders') || errorLower.includes('system.noproviders')) {
      if (currentChain === 'assetHub') {
        strategy.tryAlternateChain = true;
        return strategy;
      }
    }

    // Asset not found - wrong chain
    if (
      errorLower.includes('unknown asset') ||
      errorLower.includes('asset not found') ||
      errorLower.includes('assetnotfound')
    ) {
      strategy.tryAlternateChain = true;
      return strategy;
    }

    // Call not found - wrong chain or wrong method
    if (
      errorLower.includes('call not found') ||
      errorLower.includes('method not found') ||
      errorLower.includes('unknown call')
    ) {
      strategy.tryAlternateChain = true;
      return strategy;
    }

    // If suggested fix mentions alternate chain, try it
    if (analysis.suggestedFix?.includes('alternate chain')) {
      strategy.tryAlternateChain = true;
      return strategy;
    }
  }

  // Network errors: just retry same config
  if (analysis.category === 'NETWORK_ERROR') {
    return {
      tryDifferentEndpoint: false,
    };
  }

  // Unknown errors: try alternate chain once, then stop
  if (analysis.category === 'UNKNOWN_ERROR' && attemptNumber === 1) {
    strategy.tryAlternateChain = true;
    return strategy;
  }

  return null;
}

/**
 * Format error for user display
 */
export function formatErrorForUser(
  analysis: ErrorAnalysis,
  attemptNumber: number,
  maxAttempts = 3
): string {
  let message = analysis.userMessage;

  if (analysis.category !== 'USER_ERROR' && attemptNumber < maxAttempts) {
    message += ` (Attempt ${attemptNumber}/${maxAttempts})`;
  }

  if (analysis.technicalDetails && analysis.technicalDetails !== analysis.userMessage) {
    message += `\n\nTechnical details: ${analysis.technicalDetails}`;
  }

  return message;
}

/**
 * Check if error is related to chain mismatch
 */
export function isChainMismatchError(error: Error | string): boolean {
  const errorMessage = typeof error === 'string' ? error : error.message;
  const errorLower = errorMessage.toLowerCase();

  return (
    errorLower.includes('wasm unreachable') ||
    errorLower.includes('unknown asset') ||
    errorLower.includes('asset not found') ||
    errorLower.includes('noproviders') ||
    errorLower.includes('system.noproviders') ||
    errorLower.includes('call not found') ||
    (errorLower.includes('invalid') && errorLower.includes('transaction'))
  );
}

