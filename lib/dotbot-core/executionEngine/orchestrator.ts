/**
 * Execution Orchestrator
 * 
 * Converts LLM execution plans into executable operations by calling
 * appropriate agent functions and building an ExecutionArray.
 */

import { ApiPromise } from '@polkadot/api';
import { ExecutionStep, ExecutionPlan } from '../prompts/system/execution/types';
import { ExecutionArray } from './executionArray';
import { AgentResult, AgentError, SimulationStatusCallback } from '../agents/types';
import { createAgent, getAgentByClassName } from '../agents';
import { BaseAgent } from '../agents/baseAgent';
import type { RpcManager } from '../rpcManager';

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
  private assetHubApi: ApiPromise | null = null;
  private agentInstances: Map<string, BaseAgent> = new Map();
  private onStatusUpdate: SimulationStatusCallback | null = null;
  private relayChainManager: RpcManager | null = null;
  private assetHubManager: RpcManager | null = null;
  
  /**
   * Initialize with Polkadot API
   * 
   * @param api Polkadot Relay Chain API
   * @param assetHubApi Optional Asset Hub API (recommended for DOT transfers)
   * @param onStatusUpdate Optional callback for simulation status updates
   * @param relayChainManager Optional RPC manager for Relay Chain endpoints
   * @param assetHubManager Optional RPC manager for Asset Hub endpoints
   */
  initialize(
    api: ApiPromise, 
    assetHubApi?: ApiPromise | null, 
    onStatusUpdate?: SimulationStatusCallback | null,
    relayChainManager?: RpcManager | null,
    assetHubManager?: RpcManager | null
  ): void {
    this.api = api;
    this.assetHubApi = assetHubApi || null;
    this.onStatusUpdate = onStatusUpdate || null;
    this.relayChainManager = relayChainManager || null;
    this.assetHubManager = assetHubManager || null;
  }
  
  /**
   * Get the API instance used by orchestrator (Relay Chain)
   * 
   * Public getter to avoid type assertions when accessing orchestrator's API.
   * Used by simulation code to match extrinsics with their creating API.
   */
  getApi(): ApiPromise | null {
    return this.api;
  }
  
  /**
   * Get the Asset Hub API instance used by orchestrator
   * 
   * Public getter to avoid type assertions when accessing orchestrator's API.
   * Used by simulation code to match extrinsics with their creating API.
   */
  getAssetHubApi(): ApiPromise | null {
    return this.assetHubApi;
  }
  
  /**
   * Orchestrate execution plan from LLM
   * 
   * Takes LLM output (ExecutionPlan) and automatically:
   * 1. Calls appropriate agents
   * 2. Gets AgentResults (with extrinsics)
   * 3. Populates ExecutionArray
   * 4. Returns ready-to-execute array
   * 
   * @param plan ExecutionPlan from LLM
   * @param options Orchestration options
   * @param executionId Optional execution ID to preserve when rebuilding (prevents duplicate ExecutionMessages)
   * @returns OrchestrationResult with populated ExecutionArray
   */
  async orchestrate(
    plan: ExecutionPlan,
    options: OrchestrationOptions = {},
    executionId?: string
  ): Promise<OrchestrationResult> {
    this.ensureInitialized();
    
    const startTime = Date.now();
    const executionArray = new ExecutionArray(executionId);
    const errors = this.validatePlanIfNeeded(plan, options);
    
    if (errors.length > 0 && options.stopOnError) {
      return this.createOrchestrationResult(executionArray, errors, plan.steps.length, startTime);
    }
    
    const { successfulSteps, finalErrors } = await this.executeSteps(
      plan.steps,
      executionArray,
      options,
      errors
    );
    
    return this.createOrchestrationResult(
      executionArray,
      finalErrors,
      plan.steps.length,
      startTime,
      successfulSteps
    );
  }
  
  /**
   * Validate plan steps if validation is enabled
   */
  private validatePlanIfNeeded(
    plan: ExecutionPlan,
    options: OrchestrationOptions
  ): Array<{ stepId: string; error: string; step: ExecutionStep }> {
    if (!options.validateFirst) {
      return [];
    }
    return this.validateSteps(plan.steps);
  }
  
  /**
   * Execute all steps in the plan
   */
  private async executeSteps(
    steps: ExecutionStep[],
    executionArray: ExecutionArray,
    options: OrchestrationOptions,
    initialErrors: Array<{ stepId: string; error: string; step: ExecutionStep }>
  ): Promise<{ successfulSteps: number; finalErrors: Array<{ stepId: string; error: string; step: ExecutionStep }> }> {
    let successfulSteps = 0;
    const errors = [...initialErrors];
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (options.onProgress) {
        options.onProgress(step, i, steps.length);
      }
      
      const result = await this.executeStepWithErrorHandling(step, executionArray, options);
      if (result.success) {
        successfulSteps++;
      } else if (result.error) {
        errors.push(result.error);
        if (options.stopOnError) {
          break;
        }
      }
    }
    
    return { successfulSteps, finalErrors: errors };
  }
  
  /**
   * Execute a single step with error handling
   */
  private async executeStepWithErrorHandling(
    step: ExecutionStep,
    executionArray: ExecutionArray,
    options: OrchestrationOptions
  ): Promise<{ success: boolean; error?: { stepId: string; error: string; step: ExecutionStep } }> {
    try {
      const agentResult = await this.executeStep(step);
      executionArray.add(agentResult);
      if (options.onStepCompleted) {
        options.onStepCompleted(step, agentResult);
      }
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorObj = {
        stepId: step.id,
        error: errorMessage,
        step,
      };
      if (options.onError && error instanceof Error) {
        options.onError(step, error);
      }
      return { success: false, error: errorObj };
    }
  }
  
  /**
   * Create orchestration result
   */
  private createOrchestrationResult(
    executionArray: ExecutionArray,
    errors: Array<{ stepId: string; error: string; step: ExecutionStep }>,
    totalSteps: number,
    startTime: number,
    successfulSteps = 0
  ): OrchestrationResult {
    return {
      executionArray,
      success: errors.length === 0,
      errors,
      metadata: {
        totalSteps,
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
    
    const agent = this.getAgentInstance(step.agentClassName);
    this.validateAgentFunction(agent, step);
    
    const paramsWithCallback = this.prepareAgentParameters(step);
    
    try {
      const result = await this.callAgentFunction(agent, step, paramsWithCallback);
      this.validateAgentResult(result, step);
      return result;
    } catch (error) {
      throw this.wrapAgentError(error, step);
    }
  }
  
  /**
   * Validate agent function exists
   */
  private validateAgentFunction(agent: BaseAgent, step: ExecutionStep): void {
    if (typeof (agent as any)[step.functionName] !== 'function') {
      throw new AgentError(
        `Function '${step.functionName}' not found on agent '${step.agentClassName}'`,
        'FUNCTION_NOT_FOUND',
        { agentClassName: step.agentClassName, functionName: step.functionName }
      );
    }
  }
  
  /**
   * Prepare agent parameters with callback
   */
  private prepareAgentParameters(step: ExecutionStep): any {
    // Add status callback to parameters if not present
    // NOTE: Simulation is now handled by Executioner only, not by agents
    return {
      ...step.parameters,
      onSimulationStatus: step.parameters.onSimulationStatus || this.onStatusUpdate || undefined,
    };
  }
  
  /**
   * Call agent function
   * Type-safe wrapper for calling agent methods dynamically
   */
  private async callAgentFunction(
    agent: BaseAgent,
    step: ExecutionStep,
    params: any
  ): Promise<AgentResult> {
    // Type-safe agent method call
    // All agent methods follow the pattern: async methodName(params: SomeParams): Promise<AgentResult>
    // Cast through 'unknown' first to allow index signature access
    const agentMethods = agent as unknown as Record<string, (params: any) => Promise<AgentResult>>;
    const method = agentMethods[step.functionName];
    
    if (typeof method !== 'function') {
      throw new AgentError(
        `Function '${step.functionName}' is not callable on agent '${step.agentClassName}'`,
        'FUNCTION_NOT_CALLABLE',
        { agentClassName: step.agentClassName, functionName: step.functionName }
      );
    }
    
    return await method.call(agent, params);
  }
  
  /**
   * Validate agent result
   */
  private validateAgentResult(result: any, step: ExecutionStep): void {
    if (!this.isValidAgentResult(result)) {
      throw new AgentError(
        `Agent function '${step.agentClassName}.${step.functionName}' did not return a valid AgentResult`,
        'INVALID_AGENT_RESULT',
        { result }
      );
    }
  }
  
  /**
   * Wrap error in AgentError if needed
   */
  private wrapAgentError(error: unknown, step: ExecutionStep): AgentError {
    // Re-throw AgentErrors
    if (error instanceof AgentError) {
      return error;
    }
    
    // Wrap other errors
    return new AgentError(
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
  
  /**
   * Validate steps before execution
   */
  private validateSteps(steps: ExecutionStep[]): Array<{ stepId: string; error: string; step: ExecutionStep }> {
    const errors: Array<{ stepId: string; error: string; step: ExecutionStep }> = [];
    
    for (const step of steps) {
      const agentEntry = getAgentByClassName(step.agentClassName);
      if (!agentEntry) {
        errors.push({
          stepId: step.id,
          error: `Agent '${step.agentClassName}' not found in registry`,
          step,
        });
        continue;
      }
      
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
    
    // Initialize with API (and Asset Hub API if available)
    if (agent.initialize) {
      agent.initialize(this.api!, this.assetHubApi, this.onStatusUpdate, this.relayChainManager, this.assetHubManager);
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

