/**
 * ScenarioEngine
 * 
 * **ARCHITECTURE PRINCIPLE**: ScenarioEngine is a CONTROLLER, not a replacement for DotBot.
 * 
 * ## Core Design Principle
 * 
 * ScenarioEngine **CONTROLS** DotBot, it does NOT create duplicate state or replace DotBot.
 * - ✅ ScenarioEngine creates test entities (Alice, Bob, multisigs)
 * - ✅ ScenarioEngine funds accounts on the REAL chain (live mode)
 * - ✅ ScenarioEngine injects prompts to DotBot's UI
 * - ✅ ScenarioEngine evaluates DotBot's responses
 * - ❌ ScenarioEngine does NOT create mock balances that shadow DotBot's view
 * - ❌ ScenarioEngine does NOT create parallel APIs or state
 * 
 * ## Current Implementation Status
 * 
 * **LIVE Mode**: ✅ READY
 * - Creates real test entities with deterministic addresses
 * - Funds accounts on real Westend testnet via batch transfers
 * - DotBot sees the same state (real chain)
 * - Tests work correctly
 * 
 * **SYNTHETIC Mode**: ⚠️ TODO (Disabled)
 * - Future: Mock DotBot's LLM responses entirely
 * - Don't actually query chain or run DotBot
 * - Fast unit testing
 * - Requires: Response mocking system
 * 
 * **EMULATED Mode**: ⚠️ TODO (Disabled)
 * - Future: Create Chopsticks fork AND reconnect DotBot to it
 * - DotBot must use Chopsticks API, not real chain API
 * - Realistic integration testing without testnet costs
 * - Requires: DotBot reconfiguration support
 * 
 * ## Usage (Live Mode)
 * 
 * ```typescript
 * const engine = new ScenarioEngine();
 * await engine.initialize();
 * 
 * // Set wallet for funding (user must approve)
 * engine.setWalletForLiveMode(account, signer);
 * 
 * // Run scenario - will fund accounts on real testnet
 * const result = await engine.runScenario(myScenario);
 * console.log(result.evaluation.summary);
 * ```
 */

import type {
  Scenario,
  ScenarioResult,
  ScenarioEngineConfig,
  ScenarioEngineState,
  ScenarioEngineEvent,
  ScenarioEngineEventListener,
  TestEntity,
  EntityConfig,
  ScenarioChain,
  ScenarioMode,
} from './types';

import {
  EntityCreator,
  createEntityCreator,
  StateAllocator,
  createStateAllocator,
  FundingRequiredError,
  ScenarioExecutor,
  createScenarioExecutor,
  Evaluator,
  createEvaluator,
  ExecutorDependencies,
} from './components';

import type { ApiPromise } from '@polkadot/api';

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const DEFAULT_CONFIG: Required<ScenarioEngineConfig> = {
  defaultEnvironment: {
    chain: 'westend',
    mode: 'synthetic',
  },
  logLevel: 'info',
  autoSaveResults: true,
  resultsStoragePrefix: 'dotbot_scenario_',
};

// =============================================================================
// SCENARIO ENGINE CLASS
// =============================================================================

export class ScenarioEngine {
  private config: Required<ScenarioEngineConfig>;
  private state: ScenarioEngineState;
  private eventListeners: Set<ScenarioEngineEventListener> = new Set();
  
  // Components
  private entityCreator: EntityCreator | null = null;
  private stateAllocator: StateAllocator | null = null;
  private executor: ScenarioExecutor | null = null;
  private evaluator: Evaluator | null = null;
  
  // Dependencies for executor
  private executorDeps: ExecutorDependencies | null = null;
  
  // RPC managers for StateAllocator (optional)
  private rpcManagerProvider: (() => {
    relayChainManager?: any;
    assetHubManager?: any;
  } | null) | null = null;
  
  // Wallet account and signer for live mode transfers
  private walletAccount?: { address: string; name?: string; source: string };
  private walletSigner?: any;

  constructor(config: ScenarioEngineConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      status: 'idle',
      entities: new Map(),
    };
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Initialize the scenario engine
   */
  async initialize(): Promise<void> {
    this.log('info', 'Initializing ScenarioEngine...');
    this.updateState({ status: 'preparing' });

    try {
      // Initialize evaluator (no async setup needed)
      this.evaluator = createEvaluator();

      // Forward evaluator events (LLM-consumable logs)
      this.evaluator.addEventListener((event) => this.emit(event));

      // Initialize executor
      this.executor = createScenarioExecutor();

      // Forward executor events
      this.executor.addEventListener((event) => this.emit(event));

      this.log('info', 'ScenarioEngine initialized');
      this.updateState({ status: 'idle' });
    } catch (error) {
      this.log('error', `Initialization failed: ${error}`);
      this.updateState({ status: 'error', error: String(error) });
      throw error;
    }
  }

  /**
   * Set dependencies for executor (DotBot instance, API, etc.)
   * 
   * This must be called before running scenarios.
   * The consumer (UI, CLI, test harness) provides these dependencies.
   */
  setDependencies(deps: ExecutorDependencies): void {
    this.executorDeps = deps;
    if (this.executor) {
      this.executor.setDependencies(deps);
    }
    this.log('debug', 'Executor dependencies set');
  }

  /**
   * Set RPC manager provider for StateAllocator
   * 
   * This allows StateAllocator to use the same RPC managers as DotBot,
   * ensuring consistent connections and proper chain selection.
   */
  setRpcManagerProvider(provider: () => {
    relayChainManager?: any;
    assetHubManager?: any;
  } | null): void {
    this.rpcManagerProvider = provider;
    this.log('debug', 'RPC manager provider set');
  }

  /**
   * Set wallet account and signer for live mode transfers
   * 
   * This allows StateAllocator to use the user's wallet for funding scenario entities.
   */
  setWalletForLiveMode(walletAccount: { address: string; name?: string; source: string }, signer: any): void {
    this.walletAccount = walletAccount;
    this.walletSigner = signer;
    this.log('debug', 'Wallet account and signer set for live mode');
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    this.log('info', 'Destroying ScenarioEngine...');
    
    // Clear state
    if (this.stateAllocator) {
      await this.stateAllocator.clearAllocatedState();
    }
    
    // Clear entities
    if (this.entityCreator) {
      this.entityCreator.clear();
    }

    this.updateState({
      status: 'idle',
      currentScenario: undefined,
      currentStepIndex: undefined,
      entities: new Map(),
      partialResults: undefined,
      error: undefined,
    });

    this.log('info', 'ScenarioEngine destroyed');
  }

  // ===========================================================================
  // SCENARIO EXECUTION
  // ===========================================================================

  /**
   * Run a complete scenario
   */
  async runScenario(scenario: Scenario): Promise<ScenarioResult> {
    this.log('info', `Running scenario: ${scenario.name}`);
    const startTime = Date.now();

    try {
      // Validate
      this.validateScenario(scenario);
      this.ensureDependencies();

      this.updateState({
        status: 'preparing',
        currentScenario: scenario,
        currentStepIndex: 0,
      });

      // Phase 1: Create entities
      await this.setupEntities(scenario);

      // Phase 2: Allocate state
      await this.setupState(scenario);

      // Phase 3: Execute steps
      this.updateState({ status: 'running' });
      const stepResults = await this.executor!.executeScenario(scenario);

      // Phase 4: Evaluate
      const evaluation = this.evaluator!.evaluate(scenario, stepResults);

      const endTime = Date.now();

      const result: ScenarioResult = {
        scenarioId: scenario.id,
        success: evaluation.passed,
        startTime,
        endTime,
        duration: endTime - startTime,
        stepResults,
        evaluation,
      };

      // Auto-save if enabled
      if (this.config.autoSaveResults) {
        this.saveResult(result);
      }

      this.updateState({ status: 'completed' });
      this.emit({ type: 'scenario-complete', result });

      this.log('info', `Scenario completed: ${evaluation.passed ? 'PASSED' : 'FAILED'} (${evaluation.score}/100)`);

      return result;
    } catch (error) {
      const endTime = Date.now();
      
      this.log('error', `Scenario failed: ${error}`);
      this.updateState({ status: 'error', error: String(error) });
      this.emit({ type: 'error', error: String(error) });

      return {
        scenarioId: scenario.id,
        success: false,
        startTime,
        endTime,
        duration: endTime - startTime,
        stepResults: [],
        evaluation: {
          passed: false,
          score: 0,
          expectations: [],
          summary: `Scenario failed with error: ${error}`,
        },
        errors: [{ message: String(error) }],
      };
    }
  }

  /**
   * Run multiple scenarios
   */
  async runScenarios(scenarios: Scenario[]): Promise<ScenarioResult[]> {
    this.log('info', `Running ${scenarios.length} scenarios`);
    const results: ScenarioResult[] = [];

    for (const scenario of scenarios) {
      const result = await this.runScenario(scenario);
      results.push(result);

      // Clean up between scenarios
      await this.destroy();
      await this.initialize();
      if (this.executorDeps) {
        this.setDependencies(this.executorDeps);
      }
    }

    return results;
  }

  /**
   * Pause current execution
   */
  pause(): void {
    if (this.executor) {
      this.executor.pause();
      this.updateState({ status: 'paused' });
    }
  }

  /**
   * Resume paused execution
   */
  resume(): void {
    if (this.executor) {
      this.executor.resume();
      this.updateState({ status: 'running' });
    }
  }

  /**
   * Stop current execution
   */
  stop(): void {
    if (this.executor) {
      this.executor.stop();
    }
  }

  /**
   * Create test entities without running a scenario
   * 
   * Useful for pre-populating entities before running tests
   * 
   * NOTE: Entities are mode-specific. If entities exist for a different mode,
   * they will be cleared and recreated.
   */
  async createEntities(
    entityConfigs: EntityConfig[],
    environment: { chain: ScenarioChain; mode: ScenarioMode }
  ): Promise<void> {
    // Check if entities exist for a different mode/chain
    const currentEntityMode = this.state.entityMode;
    const currentEntityChain = this.state.entityChain;
    
    if (currentEntityMode && currentEntityMode !== environment.mode) {
      this.log('warn', `Clearing entities from ${currentEntityMode} mode (switching to ${environment.mode})`);
      if (this.entityCreator) {
        this.entityCreator.clear();
      }
      this.updateState({
        entities: new Map(),
        entityMode: undefined,
        entityChain: undefined,
      });
    }
    
    if (currentEntityChain && currentEntityChain !== environment.chain) {
      this.log('warn', `Clearing entities from ${currentEntityChain} chain (switching to ${environment.chain})`);
      if (this.entityCreator) {
        this.entityCreator.clear();
      }
      this.updateState({
        entities: new Map(),
        entityMode: undefined,
        entityChain: undefined,
      });
    }
    
    this.log('info', `Creating ${entityConfigs.length} entities for ${environment.mode} mode on ${environment.chain}...`);
    
    // Create entity creator if not already created or if mode changed
    if (!this.entityCreator || currentEntityMode !== environment.mode || currentEntityChain !== environment.chain) {
      this.entityCreator = createEntityCreator(environment.mode, {
        ss58Format: this.getSS58Format(environment.chain),
      });
      await this.entityCreator.initialize();
    }

    // Create entities from configs
    await this.entityCreator.createFromConfigs(entityConfigs);

    // Update state with entities and their mode
    this.updateState({
      entities: this.entityCreator.getAllEntities(),
      entityMode: environment.mode,
      entityChain: environment.chain,
    });

    this.log('info', `Created ${this.state.entities.size} entities for ${environment.mode} mode`);
  }

  /**
   * Clear all entities
   * 
   * Removes all created entities and resets entity state.
   */
  clearEntities(): void {
    if (this.entityCreator) {
      this.entityCreator.clear();
    }
    
    this.updateState({
      entities: new Map(),
      entityMode: undefined,
      entityChain: undefined,
    });
    
    this.log('info', 'All entities cleared');
  }

  // ===========================================================================
  // SETUP PHASES
  // ===========================================================================

  private async setupEntities(scenario: Scenario): Promise<void> {
    this.log('debug', 'Setting up entities...');

    const environment = scenario.environment || this.config.defaultEnvironment;

    // Create entity creator
    this.entityCreator = createEntityCreator(environment.mode, {
      ss58Format: this.getSS58Format(environment.chain),
    });
    await this.entityCreator.initialize();

    // Create predefined entities
    await this.entityCreator.createPredefinedEntities();

    // Create custom entities from scenario
    if (scenario.entities) {
      await this.entityCreator.createFromConfigs(scenario.entities);
    }

    // Update state with entities
    this.updateState({
      entities: this.entityCreator.getAllEntities(),
    });

    this.log('debug', `Created ${this.state.entities.size} entities`);
  }

  private async setupState(scenario: Scenario): Promise<void> {
    this.log('debug', 'Setting up state...');

    const environment = scenario.environment || this.config.defaultEnvironment;

    // Create state allocator
    this.stateAllocator = createStateAllocator({
      mode: environment.mode,
      chain: environment.chain,
      entityResolver: (name) => this.entityCreator?.getEntity(name),
      chopsticksEndpoint: environment.chopsticksConfig?.endpoint,
      rpcManagerProvider: this.rpcManagerProvider || undefined,
      // Pass wallet account and signer for live mode
      walletAccount: this.walletAccount,
      signer: this.walletSigner,
    });
    await this.stateAllocator.initialize();

    // Allocate wallet state
    if (scenario.walletState) {
      try {
        const result = await this.stateAllocator.allocateWalletState(scenario.walletState);
        if (!result.success) {
          throw new Error(`Failed to allocate wallet state: ${result.errors.join(', ')}`);
        }
        if (result.warnings.length > 0) {
          for (const warning of result.warnings) {
            this.log('warn', warning);
          }
        }
      } catch (error) {
        // If it's a FundingRequiredError, log it and re-throw to stop execution immediately
        // DO NOT continue to steps - this error means funding is required
        if (error instanceof FundingRequiredError) {
          this.log('error', error.message);
          this.updateState({ status: 'error', error: error.message });
          // Re-throw to stop execution - this will be caught by runScenario's catch block
          throw error;
        }
        // For other errors, re-throw as well
        throw error;
      }
    }

    // Allocate on-chain state
    if (scenario.onchainState) {
      const result = await this.stateAllocator.allocateOnchainState(scenario.onchainState);
      if (!result.success) {
        throw new Error(`Failed to allocate on-chain state: ${result.errors.join(', ')}`);
      }
    }

    // Allocate local state
    if (scenario.localState) {
      await this.stateAllocator.allocateLocalState(scenario.localState);
    }

    this.log('debug', 'State setup complete');
  }

  // ===========================================================================
  // EVENT HANDLING
  // ===========================================================================

  /**
   * Add event listener
   */
  addEventListener(listener: ScenarioEngineEventListener): void {
    this.eventListeners.add(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: ScenarioEngineEventListener): void {
    this.eventListeners.delete(listener);
  }

  private emit(event: ScenarioEngineEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Event listener error:', error);
      }
    }
  }

  private updateState(updates: Partial<ScenarioEngineState>): void {
    this.state = { ...this.state, ...updates };
    this.emit({ type: 'state-change', state: this.state });
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  /**
   * Get current state
   */
  getState(): ScenarioEngineState {
    return { ...this.state };
  }

  /**
   * Get entity by name
   */
  getEntity(name: string): TestEntity | undefined {
    return this.state.entities.get(name);
  }

  /**
   * Get entity by address
   */
  getEntityByAddress(address: string): TestEntity | undefined {
    for (const entity of this.state.entities.values()) {
      if (entity.address === address) {
        return entity;
      }
    }
    return undefined;
  }

  /**
   * Get all entities
   */
  getEntities(): Map<string, TestEntity> {
    return new Map(this.state.entities);
  }

  /**
   * Get the executor (for UI callbacks)
   */
  getExecutor(): ScenarioExecutor | null {
    return this.executor;
  }

  private validateScenario(scenario: Scenario): void {
    if (!scenario.id) {
      throw new Error('Scenario must have an id');
    }
    if (!scenario.name) {
      throw new Error('Scenario must have a name');
    }
    if (!scenario.steps || scenario.steps.length === 0) {
      throw new Error('Scenario must have at least one step');
    }
    if (!scenario.expectations || scenario.expectations.length === 0) {
      throw new Error('Scenario must have at least one expectation');
    }
  }

  private ensureDependencies(): void {
    if (!this.executorDeps) {
      throw new Error('Executor dependencies not set. Call setDependencies() before running scenarios.');
    }
  }

  private getSS58Format(chain: string): number {
    switch (chain) {
      case 'polkadot':
      case 'asset-hub-polkadot':
        return 0;
      case 'kusama':
        return 2;
      case 'westend':
      case 'asset-hub-westend':
      default:
        return 42;
    }
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevel = levels.indexOf(this.config.logLevel);
    const msgLevel = levels.indexOf(level);

    if (msgLevel >= configLevel) {
      const prefix = `[ScenarioEngine] [${level.toUpperCase()}]`;
      switch (level) {
        case 'debug':
          console.debug(prefix, message);
          break;
        case 'info':
          console.info(prefix, message);
          break;
        case 'warn':
          console.warn(prefix, message);
          break;
        case 'error':
          console.error(prefix, message);
          break;
      }
    }

    this.emit({ type: 'log', level, message });
  }

  private saveResult(result: ScenarioResult): void {
    try {
      const key = `${this.config.resultsStoragePrefix}${result.scenarioId}_${result.startTime}`;
      localStorage.setItem(key, JSON.stringify(result));
      this.log('debug', `Result saved: ${key}`);
    } catch (error) {
      this.log('warn', `Failed to save result: ${error}`);
    }
  }

  /**
   * Load saved results
   */
  loadSavedResults(): ScenarioResult[] {
    const results: ScenarioResult[] = [];
    const prefix = this.config.resultsStoragePrefix;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        try {
          const data = localStorage.getItem(key);
          if (data) {
            results.push(JSON.parse(data));
          }
        } catch (error) {
          this.log('warn', `Failed to load result ${key}: ${error}`);
        }
      }
    }

    return results.sort((a, b) => b.startTime - a.startTime);
  }

  /**
   * Clear saved results
   */
  clearSavedResults(): void {
    const prefix = this.config.resultsStoragePrefix;
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }

    this.log('info', `Cleared ${keysToRemove.length} saved results`);
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a ScenarioEngine with configuration
 */
export function createScenarioEngine(config?: ScenarioEngineConfig): ScenarioEngine {
  return new ScenarioEngine(config);
}

