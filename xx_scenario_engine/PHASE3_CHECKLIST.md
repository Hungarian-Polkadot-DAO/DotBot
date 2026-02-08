# Phase 3 Implementation Checklist

Use this checklist to track Phase 3 implementation progress and ensure nothing is missed.

## 📋 Pre-Implementation (Before Writing Code)

- [ ] Read PHASE3_DESIGN.md completely
- [ ] Read EXPRESSION_SYSTEM_EXAMPLES.md
- [ ] Analyze all commented patterns in testPrompts.ts
- [ ] Create feature branch: `feat/expression-system`
- [ ] Set up test environment

## 🏗️ Week 1: Foundation

### Day 1-2: Type System

- [ ] Define `ComparisonOperator<T>` type in types.ts
- [ ] Define `LogicalExpectation` type in types.ts
- [ ] Update `ScenarioExpectation` to support both formats
- [ ] Add type guard: `isLogicalExpectation()`
- [ ] Add type guard: `isComparisonOperator()`
- [ ] Write JSDoc comments for all new types
- [ ] Test backward compatibility (existing scenarios compile)
- [ ] Test type safety (invalid expressions caught at compile time)

**Verification**:
```bash
# All existing scenarios should compile
npm run type-check

# No type errors in ScenarioEngine, Evaluator, Executor
tsc --noEmit
```

### Day 3-4: Comparison Operators

- [ ] Create `ExpressionEvaluator` class
- [ ] Implement `eq` (equals) operator
- [ ] Implement `ne` (not equals) operator
- [ ] Implement `gt` (greater than) operator
- [ ] Implement `gte` (greater than or equal) operator
- [ ] Implement `lt` (less than) operator
- [ ] Implement `lte` (less than or equal) operator
- [ ] Implement `between` (range) operator
- [ ] Implement `matches` (regex) operator
- [ ] Implement `in` (list membership) operator
- [ ] Implement `notIn` (list exclusion) operator
- [ ] Write unit test for each operator (10 tests minimum)
- [ ] Test edge cases: null, undefined, NaN, Infinity
- [ ] Test type coercion: string "5" vs number 5

**Verification**:
```bash
# Run comparison operator tests
npm test -- --grep "ComparisonOperator"

# All tests should pass
# Coverage should be >95% for ExpressionEvaluator
```

### Day 5: Logical Operators (AND, OR, NOT)

- [ ] Implement `all` (AND) evaluation
- [ ] Implement short-circuit for `all` (stop on first failure)
- [ ] Implement `any` (OR) evaluation
- [ ] Implement short-circuit for `any` (stop on first success)
- [ ] Implement `not` (NOT) evaluation
- [ ] Implement result combination logic
- [ ] Handle empty arrays gracefully
- [ ] Write integration tests (20 tests minimum)
- [ ] Test nested logical operators (3 levels deep)

**Verification**:
```bash
# Run logical operator tests
npm test -- --grep "LogicalOperator"

# Test performance
npm test -- --grep "LogicalOperator.*performance"
# Should complete in <5ms per evaluation
```

## 🚀 Week 2: Advanced Features

### Day 6-7: Conditional Logic (when/then/else)

- [ ] Implement `when` condition evaluation
- [ ] Implement `then` branch execution
- [ ] Implement `else` branch execution
- [ ] Handle missing branches (then or else undefined)
- [ ] Support context-based conditions
- [ ] Test nested conditionals (2 levels max)
- [ ] Write integration tests (15 tests minimum)

**Verification**:
```bash
# Run conditional tests
npm test -- --grep "ConditionalExpectation"

# Test context handling
npm test -- --grep "ConditionalExpectation.*context"
```

### Day 8: Expression Validator ✅ COMPLETE

- [x] Create `ExpressionValidator` class
- [x] Implement circular reference detection
- [x] Implement type mismatch detection
- [x] Implement invalid operator detection
- [x] Implement nesting depth check (max 5 levels)
- [x] Generate helpful error messages
- [x] Generate warnings for deprecated patterns
- [x] Integrate validator into ScenarioEngine.validateScenario()
- [x] Write validator tests (35 tests - exceeded minimum!)

**Verification**:
```bash
# Run validator tests
npm test -- --grep "ExpressionValidator"

# Test circular reference detection
npm test -- --grep "ExpressionValidator.*circular"

# Test error messages are helpful
npm test -- --grep "ExpressionValidator.*error.*message"
```

### Day 9: Integration & Migration

- [ ] Update Evaluator.ts to use ExpressionEvaluator
- [ ] Update ScenarioEngine.ts to use ExpressionValidator
- [ ] Test all existing scenarios still pass
- [ ] Convert 5 commented scenarios from testPrompts.ts
- [ ] Run converted scenarios and verify they pass
- [ ] Performance test: 100 scenarios in <1 second
- [ ] Memory test: No leaks with 1000 evaluations

**Verification**:
```bash
# All existing scenarios pass
npm test -- --grep "Scenario"

# Converted scenarios pass
npm test -- --grep "ConvertedScenario"

# Performance benchmark
npm test -- --grep "performance"
# Should evaluate 100 scenarios in <1s

# Memory test
npm test -- --grep "memory"
# No memory leaks
```

### Day 10: Documentation

- [ ] Write API documentation (types.ts JSDoc)
- [ ] Write migration guide (converting commented scenarios)
- [ ] Write troubleshooting guide (common errors)
- [ ] Add 20+ examples to EXPRESSION_SYSTEM_EXAMPLES.md
- [ ] Update PHASE3_DESIGN.md with any changes
- [ ] Create PHASE3_COMPLETE.md summary
- [ ] Update main README with expression system info

**Verification**:
```bash
# Generate documentation
npm run docs

# Check documentation completeness
# - All public APIs documented
# - All examples compile
# - No broken links
```

## ✅ Final Verification

### Backward Compatibility

- [ ] All existing HAPPY_PATH_TESTS pass
- [ ] All existing EDGE_CASE_TESTS pass
- [ ] No breaking changes to types
- [ ] No breaking changes to API

```bash
# Run full test suite
npm test

# All tests should pass (0 failures)
```

### Type Safety

- [ ] Invalid expressions caught at compile time
- [ ] Type guards work correctly
- [ ] IDE autocomplete works for new types

```bash
# Type check entire project
npm run type-check

# No errors should be reported
```

### Performance

- [ ] Single expectation: <5ms
- [ ] 10 expectations: <50ms
- [ ] 100 expectations: <500ms
- [ ] 1000 expectations: <5s

```bash
# Run performance benchmarks
npm run benchmark

# Check results match targets above
```

### Documentation

- [ ] API docs complete (all types, all operators)
- [ ] Migration guide with 10+ examples
- [ ] Troubleshooting guide with 10+ common issues
- [ ] Examples document with 20+ patterns

### Code Quality

- [ ] ESLint: 0 errors, 0 warnings
- [ ] Test coverage: >95%
- [ ] No TODO comments in production code
- [ ] All console.logs removed (use proper logging)

```bash
# Run linter
npm run lint

# Check coverage
npm run test:coverage
# Should show >95% coverage for expression system
```

## 🎉 Phase 3 Complete!

When all checkboxes are ticked:

1. Create pull request with title: "feat: Expression System for ScenarioEngine"
2. Link to PHASE3_COMPLETE.md in PR description
3. Request code review
4. Address feedback
5. Merge to main
6. Update CHANGELOG.md
7. Celebrate! 🎊

---

**Created**: 2026-02-05
**Status**: Ready for Implementation
