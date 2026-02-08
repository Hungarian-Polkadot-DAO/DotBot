# ScenarioEngine Scoring System

## Overview

The ScenarioEngine uses a **weighted scoring system** to provide meaningful evaluation of scenarios. The scoring system ensures that critical checks (like function selection) have more impact on the final score than less important checks (like text content).

## Scoring Weights

Each expectation check type is assigned a weight based on its importance:

### Critical (Weight: 3)
- **expectedFunction**: The core action being tested. This is the most important check as it verifies the bot selected the correct function to execute.

### High Importance (Weight: 2)
- **responseType**: Overall category of response (action, clarification, rejection)
- **expectedAgent**: Correct agent selection for multi-agent scenarios
- **expectedParams**: Parameter validation for function calls
- **shouldAskFor**: Verification that bot asks for clarification when needed
- **shouldWarn**: Verification that bot warns about potential issues
- **shouldReject**: Verification that bot rejects inappropriate requests
- **customValidator**: Custom validation logic (considered important as it's explicitly defined)

### Medium Importance (Weight: 1)
- **shouldContain**: Text content validation
- **shouldNotContain**: Text exclusion validation
- **shouldMention**: Topic mention validation

## Score Calculation

The final score is calculated using weighted average:

```
score = (sum of (check_result * weight)) / (sum of weights)
```

Where:
- `check_result` = 100 if passed, 0 if failed
- Each check contributes proportionally to its weight

### Example

Scenario with 3 checks:
- expectedFunction (weight 3): PASS (300 points)
- responseType (weight 2): PASS (200 points)
- shouldContain (weight 1): FAIL (0 points)

Total score = (300 + 200 + 0) / (3 + 2 + 1) = 500 / 6 = **83/100**

Without weighting, this would be 67/100 (2/3 passed), but with weighting the critical checks matter more.

## Score Visibility

The overall scenario score is only shown if there are **3 or more checks** across all expectations. For scenarios with fewer checks:
- Shows `[RESULT] All checks passed` or `[RESULT] Some checks failed`
- This prevents misleading scores from very simple scenarios

For scenarios with 3+ checks:
- Shows `[SCORE] X/100 (N checks)`
- Provides detailed breakdown of each check in the summary

## Benefits

1. **More Meaningful Scores**: Critical functionality errors have more impact than minor text issues
2. **Better Prioritization**: Developers can focus on fixing high-weight check failures first
3. **Realistic Evaluation**: Reflects the actual importance of different aspects being tested
4. **Flexible System**: Weights can be adjusted as the system evolves

## Check Details in Reports

All scenario reports now include a "Check Details" section that lists:
- Each individual check performed
- Pass/fail status (✓/✗)
- Descriptive message for each check

This provides full transparency into how the score was calculated.
