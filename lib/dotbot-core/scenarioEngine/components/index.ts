/**
 * ScenarioEngine Components
 * 
 * Core components for scenario execution and evaluation.
 */

export { EntityCreator, createEntityCreator, PREDEFINED_NAMES } from './EntityCreator';
export type { EntityCreatorConfig, PredefinedName } from './EntityCreator';

export { StateAllocator, createStateAllocator, FundingRequiredError } from './StateAllocator';
export type { StateAllocatorConfig, AllocationResult } from './StateAllocator';

export { ScenarioExecutor, createScenarioExecutor } from './ScenarioExecutor';
export type { ExecutorConfig, ExecutionContext, ExecutorDependencies } from './ScenarioExecutor';

export { Evaluator, createEvaluator } from './Evaluator';
export type { EvaluatorConfig, ExpectationResult, EvaluationReport } from './Evaluator';

export { ExpressionValidator, createExpressionValidator } from './ExpressionValidator';
export type { ValidationResult } from './ExpressionValidator';

