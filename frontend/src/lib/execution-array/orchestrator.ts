/**
 * Execution Orchestrator
 * 
 * Automatically converts LLM plans (ExecutionStep[]) into agent calls.
 * This eliminates manual wiring in the frontend.
 * 
 * Flow:
 * 1. LLM creates ExecutionStep[] (JSON plan with agentClassName, functionName, parameters)
 * 2. Orchestrator reads each ExecutionStep
 * 3. Orchestrator calls the appropriate agent function
 * 4. Agent returns AgentResult (with extrinsic already created)
 * 5. Orchestrator adds AgentResult to ExecutionArray
 * 6. ExecutionArray is ready for Executioner
 * 
 * This makes the library turnkey: Frontend just passes LLM output to Orchestrator!
 */

import { ApiPromise } from '@polkadot/api';
import { ExecutionStep, ExecutionArray as ExecutionArrayPlan } from '../prompts/system/execution/types';
import { ExecutionArray } from './execution-array';
import { AgentResult, AgentError } from '../agents/types';
import { createAgent, getAgentByClassName } from '../agents';
import { BaseAgent } from '../agents/base-agent';

/**
 * Result of orchestration
 */
export interface OrchestrationResult {
  /** Populated ExecutionArray ready for execution */
  executionArray: ExecutionArray;
  
  /** Whether all steps were successfully prepared */
  success: boolean;
  
  /** Any errors encountered */
  errors: Array<{
    stepId: string;
    error: string;
    step: ExecutionStep;
  }>;
  
  /** Metadata */
  metadata: {
    totalSteps: number;
    successfulSteps: number;
    failedSteps: number;
    duration: number;
  };
}

/**
 * Orchestration options
 */
export interface OrchestrationOptions {
  /** Stop on first error (default: false) */
  stopOnError?: boolean;
  
  /** Validate all steps before executing (default: true) */
  validateFirst?: boolean;
  
  /** Progress callback (step being prepared) */
  onProgress?: (step: ExecutionStep, index: number, total: number) => void;
  
  /** Success callback (agent returned result) */
  onStepCompleted?: (step: ExecutionStep, result: AgentResult) => void;
  
  /** Error callback */
  onError?: (step: ExecutionStep, error: Error) => void;
}

/**
 * Execution Orchestrator
 * 
 * Automatically converts LLM execution plans into executable operations.
 * Frontend just needs to pass LLM output - no manual agent calling!
 */
export class ExecutionOrchestrator {
  private api: ApiPromise | null = null;
  private agentInstances: Map<string, BaseAgent> = new Map();
  
  /**
   * Initialize with Polkadot API
   */
  initialize(api: ApiPromise): void {
    this.api = api;
  }
  
  /**
   * Orchestrate execution plan from LLM
   * 
   * Takes LLM output (ExecutionArrayPlan) and automatically:
   * 1. Calls appropriate agents
   * 2. Gets AgentResults (with extrinsics)
   * 3. Populates ExecutionArray
   * 4. Returns ready-to-execute array
   * 
   * @param plan ExecutionArrayPlan from LLM
   * @param options Orchestration options
   * @returns OrchestrationResult with populated ExecutionArray
   */
  async orchestrate(
    plan: ExecutionArrayPlan,
    options: OrchestrationOptions = {}
  ): Promise<OrchestrationResult> {
    this.ensureInitialized();
    
    const {
      stopOnError = false,
      validateFirst = true,
      onProgress,
      onStepCompleted,
      onError,
    } = options;
    
    const startTime = Date.now();
    const executionArray = new ExecutionArray();
    const errors: Array<{ stepId: string; error: string; step: ExecutionStep }> = [];
    
    // Validate all steps first
    if (validateFirst) {
      const validationErrors = this.validateSteps(plan.steps);
      if (validationErrors.length > 0) {
        errors.push(...validationErrors);
        if (stopOnError) {
          return {
            executionArray,
            success: false,
            errors,
            metadata: {
              totalSteps: plan.steps.length,
              successfulSteps: 0,
              failedSteps: errors.length,
              duration: Date.now() - startTime,
            },
          };
        }
      }
    }
    
    // Process each step
    let successfulSteps = 0;
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      
      // Notify progress
      if (onProgress) {
        onProgress(step, i, plan.steps.length);
      }
      
      try {
        // Call agent to get extrinsic
        const agentResult = await this.executeStep(step);
        
        // Add to execution array
        executionArray.add(agentResult);
        successfulSteps++;
        
        // Notify success
        if (onStepCompleted) {
          onStepCompleted(step, agentResult);
        }
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({
          stepId: step.id,
          error: errorMessage,
          step,
        });
        
        // Notify error
        if (onError && error instanceof Error) {
          onError(step, error);
        }
        
        // Stop if requested
        if (stopOnError) {
          break;
        }
      }
    }
    
    return {
      executionArray,
      success: errors.length === 0,
      errors,
      metadata: {
        totalSteps: plan.steps.length,
        successfulSteps,
        failedSteps: errors.length,
        duration: Date.now() - startTime,
      },
    };
  }
  
  /**
   * Execute a single ExecutionStep by calling the agent
   * 
   * This is where ExecutionStep becomes AgentResult:
   * 1. Find agent class (e.g., "AssetTransferAgent")
   * 2. Get/create agent instance
   * 3. Call agent function (e.g., agent.transfer(parameters))
   * 4. Agent creates extrinsic and returns AgentResult
   * 
   * @param step ExecutionStep from LLM
   * @returns AgentResult from agent (with extrinsic)
   */
  async executeStep(step: ExecutionStep): Promise<AgentResult> {
    this.ensureInitialized();
    
    // Get or create agent instance
    const agent = this.getAgentInstance(step.agentClassName);
    
    // Validate function exists
    if (typeof (agent as any)[step.functionName] !== 'function') {
      throw new AgentError(
        `Function '${step.functionName}' not found on agent '${step.agentClassName}'`,
        'FUNCTION_NOT_FOUND',
        { agentClassName: step.agentClassName, functionName: step.functionName }
      );
    }
    
    // Call the agent function
    // Agent will create the extrinsic and return AgentResult
    try {
      const result = await (agent as any)[step.functionName](step.parameters);
      
      // Validate result
      if (!this.isValidAgentResult(result)) {
        throw new AgentError(
          `Agent function '${step.agentClassName}.${step.functionName}' did not return a valid AgentResult`,
          'INVALID_AGENT_RESULT',
          { result }
        );
      }
      
      return result;
      
    } catch (error) {
      // Re-throw AgentErrors
      if (error instanceof AgentError) {
        throw error;
      }
      
      // Wrap other errors
      throw new AgentError(
        `Error calling ${step.agentClassName}.${step.functionName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'AGENT_CALL_ERROR',
        {
          agentClassName: step.agentClassName,
          functionName: step.functionName,
          parameters: step.parameters,
          originalError: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }
  
  /**
   * Validate steps before execution
   */
  private validateSteps(steps: ExecutionStep[]): Array<{ stepId: string; error: string; step: ExecutionStep }> {
    const errors: Array<{ stepId: string; error: string; step: ExecutionStep }> = [];
    
    for (const step of steps) {
      // Check if agent exists in registry
      const agentEntry = getAgentByClassName(step.agentClassName);
      if (!agentEntry) {
        errors.push({
          stepId: step.id,
          error: `Agent '${step.agentClassName}' not found in registry`,
          step,
        });
        continue;
      }
      
      // Validate parameters exist
      if (!step.parameters || Object.keys(step.parameters).length === 0) {
        errors.push({
          stepId: step.id,
          error: `No parameters provided for ${step.agentClassName}.${step.functionName}`,
          step,
        });
      }
    }
    
    return errors;
  }
  
  /**
   * Get or create agent instance (with caching)
   */
  private getAgentInstance(agentClassName: string): BaseAgent {
    // Check cache
    if (this.agentInstances.has(agentClassName)) {
      return this.agentInstances.get(agentClassName)!;
    }
    
    // Create new instance
    const agent = createAgent(agentClassName);
    if (!agent) {
      throw new AgentError(
        `Failed to create agent: ${agentClassName}`,
        'AGENT_CREATION_FAILED',
        { agentClassName }
      );
    }
    
    // Initialize with API
    if (agent.initialize) {
      agent.initialize(this.api!);
    }
    
    // Cache
    this.agentInstances.set(agentClassName, agent);
    
    return agent;
  }
  
  /**
   * Validate AgentResult
   */
  private isValidAgentResult(result: any): result is AgentResult {
    if (!result || typeof result !== 'object') {
      return false;
    }
    
    // Check required fields
    return (
      typeof result.description === 'string' &&
      ['extrinsic', 'data', 'mixed', 'confirmation'].includes(result.resultType) &&
      ['extrinsic', 'data_fetch', 'validation', 'user_input'].includes(result.executionType)
    );
  }
  
  /**
   * Ensure initialized
   */
  private ensureInitialized(): void {
    if (!this.api) {
      throw new Error('Orchestrator not initialized. Call initialize() with ApiPromise first.');
    }
  }
  
  /**
   * Clear agent cache
   */
  clearCache(): void {
    this.agentInstances.clear();
  }
}

