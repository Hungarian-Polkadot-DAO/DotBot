/**
 * Unit tests for Chopsticks Ignore Policy
 */

import {
  classifyChopsticksError,
  CHOPSTICKS_IGNORE_ERRORS,
  CHOPSTICKS_FATAL_ERRORS,
  TRUST_LEVELS,
} from '../../../../services/simulation/chopsticksIgnorePolicy';

describe('Chopsticks Ignore Policy', () => {
  describe('classifyChopsticksError()', () => {
    it('should classify fatal errors as blocking', () => {
      const error = 'Call decoding failed';
      const result = classifyChopsticksError(error);

      expect(result.ignore).toBe(false);
      expect(result.classification).toBe('FATAL_ERROR');
      expect(result.severity).toBe('BLOCKING');
    });

    it('should classify paymentInfo wasm unreachable as ignorable', () => {
      const error = 'TransactionPaymentApi_query_info wasm unreachable';
      const result = classifyChopsticksError(error, 'paymentInfo', 'Asset Hub Polkadot');

      expect(result.ignore).toBe(true);
      expect(result.classification).toBe('PAYMENT_INFO_WASM_UNREACHABLE');
      expect(result.severity).toBe('NON_FATAL');
    });

    it('should classify paymentInfo runtime panic as ignorable', () => {
      const error = 'panic during paymentInfo rust_begin_unwind';
      const result = classifyChopsticksError(error, 'paymentInfo', 'Asset Hub Polkadot');

      expect(result.ignore).toBe(true);
      expect(result.classification).toBe('PAYMENT_INFO_RUNTIME_PANIC');
    });

    it('should classify dryRun BadOrigin as ignorable', () => {
      const error = 'BadOrigin InvalidTransaction::Payment';
      const result = classifyChopsticksError(error, 'dryRun');

      expect(result.ignore).toBe(true);
      expect(result.classification).toBe('UNSIGNED_SIMULATION_REJECTED');
    });

    it('should classify weight fee calculation failure as ignorable', () => {
      const error = 'WeightToFee FeeDetails Fee calculation failed';
      const result = classifyChopsticksError(error, 'paymentInfo');

      expect(result.ignore).toBe(true);
      expect(result.classification).toBe('WEIGHT_FEE_CALCULATION_FAILED');
    });

    it('should classify Asset Hub fee hook errors as ignorable', () => {
      const error = 'AssetTxPayment OnChargeTransaction OnChargeAssetTx';
      const result = classifyChopsticksError(error, 'paymentInfo', 'Asset Hub Polkadot');

      expect(result.ignore).toBe(true);
      expect(result.classification).toBe('ASSET_HUB_FEE_HOOK_MISSING_CONTEXT');
    });

    it('should not ignore errors on wrong chain', () => {
      const error = 'TransactionPaymentApi_query_info wasm unreachable';
      const result = classifyChopsticksError(error, 'paymentInfo', 'Polkadot'); // Not Asset Hub

      // Should not match because chain doesn't match
      expect(result.ignore).toBe(false);
    });

    it('should not ignore errors in wrong phase', () => {
      const error = 'TransactionPaymentApi_query_info wasm unreachable';
      const result = classifyChopsticksError(error, 'dryRun'); // Wrong phase

      expect(result.ignore).toBe(false);
    });

    it('should classify unknown errors as blocking', () => {
      const error = 'Some random error that does not match any pattern';
      const result = classifyChopsticksError(error);

      expect(result.ignore).toBe(false);
      expect(result.classification).toBe('UNKNOWN');
      expect(result.severity).toBe('BLOCKING');
    });

    it('should handle Error objects', () => {
      const error = new Error('Call decoding failed');
      const result = classifyChopsticksError(error);

      expect(result.ignore).toBe(false);
      expect(result.classification).toBe('FATAL_ERROR');
    });
  });

  describe('CHOPSTICKS_IGNORE_ERRORS', () => {
    it('should have all ignore rules defined', () => {
      expect(CHOPSTICKS_IGNORE_ERRORS.length).toBeGreaterThan(0);
      
      for (const rule of CHOPSTICKS_IGNORE_ERRORS) {
        expect(rule.id).toBeDefined();
        expect(rule.match.length).toBeGreaterThan(0);
        expect(rule.phase).toBeDefined();
        expect(rule.severity).toBeDefined();
        expect(rule.reason).toBeDefined();
      }
    });
  });

  describe('CHOPSTICKS_FATAL_ERRORS', () => {
    it('should have fatal errors defined', () => {
      expect(CHOPSTICKS_FATAL_ERRORS.length).toBeGreaterThan(0);
      expect(CHOPSTICKS_FATAL_ERRORS).toContain('Call decoding failed');
      expect(CHOPSTICKS_FATAL_ERRORS).toContain('TaggedTransactionQueue_validate_transaction');
    });
  });

  describe('TRUST_LEVELS', () => {
    it('should define trust levels for different phases', () => {
      expect(TRUST_LEVELS.CALL_DECODING).toBe('FULL_TRUST');
      expect(TRUST_LEVELS.METADATA_MATCH).toBe('FULL_TRUST');
      expect(TRUST_LEVELS.PAYMENT_INFO).toBe('NO_TRUST');
      expect(TRUST_LEVELS.DRY_RUN).toBe('PARTIAL_TRUST');
      expect(TRUST_LEVELS.ON_CHAIN).toBe('GROUND_TRUTH');
    });
  });
});

