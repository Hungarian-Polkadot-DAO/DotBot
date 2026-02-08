/**
 * ExpressionValidator - Validates scenario expectations at load time
 * 
 * Catches issues before runtime:
 * - Circular references in logical operators
 * - Invalid comparison operators
 * - Type mismatches (warnings)
 * - Excessive nesting depth
 * - Deprecated patterns
 */

import {
  ScenarioExpectation,
  isLogicalExpectation,
  isComparisonOperator,
  ComparisonOperator,
  LogicalExpectation,
} from '../types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class ExpressionValidator {
  private readonly MAX_NESTING_DEPTH = 5;
  private readonly VALID_COMPARISON_OPS = [
    'eq', 'ne', 'gt', 'gte', 'lt', 'lte',
    'between', 'matches', 'in', 'notIn'
  ];

  /**
   * Validate an expectation before execution
   */
  validate(expectation: ScenarioExpectation): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for circular references first (can cause stack overflow)
    try {
      if (this.hasCircularReference(expectation)) {
        errors.push(
          'Circular reference detected in logical operators. ' +
          'Ensure logical operators do not reference themselves.'
        );
        // Return early to avoid stack overflow in subsequent checks
        return {
          valid: false,
          errors,
          warnings,
        };
      }
    } catch (error) {
      // If we get a stack overflow or similar error, it's likely a circular reference
      if (error instanceof RangeError) {
        errors.push(
          'Circular reference detected (stack overflow). ' +
          'Ensure logical operators do not reference themselves.'
        );
        return {
          valid: false,
          errors,
          warnings,
        };
      }
      throw error; // Re-throw unexpected errors
    }

    // Check nesting depth
    try {
      const depth = this.calculateNestingDepth(expectation);
      if (depth > this.MAX_NESTING_DEPTH) {
        errors.push(
          `Nesting depth ${depth} exceeds maximum of ${this.MAX_NESTING_DEPTH}. ` +
          `Deep nesting can impact performance and readability.`
        );
      }
    } catch (error) {
      if (error instanceof RangeError) {
        errors.push(
          'Nesting depth check failed (likely circular reference). ' +
          'Ensure logical operators do not reference themselves.'
        );
        return {
          valid: false,
          errors,
          warnings,
        };
      }
      throw error;
    }

    // Validate the expectation structure
    this.validateExpectation(expectation, errors, warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Calculate the maximum nesting depth of an expectation
   */
  private calculateNestingDepth(
    expectation: ScenarioExpectation,
    currentDepth = 0
  ): number {
    if (!isLogicalExpectation(expectation)) {
      return currentDepth;
    }

    let maxDepth = currentDepth;

    if (expectation.all) {
      for (const child of expectation.all) {
        maxDepth = Math.max(
          maxDepth,
          this.calculateNestingDepth(child, currentDepth + 1)
        );
      }
    }

    if (expectation.any) {
      for (const child of expectation.any) {
        maxDepth = Math.max(
          maxDepth,
          this.calculateNestingDepth(child, currentDepth + 1)
        );
      }
    }

    if (expectation.not) {
      maxDepth = Math.max(
        maxDepth,
        this.calculateNestingDepth(expectation.not, currentDepth + 1)
      );
    }

    if (expectation.when) {
      maxDepth = Math.max(
        maxDepth,
        this.calculateNestingDepth(expectation.when, currentDepth + 1)
      );
    }

    if (expectation.then) {
      maxDepth = Math.max(
        maxDepth,
        this.calculateNestingDepth(expectation.then, currentDepth + 1)
      );
    }

    if (expectation.else) {
      maxDepth = Math.max(
        maxDepth,
        this.calculateNestingDepth(expectation.else, currentDepth + 1)
      );
    }

    return maxDepth;
  }

  /**
   * Detect circular references in nested logical operators
   */
  private hasCircularReference(
    expectation: ScenarioExpectation,
    visited = new Set<ScenarioExpectation>()
  ): boolean {
    if (visited.has(expectation)) {
      return true;
    }

    if (!isLogicalExpectation(expectation)) {
      return false;
    }

    visited.add(expectation);

    if (expectation.all) {
      for (const child of expectation.all) {
        if (this.hasCircularReference(child, new Set(visited))) {
          return true;
        }
      }
    }

    if (expectation.any) {
      for (const child of expectation.any) {
        if (this.hasCircularReference(child, new Set(visited))) {
          return true;
        }
      }
    }

    if (expectation.not) {
      if (this.hasCircularReference(expectation.not, new Set(visited))) {
        return true;
      }
    }

    if (expectation.when) {
      if (this.hasCircularReference(expectation.when, new Set(visited))) {
        return true;
      }
    }

    if (expectation.then) {
      if (this.hasCircularReference(expectation.then, new Set(visited))) {
        return true;
      }
    }

    if (expectation.else) {
      if (this.hasCircularReference(expectation.else, new Set(visited))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate expectation structure and add errors/warnings
   */
  private validateExpectation(
    expectation: ScenarioExpectation,
    errors: string[],
    warnings: string[]
  ): void {
    // Validate logical operators
    if (isLogicalExpectation(expectation)) {
      // Check for then without when (must be after type guard)
      if (expectation.then && !expectation.when) {
        errors.push('Conditional "then" requires a "when" condition');
      }
      
      this.validateLogicalExpectation(expectation, errors, warnings);
    }

    // Validate comparison operators in expectedParams
    if (expectation.expectedParams) {
      this.validateExpectedParams(expectation.expectedParams, errors, warnings);
    }

    // Check for deprecated patterns
    this.checkDeprecatedPatterns(expectation, warnings);
  }

  /**
   * Validate logical expectation structure
   */
  private validateLogicalExpectation(
    expectation: LogicalExpectation,
    errors: string[],
    warnings: string[]
  ): void {
    // Check all operator
    if (expectation.all) {
      if (!Array.isArray(expectation.all) || expectation.all.length === 0) {
        errors.push(
          'Logical operator "all" must be a non-empty array of expectations'
        );
      } else {
        expectation.all.forEach((child, idx) => {
          this.validateExpectation(child, errors, warnings);
        });
      }
    }

    // Check any operator
    if (expectation.any) {
      if (!Array.isArray(expectation.any) || expectation.any.length === 0) {
        errors.push(
          'Logical operator "any" must be a non-empty array of expectations'
        );
      } else {
        expectation.any.forEach((child, idx) => {
          this.validateExpectation(child, errors, warnings);
        });
      }
    }

    // Check not operator
    if (expectation.not) {
      this.validateExpectation(expectation.not, errors, warnings);
    }

    // Check conditional operators
    if (expectation.when) {
      if (!expectation.then) {
        errors.push('Conditional "when" requires a "then" branch');
      }
      this.validateExpectation(expectation.when, errors, warnings);
      if (expectation.then) {
        this.validateExpectation(expectation.then, errors, warnings);
      }
      if (expectation.else) {
        this.validateExpectation(expectation.else, errors, warnings);
      }
    } else if (expectation.then) {
      errors.push('Conditional "then" requires a "when" condition');
    }
  }

  /**
   * Validate expectedParams for invalid operators
   */
  private validateExpectedParams(
    params: Record<string, unknown>,
    errors: string[],
    warnings: string[]
  ): void {
    for (const [key, value] of Object.entries(params)) {
      // Check if value is an object (potential comparison operator)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Validate it as a comparison operator
        this.validateComparisonOperator(
          key,
          value as ComparisonOperator,
          errors,
          warnings
        );
      }
    }
  }

  /**
   * Validate a single comparison operator
   */
  private validateComparisonOperator(
    paramName: string,
    operator: ComparisonOperator,
    errors: string[],
    warnings: string[]
  ): void {
    const operatorKeys = Object.keys(operator);

    // Check for invalid operator names
    const invalidOps = operatorKeys.filter(
      op => !this.VALID_COMPARISON_OPS.includes(op)
    );
    if (invalidOps.length > 0) {
      errors.push(
        `Invalid comparison operator(s) in "${paramName}": ${invalidOps.join(', ')}. ` +
        `Valid operators are: ${this.VALID_COMPARISON_OPS.join(', ')}`
      );
    }

    // Validate between operator
    if (operator.between) {
      if (
        !Array.isArray(operator.between) ||
        operator.between.length !== 2
      ) {
        errors.push(
          `"between" operator in "${paramName}" must be an array of [min, max]`
        );
      }
    }

    // Validate in/notIn operators
    if (operator.in && !Array.isArray(operator.in)) {
      errors.push(`"in" operator in "${paramName}" must be an array`);
    }
    if (operator.notIn && !Array.isArray(operator.notIn)) {
      errors.push(`"notIn" operator in "${paramName}" must be an array`);
    }

    // Validate matches operator
    if (operator.matches) {
      if (
        typeof operator.matches !== 'string' &&
        !(operator.matches instanceof RegExp)
      ) {
        errors.push(
          `"matches" operator in "${paramName}" must be a string or RegExp`
        );
      }
    }

    // Warn about type mismatches
    this.checkTypeMismatches(paramName, operator, warnings);
  }

  /**
   * Check for potential type mismatches
   */
  private checkTypeMismatches(
    paramName: string,
    operator: ComparisonOperator,
    warnings: string[]
  ): void {
    // Check numeric operators with string values
    const numericOps = ['gt', 'gte', 'lt', 'lte'] as const;
    for (const op of numericOps) {
      if (op in operator) {
        const value = operator[op];
        if (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value)) {
          warnings.push(
            `Parameter "${paramName}" uses numeric operator "${op}" with non-numeric string. ` +
            `Consider using a number instead.`
          );
        }
      }
    }
  }

  /**
   * Check for deprecated patterns and add warnings
   */
  private checkDeprecatedPatterns(
    expectation: ScenarioExpectation,
    warnings: string[]
  ): void {
    // Currently no deprecated patterns
    // This method is a placeholder for future deprecations
  }
}

/**
 * Factory function to create a validator
 */
export function createExpressionValidator(): ExpressionValidator {
  return new ExpressionValidator();
}
