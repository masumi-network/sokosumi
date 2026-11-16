import { format, stripVTControlCharacters } from "node:util";

import { afterAll, afterEach, expect, vi } from "vitest";

/**
 * A test fails when it writes a `console.error` or `console.warn` it did
 * not declare. Such output means the test ran something other than
 * production: a mock missing a method, a client reaching a real service, a
 * fixture production would reject. `console.log` stays allowed.
 *
 * A test whose subject is that error path declares it with `expectConsole`,
 * which also fails the test when the message comes another number of times.
 */

type ConsoleMethod = "error" | "warn";

const METHODS = ["error", "warn"] as const;

interface ExpectedMessage {
  method: ConsoleMethod;
  start: string | RegExp;
  times: number;
  calls: unknown[][];
}

interface ConsoleGuardState {
  expected: ExpectedMessage[];
  unexpected: string[];
  /** Mock implementations put on console.error/warn during this test. */
  muted: string[];
}

// The unit project reuses one worker across files and re-evaluates this
// module per file, so the state lives on `globalThis` beside the one
// console patch that reads it.
const STATE_KEY = Symbol.for("sokosumi.test.console-guard");

function matches(entry: ExpectedMessage, text: string): boolean {
  return typeof entry.start === "string"
    ? text.startsWith(entry.start)
    : entry.start.test(stripVTControlCharacters(text));
}

function guardState(): ConsoleGuardState {
  const holder = globalThis as { [STATE_KEY]?: ConsoleGuardState };
  const existing = holder[STATE_KEY];
  if (existing) return existing;

  const state: ConsoleGuardState = { expected: [], unexpected: [], muted: [] };
  for (const method of METHODS) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const text = format(...args);
      const match = state.expected.find(
        (entry) =>
          entry.method === method &&
          entry.calls.length < entry.times &&
          matches(entry, text),
      );
      if (match) {
        match.calls.push(args);
        return;
      }
      state.unexpected.push(`console.${method}: ${text}`);
      original(...args);
    };
  }

  // A spy given an implementation swallows output, even when the test
  // restores it before this guard looks. Record the moment it happens.
  const spyOn = vi.spyOn.bind(vi);
  vi.spyOn = ((target: object, key: PropertyKey, ...rest: never[]) => {
    const spy = (spyOn as (...args: unknown[]) => unknown)(
      target,
      key,
      ...rest,
    ) as Record<string, (...args: unknown[]) => unknown>;
    if (target === console && METHODS.some((method) => method === key)) {
      for (const name of [
        "mockImplementation",
        "mockImplementationOnce",
        "mockReturnValue",
        "mockReturnValueOnce",
      ]) {
        const set = spy[name]?.bind(spy);
        if (!set) continue;
        spy[name] = (...args: unknown[]) => {
          state.muted.push(`console.${String(key)}.${name}`);
          return set(...args);
        };
      }
    }
    return spy;
  }) as typeof vi.spyOn;

  holder[STATE_KEY] = state;
  return state;
}

/**
 * Declares that the current test writes `console[method]` exactly `times`
 * times with a message that starts with `start`. A RegExp is matched against
 * the text without terminal colors and must be anchored with `^`, for
 * library loggers that put a timestamp first. Returns the matched calls'
 * arguments as they arrive, for assertions on them.
 */
export function expectConsole(
  method: ConsoleMethod,
  start: string | RegExp,
  times = 1,
): unknown[][] {
  if (start instanceof RegExp && !start.source.startsWith("^")) {
    throw new Error(
      `expectConsole: anchor the message pattern with ^ (got ${start})`,
    );
  }
  const calls: unknown[][] = [];
  guardState().expected.push({ method, start, times, calls });
  return calls;
}

function unexpectedError(messages: string[], where: string): Error {
  return new Error(
    `Unexpected console output ${where}. Fix its cause, or, when it is the test's subject, declare it with expectConsole() from "@/test/console":\n${messages.join("\n---\n")}`,
  );
}

/** Registers the per-test check. Called once per file from `setup.ts`. */
export function installConsoleGuard(): void {
  const state = guardState();
  state.expected.length = 0;
  state.muted.length = 0;

  afterEach(() => {
    // A spy that only watches still passes output through to the guard; a
    // mock implementation swallows it.
    const mocked = METHODS.filter(
      (method) =>
        vi.isMockFunction(console[method]) &&
        vi.mocked(console[method]).getMockImplementation() !== undefined,
    );
    for (const method of mocked) vi.mocked(console[method]).mockRestore();
    const muted = state.muted.splice(0);
    if (mocked.length > 0 || muted.length > 0) {
      state.expected.length = 0;
      state.unexpected.length = 0;
      throw new Error(
        `${[...new Set([...muted, ...mocked.map((m) => `console.${m}`)])].join(", ")} replaced console output this guard checks. Declare the expected message with expectConsole() from "@/test/console" instead.`,
      );
    }
    const unexpected = state.unexpected.splice(0);
    const wrongCount = state.expected
      .splice(0)
      .filter((entry) => entry.calls.length !== entry.times)
      .map(
        (entry) =>
          `console.${entry.method}: ${String(entry.start)} (expected ${entry.times}, got ${entry.calls.length})`,
      );
    if (unexpected.length > 0) {
      throw unexpectedError(
        unexpected,
        `in "${expect.getState().currentTestName}"`,
      );
    }
    if (wrongCount.length > 0) {
      throw new Error(
        `Expected console output came another number of times:\n${wrongCount.join("\n")}`,
      );
    }
  });

  // Output between tests: collection, `beforeAll`/`afterAll`, or work a
  // test left running (in a shared worker, possibly an earlier file's).
  afterAll(() => {
    const unexpected = state.unexpected.splice(0);
    if (unexpected.length > 0) {
      throw unexpectedError(unexpected, "outside a test in this file");
    }
  });
}
