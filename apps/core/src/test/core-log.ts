import { beforeEach, expect, onTestFinished } from "vitest";

/**
 * In tests evlog is silent and every event lands in this drain, reset per
 * test. A test fails when it logs a Core warning or error it did not declare,
 * or a declared one another number of times, like `expectConsole` from
 * `@sokosumi/utils/test-console`. A test whose subject is that path declares
 * it with `expectCoreLog`.
 *
 * The drain sees an event after redaction, as Sentry would.
 */

export type CoreLogLevel = "warn" | "error";

/** One warning or error on a drained event. */
export interface CoreLogEntry {
  level: CoreLogLevel;
  message: string;
  why?: string;
  fix?: string;
  link?: string;
  /** The error behind it, as drained: provider text belongs here, not in `why`. */
  cause?: unknown;
  /** The whole drained event, for its fields. */
  event: Record<string, unknown>;
}

interface Declaration {
  level: CoreLogLevel;
  start: string;
  times: number;
  entries: CoreLogEntry[];
}

const declarations: Declaration[] = [];
/** Every event drained in the current test, info events included. */
const events: Record<string, unknown>[] = [];
/** Every entry drained in the current test, and the declaration it matched. */
const recorded: { entry: CoreLogEntry; declaration?: Declaration }[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function entryLevel(level: unknown): CoreLogLevel | null {
  if (level === "warn") return "warn";
  if (level === "error" || level === "fatal") return "error";
  return null;
}

function guidance(record: Record<string, unknown>) {
  return {
    why: optionalString(record.why),
    fix: optionalString(record.fix),
    link: optionalString(record.link),
    cause: record.cause,
  };
}

/**
 * The warnings and errors an event carries: its `error` (`log.error`), each
 * warn, error or fatal line in `requestLogs` (`log.warn`, `log.fatal`, and
 * `logCoreWarning`, whose `warnings` item names its line and adds that line's why and fix), and
 * the event's own level when nothing else explains it (`log.setLevel`).
 */
function entriesOf(event: Record<string, unknown>): CoreLogEntry[] {
  const entries: CoreLogEntry[] = [];
  if (isRecord(event.error)) {
    entries.push({
      level: "error",
      message: optionalString(event.error.message) ?? "",
      ...guidance(event.error),
      event,
    });
  }
  // `logCoreWarning` records the index of its own `requestLogs` line, so
  // guidance never moves to another line that shares its message.
  const warnings = (Array.isArray(event.warnings) ? event.warnings : []).filter(
    isRecord,
  );
  const requestLogs = Array.isArray(event.requestLogs) ? event.requestLogs : [];
  const linked = new Map<number, Record<string, unknown>>();
  for (const warning of warnings) {
    const line = requestLogs[Number(warning.requestLogIndex)];
    if (
      Number.isInteger(warning.requestLogIndex) &&
      isRecord(line) &&
      line.level === "warn" &&
      line.message === warning.message &&
      !linked.has(Number(warning.requestLogIndex))
    ) {
      linked.set(Number(warning.requestLogIndex), warning);
    }
  }
  requestLogs.forEach((line, index) => {
    if (!isRecord(line)) return;
    const level = entryLevel(line.level);
    if (!level) return;
    const warning = linked.get(index);
    entries.push({
      level,
      message: optionalString(line.message) ?? "",
      ...(warning ? guidance(warning) : {}),
      event,
    });
  });
  const linkedWarnings = new Set(linked.values());
  for (const warning of warnings.filter((item) => !linkedWarnings.has(item))) {
    entries.push({
      level: "warn",
      message: optionalString(warning.message) ?? "",
      ...guidance(warning),
      event,
    });
  }
  const level = entryLevel(event.level);
  if (level && entries.length === 0) {
    entries.push({
      level,
      message: optionalString(event.message) ?? "",
      event,
    });
  }
  return entries;
}

function matches(declaration: Declaration, entry: CoreLogEntry): boolean {
  return (
    declaration.level === entry.level &&
    entry.message.startsWith(declaration.start)
  );
}

/** The drain every test starts on: every entry counts, declared or not. */
export function coreLogDrain({ event }: { event: Record<string, unknown> }) {
  events.push(event);
  for (const entry of entriesOf(event)) {
    const declaration = declarations.find((candidate) =>
      matches(candidate, entry),
    );
    declaration?.entries.push(entry);
    recorded.push({ entry, declaration });
  }
}

/** Every event drained in the current test so far, in order, after redaction. */
export function coreLogEvents(): readonly Record<string, unknown>[] {
  return events;
}

/**
 * Declares that the current test logs a Core `level` entry whose message
 * starts with `start`, exactly `times` times. Returns the matched entries as
 * they arrive, for assertions on `why`, `fix` and the event's fields.
 */
export function expectCoreLog(
  level: CoreLogLevel,
  start: string,
  times = 1,
): CoreLogEntry[] {
  const declaration: Declaration = { level, start, times, entries: [] };
  declarations.push(declaration);
  // Entries drained earlier in this test, not yet declared, count too.
  for (const record of recorded) {
    if (!record.declaration && matches(declaration, record.entry)) {
      record.declaration = declaration;
      declaration.entries.push(record.entry);
    }
  }
  return declaration.entries;
}

/**
 * `expectCoreLog` for entries whose `why` is known: one entry per item of
 * `whys`, checked in order when the test ends, and, when given, each entry's
 * `cause` message (where provider text belongs) against `causes`.
 */
export function expectCoreLogWhys(
  level: CoreLogLevel,
  start: string,
  whys: readonly string[],
  causes?: readonly string[],
): CoreLogEntry[] {
  const entries = expectCoreLog(level, start, whys.length);
  onTestFinished(() => {
    expect(entries.map((entry) => entry.why)).toEqual(whys);
    if (causes) {
      expect(entries.map((entry) => causeMessage(entry.cause))).toEqual(causes);
    }
  });
  return entries;
}

/** A drained `cause`'s message, the provider text it carries. */
export function causeMessage(cause: unknown): string | undefined {
  return isRecord(cause) ? optionalString(cause.message) : undefined;
}

/** Every entry the current test logged so far, declared or not, in order. */
export function coreLogEntries(): readonly CoreLogEntry[] {
  return recorded.map((record) => record.entry);
}

/**
 * The current test's failures: undeclared entries, and declarations that
 * matched another number of times. Clears the test's state.
 */
export function takeCoreLogFailures(): string[] {
  const undeclared = recorded
    .splice(0)
    .filter((record) => !record.declaration)
    .map(({ entry }) => `${entry.level}: ${entry.message}`);
  const wrongCount = declarations
    .splice(0)
    .filter((declaration) => declaration.entries.length !== declaration.times)
    .map(
      (declaration) =>
        `${declaration.level}: ${declaration.start} (expected ${declaration.times}, got ${declaration.entries.length})`,
    );
  const failures: string[] = [];
  if (undeclared.length > 0) {
    failures.push(`Undeclared Core log entries:\n${undeclared.join("\n")}`);
  }
  if (wrongCount.length > 0) {
    failures.push(
      `Expected Core log entries came another number of times:\n${wrongCount.join("\n")}`,
    );
  }
  return failures;
}

const EVLOG_REGISTRY = Symbol.for("evlog.registry.v2");
let configAtFileStart: Record<string, unknown> | undefined;

/** evlog's config as this file found it, before the test drain went in. */
export function evlogConfigAtFileStart(): Record<string, unknown> | undefined {
  return configAtFileStart;
}

/**
 * `expectCoreLog` for an entry logged while the test file loads, before any
 * test: call it at the top of the file, before the import that logs. The
 * file's first test fails when the count differs.
 */
export function expectCoreLogAtLoad(
  level: CoreLogLevel,
  start: string,
  times = 1,
): CoreLogEntry[] {
  return expectCoreLog(level, start, times);
}

/**
 * Registers the drain and the per-test check. Called once per file from
 * `setup.ts`, before the file's modules load: a module that logs at import
 * lands in the silent, redacting test drain too, and counts against the
 * file's first test unless `expectCoreLogAtLoad` declared it.
 */
export async function installCoreLogDrain(): Promise<void> {
  const config = (
    globalThis as Record<symbol, { config?: Record<string, unknown> }>
  )[EVLOG_REGISTRY]?.config;
  configAtFileStart = config ? { ...config } : undefined;

  declarations.length = 0;
  recorded.length = 0;
  events.length = 0;
  // A copy of its own, by query: the file's `@/lib/evlog` still loads after
  // the file's `vi.mock`s apply. The drain is evlog's process-wide config,
  // so this copy's call holds for the file's copy too.
  const ownCopy = "@/lib/evlog?test-drain";
  const evlog = (await import(ownCopy)) as typeof import("@/lib/evlog");
  evlog.initCoreLogger({ silent: true, drain: coreLogDrain });
  let loading = true;

  beforeEach(async ({ task, onTestFinished }) => {
    if (loading) {
      loading = false;
      const failures = takeCoreLogFailures();
      if (failures.length > 0) {
        throw new Error(
          `While the test file loaded:\n${failures.join("\n")}\nFix its cause, or declare it with expectCoreLogAtLoad() from "@/test/core-log".`,
        );
      }
    }
    declarations.length = 0;
    recorded.length = 0;
    events.length = 0;
    // Imported here, not at the top: a file's own `vi.mock` of a module
    // `@/lib/evlog` imports must apply, and a file that mocks `@/lib/evlog`
    // itself emits nothing to drain.
    const evlog = await import("@/lib/evlog");
    if ("initCoreLogger" in evlog) {
      evlog.initCoreLogger({ silent: true, drain: coreLogDrain });
    }
    onTestFinished(() => {
      const failures = takeCoreLogFailures();
      if (task.result?.state === "skip" || failures.length === 0) return;
      throw new Error(
        `${failures.join("\n")}\nFix its cause, or, when it is the test's subject, declare it with expectCoreLog() from "@/test/core-log".`,
      );
    });
  });
}
