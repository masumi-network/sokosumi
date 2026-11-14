import type { ChildProcess } from "node:child_process";

const STDERR_TAIL_CHARS = 1_500;

export interface RunnerFailure {
  code: string;
  message: string;
}

/**
 * Waits for the runner process and reports how it ended when that was not a
 * clean exit. A runner that crashes, runs out of memory or is killed cannot
 * say so itself, and its turn would sit until the deadline. Resolves with
 * the exit code to pass on.
 */
export async function superviseRunner(
  child: Pick<ChildProcess, "stderr" | "once" | "kill">,
  report: (failure: RunnerFailure) => Promise<unknown>,
): Promise<number> {
  let tail = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
    tail = (tail + chunk.toString()).slice(-STDERR_TAIL_CHARS);
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
  // A runner that reported its own failure has already settled the turn;
  // Core then refuses this one.
  await report({
    code: "runner_exited",
    message: `The runner ended with ${how}${tail.trim() ? `: ${tail.trim()}` : ""}`,
  }).catch(() => undefined);
  return 1;
}
