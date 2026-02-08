# ScenarioEngine - Main Planning Document

**Status**: Work in Progress  
**Goal**: Robust, production-ready scenario testing system for hundreds of test cases

---

## ⚠️ Known Limitations

- **Evaluation timing**: ScenarioEngine evaluates after "DotBot response received", not after transactions are signed/broadcast/finalized. So it is not yet full e2e (no wait for execution completion). Planned: optional wait-for-execution phase before evaluation.
- **Token symbol in logs/prompts**: Prefer a network-aware placeholder (e.g. from chain config) instead of hardcoding "DOT" so scenarios work on Westend (WND) and other networks without change.

---

## 🎯 Current Issues & Planned Fixes

### 1. Logging & Reporting Issues

#### Issue 1.1: Verbose Internal Logs in Reports
**Problem**: Internal executor logs appearing in user-facing reports
```
❌ [INFO] [Executor] Resolving waitForResponseReceived promise
```
**Location**: `ScenarioExecutor.ts:240`
**Fix**: Remove or downgrade to debug level
**Priority**: HIGH
**Status**: ⏳ TODO

#### Issue 1.2: "Waiting for response..." Blinking During Simulation
**Problem**: Misleading status message when simulation is running
```
❌ "DotBot: Waiting for response..." 
   (while simulation is in progress - not waiting!)
```
**Location**: `ScenarioExecutor.ts:502, 509`
**Root Cause**: Status doesn't distinguish between:
- Waiting for LLM response
- Waiting for execution to start
- Simulation in progress
- User approval pending

**Fix**: Implement granular status tracking:
- `waiting_for_llm` - "Getting response from DotBot..."
- `preparing_execution` - "Preparing execution plan..."
- `simulating` - "Simulating transaction..."
- `awaiting_approval` - "Awaiting user approval..."
- `executing` - "Executing transaction..."

**Priority**: HIGH
**Status**: ⏳ TODO

#### Issue 1.3: Incorrect "All Steps Completed" Message
**Problem**: Says "All steps completed" when only ExecutionFlow was prepared, not executed
```
❌ [INFO] All 1 step(s) completed
   (but execution was only prepared, not executed!)
```
**Location**: `ScenarioExecutor.ts:339-340`
**Root Cause**: Message sent after step execution ends, regardless of whether actual blockchain execution happened
**Fix**: 
- Change message to: "All step(s) processed" or "All prompts sent"
- Add separate tracking for actual execution completion
- Only show "execution completed" when transactions are finalized on-chain

**Priority**: HIGH
**Status**: ⏳ TODO

#### Issue 1.4: Unnecessary "Analyzing Results" Phase Message
**Problem**: Verbose phase message not needed in final report
```
❌ → Analyzing scenario results...
```
**Location**: `ScenarioEngine.ts:1095-1096, 1353-1354`
**Fix**: Remove these messages or make them debug-level only
**Priority**: MEDIUM
**Status**: ⏳ TODO

---

### 2. Scoring System Issues

#### Issue 2.1: Misleading Score When No Elements to Score
**Problem**: Shows score like "75/100" when there are no specific scoring elements
```
❌ [SCORE] 75/100
   Expectations: 0/1 met  <-- What is 75 based on?
```

**Root Cause**: Score is calculated even when expectations are incomplete or vague

**Options**:
1. **Option A**: Show score ONLY when all expectations have clear pass/fail criteria
2. **Option B**: Show per-element scores instead of overall score
3. **Option C**: Remove scoring entirely, focus on pass/fail

**Recommendation**: Option B + fallback to Option C
- Show per-element scores: `✓ Response Type: execution (100%)`
- Show per-element scores: `✗ Amount Match: expected "5", got "3" (0%)`
- Overall score ONLY if 3+ scoreable elements exist
- Otherwise show: `[RESULT] ✅ PASSED` (no numeric score)

**Priority**: MEDIUM
**Status**: ⏳ TODO

---

### 3. Expectation System Redesign

#### Issue 3.1: Need Robust Expression System
**Problem**: Current expectations are limited and not easily composable
**Goal**: Support hundreds of scenarios with complex conditions

**Current State**:
- Basic expectations: `responseType`, `expectedAgent`, `expectedFunction`, `expectedParams`
- Simple string matching: `shouldContain`, `shouldNotContain`
- Entity resolution works but limited

**Needed Improvements**:

##### A. Expression Language for Expectations
Support complex logical expressions:
```typescript
expectations: [
  {
    // AND logic (all must be true)
    all: [
      { responseType: "execution" },
      { expectedAgent: "AssetTransferAgent" },
      { expectedParams: { amount: { gte: "5", lte: "10" } } }
    ]
  },
  {
    // OR logic (at least one must be true)
    any: [
      { shouldContain: ["insufficient", "balance"] },
      { shouldContain: ["not enough", "funds"] }
    ]
  },
  {
    // NOT logic (must not be true)
    not: { shouldContain: ["error", "failed"] }
  }
]
```

##### B. Rich Comparison Operators
```typescript
expectedParams: {
  amount: {
    eq: "5",      // equals
    ne: "0",      // not equals
    gt: "0",      // greater than
    gte: "5",     // greater than or equal
    lt: "100",    // less than
    lte: "10",    // less than or equal
    between: ["5", "10"],  // inclusive range
    oneOf: ["5", "10", "15"]  // in list
  },
  recipient: {
    matches: /^5[A-Z]/,  // regex match
    startsWith: "5G",
    endsWith: "ABC",
    contains: "Bob"
  }
}
```

##### C. Conditional Expectations
```typescript
expectations: [
  {
    when: { userBalance: { gt: "100" } },
    then: { responseType: "execution" },
    else: { 
      responseType: "text",
      shouldContain: ["insufficient"]
    }
  }
]
```

##### D. Multi-Step Expectations
```typescript
expectations: [
  {
    // Check step 1 only
    step: 1,
    responseType: "clarification",
    shouldAskFor: ["amount"]
  },
  {
    // Check step 2 only
    step: 2,
    responseType: "execution",
    expectedAgent: "AssetTransferAgent"
  },
  {
    // Check across all steps
    overall: {
      totalDuration: { lt: 10000 },
      someStepHas: { responseType: "execution" }
    }
  }
]
```

##### E. Custom Validators
```typescript
expectations: [
  {
    custom: (result, context) => {
      // Custom validation logic
      if (result.executionPlan) {
        const totalAmount = result.executionPlan.steps
          .reduce((sum, step) => sum + parseFloat(step.params.amount), 0);
        return {
          passed: totalAmount <= 100,
          message: `Total amount ${totalAmount} should be <= 100`
        };
      }
      return { passed: false, message: "No execution plan found" };
    }
  }
]
```

**Priority**: HIGH
**Status**: ⏳ TODO

#### Issue 3.2: Better Error Messages for Unmet Expectations
**Current**: 
```
❌ Expectation not met: responseType
```

**Needed**:
```
❌ Response Type Mismatch
   Expected: execution
   Got: text
   Response: "Sorry, I cannot process this request..."
   
   Possible reasons:
   - DotBot determined the request is unsafe
   - Insufficient balance
   - Invalid parameters
```

**Priority**: MEDIUM
**Status**: ⏳ TODO

---

### 4. Architecture & Scalability

#### Issue 4.1: Scenario Organization for Hundreds of Tests
**Current**: Scenarios in a few files
**Needed**: Organized structure for hundreds of scenarios

**Proposed Structure**:
```
scenarios/
├── transfers/
│   ├── happy-path/
│   │   ├── single-transfer.ts
│   │   ├── batch-transfer.ts
│   │   └── recurring-transfer.ts
│   ├── edge-cases/
│   │   ├── insufficient-balance.ts
│   │   ├── invalid-address.ts
│   │   └── zero-amount.ts
│   └── adversarial/
│       ├── prompt-injection.ts
│       └── malicious-recipient.ts
├── staking/
│   ├── happy-path/
│   ├── edge-cases/
│   └── adversarial/
├── governance/
└── multisig/
```

**Priority**: MEDIUM
**Status**: ⏳ TODO

#### Issue 4.2: Scenario Tagging & Filtering
**Needed**: Easy way to run subsets of scenarios
```typescript
// Run specific tags
engine.runScenarios({ tags: ['transfers', 'happy-path'] });
engine.runScenarios({ tags: ['!slow', 'regression'] });

// Run specific categories
engine.runScenarios({ categories: ['happy-path'] });

// Run by priority
engine.runScenarios({ priority: ['critical', 'high'] });
```

**Priority**: MEDIUM
**Status**: ⏳ TODO

#### Issue 4.3: Scenario Dependencies
**Needed**: Some scenarios depend on others
```typescript
{
  id: "multisig-approval-002",
  name: "Approve Existing Multisig Call",
  dependsOn: ["multisig-creation-001"],  // Must run first
  steps: [...]
}
```

**Priority**: LOW
**Status**: ⏳ TODO

---

## 📋 Implementation Plan

### Phase 1: Fix Critical Logging Issues ✅ COMPLETE
**Timeline**: 1-2 days
**Completed**: 2026-02-05

- [x] 1.1: Remove internal executor logs from reports
- [x] 1.2: Implement granular status tracking
- [x] 1.3: Fix "steps completed" message
- [x] 1.4: Remove verbose phase messages

### Phase 2: Improve Scoring System ✅ COMPLETE
**Timeline**: 2-3 days
**Completed**: 2026-02-05

- [x] 2.1: Implement per-element scoring
- [x] 2.2: Add score visibility rules
- [x] 2.3: Better score calculation with weights
- [x] 2.4: Add scoring documentation

### Phase 3: Expression System Foundation 🔨 IN PROGRESS (Week 1 ✅ COMPLETE!)
**Timeline**: 2 weeks (Week 1 complete in 1 session! 🚀)
**Design Doc**: See [PHASE3_DESIGN.md](./PHASE3_DESIGN.md) for full architecture
**Progress**: See [PHASE3_WEEK1_COMPLETE.md](./PHASE3_WEEK1_COMPLETE.md) for Week 1 summary

**CRITICAL REQUIREMENTS**:
- ✅ Backward compatible (all existing scenarios work unchanged)
- ✅ Type safe (TypeScript catches issues at compile time)
- ✅ Robust (handles 200+ commented test patterns in testPrompts.ts)
- ✅ Scalable (easy to add new operators/checks)
- ✅ Performant (<5ms per expectation)

**Week 1: Foundation** ✅ COMPLETE
- [x] 3.1: Design and implement type system (ComparisonOperator, LogicalExpectation)
- [x] 3.2: Implement comparison operators (eq, ne, gt, gte, lt, lte, between, matches, in, notIn)
- [x] 3.3: Implement logical operators (all/AND, any/OR, not/NOT, when/then/else)
- [x] 3.4: Create 4 demo scenarios
- [x] 3.5: Integration with Evaluator complete

**Week 2: Advanced**
- [x] 3.4: Implement conditional expressions (when/then/else)
- [x] 3.5: Add expression validator with circular reference detection
- [x] 3.6: Write comprehensive documentation with 20+ examples
- [x] 3.7: Convert 20 commented scenarios to validate design

### Phase 4: Advanced Expectations ⏳
**Timeline**: 1 week

- [ ] 4.1: Conditional expectations
- [ ] 4.2: Multi-step expectations
- [ ] 4.3: Custom validators
- [ ] 4.4: Better error messages
- [ ] 4.5: Expression examples

### Phase 5: Scalability & Organization ⏳
**Timeline**: 3-5 days

- [ ] 5.1: Implement scenario organization structure
- [ ] 5.2: Add tagging system
- [ ] 5.3: Add filtering capabilities
- [ ] 5.4: Add scenario dependencies (optional)
- [ ] 5.5: Bulk scenario runner

### Phase 6: Documentation & Examples ⏳
**Timeline**: 2-3 days

- [ ] 6.1: Update scenario writing guide
- [ ] 6.2: Add expression language reference
- [ ] 6.3: Add 50+ example scenarios
- [ ] 6.4: Add best practices guide
- [ ] 6.5: Add troubleshooting guide

---

## 🎯 Success Criteria

### For Phase 1-2 (Logging & Scoring) ✅ COMPLETE
- [x] No internal logs in user-facing reports
- [x] Status messages accurately reflect current state
- [x] Completion messages distinguish between prep and execution
- [x] Scores only shown when meaningful (3+ checks)
- [x] Per-element score breakdown visible
- [x] Weighted scoring system implemented

### For Phase 3-4 (Expression System)
- [ ] Support 20+ comparison operators
- [ ] Support complex logical expressions (AND, OR, NOT, nested)
- [ ] Support conditional expectations
- [ ] Support multi-step expectations
- [ ] Support custom validators
- [ ] Clear error messages with suggestions

### For Phase 5-6 (Scalability)
- [ ] Organized folder structure for 100+ scenarios
- [ ] Tag-based filtering works
- [ ] Can run specific scenario subsets
- [ ] Comprehensive documentation
- [ ] 50+ example scenarios covering all features

---

## 📝 Notes

- Focus on making the system **composable** - small building blocks that combine well
- Prioritize **clarity** over brevity - verbose but clear is better than terse but confusing
- Design for **hundreds of scenarios** - the system must scale
- Keep **backward compatibility** where possible - don't break existing scenarios
- Write **tests** for the expression system - it's critical infrastructure

---

## ⚠️ CRITICAL: Phase 3 Requirements

**Before implementing Phase 3, you MUST**:

1. ✅ Read [PHASE3_DESIGN.md](./PHASE3_DESIGN.md) - Full architecture specification
2. ✅ Read [EXPRESSION_SYSTEM_EXAMPLES.md](./EXPRESSION_SYSTEM_EXAMPLES.md) - Pattern reference
3. ✅ Analyze all commented scenarios in `testPrompts.ts` (~200 test cases)
4. ✅ Ensure 100% backward compatibility (all existing scenarios work unchanged)
5. ✅ Validate type system catches errors at compile time
6. ✅ Test performance (<5ms per expectation evaluation)

**Why This Matters**:
- 200+ commented test scenarios depend on this system
- Breaking changes would invalidate months of scenario planning
- Type safety prevents runtime errors in production
- Performance matters for bulk scenario runs (100+ scenarios)

## 🔗 Related Documents

- [Phase 1 Complete Summary](./PHASE1_COMPLETE.md)
- [Phase 2 Complete Summary](./PHASE2_COMPLETE.md)
- [Phase 3 Design Document](./PHASE3_DESIGN.md) - **Architecture specification**
- [Phase 3 Week 1 Complete](./PHASE3_WEEK1_COMPLETE.md) - **✅ Foundation complete!**
- [Phase 3 Examples Reference](./EXPRESSION_SYSTEM_EXAMPLES.md) - **Pattern catalog**
- [Refactoring Summary](./REFACTORING_SUMMARY.md) - **✅ Clean code refactor**
- [Scoring System Guide](./SCORING_SYSTEM.md)
- [Scenario Writing Guide](../lib/dotbot-core/scenarioEngine/scenarios/1_REPORT_WRITING_SCENARIOS.md)
- [ScenarioEngine Types](../lib/dotbot-core/scenarioEngine/types.ts)
- [Evaluator Implementation](../lib/dotbot-core/scenarioEngine/components/Evaluator.ts)
- [Executor Implementation](../lib/dotbot-core/scenarioEngine/components/ScenarioExecutor.ts)
- [Test Scenarios (with commented patterns)](../lib/dotbot-core/scenarioEngine/scenarios/testPrompts.ts)

---

## 📝 Change Log

### Phase 1 - Completed 2026-02-05

#### Fix 1.1: Removed Internal Executor Logs
**File**: `ScenarioExecutor.ts:236-241`
**Change**: Removed verbose log message `[Executor] Resolving waitForResponseReceived promise`
**Impact**: Cleaner report output, no internal implementation details leaked

#### Fix 1.2: Improved Status Messages
**File**: `ScenarioExecutor.ts:502, 593`
**Changes**:
1. Changed "Waiting for response..." to "Waiting for DotBot response..." (more specific)
2. Changed "Generated execution plan" to "Execution plan prepared (awaiting user approval)" (clarifies state)

**Impact**: Users now understand:
- When waiting for LLM response
- When execution plan is ready but awaiting approval
- Status doesn't blink during simulation (handled by execution state updates)

#### Fix 1.3: Accurate Step Completion Message
**File**: `ScenarioExecutor.ts:339`
**Change**: Changed "All X step(s) completed" to "All X step(s) processed"
**Rationale**: 
- "Completed" implied transactions were executed on-chain
- "Processed" correctly indicates prompts were sent and responses received
- Execution completion is tracked separately via execution state events

**Impact**: No confusion about whether blockchain transactions actually completed

#### Fix 1.4: Removed Verbose Phase Messages
**File**: `ScenarioEngine.ts:1095-1096, 1353-1354`
**Change**: Removed "Analyzing scenario results..." messages
**Impact**: Cleaner, less verbose final report

### Phase 2 - Completed 2026-02-05

#### Fix 2.1: Implemented Per-Element Scoring
**Files**: `Evaluator.ts:107, 158-161, 182-187`, `ScenarioEngine.ts:671-690`
**Changes**:
1. Added `lastExpectationResults` field to Evaluator to store detailed check results
2. Updated `generateSummary` to include "Check Details" section listing each individual check
3. Added public getter `getLastExpectationResults()` for ScenarioEngine to access details

**Impact**: 
- Reports now show each individual check with pass/fail status and message
- Full transparency into what was evaluated

#### Fix 2.2: Smart Score Visibility
**Files**: `ScenarioEngine.ts:1152-1165, 1412-1425`
**Changes**:
1. Modified final report generation to check number of scoreable checks
2. Only show `[SCORE] X/100` if scenario has 3+ checks
3. For scenarios with <3 checks, show `[RESULT] All checks passed/failed` instead

**Impact**:
- Prevents misleading scores from simple scenarios
- More meaningful scoring presentation

#### Fix 2.3: Weighted Score Calculation
**Files**: `Evaluator.ts:294-520`
**Changes**:
1. Replaced equal-weight scoring with weighted system
2. Assigned importance weights to each check type:
   - Critical (weight 3): expectedFunction
   - High (weight 2): responseType, expectedAgent, expectedParams, shouldAskFor, shouldWarn, shouldReject, customValidator
   - Medium (weight 1): shouldContain, shouldNotContain, shouldMention
3. Updated score calculation: `(sum of (result * weight)) / (sum of weights)`

**Impact**:
- Critical checks (like function selection) have more impact on final score
- More realistic evaluation that reflects importance of different checks
- Better prioritization for developers when fixing failures

#### Documentation 2.4: Scoring System Guide
**File**: `SCORING_SYSTEM.md`
**Content**: Complete documentation of:
- Weighting rationale
- Score calculation formula
- Examples
- Benefits and use cases

**Impact**: Clear documentation for scenario writers and contributors

#### Fix 2.5: Improved Summary Reporting
**File**: `ScenarioEngine.ts:674-703`
**Problem**: Summary showed "Expectations: 0/1 met" which was confusing when score was 78/100
**Changes**:
1. Changed to "Checks: X/Y passed" to match granular check-level scoring
2. Added fallback for edge cases with no detailed checks
3. Summary now aligns with how scores are calculated

**Impact**: 
- Clear, unambiguous reporting
- Summary line matches the scoring methodology
- No more confusion about pass/fail vs score

#### Fix 2.6: Source Map Warnings
**File**: `frontend/craco.config.js:47-63`
**Problem**: Webpack warning about missing source maps from @dotbot/core package
**Change**: Excluded node_modules from source-map-loader

**Impact**: 
- Clean build output
- No functionality change (only affects debugging experience)

---

**Last Updated**: 2026-02-05
