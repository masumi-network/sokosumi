import {
  matchesMessageStart,
  requireAnchoredStart,
} from "@sokosumi/utils/test-console";
import { afterEach, beforeEach, vi } from "vitest";

/**
 * Background work must not outlive the test that started it. Code hands a
 * promise to `waitUntil` that is already running; a test that mocks
 * `@vercel/functions` drops it, so it finishes in a later test or file
 * without that test's mocks, and the warning or failure lands there.
 *
 * Each promise the file's `waitUntil` mock receives is observed the moment
 * it is recorded, also when the mock throws or a test replaced its
 * implementation, so a rejection is never reported as unhandled. After each
 * test the drain awaits the recorded calls it has not awaited yet, in rounds
 * until a round finds none (work that background work hands on to
 * `waitUntil` included), up to `MAX_ROUNDS`. The warnings and errors that
 * work logs count against the test that started it (the console guard and
 * the core-log drain check in `onTestFinished`, after this `afterEach`). A
 * rejected promise fails the test unless the test declared it with
 * `expectBackgroundRejection`.
 *
 * It sees only a `vi.fn()` mock: one written as a plain function has no
 * recorded calls, and work started without `waitUntil` is not seen at all.
 * Calls a test removes with `mockClear()` or `mockReset()` are not awaited;
 * that is how a test drops work that never settles by design. Other work
 * that never settles makes the hook time out.
 */

const MAX_ROUNDS = 100;

type Outcome = { rejected: false } | { rejected: true; reason: unknown };

type Declaration = {
  start: string | RegExp;
  times: number;
  rejections: unknown[];
};

const declarations: Declaration[] = [];
/** One observation per recorded call (its arguments array), for the file. */
const outcomes = new WeakMap<unknown[], Promise<Outcome>>();
/** Calls already awaited by a drain in this file, by identity, not count. */
const drained = new WeakSet<unknown[]>();
const OBSERVED = Symbol.for("sokosumi.test.waitUntilObserved");

/** Attaches the outcome handler, which also marks a rejection handled. */
function observe(args: unknown[]): Promise<Outcome> {
  let outcome = outcomes.get(args);
  if (!outcome) {
    outcome = Promise.resolve(args[0]).then(
      (): Outcome => ({ rejected: false }),
      (reason: unknown): Outcome => ({ rejected: true, reason }),
    );
    outcomes.set(args, outcome);
  }
  return outcome;
}

/**
 * Observes every call as Vitest records it. Vitest pushes each call's
 * arguments onto `mock.calls` and replaces the array on `mockClear()`, so
 * the property becomes an accessor that watches each array it is given. The
 * state is internal: a Vitest upgrade that changes it fails here loudly.
 */
function observeCalls(state: { calls: unknown[][] }): void {
  const holder = state as { calls: unknown[][]; [OBSERVED]?: true };
  if (holder[OBSERVED]) return;
  const descriptor = Object.getOwnPropertyDescriptor(state, "calls");
  if (!descriptor?.writable || !Array.isArray(descriptor.value)) {
    throw new Error(
      "wait-until: Vitest mock state has no writable calls array; update this helper for the installed Vitest",
    );
  }
  const watch = (calls: unknown[][]): unknown[][] => {
    for (const args of calls) observe(args);
    const push = calls.push;
    Object.defineProperty(calls, "push", {
      configurable: true,
      value(...items: unknown[][]): number {
        for (const args of items) observe(args);
        return push.apply(calls, items);
      },
    });
    return calls;
  };
  let calls = watch(descriptor.value);
  Object.defineProperty(state, "calls", {
    configurable: true,
    enumerable: descriptor.enumerable,
    get: () => calls,
    set: (next: unknown[][]) => {
      calls = watch(next);
    },
  });
  holder[OBSERVED] = true;
}

function reasonMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Declares that background work the current test hands to `waitUntil`
 * rejects with a message that starts with `start` exactly `times` times,
 * matched as `expectConsole` matches (a RegExp must be anchored with `^`).
 * Returns the matched reasons; the drain fills it after the test body, so
 * assert on it only after `await drainWaitUntil()`.
 */
export function expectBackgroundRejection(
  start: string | RegExp,
  times = 1,
): unknown[] {
  requireAnchoredStart("expectBackgroundRejection", start);
  const declaration: Declaration = { start, times, rejections: [] };
  declarations.push(declaration);
  return declaration.rejections;
}

/**
 * Awaits the current test's `waitUntil` work, rounds included, and returns
 * its failures: undeclared rejections, declarations that matched another
 * number of times, and work that kept registering past `MAX_ROUNDS`. Clears
 * the test's declarations.
 */
export async function drainWaitUntil(): Promise<string[]> {
  const failures: string[] = [];
  const undeclared: string[] = [];
  const { waitUntil } = await import("@vercel/functions");
  if (vi.isMockFunction(waitUntil)) {
    let rounds = 0;
    for (;;) {
      const batch = waitUntil.mock.calls.filter((args) => !drained.has(args));
      if (batch.length === 0) break;
      if (rounds === MAX_ROUNDS) {
        failures.push(
          `Background work kept handing new work to waitUntil after ${MAX_ROUNDS} rounds`,
        );
        break;
      }
      rounds += 1;
      for (const args of batch) drained.add(args);
      for (const outcome of await Promise.all(batch.map(observe))) {
        if (!outcome.rejected) continue;
        const message = reasonMessage(outcome.reason);
        const declaration = declarations.find((candidate) =>
          matchesMessageStart(candidate.start, message),
        );
        if (declaration) declaration.rejections.push(outcome.reason);
        else undeclared.push(message);
      }
    }
  }
  const wrongCount = declarations
    .splice(0)
    .filter(
      (declaration) => declaration.rejections.length !== declaration.times,
    )
    .map(
      (declaration) =>
        `${String(declaration.start)} (expected ${declaration.times}, got ${declaration.rejections.length})`,
    );
  if (undeclared.length > 0) {
    failures.unshift(
      `Undeclared background rejections:\n${undeclared.join("\n")}`,
    );
  }
  if (wrongCount.length > 0) {
    failures.push(
      `Expected background rejections came another number of times:\n${wrongCount.join("\n")}`,
    );
  }
  return failures;
}

/** Registers the observation and the per-test drain. Called once per file from `setup.ts`. */
export function installWaitUntilDrain(): void {
  beforeEach(async () => {
    declarations.length = 0;
    // A file that mocks `@vercel/functions` gets its mock here.
    const { waitUntil } = await import("@vercel/functions");
    if (vi.isMockFunction(waitUntil)) observeCalls(waitUntil.mock);
  });
  afterEach(async ({ task }) => {
    const failures = await drainWaitUntil();
    if (task.result?.state === "skip" || failures.length === 0) return;
    throw new Error(
      `${failures.join("\n")}\nAwait or settle the work, or, when a rejection is the test's subject, declare it with expectBackgroundRejection() from "@/test/wait-until".`,
    );
  });
}
