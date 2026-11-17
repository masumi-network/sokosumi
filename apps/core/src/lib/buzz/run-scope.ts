/**
 * The bridge run a piece of work belongs to. Every write the bridge makes
 * (to the relay, or to Core as someone) passes `checkpoint()`, so a run that
 * must stop (its time is up, its lease is gone) stops writing at once,
 * wherever it is, instead of only between batches.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const run = new AsyncLocalStorage<() => boolean>();

export class BridgeRunStoppedError extends Error {
  constructor() {
    super("The Buzz bridge run stopped");
  }
}

export function withinBridgeRun<T>(
  shouldContinue: () => boolean,
  work: () => Promise<T>,
): Promise<T> {
  return run.run(shouldContinue, work);
}

/** Throws when the current run must stop; outside a run, never. */
export function checkpoint(): void {
  const shouldContinue = run.getStore();
  if (shouldContinue && !shouldContinue()) throw new BridgeRunStoppedError();
}
