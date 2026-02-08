import { DotBotError } from './DotBotError';

/**
 * Thrown when execution preparation fails (e.g. cannot add ExecutionMessage, sessions failed).
 */
export class ExecutionPreparationError extends DotBotError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'EXECUTION_PREPARATION_ERROR', context);
    this.name = 'ExecutionPreparationError';
    Object.setPrototypeOf(this, ExecutionPreparationError.prototype);
  }
}
