/**
 * Execution Engine Module
 * 
 * Complete, portable execution system that works ANYWHERE:
 *  - Browser (with wallet extensions)
 *  - Terminal/CLI (with keyring)
 *  - Backend services
 *  - Tests
 * 
 * **Turnkey Usage** (Recommended - Use DotBot):
 * ```typescript
 * const dotbot = await DotBot.create({
 *   wallet: account,
 *   endpoint: 'wss://rpc.polkadot.io',
 *   onSigningRequest: showModal
 * });
 * await dotbot.chat("Send 2 DOT to Bob"); // That's it!
 * ```
 * 
 * **Advanced Usage** (If you already have an ExecutionPlan):
 * ```typescript
 * const system = new ExecutionSystem();
 * system.initialize(api, account);
 * system.setSigningHandler(showModal);
 * await system.execute(executionPlan);
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

export { ExecutionArray } from './executionArray';
export { Executioner } from './executioner';
export { ExecutionOrchestrator } from './orchestrator';
export { ExecutionSystem } from './system';
export * from './types';
export * from './utils';
export * from './signers';
export type { OrchestrationResult, OrchestrationOptions } from './orchestrator';

