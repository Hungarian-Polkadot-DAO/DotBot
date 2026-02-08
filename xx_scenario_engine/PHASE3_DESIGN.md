# Phase 3: Expression System Design

**Status**: 🔨 Planning
**Priority**: HIGH - Must be robust, stable, and scalable

## 🎯 Design Goals

1. **Backward Compatible**: All existing scenarios continue working unchanged
2. **Type Safe**: Full TypeScript support with proper type checking
3. **Extensible**: Easy to add new operators and checks in the future
4. **Performant**: Fast evaluation even with complex expressions
5. **Readable**: Clear syntax that scenario writers can understand
6. **Comprehensive**: Supports all patterns in commented test code

## 📋 Requirements Analysis

### From `testPrompts.ts` Commented Code

Analyzing 200+ commented test cases reveals these needed patterns:

#### 1. **Existing Fields** (Already Working ✅)
```typescript
responseType: 'execution' | 'text' | 'clarification' | 'error'
expectedAgent: 'AssetTransferAgent'
expectedFunction: 'transfer'
expectedParams: { amount: '0.1', recipient: 'Alice' }
shouldContain: ['balance', 'DOT']
shouldNotContain: ['error', 'failed']
shouldMention: ['Asset Hub']
shouldAskFor: ['amount', 'recipient']
shouldWarn: ['insufficient balance']
shouldReject: true
```

#### 2. **New Fields Needed** (From Commented Code)
```typescript
// Behavioral expectations
shouldMaintainRole: 'DotBot'  // Verify bot doesn't switch roles (jailbreak test)
shouldExplain: ['migration', 'ED concept']  // Verify explanations given

// System behavior
shouldHandle: 'rate limiting'  // How system handles edge cases
expectedBehavior: 'process sequentially'  // Expected system behavior

// Aliases/shortcuts (map to existing fields)
expectedAmount: '5'  // Maps to expectedParams.amount
expectedRecipient: 'Alice'  // Maps to expectedParams.recipient
```

#### 3. **Comparison Operators** (For Numeric/String Values)
```typescript
expectedParams: {
  amount: {
    eq: '5',          // equals
    ne: '0',          // not equals
    gt: '0',          // greater than
    gte: '5',         // greater than or equal
    lt: '100',        // less than
    lte: '10',        // less than or equal
    between: ['5', '10'],  // inclusive range
    matches: /^\d+\.\d{2}$/,  // regex match
  }
}
```

#### 4. **Logical Operators** (Combine Expectations)
```typescript
expectations: [
  {
    all: [  // AND - all must be true
      { responseType: 'execution' },
      { expectedAgent: 'AssetTransferAgent' },
      { expectedFunction: 'transfer' }
    ]
  },
  {
    any: [  // OR - at least one must be true
      { shouldContain: ['insufficient'] },
      { shouldContain: ['not enough'] }
    ]
  },
  {
    not: {  // NOT - must not be true
      shouldContain: ['error']
    }
  }
]
```

#### 5. **Conditional Expectations** (Context-Aware)
```typescript
expectations: [
  {
    when: { contextBalance: { gt: '10' } },
    then: { responseType: 'execution' },
    else: { shouldWarn: ['insufficient balance'] }
  }
]
```

## 🏗️ Architecture Design

### Phase 3A: Core Type System (2 days)

**Goal**: Extend types without breaking existing scenarios

```typescript
// 1. Add comparison operator type
type ComparisonOperator<T> = {
  eq?: T;
  ne?: T;
  gt?: T;
  gte?: T;
  lt?: T;
  lte?: T;
  between?: [T, T];
  matches?: RegExp | string;
  in?: T[];
  notIn?: T[];
};

// 2. Allow param values to be simple OR comparison
type ParamValue = string | number | boolean | ComparisonOperator<string | number>;

// 3. Extend expectedParams
expectedParams?: Record<string, ParamValue>;

// 4. Add logical operators
type LogicalExpectation = {
  all?: ScenarioExpectation[];   // AND
  any?: ScenarioExpectation[];   // OR
  not?: ScenarioExpectation;     // NOT
  when?: ScenarioExpectation;    // IF
  then?: ScenarioExpectation;    // THEN
  else?: ScenarioExpectation;    // ELSE
} & ScenarioExpectation;  // Can also have direct fields

// 5. Update ScenarioExpectation to support both
export type ScenarioExpectation = BasicExpectation | LogicalExpectation;
```

**Backward Compatibility Strategy**:
- Existing flat expectations still work (no `all`/`any`/`not` = flat)
- Comparison operators are opt-in (string values work as before)
- Type guard functions detect which format is used

### Phase 3B: Expression Evaluator (3 days)

**Goal**: Robust evaluation engine with proper error handling

```typescript
class ExpressionEvaluator {
  /**
   * Evaluate a single expectation (may be logical or basic)
   */
  evaluate(expectation: ScenarioExpectation, context: EvaluationContext): ExpectationResult {
    // 1. Detect format (logical vs basic)
    if (this.isLogicalExpectation(expectation)) {
      return this.evaluateLogical(expectation, context);
    }
    return this.evaluateBasic(expectation, context);
  }
  
  /**
   * Evaluate logical operators (AND, OR, NOT, IF/THEN/ELSE)
   */
  private evaluateLogical(exp: LogicalExpectation, ctx: EvaluationContext): ExpectationResult {
    // Handle 'all' (AND)
    if (exp.all) {
      const results = exp.all.map(e => this.evaluate(e, ctx));
      return this.combineAND(results);
    }
    
    // Handle 'any' (OR)
    if (exp.any) {
      const results = exp.any.map(e => this.evaluate(e, ctx));
      return this.combineOR(results);
    }
    
    // Handle 'not' (NOT)
    if (exp.not) {
      const result = this.evaluate(exp.not, ctx);
      return this.negate(result);
    }
    
    // Handle 'when/then/else' (conditional)
    if (exp.when) {
      const condition = this.evaluate(exp.when, ctx);
      if (condition.met) {
        return exp.then ? this.evaluate(exp.then, ctx) : condition;
      } else {
        return exp.else ? this.evaluate(exp.else, ctx) : condition;
      }
    }
    
    // Fallback to basic evaluation (supports mixing logical + basic)
    return this.evaluateBasic(exp, ctx);
  }
  
  /**
   * Evaluate comparison operators
   */
  private evaluateComparison<T>(actual: T, expected: ParamValue): boolean {
    // Simple value (existing behavior - exact match)
    if (typeof expected === 'string' || typeof expected === 'number' || typeof expected === 'boolean') {
      return String(actual) === String(expected);
    }
    
    // Comparison operator
    const comp = expected as ComparisonOperator<T>;
    const actualNum = typeof actual === 'string' ? parseFloat(actual) : Number(actual);
    
    if (comp.eq !== undefined) return String(actual) === String(comp.eq);
    if (comp.ne !== undefined) return String(actual) !== String(comp.ne);
    if (comp.gt !== undefined) return actualNum > Number(comp.gt);
    if (comp.gte !== undefined) return actualNum >= Number(comp.gte);
    if (comp.lt !== undefined) return actualNum < Number(comp.lt);
    if (comp.lte !== undefined) return actualNum <= Number(comp.lte);
    if (comp.between) return actualNum >= Number(comp.between[0]) && actualNum <= Number(comp.between[1]);
    if (comp.matches) {
      const regex = typeof comp.matches === 'string' ? new RegExp(comp.matches) : comp.matches;
      return regex.test(String(actual));
    }
    if (comp.in) return comp.in.some(v => String(actual) === String(v));
    if (comp.notIn) return !comp.notIn.some(v => String(actual) === String(v));
    
    return false;
  }
}
```

**Error Handling**:
- Invalid operator: Clear error message with suggestion
- Type mismatch: Warn if comparing incompatible types
- Circular logic: Detect and prevent infinite loops
- Undefined values: Graceful handling with clear messages

### Phase 3C: Validator & Type Guards (1 day)

**Goal**: Validate expressions at scenario load time, not runtime

```typescript
class ExpressionValidator {
  /**
   * Validate an expectation before execution
   */
  validate(expectation: ScenarioExpectation): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // 1. Check for logical structure issues
    if (this.hasCircularReference(expectation)) {
      errors.push('Circular reference detected in logical operators');
    }
    
    // 2. Check for invalid operators
    if (this.hasInvalidOperators(expectation)) {
      errors.push('Invalid comparison operator detected');
    }
    
    // 3. Check for type mismatches
    const typeMismatches = this.checkTypeMismatches(expectation);
    warnings.push(...typeMismatches);
    
    // 4. Check for deprecated patterns
    const deprecated = this.checkDeprecated(expectation);
    warnings.push(...deprecated);
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
  
  /**
   * Detect circular references in nested logical operators
   */
  private hasCircularReference(exp: ScenarioExpectation, visited = new Set()): boolean {
    // Implementation with cycle detection
    // ...
  }
}
```

### Phase 3D: Migration & Documentation (2 days)

**Goal**: Comprehensive docs and migration guide

1. **API Documentation**
   - All operators with examples
   - Type definitions with comments
   - Common patterns and recipes

2. **Migration Guide**
   - How to convert commented scenarios
   - Before/after examples
   - Breaking changes (none expected!)

3. **Test Coverage**
   - Unit tests for each operator
   - Integration tests with real scenarios
   - Edge case tests

## 📊 Implementation Plan

### Week 1: Foundation

**Day 1-2**: Type System
- [ ] Define `ComparisonOperator<T>` type
- [ ] Define `LogicalExpectation` type  
- [ ] Update `ScenarioExpectation` type
- [ ] Add type guards (`isLogicalExpectation`, `isComparisonOperator`)
- [ ] Write type-level tests

**Day 3-4**: Basic Evaluator
- [ ] Create `ExpressionEvaluator` class
- [ ] Implement comparison operators (eq, ne, gt, gte, lt, lte)
- [ ] Implement range operators (between, in, notIn)
- [ ] Implement regex matching
- [ ] Unit tests for each operator

**Day 5**: Logical Operators
- [ ] Implement `all` (AND) combiner
- [ ] Implement `any` (OR) combiner
- [ ] Implement `not` (NOT) negation
- [ ] Integration tests

### Week 2: Advanced Features

**Day 6-7**: Conditional Logic
- [ ] Implement `when/then/else` evaluation
- [ ] Add context support for conditions
- [ ] Handle nested conditionals
- [ ] Edge case tests

**Day 8**: Validation
- [ ] Create `ExpressionValidator` class
- [ ] Implement circular reference detection
- [ ] Implement type checking
- [ ] Add helpful error messages

**Day 9-10**: Documentation & Migration
- [ ] Write API documentation
- [ ] Create migration guide
- [ ] Convert 20 commented scenarios as examples
- [ ] Write troubleshooting guide

## 🎓 Design Principles

### 1. Progressive Enhancement
```typescript
// Level 0: Simple (existing - still works)
expectedParams: { amount: '0.1' }

// Level 1: Comparison (new - opt-in)
expectedParams: { amount: { gte: '0.1', lte: '10' } }

// Level 2: Logical (new - opt-in)
all: [
  { expectedParams: { amount: { gte: '0.1' } } },
  { expectedFunction: 'transfer' }
]
```

### 2. Fail-Safe Evaluation
- Unknown operators → Warning + skip check (don't fail scenario)
- Type mismatches → Warning + best-effort comparison
- Missing context → Clear error message

### 3. Performance Optimization
- Cache parsed expressions
- Short-circuit evaluation (AND stops on first false, OR stops on first true)
- Lazy evaluation (don't evaluate branches that won't be used)

### 4. Developer Experience
- Clear error messages with suggestions
- Auto-completion in TypeScript
- Runtime validation catches issues early

## ✅ Success Criteria

- [ ] All existing scenarios pass unchanged
- [ ] 100+ commented scenarios converted successfully
- [ ] Type system catches invalid expressions at compile time
- [ ] Validator catches circular references before runtime
- [ ] Performance: <5ms per expectation evaluation
- [ ] Documentation: 20+ examples covering all operators
- [ ] Test coverage: >95% for expression system

## 🚨 Risk Mitigation

### Risk 1: Breaking Changes
**Mitigation**: 
- Keep existing flat format fully supported
- Type guards detect format automatically
- No migration required for existing scenarios

### Risk 2: Complex Expressions Hard to Debug
**Mitigation**:
- Detailed logging of evaluation steps
- Clear error messages with line numbers
- Validator catches issues at load time

### Risk 3: Performance Issues with Deep Nesting
**Mitigation**:
- Limit nesting depth (max 5 levels)
- Short-circuit evaluation
- Cache parsed expressions

### Risk 4: Type System Too Complex
**Mitigation**:
- Helper functions for common patterns
- Template scenarios in docs
- Auto-completion via TypeScript

## 📝 Next Steps

1. Review this design with team
2. Get approval on type system changes
3. Create feature branch: `feat/expression-system`
4. Begin implementation (Week 1, Day 1)

---

**Last Updated**: 2026-02-05
