/** How the world check (B2) judges a journey from its runs; pure, so it is tested offline. */
export type WorldCheckRunMode = "noop" | "reference";

export interface WorldCheckCheck {
  label: string;
  pass: boolean;
  actual?: string;
}

export interface WorldCheckResult {
  repeat: number;
  checks: WorldCheckCheck[];
  /** Why the run did not validate the journey, or null. */
  invalid: string | null;
}

export interface WorldCheckRun {
  mode: WorldCheckRunMode;
  pass: number;
  results: WorldCheckResult[];
  /** The lane right after the runner's reset, before the agent acted. */
  afterReset: Record<string, number> | null;
}

// The runner reports an unjudged journey with this error; any other error,
// or no checks at all, means the run did not validate the journey.
const JUDGE_OFF = /judge was unavailable/i;

export function resultInvalid(row: {
  status: string;
  error: string | null;
  finishedAt: Date | null;
  checks: readonly WorldCheckCheck[];
}): string | null {
  if (!row.finishedAt) return `did not finish (${row.status})`;
  if (row.checks.length === 0)
    return `no checks (${row.status}${row.error ? `: ${row.error.slice(0, 160)}` : ""})`;
  if (row.status === "ERROR" && !JUDGE_OFF.test(row.error ?? ""))
    return `run error: ${(row.error ?? "").slice(0, 160)}`;
  return null;
}

const allPass = (checks: readonly WorldCheckCheck[]) =>
  checks.length > 0 && checks.every((check) => check.pass);
const signature = (checks: readonly WorldCheckCheck[]) =>
  checks.map((check) => `${check.label}:${check.pass}`).join("|");

/** Every way the journey's world or grader failed validation; empty when it held. */
export function journeyProblems(
  runs: readonly WorldCheckRun[],
  options: { modes: readonly WorldCheckRunMode[]; hasScript: boolean },
): string[] {
  const problems: string[] = [];
  if (options.modes.includes("reference") && !options.hasScript)
    problems.push("reference: UNCOVERED (no script)");
  for (const mode of options.modes)
    if (!runs.some((run) => run.mode === mode))
      problems.push(`${mode}: INVALID RUN, never ran`);
  for (const run of runs) {
    const where = `${run.mode} pass ${run.pass}`;
    if (!run.results.length)
      problems.push(`${where}: INVALID RUN, the run made no result`);
    for (const result of run.results) {
      if (result.invalid) {
        problems.push(
          `${where} r${result.repeat}: INVALID RUN, ${result.invalid}`,
        );
        continue;
      }
      if (run.mode === "noop" && allPass(result.checks))
        problems.push(
          `${where} r${result.repeat}: do-nothing PASSES (checks too loose)`,
        );
      if (run.mode === "reference" && !allPass(result.checks))
        problems.push(
          `${where} r${result.repeat}: reference FAILS: ${result.checks
            .filter((check) => !check.pass)
            .map(
              (check) =>
                `${check.label} => ${(check.actual ?? "").slice(0, 200)}`,
            )
            .join("; ")}`,
        );
    }
    if (!run.afterReset)
      problems.push(
        `${where}: no agent step, so the lane after the reset was not checked`,
      );
    else if (Object.values(run.afterReset).some(Boolean))
      problems.push(
        `${where}: left over after the reset ${JSON.stringify(run.afterReset)}`,
      );
  }
  for (const mode of options.modes) {
    const signatures = new Set(
      runs
        .filter((run) => run.mode === mode)
        .flatMap((run) => run.results)
        .filter((result) => !result.invalid)
        .map((result) => signature(result.checks)),
    );
    if (signatures.size > 1)
      problems.push(`${mode}: passes give different checks`);
  }
  return problems;
}
