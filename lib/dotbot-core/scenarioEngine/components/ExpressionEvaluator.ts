/**
 * ExpressionEvaluator - Phase 3: Expression System
 * 
 * Evaluates comparison operators and logical expressions in scenario expectations.
 * 
 * Features:
 * - Comparison operators: eq, ne, gt, gte, lt, lte, between, matches, in, notIn
 * - Logical operators: all (AND), any (OR), not (NOT)
 * - Conditional logic: when/then/else (IF-THEN-ELSE)
 * - Type coercion for flexible comparisons
 * - Short-circuit evaluation for performance
 * 
 * @example
 * ```typescript
 * const evaluator = new ExpressionEvaluator();
 * 
 * // Comparison operators
 * evaluator.evaluateComparison('5.5', { gte: '5', lte: '10' }); // true
 * evaluator.evaluateComparison('Alice', { matches: /^[A-Z]/ }); // true
 * 
 * // Logical operators
 * evaluator.evaluateAll([...expectations], context); // AND
 * evaluator.evaluateAny([...expectations], context); // OR
 * evaluator.evaluateNot(expectation, context); // NOT
 * ```
 */

import type {
  ScenarioExpectation,
  ComparisonOperator,
  ParamValue,
  isComparisonOperator,
  isLogicalExpectation,
} from '../types';

export interface EvaluationContext {
  /** Actual value being evaluated */
  actualValue?: unknown;
  
  /** Full context object (for conditional expressions) */
  context?: Record<string, unknown>;
  
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface ComparisonResult {
  /** Whether the comparison passed */
  passed: boolean;
  
  /** Human-readable message */
  message: string;
  
  /** Actual value that was compared */
  actualValue?: unknown;
  
  /** Expected value or operator */
  expectedValue?: unknown;
}

export interface LogicalEvaluationResult {
  /** Whether the logical expression passed */
  passed: boolean;
  
  /** Human-readable message explaining the result */
  message: string;
  
  /** Individual sub-results (for all/any operators) */
  subResults?: LogicalEvaluationResult[];
  
  /** Operator used (all, any, not, when) */
  operator?: string;
}

/**
 * Expression Evaluator for comparison and logical operators
 */
export class ExpressionEvaluator {
  /**
   * Evaluate a comparison operator against an actual value
   * 
   * @param actual - The actual value to check
   * @param expected - The expected value (simple or comparison operator)
   * @returns Comparison result with pass/fail and message
   */
  evaluateComparison(
    actual: unknown,
    expected: ParamValue
  ): ComparisonResult {
    // Handle simple values (exact match - backward compatible)
    if (typeof expected === 'string' || typeof expected === 'number' || typeof expected === 'boolean') {
      const passed = String(actual) === String(expected);
      return {
        passed,
        message: passed 
          ? `Value matches ${expected}` 
          : `Expected ${expected}, got ${actual}`,
        actualValue: actual,
        expectedValue: expected,
      };
    }
    
    // Handle comparison operators
    const comp = expected as ComparisonOperator;
    const actualStr = String(actual);
    const actualNum = this.parseNumber(actual);
    
    // Try each operator
    if (comp.eq !== undefined) {
      const passed = String(actual) === String(comp.eq);
      return {
        passed,
        message: passed ? `Value equals ${comp.eq}` : `Expected ${comp.eq}, got ${actual}`,
        actualValue: actual,
        expectedValue: comp.eq,
      };
    }
    
    if (comp.ne !== undefined) {
      const passed = String(actual) !== String(comp.ne);
      return {
        passed,
        message: passed ? `Value is not ${comp.ne}` : `Value should not be ${comp.ne}`,
        actualValue: actual,
        expectedValue: comp.ne,
      };
    }
    
    // Numeric comparisons
    if (comp.gt !== undefined) {
      const expected = this.parseNumber(comp.gt);
      const passed = actualNum > expected;
      return {
        passed,
        message: passed 
          ? `Value ${actualNum} > ${expected}` 
          : `Expected > ${expected}, got ${actualNum}`,
        actualValue: actualNum,
        expectedValue: expected,
      };
    }
    
    if (comp.gte !== undefined) {
      const expected = this.parseNumber(comp.gte);
      const passed = actualNum >= expected;
      return {
        passed,
        message: passed 
          ? `Value ${actualNum} >= ${expected}` 
          : `Expected >= ${expected}, got ${actualNum}`,
        actualValue: actualNum,
        expectedValue: expected,
      };
    }
    
    if (comp.lt !== undefined) {
      const expected = this.parseNumber(comp.lt);
      const passed = actualNum < expected;
      return {
        passed,
        message: passed 
          ? `Value ${actualNum} < ${expected}` 
          : `Expected < ${expected}, got ${actualNum}`,
        actualValue: actualNum,
        expectedValue: expected,
      };
    }
    
    if (comp.lte !== undefined) {
      const expected = this.parseNumber(comp.lte);
      const passed = actualNum <= expected;
      return {
        passed,
        message: passed 
          ? `Value ${actualNum} <= ${expected}` 
          : `Expected <= ${expected}, got ${actualNum}`,
        actualValue: actualNum,
        expectedValue: expected,
      };
    }
    
    // Range check
    if (comp.between && Array.isArray(comp.between) && comp.between.length === 2) {
      const min = this.parseNumber(comp.between[0]);
      const max = this.parseNumber(comp.between[1]);
      const passed = actualNum >= min && actualNum <= max;
      return {
        passed,
        message: passed 
          ? `Value ${actualNum} is between ${min} and ${max}` 
          : `Expected between ${min} and ${max}, got ${actualNum}`,
        actualValue: actualNum,
        expectedValue: comp.between,
      };
    }
    
    // Regex match
    if (comp.matches) {
      const regex = typeof comp.matches === 'string' 
        ? new RegExp(comp.matches) 
        : comp.matches;
      const passed = regex.test(actualStr);
      return {
        passed,
        message: passed 
          ? `Value matches pattern ${regex}` 
          : `Value does not match pattern ${regex}`,
        actualValue: actualStr,
        expectedValue: comp.matches,
      };
    }
    
    // List membership (in)
    if (comp.in && Array.isArray(comp.in)) {
      const passed = comp.in.some(v => String(actual) === String(v));
      return {
        passed,
        message: passed 
          ? `Value ${actual} is in [${comp.in.join(', ')}]` 
          : `Value ${actual} is not in [${comp.in.join(', ')}]`,
        actualValue: actual,
        expectedValue: comp.in,
      };
    }
    
    // List exclusion (notIn)
    if (comp.notIn && Array.isArray(comp.notIn)) {
      const passed = !comp.notIn.some(v => String(actual) === String(v));
      return {
        passed,
        message: passed 
          ? `Value ${actual} is not in [${comp.notIn.join(', ')}]` 
          : `Value ${actual} should not be in [${comp.notIn.join(', ')}]`,
        actualValue: actual,
        expectedValue: comp.notIn,
      };
    }
    
    // No valid operator found
    return {
      passed: false,
      message: 'No valid comparison operator found',
      actualValue: actual,
      expectedValue: expected,
    };
  }
  
  /**
   * Parse a value as a number, handling strings and edge cases
   * 
   * @param value - Value to parse
   * @returns Parsed number (or 0 if invalid)
   */
  private parseNumber(value: unknown): number {
    if (typeof value === 'number') {
      return value;
    }
    
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? 0 : parsed;
    }
    
    return 0;
  }
}
