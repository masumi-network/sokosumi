/**
 * The events the Soko Bot runner hands to Core's drain, by name. The sandbox
 * has no Sentry, so the runner's supervisor carries the event in its failure
 * report (`POST …/fail`, `diagnostic`), and Core logs it once per turn, when
 * it claims the turn's `runnerDiagnosticAt`. It carries a name and closed-set
 * fields, never text: anything in the sandbox, user code included, can call
 * `/fail`, so Core writes only its own sentences. Imported by the runner too,
 * whose bundle has no `@/` alias.
 */
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { z } from "zod";
import { emitCoreError, emitCoreWarning } from "../evlog";

export const RUNNER_LOG_EVENTS = {
  start_failed: {
    level: "error",
    message: "A Soko Bot turn could not start in its sandbox",
    why: "Core refused or did not answer the runner's start call",
    fix: "coreResponse has Core's status and kind; the start call's request event has the same turnId and the rest.",
  },
} as const satisfies Record<
  string,
  { level: "warn" | "error"; message: string; why: string; fix: string }
>;

export type RunnerLogEventName = keyof typeof RUNNER_LOG_EVENTS;

/** Error names a failed Core call can end with; any other is left out. */
export const RUNNER_ERROR_NAMES = [
  "Error",
  "AbortError",
  "TimeoutError",
  "TypeError",
  "SyntaxError",
] as const;

/**
 * A diagnostic from closed sets only, checked the same way on both sides:
 * by the supervisor before it words the failure, and by Core before it logs.
 * Anything else drops the whole diagnostic, never part of it.
 */
export const runnerDiagnosticSchema = z.strictObject({
  event: z.enum(
    Object.keys(RUNNER_LOG_EVENTS) as [
      RunnerLogEventName,
      ...RunnerLogEventName[],
    ],
  ),
  coreResponse: z
    .strictObject({
      status: z.number().int().min(100).max(599),
      kind: z.enum(Object.values(CORE_API_ERROR_KINDS)).optional(),
    })
    .optional(),
  errorName: z.enum(RUNNER_ERROR_NAMES).optional(),
});

export type RunnerDiagnostic = z.infer<typeof runnerDiagnosticSchema>;

/** `value` as a diagnostic, or null when anything in it is off the sets. */
export function runnerDiagnostic(value: unknown): RunnerDiagnostic | null {
  const parsed = runnerDiagnosticSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The diagnostic in one line for the turn's failure: only Core's words. */
export function describeRunnerDiagnostic(diagnostic: RunnerDiagnostic): string {
  const { message } = RUNNER_LOG_EVENTS[diagnostic.event];
  const response = diagnostic.coreResponse;
  return response
    ? `${message} (Core answered ${[response.status, response.kind].filter(Boolean).join(" ")})`
    : message;
}

/**
 * The runner's event as a standalone one: in the sandbox with its `cause`,
 * and in Core, without one, from the diagnostic.
 */
export function logRunnerDiagnostic(
  context: { turnId?: string; sessionId?: string },
  { event, ...fields }: RunnerDiagnostic,
  cause?: unknown,
) {
  const { level, ...guidance } = RUNNER_LOG_EVENTS[event];
  const eventContext = {
    operation: "soko_bot_runner",
    source: "soko-bot-runner",
    ...context,
  };
  if (level === "error")
    emitCoreError(eventContext, { ...guidance, cause }, fields);
  else emitCoreWarning(eventContext, { ...guidance, cause }, fields);
}
