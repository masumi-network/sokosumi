/**
 * Runtime parity for the owner benchmark. `evals:local` runs journeys on the
 * in-process runtime; deployments run the sandbox runtime, with its own loop,
 * sandbox tools and final report call. A journey whose outcome differs between
 * the two measures the runtime, not the bot, so a version's delta on it is
 * not trusted until they agree.
 */

/** The slice of one run's report this reads (`sokosumi evals show RUN --json`). */
export interface ParityReport {
  cases: {
    caseId: string;
    results: {
      status: string;
      output?: unknown;
    }[];
  }[];
}

interface JourneyResult {
  status: string;
  stepsPassed: number | null;
  stepsTotal: number | null;
  runtime: string;
}

export interface ParityRow {
  caseId: string;
  a: JourneyResult | null;
  b: JourneyResult | null;
  /** Empty when both runtimes agree. */
  flag: string;
}

function journeyResult(result: {
  status: string;
  output?: unknown;
}): JourneyResult {
  const output = (result.output ?? {}) as {
    score?: { stepsPassed?: number; stepsTotal?: number };
    runtime?: { adapter?: string; models?: string };
  };
  return {
    status: result.status,
    stepsPassed: output.score?.stepsPassed ?? null,
    stepsTotal: output.score?.stepsTotal ?? null,
    runtime: output.runtime
      ? `${output.runtime.adapter}/${output.runtime.models}`
      : "unknown",
  };
}

function firstResults(report: ParityReport): Map<string, JourneyResult> {
  return new Map(
    report.cases.flatMap((evalCase) => {
      const result = evalCase.results.find(
        (row) => row.status === "PASSED" || row.status === "FAILED",
      );
      return result ? [[evalCase.caseId, journeyResult(result)]] : [];
    }),
  );
}

function flagFor(a: JourneyResult | null, b: JourneyResult | null): string {
  if (!a || !b) return `only ran on ${a ? a.runtime : b?.runtime}`;
  if (a.status !== b.status)
    return `${a.status === "PASSED" ? "passes" : "fails"} only on ${a.runtime}`;
  if (a.stepsPassed !== b.stepsPassed)
    return `steps ${a.stepsPassed} on ${a.runtime}, ${b.stepsPassed} on ${b.runtime}`;
  return "";
}

/** The owner journeys of two runs side by side, disagreements flagged. */
export function journeyParity(a: ParityReport, b: ParityReport): ParityRow[] {
  const left = firstResults(a);
  const right = firstResults(b);
  const ids = [...new Set([...left.keys(), ...right.keys()])].filter((id) =>
    id.startsWith("owner-"),
  );
  return ids.map((caseId) => {
    const rowA = left.get(caseId) ?? null;
    const rowB = right.get(caseId) ?? null;
    return { caseId, a: rowA, b: rowB, flag: flagFor(rowA, rowB) };
  });
}
