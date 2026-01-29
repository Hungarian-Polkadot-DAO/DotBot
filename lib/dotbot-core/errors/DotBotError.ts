/**
 * Base error class for DotBot
 *
 * Provides a consistent structure for errors with optional code and context.
 */

export class DotBotError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DotBotError';
    Object.setPrototypeOf(this, DotBotError.prototype);
  }
}
