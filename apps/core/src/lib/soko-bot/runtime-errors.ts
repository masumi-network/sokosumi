/**
 * A runtime failure the control plane may retry. The agent loop runs inside
 * Core, so this is no longer a transport status — it is raised when a turn
 * could not be *accepted* (for example the event log could not be written),
 * which says nothing about whether the work itself would succeed.
 */
export class SokoBotRuntimeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SokoBotRuntimeUnavailableError";
  }
}

export function isRetryableSokoBotRuntimeError(error: unknown): boolean {
  return error instanceof SokoBotRuntimeUnavailableError;
}
