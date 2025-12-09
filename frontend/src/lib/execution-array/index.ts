/**
 * Execution Array Module
 * 
 * Complete, portable execution system that works ANYWHERE:
 * ✅ Browser (with wallet extensions)
 * ✅ Terminal/CLI (with keyring)
 * ✅ Backend services
 * ✅ Tests
 * 
 * **Turnkey Usage** (Recommended):
 * ```typescript
 * const system = new ExecutionSystem();
 * system.initialize(api, account);
 * system.setSigningHandler(showModal);
 * await system.execute(llmPlan); // That's it!
 * ```
 * 
 * **Terminal/CLI Usage**:
 * ```typescript
 * const signer = KeyringSigner.fromMnemonic("your seed phrase");
 * const executioner = new Executioner();
 * executioner.initialize(api, account, signer);
 * await executioner.execute(executionArray);
 * ```
 */

export { ExecutionArray } from './execution-array';
export { Executioner } from './executioner';
export { ExecutionOrchestrator } from './orchestrator';
export { ExecutionSystem } from './system';
export * from './types';
export * from './utils';
export * from './signers';
export type { OrchestrationResult, OrchestrationOptions } from './orchestrator';

