/**
 * Unit tests for ExpressionEvaluator
 * 
 * Tests comparison operators for scenario expectations.
 * Focus: Core functionality and common edge cases.
 */

import { ExpressionEvaluator } from '../../../../scenarioEngine/components/ExpressionEvaluator';
import type { ComparisonOperator } from '../../../../scenarioEngine/types';

describe('ExpressionEvaluator', () => {
  let evaluator: ExpressionEvaluator;

  beforeEach(() => {
    evaluator = new ExpressionEvaluator();
  });

  describe('Simple Value Matching (Backward Compatibility)', () => {
    it('should match exact string values', () => {
      const result = evaluator.evaluateComparison('5', '5');
      expect(result.passed).toBe(true);
      expect(result.message).toContain('matches');
    });

    it('should match exact number values', () => {
      const result = evaluator.evaluateComparison(5, 5);
      expect(result.passed).toBe(true);
    });

    it('should match exact boolean values', () => {
      const result = evaluator.evaluateComparison(true, true);
      expect(result.passed).toBe(true);
    });

    it('should fail on mismatch', () => {
      const result = evaluator.evaluateComparison('5', '10');
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Expected 10, got 5');
    });
  });

  describe('Equality Operators', () => {
    it('should evaluate eq (equals)', () => {
      expect(evaluator.evaluateComparison('5', { eq: '5' }).passed).toBe(true);
      expect(evaluator.evaluateComparison('5', { eq: '10' }).passed).toBe(false);
    });

    it('should evaluate ne (not equals)', () => {
      expect(evaluator.evaluateComparison('5', { ne: '10' }).passed).toBe(true);
      expect(evaluator.evaluateComparison('5', { ne: '5' }).passed).toBe(false);
    });
  });

  describe('Numeric Comparison Operators', () => {
    it('should evaluate gt (greater than)', () => {
      expect(evaluator.evaluateComparison('10', { gt: '5' }).passed).toBe(true);
      expect(evaluator.evaluateComparison('5', { gt: '10' }).passed).toBe(false);
      expect(evaluator.evaluateComparison('5', { gt: '5' }).passed).toBe(false);
    });

    it('should evaluate gte (greater than or equal)', () => {
      expect(evaluator.evaluateComparison('10', { gte: '5' }).passed).toBe(true);
      expect(evaluator.evaluateComparison('5', { gte: '5' }).passed).toBe(true);
      expect(evaluator.evaluateComparison('3', { gte: '5' }).passed).toBe(false);
    });

    it('should evaluate lt (less than)', () => {
      expect(evaluator.evaluateComparison('5', { lt: '10' }).passed).toBe(true);
      expect(evaluator.evaluateComparison('10', { lt: '5' }).passed).toBe(false);
      expect(evaluator.evaluateComparison('5', { lt: '5' }).passed).toBe(false);
    });

    it('should evaluate lte (less than or equal)', () => {
      expect(evaluator.evaluateComparison('5', { lte: '10' }).passed).toBe(true);
      expect(evaluator.evaluateComparison('5', { lte: '5' }).passed).toBe(true);
      expect(evaluator.evaluateComparison('10', { lte: '5' }).passed).toBe(false);
    });

    it('should handle decimal numbers', () => {
      expect(evaluator.evaluateComparison('5.5', { gte: '5', lte: '10' }).passed).toBe(true);
      expect(evaluator.evaluateComparison('0.01', { gt: '0' }).passed).toBe(true);
    });
  });

  describe('Range Operator', () => {
    it('should evaluate between (inclusive range)', () => {
      expect(evaluator.evaluateComparison('5', { between: ['1', '10'] }).passed).toBe(true);
      expect(evaluator.evaluateComparison('1', { between: ['1', '10'] }).passed).toBe(true);
      expect(evaluator.evaluateComparison('10', { between: ['1', '10'] }).passed).toBe(true);
      expect(evaluator.evaluateComparison('0', { between: ['1', '10'] }).passed).toBe(false);
      expect(evaluator.evaluateComparison('11', { between: ['1', '10'] }).passed).toBe(false);
    });

    it('should handle invalid range format', () => {
      const result = evaluator.evaluateComparison('5', { between: ['1'] as any });
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Invalid range format');
    });
  });

  describe('Pattern Matching', () => {
    it('should evaluate matches with regex', () => {
      const result1 = evaluator.evaluateComparison('Alice', { matches: /^[A-Z]/ });
      expect(result1.passed).toBe(true);

      const result2 = evaluator.evaluateComparison('alice', { matches: /^[A-Z]/ });
      expect(result2.passed).toBe(false);
    });

    it('should evaluate matches with string pattern', () => {
      const result = evaluator.evaluateComparison('test123', { matches: '^test\\d+$' });
      expect(result.passed).toBe(true);
    });

    it('should handle Polkadot address pattern', () => {
      const addressPattern = /^5[A-Za-z0-9]{47}$/;
      const validAddress = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
      const invalidAddress = '1GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

      expect(evaluator.evaluateComparison(validAddress, { matches: addressPattern }).passed).toBe(true);
      expect(evaluator.evaluateComparison(invalidAddress, { matches: addressPattern }).passed).toBe(false);
    });
  });

  describe('List Membership', () => {
    it('should evaluate in (list membership)', () => {
      const tokens = ['DOT', 'WND', 'KSM'];
      expect(evaluator.evaluateComparison('DOT', { in: tokens }).passed).toBe(true);
      expect(evaluator.evaluateComparison('WND', { in: tokens }).passed).toBe(true);
      expect(evaluator.evaluateComparison('USDT', { in: tokens }).passed).toBe(false);
    });

    it('should evaluate notIn (list exclusion)', () => {
      const tokens = ['SPAM', 'SCAM'];
      expect(evaluator.evaluateComparison('DOT', { notIn: tokens }).passed).toBe(true);
      expect(evaluator.evaluateComparison('SPAM', { notIn: tokens }).passed).toBe(false);
    });

    it('should handle invalid list format', () => {
      const result = evaluator.evaluateComparison('value', { in: 'not-array' as any });
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Invalid list format');
    });
  });

  describe('Type Coercion', () => {
    it('should coerce string numbers to numeric comparison', () => {
      expect(evaluator.evaluateComparison('5', { gt: '3' }).passed).toBe(true);
      expect(evaluator.evaluateComparison(5, { gt: '3' }).passed).toBe(true);
      expect(evaluator.evaluateComparison('5', { gt: 3 }).passed).toBe(true);
    });

    it('should handle string comparison for eq/ne', () => {
      expect(evaluator.evaluateComparison('abc', { eq: 'abc' }).passed).toBe(true);
      expect(evaluator.evaluateComparison('abc', { ne: 'xyz' }).passed).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero values', () => {
      expect(evaluator.evaluateComparison('0', { gt: '-1' }).passed).toBe(true);
      expect(evaluator.evaluateComparison('0', { gte: '0' }).passed).toBe(true);
      expect(evaluator.evaluateComparison('0', { lt: '1' }).passed).toBe(true);
    });

    it('should handle negative numbers', () => {
      expect(evaluator.evaluateComparison('-5', { lt: '0' }).passed).toBe(true);
      expect(evaluator.evaluateComparison('-5', { between: ['-10', '-1'] }).passed).toBe(true);
    });

    it('should handle non-numeric strings in numeric comparisons', () => {
      // Should parse as 0 when non-numeric
      const result = evaluator.evaluateComparison('abc', { gt: '0' });
      expect(result.passed).toBe(false); // 'abc' parses to 0, which is not > 0
    });

    it('should return failure for unknown operator', () => {
      const result = evaluator.evaluateComparison('5', {} as ComparisonOperator);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('No valid comparison operator');
    });
  });

  describe('Real-World Use Cases', () => {
    it('should validate transfer amounts in safe range', () => {
      const safeRange = { gte: '0.01', lte: '1000' };
      
      expect(evaluator.evaluateComparison('5.5', safeRange).passed).toBe(true);
      expect(evaluator.evaluateComparison('0.005', safeRange).passed).toBe(false); // Below ED
      expect(evaluator.evaluateComparison('10000', safeRange).passed).toBe(false); // Too large
    });

    it('should validate recipient addresses', () => {
      const addressPattern = { matches: /^5[A-Za-z0-9]{47}$/ };
      const validAddress = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
      
      expect(evaluator.evaluateComparison(validAddress, addressPattern).passed).toBe(true);
    });

    it('should validate token types', () => {
      const validTokens = { in: ['DOT', 'WND', 'KSM'] };
      
      expect(evaluator.evaluateComparison('DOT', validTokens).passed).toBe(true);
      expect(evaluator.evaluateComparison('USDT', validTokens).passed).toBe(false);
    });
  });
});
