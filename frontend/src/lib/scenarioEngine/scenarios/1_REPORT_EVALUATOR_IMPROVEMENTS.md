# Evaluator Improvements

## Problem Statement

The ScenarioEngine's Evaluator was failing to properly evaluate execution-based scenarios because it was only checking text responses, not the actual execution plans created by DotBot.

### Example Failure

**Scenario:** "Send 0.2 WND to Alice"

**Expected:**
- Agent: `AssetTransferAgent`
- Function: `transfer`
- Parameters: `{ amount: "0.2", recipient: "Alice" }`

**What Was Happening:**
- DotBot created the correct execution plan with the right agent, function, and parameters
- The Evaluator only looked at the text response: "I've prepared a transaction flow with 1 step..."
- It did naive string matching: `response.includes("AssetTransferAgent")` → ❌ FAILED
- Result: False negative - the test failed even though DotBot did everything correctly!

## Solution

### 1. Extended `StepResult` Type

Added execution plan data to capture what DotBot actually created:

```typescript
export interface StepResult {
  // ... existing fields ...
  
  /** Execution plan (if DotBot created a plan) */
  executionPlan?: {
    id: string;
    steps: {
      agentClassName: string;      // ✅ The actual agent called
      functionName: string;         // ✅ The actual function called
      parameters: Record<string, any>; // ✅ The actual parameters
      description: string;
      executionType: string;
    }[];
    requiresApproval: boolean;
  };
  
  /** Execution statistics (if plan was executed) */
  executionStats?: {
    executed: boolean;
    success: boolean;
    completed: number;
    failed: number;
  };
}
```

### 2. Updated `ScenarioExecutor`

Modified `executePromptStep()` to capture execution plan data from `ChatResult`:

```typescript
const executionPlan = chatResult?.plan ? {
  id: chatResult.plan.id,
  steps: chatResult.plan.steps.map((s: ExecutionStep) => ({
    agentClassName: s.agentClassName,
    functionName: s.functionName,
    parameters: s.parameters,
    description: s.description,
    executionType: s.executionType,
  })),
  requiresApproval: chatResult.plan.requiresApproval,
} : undefined;
```

### 3. Enhanced `Evaluator` with Execution Checking

Added three new robust checking methods:

#### a) `checkExpectedAgent()`

Checks if the expected agent was called in any execution plan:
- ✅ Exact match: `AssetTransferAgent === AssetTransferAgent`
- ✅ Partial match: `AssetTransferAgent` matches `AssetTransferAgent`
- ✅ Case-insensitive matching
- ✅ Works across multiple execution plans (if conversation has multiple steps)

#### b) `checkExpectedFunction()`

Checks if the expected function was called:
- ✅ Filters by agent if specified
- ✅ Supports partial/fuzzy matching
- ✅ Clear error messages showing what was actually called

#### c) `checkExpectedParams()`

Checks if parameters match (partial matching):
- ✅ Flexible value matching (handles "0.2" vs "0.20")
- ✅ Partial address matching (for entity name → address conversions)
- ✅ Numeric tolerance for floating point comparison
- ✅ Works with entity substitution ("Alice" → address)

### 4. Improved Response Type Detection

Updated `detectResponseType()` to check execution plans first:

```typescript
private detectResponseType(
  response: string, 
  executionPlans?: NonNullable<StepResult['executionPlan']>[]
): string {
  // Check for execution plans first (most reliable)
  if (executionPlans && executionPlans.length > 0) {
    return 'execution';
  }
  // ... fallback to text analysis
}
```

## Key Features

### 1. **Robust Execution Checking**

Instead of:
```typescript
// ❌ OLD: Naive string matching
const met = lastResponse.includes("AssetTransferAgent");
```

Now:
```typescript
// ✅ NEW: Check actual execution plan structure
const agentCheckResult = this.checkExpectedAgent(
  expectedAgent, 
  allExecutionPlans
);
```

### 2. **Multi-Scenario Support**

The evaluator handles:
- ✅ **Single-step scenarios:** One prompt → one execution plan
- ✅ **Multi-step scenarios:** Multiple prompts → multiple execution plans
- ✅ **Multiple execution items:** One plan with multiple steps (batch transactions)
- ✅ **Mixed scenarios:** Some steps create executions, others are text responses

### 3. **Flexible Parameter Matching**

Handles real-world variations:
- `"Alice"` matches address `5GrwvaEF...` (after entity substitution)
- `"0.2"` matches `"0.20"` or `0.2` (numeric comparison)
- Partial matching for long strings (addresses, hashes)

### 4. **Better Error Messages**

Before:
```
❌ Agent AssetTransferAgent was not detected
```

After:
```
✅ Agent AssetTransferAgent was called
✓ expectedAgent: Agent AssetTransferAgent was called
✓ expectedFunction: Function transfer was called on AssetTransferAgent
✓ expectedParams: All expected parameters matched: amount=0.2, recipient=5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
```

## Usage Example

### Test Scenario Definition

```typescript
{
  id: "happy-path-001",
  name: "Small Transfer to Alice (Should Pass)",
  steps: [
    {
      id: "step-1",
      type: "prompt",
      input: "Send 0.2 WND to Alice"
    }
  ],
  expectations: [
    {
      responseType: "execution",
      expectedAgent: "AssetTransferAgent",
      expectedFunction: "transfer",
      expectedParams: { 
        amount: "0.2", 
        recipient: "Alice" 
      }
    }
  ]
}
```

### What Gets Evaluated

1. **Response Type Check:** 
   - Looks at `stepResult.executionPlan` (not just text)
   - ✅ Correctly identifies as "execution"

2. **Agent Check:**
   - Searches through `executionPlan.steps[].agentClassName`
   - ✅ Finds "AssetTransferAgent"

3. **Function Check:**
   - Searches for `functionName` on steps from "AssetTransferAgent"
   - ✅ Finds "transfer"

4. **Parameter Check:**
   - Compares `expectedParams` against `parameters` in matching steps
   - ✅ Finds `amount: "0.2"` (normalized)
   - ✅ Finds `recipient: "5GrwvaEF..."` (matches "Alice" via address conversion)

### Result

```
✅ PASSED (Score: 100/100)
All 4 checks passed:
  ✓ responseType: Response type is execution
  ✓ expectedAgent: Agent AssetTransferAgent was called
  ✓ expectedFunction: Function transfer was called on AssetTransferAgent
  ✓ expectedParams: All expected parameters matched: amount=0.2, recipient=5GrwvaEF...
```

## Benefits

### 1. **Accurate Evaluation**

- No more false negatives from text matching
- Tests actual LLM behavior (what agent/function it chose)
- Validates parameters correctly

### 2. **Flexible & Generic**

Works with:
- Simple single-step scenarios
- Complex multi-step conversations
- Batch operations (multiple execution items)
- Mixed text/execution responses

### 3. **Better Debugging**

- Clear indication of what passed/failed
- Shows actual vs expected values
- Helps identify LLM issues vs test issues

### 4. **Future-Proof**

- Can handle new agents/functions automatically
- Extensible parameter matching
- Supports complex scenarios (multisig, governance, etc.)

## Migration Notes

### Existing Tests

Old tests that only checked text responses still work:

```typescript
{
  expectations: [
    {
      responseType: "text",
      shouldContain: ["insufficient", "balance"]
    }
  ]
}
```

### New Tests

Can now properly validate execution plans:

```typescript
{
  expectations: [
    {
      responseType: "execution",
      expectedAgent: "StakingAgent",
      expectedFunction: "nominate",
      expectedParams: {
        validators: ["validator1", "validator2"],
        amount: "100"
      }
    }
  ]
}
```

## Next Steps

### Recommended Improvements

1. **Add Execution Outcome Checking**
   - Check if execution succeeded/failed
   - Validate block hash, transaction hash
   - Check on-chain events

2. **Enhanced Parameter Validation**
   - Support regex patterns for parameters
   - Validate parameter types (not just values)
   - Deep object comparison for complex parameters

3. **Timing Assertions**
   - Check execution duration
   - Validate response time
   - Ensure no timeouts

4. **State Change Validation**
   - Query balances before/after
   - Verify on-chain state changes
   - Check event emissions

## Summary

The Evaluator now **actually checks what matters**: the execution plans, agents, functions, and parameters that DotBot creates. This enables accurate, reliable testing of DotBot's core intelligence - understanding user intent and generating correct blockchain operations.

No more false failures! 🎉

