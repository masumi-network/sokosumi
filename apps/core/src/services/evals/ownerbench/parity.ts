/**
 * Runtime parity for the owner benchmark. `evals:local` runs journeys on the
 * in-process runtime; deployments run the sandbox runtime, with its own loop,
 * sandbox tools and final report call. A journey whose outcome differs between
 * the two measures the runtime, not the bot, so a version's delta on it is
 * not trusted until two different runtimes agree on it.
 */

/** The slice of one run's report this reads (`sokosumi evals show RUN_ID --json`). */
export interface ParityReport {
  /** The run's environment (getEvalRunReport); older reports may lack it. */
  run?: { environment?: string | null };
  cases: {
    caseId: string;
    results: {
      status: string;
      output?: unknown;
    }[];
  }[];
}

interface Side {
  /** `adapter/models` of the scored repeats; null when a result lacks it. */
  runtime: string | null;
  /** Per scored repeat: status and the 1-based steps that failed. */
  repeats: { status: string; failedSteps: number[] }[];
}

export interface ParityRow {
  caseId: string;
  a: Side;
  b: Side;
  verdict: "agree" | "divergent" | "unverified";
  reason: string;
}

const SCORED = new Set(["PASSED", "FAILED"]);

function side(results: readonly { status: string; output?: unknown }[]): Side {
  const scored = results.filter((result) => SCORED.has(result.status));
  const runtimes = new Set(
    scored.map((result) => {
      const runtime = (
        result.output as {
          runtime?: { adapter?: string; models?: string };
        } | null
      )?.runtime;
      return runtime?.adapter ? `${runtime.adapter}/${runtime.models}` : null;
    }),
  );
  return {
    runtime: runtimes.size === 1 ? ([...runtimes][0] ?? null) : null,
    repeats: scored.map((result) => {
      const steps =
        (
          result.output as {
            steps?: { index: number; passed?: boolean }[];
          } | null
        )?.steps ?? [];
      return {
        status: result.status,
        failedSteps: steps
          .filter((step) => !step.passed)
          .map((step) => step.index + 1),
      };
    }),
  };
}

const adapterOf = (runtime: string) => runtime.split("/")[0];

/** The repeats' outcomes, order ignored: `PASSED` or `FAILED at 2,3`. */
function outcomes(value: Side): string[] {
  return value.repeats
    .map((repeat) =>
      repeat.status === "PASSED"
        ? "PASSED"
        : `FAILED at ${repeat.failedSteps.join(",") || "?"}`,
    )
    .sort();
}

function compare(a: Side, b: Side): Pick<ParityRow, "verdict" | "reason"> {
  if (a.repeats.length === 0 || b.repeats.length === 0)
    return { verdict: "unverified", reason: "no scored result on one side" };
  if (!a.runtime || !b.runtime)
    return { verdict: "unverified", reason: "runtime not recorded" };
  if (adapterOf(a.runtime) === adapterOf(b.runtime))
    return {
      verdict: "unverified",
      reason: `both ran on ${adapterOf(a.runtime)}`,
    };
  const left = outcomes(a);
  const right = outcomes(b);
  return left.join("|") === right.join("|")
    ? { verdict: "agree", reason: left.join("; ") }
    : {
        verdict: "divergent",
        reason: `${a.runtime}: ${left.join("; ")} vs ${b.runtime}: ${right.join("; ")}`,
      };
}

/** The owner journeys of two runs side by side: agree, divergent or unverified. */
export function journeyParity(a: ParityReport, b: ParityReport): ParityRow[] {
  const byCase = (report: ParityReport) =>
    new Map(
      report.cases.map((evalCase) => [evalCase.caseId, evalCase.results]),
    );
  const left = byCase(a);
  const right = byCase(b);
  const ids = [...new Set([...left.keys(), ...right.keys()])].filter((id) =>
    id.startsWith("owner-"),
  );
  return ids.map((caseId) => {
    const sideA = side(left.get(caseId) ?? []);
    const sideB = side(right.get(caseId) ?? []);
    return { caseId, a: sideA, b: sideB, ...compare(sideA, sideB) };
  });
}
