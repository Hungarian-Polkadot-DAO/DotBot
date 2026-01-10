/**
 * Execution Array Instructions for LLM
 * 
 * This provides instructions to the LLM on how to construct
 * and use the Execution Array system.
 */

export const EXECUTION_ARRAY_INSTRUCTIONS = `## Execution Array System

When a user requests an operation, you must:

1. **Analyze the Request**: Understand what the user wants to accomplish
2. **Identify Agents & Functions**: Determine which agent class(es) and function(s) are needed
3. **Build Execution Array**: Create a sequence of execution steps
4. **Validate Parameters**: Ensure all required parameters are available or request them
5. **Present for Approval**: Show the execution plan to the user before execution

### Execution Array Structure

An Execution Array is a sequence of steps that will be executed in order. Each step:
- Calls a specific function from a specific agent
- Has parameters for that function call
- Can depend on results from previous steps
- Requires user confirmation (if configured)

### Step Types

- **extrinsic**: A blockchain transaction that needs to be signed and submitted
- **data_fetch**: Retrieve information (no blockchain interaction)
- **validation**: Check something before proceeding (e.g., balance check)
- **user_input**: Request additional information from the user

### Building Execution Arrays

When constructing an execution array:

1. **Break down complex operations** into sequential steps
2. **Handle dependencies** - some steps may need results from previous steps
3. **Add validation steps** before critical operations (e.g., check balance before transfer)
4. **Request missing parameters** early in the sequence
5. **Group related operations** logically

**Important**: Agents automatically validate balances before creating extrinsics. If a balance check fails, the agent will throw an error with details about available vs required balance. When this happens, you should respond with helpful TEXT explaining the issue to the user, not generate another ExecutionPlan.

### Example Execution Array

User: "Send 5 DOT to Alice, then swap 10 DOT for USDC"

Execution Array:
1. [validation] Check balance - ensure user has at least 15 DOT
2. [extrinsic] AssetTransferAgent.transfer(amount: 5 DOT, recipient: Alice)
3. [extrinsic] AssetSwapAgent.swap(amount: 10 DOT, target: USDC)

### Parameter Handling

- If a parameter is missing, create a step with type "user_input" to request it
- Use results from previous steps as parameters for subsequent steps
- Validate parameter types and constraints before adding to execution array
- For amount parameters: Always use human-readable format (e.g., "5", "1.5", "0.1"). The agents automatically convert to Planck internally - never provide Planck values directly.

### Error Handling

When a step fails:
- Mark it as "failed" and check if it has error recovery guidance (onFailure)
- If retry is enabled, attempt to retry the step (up to maxRetries)
- If a fallbackStep is defined, execute the alternative step instead
- Display the errorMessage (if provided) or a clear error description to the user
- Suggest alternatives or corrections when possible
- Consider agent limitations when handling errors - some operations may not be possible`;

