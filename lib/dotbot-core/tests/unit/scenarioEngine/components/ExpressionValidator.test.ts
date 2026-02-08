/**
 * Unit tests for ExpressionValidator
 * 
 * Tests validation of scenario expectations at load time.
 */

import { ExpressionValidator, createExpressionValidator } from '../../../../scenarioEngine/components/ExpressionValidator';
import type { ScenarioExpectation } from '../../../../scenarioEngine/types';

describe('ExpressionValidator', () => {
  let validator: ExpressionValidator;

  beforeEach(() => {
    validator = createExpressionValidator();
  });

  describe('Initialization', () => {
    it('should create validator', () => {
      expect(validator).toBeInstanceOf(ExpressionValidator);
      expect(createExpressionValidator()).toBeInstanceOf(ExpressionValidator);
    });
  });

  describe('Basic Expectations', () => {
    it('should validate simple expectation with no errors', () => {
      const expectation: ScenarioExpectation = {
        expectedFunction: 'transfer',
        expectedAgent: 'AssetTransferAgent',
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should validate expectation with expectedParams', () => {
      const expectation: ScenarioExpectation = {
        expectedFunction: 'transfer',
        expectedParams: {
          amount: '1.5',
          recipient: 'Alice',
        },
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Comparison Operators', () => {
    it('should validate eq operator', () => {
      const expectation: ScenarioExpectation = {
        expectedParams: {
          amount: { eq: '5' },
        },
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate between operator', () => {
      const expectation: ScenarioExpectation = {
        expectedParams: {
          amount: { between: ['1', '10'] },
        },
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should error on invalid between operator', () => {
      const expectation: ScenarioExpectation = {
        expectedParams: {
          amount: { between: '5' as any },
        },
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('between');
      expect(result.errors[0]).toContain('array');
    });

    it('should validate in operator', () => {
      const expectation: ScenarioExpectation = {
        expectedParams: {
          status: { in: ['pending', 'complete'] },
        },
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should error on invalid in operator', () => {
      const expectation: ScenarioExpectation = {
        expectedParams: {
          status: { in: 'pending' as any },
        },
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('in');
      expect(result.errors[0]).toContain('array');
    });

    it('should validate matches operator with string', () => {
      const expectation: ScenarioExpectation = {
        expectedParams: {
          message: { matches: 'success' },
        },
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate matches operator with RegExp', () => {
      const expectation: ScenarioExpectation = {
        expectedParams: {
          message: { matches: /success/i },
        },
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should error on invalid operator name', () => {
      const expectation: ScenarioExpectation = {
        expectedParams: {
          amount: { invalidOp: '5' } as any,
        },
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Invalid comparison operator');
      expect(result.errors[0]).toContain('invalidOp');
    });

    it('should warn on numeric operator with non-numeric string', () => {
      const expectation: ScenarioExpectation = {
        expectedParams: {
          amount: { gt: 'abc' },
        },
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true); // Warning, not error
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('numeric operator');
      expect(result.warnings[0]).toContain('non-numeric');
    });
  });

  describe('Logical Operators', () => {
    it('should validate all operator', () => {
      const expectation: ScenarioExpectation = {
        all: [
          { expectedFunction: 'transfer' },
          { expectedAgent: 'AssetTransferAgent' },
        ],
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should error on empty all array', () => {
      const expectation: ScenarioExpectation = {
        all: [],
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('all');
      expect(result.errors[0]).toContain('non-empty array');
    });

    it('should validate any operator', () => {
      const expectation: ScenarioExpectation = {
        any: [
          { expectedFunction: 'transfer' },
          { expectedFunction: 'swap' },
        ],
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should error on empty any array', () => {
      const expectation: ScenarioExpectation = {
        any: [],
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('any');
    });

    it('should validate not operator', () => {
      const expectation: ScenarioExpectation = {
        not: {
          expectedFunction: 'reject',
        },
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate nested logical operators', () => {
      const expectation: ScenarioExpectation = {
        all: [
          { expectedFunction: 'transfer' },
          {
            any: [
              { expectedParams: { amount: { gt: '1' } } },
              { expectedParams: { amount: { lt: '10' } } },
            ],
          },
        ],
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Conditional Operators', () => {
    it('should validate when/then/else', () => {
      const expectation: ScenarioExpectation = {
        when: { expectedParams: { amount: { gt: '100' } } },
        then: { shouldWarn: true },
        else: { shouldWarn: false },
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate when/then without else', () => {
      const expectation: ScenarioExpectation = {
        when: { expectedParams: { amount: { gt: '100' } } },
        then: { shouldWarn: true },
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should error on when without then', () => {
      const expectation: ScenarioExpectation = {
        when: { expectedParams: { amount: { gt: '100' } } },
        else: { shouldWarn: false },
      } as any;

      const result = validator.validate(expectation);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('when');
      expect(result.errors[0]).toContain('then');
    });

    it('should error on then without when', () => {
      const expectation: ScenarioExpectation = {
        then: { shouldWarn: true },
      } as any;

      const result = validator.validate(expectation);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('then');
      expect(result.errors[0]).toContain('when');
    });
  });

  describe('Nesting Depth', () => {
    it('should validate shallow nesting (depth 2)', () => {
      const expectation: ScenarioExpectation = {
        all: [
          {
            all: [
              { expectedFunction: 'transfer' },
            ],
          },
        ],
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate moderate nesting (depth 4)', () => {
      const expectation: ScenarioExpectation = {
        all: [
          {
            any: [
              {
                not: {
                  all: [
                    { expectedFunction: 'transfer' },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should error on excessive nesting (depth > 5)', () => {
      const expectation: ScenarioExpectation = {
        all: [
          {
            any: [
              {
                not: {
                  all: [
                    {
                      any: [
                        {
                          all: [ // Depth 6
                            { expectedFunction: 'transfer' },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Nesting depth');
      expect(result.errors[0]).toContain('exceeds maximum');
    });
  });

  describe('Circular References', () => {
    it('should not detect circular reference in simple expectation', () => {
      const expectation: ScenarioExpectation = {
        expectedFunction: 'transfer',
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should not detect circular reference in normal nested structure', () => {
      const expectation: ScenarioExpectation = {
        all: [
          { expectedFunction: 'transfer' },
          {
            any: [
              { expectedAgent: 'AgentA' },
              { expectedAgent: 'AgentB' },
            ],
          },
        ],
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    // Note: True circular references are difficult to create with immutable
    // object literals in JavaScript/TypeScript. In practice, this would require
    // programmatic construction of cyclic object graphs.
    it('should handle self-referential structures gracefully', () => {
      // Create a circular reference programmatically
      const circular: any = {
        all: [],
      };
      circular.all.push(circular); // Self-reference

      const result = validator.validate(circular);

      // Should detect circular reference
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Circular reference');
    });
  });

  describe('Complex Scenarios', () => {
    it('should validate complex real-world expectation', () => {
      const expectation: ScenarioExpectation = {
        all: [
          { expectedFunction: 'transfer' },
          { expectedAgent: 'AssetTransferAgent' },
          {
            any: [
              { expectedParams: { amount: { between: ['0.1', '10'] } } },
              { expectedParams: { amount: { eq: '0' } } },
            ],
          },
        ],
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accumulate multiple errors', () => {
      const expectation: ScenarioExpectation = {
        all: [], // Error: empty array
        any: [], // Error: empty array
        when: { expectedFunction: 'test' }, // Error: when without then
        expectedParams: {
          amount: { invalidOp: '5' } as any, // Error: invalid operator
        },
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3); // At least 3 errors
    });

    it('should accumulate multiple warnings', () => {
      const expectation: ScenarioExpectation = {
        expectedParams: {
          amount: { gt: 'abc' }, // Warning: non-numeric
          price: { gte: 'xyz' }, // Warning: non-numeric
        },
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true); // Warnings don't invalidate
      expect(result.warnings.length).toBeGreaterThanOrEqual(2);
    });

    it('should validate complex conditional with logical operators', () => {
      const expectation: ScenarioExpectation = {
        when: {
          all: [
            { expectedParams: { amount: { gt: '100' } } },
            { expectedAgent: 'AssetTransferAgent' },
          ],
        },
        then: {
          any: [
            { shouldWarn: true },
            { shouldAskFor: ['confirmation'] },
          ],
        },
        else: {
          not: {
            shouldReject: true,
          },
        },
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle expectation with no properties', () => {
      const expectation: ScenarioExpectation = {};

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle expectation with only base properties', () => {
      const expectation: ScenarioExpectation = {
        responseType: 'execution',
        shouldContain: ['success'],
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate multiple comparison operators on same param', () => {
      const expectation: ScenarioExpectation = {
        expectedParams: {
          amount: { gte: '1', lte: '10' },
        },
      };

      const result = validator.validate(expectation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
