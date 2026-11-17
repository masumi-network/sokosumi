import { format, stripVTControlCharacters } from "node:util";

import { afterAll, beforeEach, expect, vi } from "vitest";

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

type ConsoleFn = (...args: unknown[]) => void;

interface ConsoleGuardState {
  expected: ExpectedMessage[];
  unexpected: string[];
  /** Replacements of console.error/warn since the last check. */
  muted: string[];
  guarded: Record<ConsoleMethod, ConsoleFn>;
  /** What `console[method]` holds now: the guard or a spy that watches it. */
  current: Record<ConsoleMethod, ConsoleFn>;
  /** Spies `vi.spyOn(console, …)` made, which pass every call through. */
  watching: WeakSet<ConsoleFn>;
  /** The console object the guard patched, and what `globalThis.console` holds now. */
  guardedConsole: Console;
  currentConsole: Console;
}

// The unit project reuses one worker across files and re-evaluates this
// module per file, so the state lives on `globalThis` beside the one
// console patch that reads it.
const STATE_KEY = Symbol.for("sokosumi.test.console-guard");

function matches(entry: ExpectedMessage, text: string): boolean {
  if (typeof entry.start === "string") return text.startsWith(entry.start);
  // A fresh pattern without g, y or m: no lastIndex carried between calls,
  // and ^ cannot match after a newline. Index 0 also catches an unanchored
  // alternative (`/^a|b/`) that matched later in the text.
  const pattern = new RegExp(
    entry.start.source,
    entry.start.flags.replace(/[gmy]/g, ""),
  );
  return pattern.exec(stripVTControlCharacters(text))?.index === 0;
}

function guardState(): ConsoleGuardState {
  const holder = globalThis as { [STATE_KEY]?: ConsoleGuardState };
  const existing = holder[STATE_KEY];
  if (existing) return existing;

  const state = {
    expected: [],
    unexpected: [],
    muted: [],
    guarded: {},
    current: {},
    watching: new WeakSet(),
  } as unknown as ConsoleGuardState;
  for (const method of METHODS) {
    const original = console[method].bind(console);
    const guarded: ConsoleFn = (...args) => {
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
    state.guarded[method] = guarded;
    state.current[method] = guarded;
    // A non-configurable accessor: `console.warn = fn` is recorded when it
    // happens, `Object.defineProperty(console, "warn", …)` throws, and only
    // the guard or a spy watching it is accepted as the method.
    Object.defineProperty(console, method, {
      configurable: false,
      enumerable: true,
      get: () => state.current[method],
      set: (next: ConsoleFn) => {
        if (next !== guarded && !state.watching.has(next)) {
          state.muted.push(`console.${method} = …`);
        }
        state.current[method] = next;
      },
    });
  }

  // `vi.spyOn` redefines the property, which the accessor does not allow, so
  // spies on the guarded methods are made here: a mock that passes each call
  // to the guard. Anything that gives it its own behaviour swallows output,
  // even when the test restores it before this guard looks; record that.
  const spyOn = vi.spyOn.bind(vi);
  vi.spyOn = ((target: object, key: PropertyKey, ...rest: never[]) => {
    const method = METHODS.find((name) => name === key);
    if (target !== console || !method) {
      return (spyOn as (...args: unknown[]) => unknown)(target, key, ...rest);
    }
    const spy = vi.fn((...args: unknown[]) =>
      state.guarded[method](...args),
    ) as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const name of [
      "mockImplementation",
      "mockImplementationOnce",
      "mockReturnValue",
      "mockReturnValueOnce",
      "withImplementation",
    ]) {
      const set = spy[name]?.bind(spy);
      if (!set) continue;
      spy[name] = (...args: unknown[]) => {
        state.muted.push(`console.${method}.${name}`);
        // It no longer watches: it is a replacement from here on.
        state.watching.delete(spy as unknown as ConsoleFn);
        return set(...args);
      };
    }
    spy.mockRestore = () => {
      if (state.current[method] === (spy as unknown)) {
        state.current[method] = state.guarded[method];
      }
      return spy;
    };
    state.watching.add(spy as unknown as ConsoleFn);
    state.current[method] = spy as unknown as ConsoleFn;
    return spy;
  }) as typeof vi.spyOn;

  // A swapped console object would carry its own methods past the guard.
  state.guardedConsole = console;
  state.currentConsole = console;
  Object.defineProperty(globalThis, "console", {
    configurable: false,
    enumerable: false,
    get: () => state.currentConsole,
    set: (next: Console) => {
      if (next !== state.guardedConsole)
        state.muted.push("globalThis.console = …");
      state.currentConsole = next;
    },
  });

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

/**
 * Fails when console.error/warn were replaced since the last check. Either
 * way it puts the guard back, watching spies included, so nothing a test
 * installed reaches the next test or file in this worker; `vi.restoreAllMocks`
 * does not take these spies off.
 */
export function checkConsoleUntouched(where: string): void {
  const state = guardState();
  if (state.currentConsole !== state.guardedConsole) {
    state.muted.push("globalThis.console (left replaced)");
    state.currentConsole = state.guardedConsole;
  }
  for (const method of METHODS) {
    const now = state.current[method];
    if (now === state.guarded[method]) continue;
    if (!state.watching.has(now)) {
      state.muted.push(`console.${method} (left replaced)`);
    }
    state.current[method] = state.guarded[method];
  }
  const muted = state.muted.splice(0);
  if (muted.length > 0) {
    state.expected.length = 0;
    state.unexpected.length = 0;
    throw new Error(
      `${[...new Set(muted)].join(", ")} replaced console output this guard checks ${where}. Declare the expected message with expectConsole() from "@/test/console" instead.`,
    );
  }
}

/** Registers the per-test check. Called once per file from `setup.ts`. */
export function installConsoleGuard(): void {
  const state = guardState();
  state.expected.length = 0;

  // Vitest runs onTestFinished hooks last, after afterEach, beforeEach
  // cleanups and fixture teardown, and in reverse: this one, registered
  // first, runs after a test's own. Output and replacements from any of them
  // count against the test that ran them.
  beforeEach(({ onTestFinished }) => {
    const where = `in "${expect.getState().currentTestName}"`;
    onTestFinished(() => {
      checkConsoleUntouched(where);
      const unexpected = state.unexpected.splice(0);
      const wrongCount = state.expected
        .splice(0)
        .filter((entry) => entry.calls.length !== entry.times)
        .map(
          (entry) =>
            `console.${entry.method}: ${String(entry.start)} (expected ${entry.times}, got ${entry.calls.length})`,
        );
      if (unexpected.length > 0) throw unexpectedError(unexpected, where);
      if (wrongCount.length > 0) {
        throw new Error(
          `Expected console output came another number of times:\n${wrongCount.join("\n")}`,
        );
      }
    });
  });

  // Output between tests: collection, `beforeAll`/`afterAll`, or work a
  // test left running (in a shared worker, possibly an earlier file's).
  afterAll(() => {
    checkConsoleUntouched("outside a test in this file");
    const unexpected = state.unexpected.splice(0);
    if (unexpected.length > 0) {
      throw unexpectedError(unexpected, "outside a test in this file");
    }
  });
}
