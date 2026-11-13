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
  child: Pick<ChildProcess, "stderr" | "once">,
  report: (failure: RunnerFailure) => Promise<unknown>,
): Promise<number> {
  let tail = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
    tail = (tail + chunk.toString()).slice(-STDERR_TAIL_CHARS);
  });
  const [code, signal] = await new Promise<
    [number | null, NodeJS.Signals | null]
  >((resolve) => {
    child.once("close", (exitCode, exitSignal) =>
      resolve([exitCode, exitSignal]),
    );
  });
  if (code === 0) return 0;
  const how = signal ? `signal ${signal}` : `exit code ${code}`;
  // A runner that reported its own failure has already settled the turn;
  // Core then refuses this one.
  await report({
    code: "runner_exited",
    message: `The runner ended with ${how}${tail.trim() ? `: ${tail.trim()}` : ""}`,
  }).catch(() => undefined);
  return code ?? 1;
}
