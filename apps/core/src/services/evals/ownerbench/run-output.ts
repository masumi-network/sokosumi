/**
 * What `evals:local` prints when a run finishes. Every case gets a line,
 * except the held-out journeys: their ids, errors and progress would show
 * the set, so stdout gets their counts only. Per-case detail stays in the
 * evaluator's `--json-out` file.
 */
import { HOLDOUT_PREFIX } from "./holdout";

export interface RunResultRow {
  caseId: string;
  repeat: number;
  status: string;
  durationMs: number | null;
  error: string | null;
  output: unknown;
}

function progress(output: unknown): string {
  const { score, totals } = (output ?? {}) as {
    score?: { stepsPassed: number; stepsTotal: number; reached: number };
    totals?: { toolErrors: number; retries: number; costUsd: number };
  };
  return score && totals
    ? `steps ${score.stepsPassed}/${score.stepsTotal}, first ${score.reached} in a row, ${totals.toolErrors} tool errors, ${totals.retries} retries, $${totals.costUsd.toFixed(2)}`
    : "";
}

export function runOutputLines(results: readonly RunResultRow[]): string[] {
  const held = results.filter((result) =>
    result.caseId.startsWith(HOLDOUT_PREFIX),
  );
  const lines = results
    .filter((result) => !result.caseId.startsWith(HOLDOUT_PREFIX))
    .map((result) =>
      [
        result.caseId,
        `r${result.repeat}`,
        result.status,
        result.durationMs == null
          ? ""
          : `${Math.round(result.durationMs / 1000)}s`,
        progress(result.output),
        result.error?.slice(0, 160) ?? "",
      ].join("\t"),
    );
  if (!held.length) return lines;
  const count = (status: string) =>
    held.filter((result) => result.status === status).length;
  const unscored = held.length - count("PASSED") - count("FAILED");
  const journeys = new Set(held.map((result) => result.caseId)).size;
  return [
    ...lines,
    `Held-out set: ${journeys} journeys, ${held.length} repeats: ${count("PASSED")} passed, ${count("FAILED")} failed, ${unscored} did not score (${unscored ? "incomplete" : "complete"}). Per-case results are only in the --json-out file.`,
  ];
}
