import type { ChildProcess } from "node:child_process";
import {
  describeRunnerDiagnostic,
  type RunnerDiagnostic,
  runnerDiagnostic,
} from "../lib/soko-bot/runner-log-events";

const STDERR_TAIL_CHARS = 1_500;

export interface RunnerFailure {
  code: string;
  message: string;
  /** The runner's own account of why it ended, for Core's drain. */
  diagnostic?: RunnerDiagnostic;
}

/**
 * Waits for the runner process and reports how it ended when that was not a
 * clean exit. A runner that crashes, runs out of memory or is killed cannot
 * say so itself, and its turn would sit until the deadline. Resolves with
 * the exit code to pass on.
 *
 * A runner that knows why it is ending sends a diagnostic over IPC first. Its
 * logs go to the sandbox's stdout, which nothing reads, so the diagnostic is
 * the only account that reaches Core: in this report, sent at once.
 */
export async function superviseRunner(
  child: Pick<ChildProcess, "stderr" | "once" | "on" | "kill">,
  report: (failure: RunnerFailure) => Promise<unknown>,
): Promise<number> {
  let tail = "";
  let diagnostic: RunnerDiagnostic | null = null;
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
    tail = (tail + chunk.toString()).slice(-STDERR_TAIL_CHARS);
  });
  child.on("message", (message: unknown) => {
    diagnostic = runnerDiagnostic(message) ?? diagnostic;
  });
  // Whoever stops this process means the runner: pass the signal on.
  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  process.on("SIGTERM", forward);
  process.on("SIGINT", forward);
  const how = await new Promise<string | null>((resolve) => {
    // A runner that could not be started at all ends with an error only.
    child.once("error", (error) => resolve(`an error: ${error.message}`));
    child.once("close", (code, signal) =>
      resolve(
        code === 0 ? null : signal ? `signal ${signal}` : `exit code ${code}`,
      ),
    );
  });
  process.off("SIGTERM", forward);
  process.off("SIGINT", forward);
  if (!how) return 0;
  const said = [
    ...(diagnostic ? [describeRunnerDiagnostic(diagnostic)] : []),
    ...(tail.trim() ? [tail.trim()] : []),
  ].join("\n");
  // A runner that reported its own failure has already settled the turn;
  // Core then refuses this one.
  await report({
    code: "runner_exited",
    message: `The runner ended with ${how}${said ? `: ${said}` : ""}`,
    ...(diagnostic ? { diagnostic } : {}),
  }).catch(() => undefined);
  return 1;
}
