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
   * @returns OrchestrationResult with populated ExecutionArray
   */
  async orchestrate(
    plan: ExecutionPlan,
    options: OrchestrationOptions = {}
  ): Promise<OrchestrationResult> {
    this.ensureInitialized();
    
    console.log('🎭 Orchestrator.orchestrate() called with plan:', {
      planId: plan.id,
      steps: plan.steps.length,
      stepDetails: plan.steps.map(s => ({
        id: s.id,
        agent: s.agentClassName,
        function: s.functionName,
        params: Object.keys(s.parameters || {})
      }))
    });
    
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
    
    console.log('📋 Created empty ExecutionArray');
    
    // Validate all steps first
    if (validateFirst) {
      console.log('🔍 Validating steps...');
      const validationErrors = this.validateSteps(plan.steps);
      console.log('🔍 Validation result:', {
        errorCount: validationErrors.length,
        errors: validationErrors.map(e => e.error)
      });
      
      if (validationErrors.length > 0) {
        errors.push(...validationErrors);
        if (stopOnError) {
          console.error('❌ Validation failed, stopping');
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
        } else {
          console.warn('⚠️ Validation errors but continuing (stopOnError=false)');
        }
      }
    }
    
    // Process each step
    console.log(`🔄 Processing ${plan.steps.length} steps...`);
    let successfulSteps = 0;
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      
      console.log(`📍 Step ${i + 1}/${plan.steps.length}:`, {
        id: step.id,
        agent: step.agentClassName,
        function: step.functionName
      });
      
      // Notify progress
      if (onProgress) {
        onProgress(step, i, plan.steps.length);
      }
      
      try {
        // Call agent to get extrinsic
        console.log('🤖 Calling agent...');
        const agentResult = await this.executeStep(step);
        console.log('✅ Agent returned result:', {
          hasExtrinsic: !!agentResult.extrinsic,
          description: agentResult.description
        });
        
        // Add to execution array
        console.log('➕ Adding to ExecutionArray...');
        executionArray.add(agentResult);
        console.log('✅ Added to ExecutionArray, new size:', executionArray.getItems().length);
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
    
    console.log('🎯 ExecuteStep:', { agent: step.agentClassName, function: step.functionName });
    
    // Get or create agent instance
    const agent = this.getAgentInstance(step.agentClassName);
    console.log('✅ Got agent instance');
    
    // Validate function exists
    if (typeof (agent as any)[step.functionName] !== 'function') {
      console.error('❌ Function not found on agent');
      throw new AgentError(
        `Function '${step.functionName}' not found on agent '${step.agentClassName}'`,
        'FUNCTION_NOT_FOUND',
        { agentClassName: step.agentClassName, functionName: step.functionName }
      );
    }
    
    console.log('✅ Function exists, calling with params:', step.parameters);
    
    // Add status callback to parameters if not present
    // NOTE: Simulation is now handled by Executioner only, not by agents
    const paramsWithCallback = {
      ...step.parameters,
      onSimulationStatus: step.parameters.onSimulationStatus || this.onStatusUpdate || undefined,
    };
    
    // Call the agent function
    // Agent will create the extrinsic and return AgentResult
    try {
      const result = await (agent as any)[step.functionName](paramsWithCallback);
      console.log('✅ Agent function returned:', {
        hasResult: !!result,
        hasExtrinsic: !!result?.extrinsic,
        description: result?.description
      });
      
      // Validate result
      if (!this.isValidAgentResult(result)) {
        console.error('❌ Invalid agent result');
        throw new AgentError(
          `Agent function '${step.agentClassName}.${step.functionName}' did not return a valid AgentResult`,
          'INVALID_AGENT_RESULT',
          { result }
        );
      }
      
      console.log('✅ Result validated, returning');
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
      console.log('🔍 Validating step:', { agent: step.agentClassName, function: step.functionName });
      
      // Check if agent exists in registry
      const agentEntry = getAgentByClassName(step.agentClassName);
      if (!agentEntry) {
        console.error('❌ Agent not found in registry:', step.agentClassName);
        errors.push({
          stepId: step.id,
          error: `Agent '${step.agentClassName}' not found in registry`,
          step,
        });
        continue;
      }
      console.log('✅ Agent found in registry');
      
      // Validate parameters exist
      if (!step.parameters || Object.keys(step.parameters).length === 0) {
        console.warn('⚠️ No parameters provided');
        errors.push({
          stepId: step.id,
          error: `No parameters provided for ${step.agentClassName}.${step.functionName}`,
          step,
        });
      } else {
        console.log('✅ Parameters validated:', Object.keys(step.parameters));
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

