/**
 * Scenario Construction Helpers
 * 
 * DRY, KISS utilities for building test scenarios.
 * Makes scenario authoring fast, consistent, and type-safe.
 */

import type {
  Scenario,
  ScenarioStep as _ScenarioStep,
  ScenarioExpectation,
  ScenarioCategory,
  EntityConfig,
} from '../types';

// =============================================================================
// SCENARIO BUILDERS
// =============================================================================

/**
 * Fluent API for building scenarios
 * 
 * Example:
 * ```typescript
 * const scenario = createScenario('test-001', 'Basic Transfer')
 *   .category('happy-path')
 *   .tags('transfer', 'basic')
 *   .withPrompt('Send 5 DOT to Alice')
 *   .expectExecution({
 *     agent: 'AssetTransferAgent',
 *     function: 'transfer',
 *     params: { amount: '5', recipient: 'Alice' }
 *   })
 *   .build();
 * ```
 */
export class ScenarioBuilder {
  private scenario: Partial<Scenario> = {
    steps: [],
    expectations: [],
  };

  constructor(id: string, name: string) {
    this.scenario.id = id;
    this.scenario.name = name;
  }

  /**
   * Set category
   */
  category(category: ScenarioCategory): this {
    this.scenario.category = category;
    return this;
  }

  /**
   * Add description
   */
  description(description: string): this {
    this.scenario.description = description;
    return this;
  }

  /**
   * Add tags
   */
  tags(...tags: string[]): this {
    this.scenario.tags = [...(this.scenario.tags || []), ...tags];
    return this;
  }

  /**
   * Add entities
   */
  withEntities(...entities: EntityConfig[]): this {
    this.scenario.entities = [...(this.scenario.entities || []), ...entities];
    return this;
  }

  /**
   * Add a prompt step
   */
  withPrompt(input: string, id?: string): this {
    this.scenario.steps!.push({
      id: id || `step-${this.scenario.steps!.length + 1}`,
      type: 'prompt',
      input,
    });
    return this;
  }

  /**
   * Add a wait step
   */
  wait(ms: number, id?: string): this {
    this.scenario.steps!.push({
      id: id || `step-${this.scenario.steps!.length + 1}`,
      type: 'wait',
      waitMs: ms,
    });
    return this;
  }

  /**
   * Expect execution plan with agent/function/params
   */
  expectExecution(config: {
    agent?: string;
    function?: string;
    params?: Record<string, unknown>;
  }): this {
    this.scenario.expectations!.push({
      responseType: 'execution',
      expectedAgent: config.agent,
      expectedFunction: config.function,
      expectedParams: config.params,
    });
    return this;
  }

  /**
   * Expect text response
   */
  expectText(config: {
    contains?: string[];
    notContains?: string[];
    mentions?: string[];
  }): this {
    this.scenario.expectations!.push({
      responseType: 'text',
      shouldContain: config.contains,
      shouldNotContain: config.notContains,
      shouldMention: config.mentions,
    });
    return this;
  }

  /**
   * Expect rejection
   */
  expectRejection(reason?: string): this {
    this.scenario.expectations!.push({
      shouldReject: true,
      rejectionReason: reason,
    });
    return this;
  }

  /**
   * Expect clarification request
   */
  expectClarification(asksFor?: string[]): this {
    this.scenario.expectations!.push({
      responseType: 'clarification',
      shouldAskFor: asksFor,
    });
    return this;
  }

  /**
   * Add custom expectation
   */
  expectCustom(expectation: ScenarioExpectation): this {
    this.scenario.expectations!.push(expectation);
    return this;
  }

  /**
   * Build the final scenario
   */
  build(): Scenario {
    // Validation
    if (!this.scenario.id) throw new Error('Scenario ID is required');
    if (!this.scenario.name) throw new Error('Scenario name is required');
    if (!this.scenario.category) throw new Error('Scenario category is required');
    if (!this.scenario.description) this.scenario.description = this.scenario.name;
    if (this.scenario.steps!.length === 0) throw new Error('Scenario must have at least one step');
    if (this.scenario.expectations!.length === 0) throw new Error('Scenario must have at least one expectation');

    return this.scenario as Scenario;
  }
}

/**
 * Create a scenario builder
 */
export function createScenario(id: string, name: string): ScenarioBuilder {
  return new ScenarioBuilder(id, name);
}

// =============================================================================
// COMMON PATTERNS (Pre-built Builders)
// =============================================================================

/**
 * Happy path transfer scenario
 */
export function transferScenario(config: {
  id: string;
  name: string;
  amount: string;
  recipient: string;
  token?: string;
}): Scenario {
  const token = config.token || 'WND';
  return createScenario(config.id, config.name)
    .category('happy-path')
    .tags('transfer', 'basic')
    .description(`Transfer ${config.amount} ${token} to ${config.recipient}`)
    .withPrompt(`Send ${config.amount} ${token} to ${config.recipient}`)
    .expectExecution({
      agent: 'AssetTransferAgent',
      function: 'transfer',
      params: {
        amount: config.amount,
        recipient: config.recipient,
      },
    })
    .build();
}

/**
 * Insufficient balance scenario
 */
export function insufficientBalanceScenario(config: {
  id: string;
  name: string;
  amount: string;
  recipient: string;
}): Scenario {
  return createScenario(config.id, config.name)
    .category('edge-case')
    .tags('transfer', 'insufficient-balance', 'error')
    .description(`Transfer ${config.amount} (more than available balance)`)
    .withPrompt(`Send ${config.amount} to ${config.recipient}`)
    .expectText({
      contains: ['insufficient', 'balance'],
      notContains: ['execution'],
    })
    .build();
}

/**
 * Calculate insufficient balance amount for multi-transaction scenario
 * 
 * Given:
 * - initialBalance: Starting balance (e.g., "1.0 WND")
 * - firstTransferAmount: Amount of first transfer (e.g., "0.1 WND")
 * - estimatedFeePerTx: Estimated fee per transaction (default: 0.01 WND)
 * 
 * Returns: Amount that would cause insufficient balance error
 * 
 * Formula:
 * remainingBalance = initialBalance - firstTransferAmount - estimatedFeePerTx
 * insufficientAmount = remainingBalance + smallAmount (to ensure it fails)
 */
export function calculateInsufficientBalanceAmount(
  initialBalance: string,
  firstTransferAmount: string,
  estimatedFeePerTx = '0.01'
): string {
  // Parse amounts (assumes format like "1.0 WND" or "0.1 WND")
  const parseAmount = (amountStr: string): number => {
    const match = amountStr.match(/^([\d.]+)/);
    return match ? parseFloat(match[1]) : 0;
  };

  const initial = parseAmount(initialBalance);
  const firstTransfer = parseAmount(firstTransferAmount);
  const fee = parseAmount(estimatedFeePerTx);

  // Calculate remaining balance after first transfer
  const remainingBalance = initial - firstTransfer - fee;

  // Calculate insufficient amount: remaining + small buffer to ensure failure
  // Add 0.01 more than remaining to guarantee insufficient balance error
  const insufficientAmount = remainingBalance + 0.01;

  // Round to 2 decimal places and return as string
  return insufficientAmount.toFixed(2);
}

/**
 * Adversarial/security scenario
 */
export function adversarialScenario(config: {
  id: string;
  name: string;
  prompt: string;
  reason: string;
}): Scenario {
  return createScenario(config.id, config.name)
    .category('adversarial')
    .tags('security', 'prompt-injection')
    .description(`Security test: ${config.reason}`)
    .withPrompt(config.prompt)
    .expectRejection(config.reason)
    .build();
}

/**
 * Clarification needed scenario
 */
export function clarificationScenario(config: {
  id: string;
  name: string;
  prompt: string;
  asksFor: string[];
}): Scenario {
  return createScenario(config.id, config.name)
    .category('ambiguity')
    .tags('clarification', 'incomplete')
    .description(`Should ask for: ${config.asksFor.join(', ')}`)
    .withPrompt(config.prompt)
    .expectClarification(config.asksFor)
    .build();
}

/**
 * Knowledge base query scenario
 */
export function knowledgeScenario(config: {
  id: string;
  name: string;
  prompt: string;
  shouldMention: string[];
}): Scenario {
  return createScenario(config.id, config.name)
    .category('knowledge-base')
    .tags('knowledge', 'information')
    .description(`Knowledge query: ${config.prompt}`)
    .withPrompt(config.prompt)
    .expectText({
      mentions: config.shouldMention,
    })
    .build();
}

// =============================================================================
// EXPECTATION HELPERS
// =============================================================================

/**
 * Create an execution expectation (most common)
 */
export function expectExecution(
  agent: string,
  functionName: string,
  params?: Record<string, unknown>
): ScenarioExpectation {
  return {
    responseType: 'execution',
    expectedAgent: agent,
    expectedFunction: functionName,
    expectedParams: params,
  };
}

/**
 * Create a text response expectation
 */
export function expectTextContaining(...keywords: string[]): ScenarioExpectation {
  return {
    responseType: 'text',
    shouldContain: keywords,
  };
}

/**
 * Create a rejection expectation
 */
export function expectRejection(reason?: string): ScenarioExpectation {
  return {
    shouldReject: true,
    rejectionReason: reason,
  };
}

/**
 * Create a clarification expectation
 */
export function expectClarificationFor(...items: string[]): ScenarioExpectation {
  return {
    responseType: 'clarification',
    shouldAskFor: items,
  };
}

// =============================================================================
// ENTITY HELPERS
// =============================================================================

/**
 * Create a keypair entity config
 */
export function keypairEntity(name: string): EntityConfig {
  return { name, type: 'keypair' };
}

/**
 * Create a multisig entity config
 */
export function multisigEntity(
  name: string,
  signatoryNames: string[],
  threshold: number
): EntityConfig {
  return {
    name,
    type: 'multisig',
    signatoryNames,
    threshold,
  };
}

/**
 * Create a proxy entity config
 */
export function proxyEntity(name: string, proxiedEntityName: string): EntityConfig {
  return {
    name,
    type: 'proxy',
    proxiedEntityName,
  };
}

// =============================================================================
// BATCH SCENARIO CREATION
// =============================================================================

/**
 * Generate a suite of related scenarios
 */
export function scenarioSuite(
  prefix: string,
  scenarios: Array<Omit<Scenario, 'id'> & { suffix: string }>
): Scenario[] {
  return scenarios.map((s) => ({
    ...s,
    id: `${prefix}-${s.suffix}`,
  })) as Scenario[];
}

/**
 * Create parametrized scenarios (test multiple inputs with same structure)
 */
export function parametrizedScenarios<T>(
  template: (params: T, index: number) => Scenario,
  params: T[]
): Scenario[] {
  return params.map((p, i) => template(p, i));
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validate a scenario definition
 */
export function validateScenario(scenario: Scenario): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!scenario.id) errors.push('Missing scenario ID');
  if (!scenario.name) errors.push('Missing scenario name');
  if (!scenario.category) errors.push('Missing scenario category');
  if (!scenario.steps || scenario.steps.length === 0) {
    errors.push('Scenario must have at least one step');
  }
  if (!scenario.expectations || scenario.expectations.length === 0) {
    errors.push('Scenario must have at least one expectation');
  }

  // Validate steps
  scenario.steps?.forEach((step, index) => {
    if (!step.id) errors.push(`Step ${index} missing ID`);
    if (!step.type) errors.push(`Step ${index} missing type`);
    if (step.type === 'prompt' && !step.input) {
      errors.push(`Prompt step ${index} missing input`);
    }
    if (step.type === 'wait' && !step.waitMs) {
      errors.push(`Wait step ${index} missing waitMs`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Assert scenario is valid (throws on invalid)
 */
export function assertValidScenario(scenario: Scenario): void {
  const { valid, errors } = validateScenario(scenario);
  if (!valid) {
    throw new Error(`Invalid scenario "${scenario.id}":\n${errors.join('\n')}`);
  }
}

