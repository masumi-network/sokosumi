/**
 * A candidate version against the baseline on the owner benchmark, for the
 * fleet-move bar: journeys passed and steps right no worse, no journey that
 * passed on the baseline failing on the candidate, and input tokens per
 * turn no worse. Both runs should come from the same code, only the
 * versions differ.
 */
import { HOLDOUT_PREFIX } from "./holdout";
import type { ParityReport } from "./parity";

interface Side {
  status: string;
  stepsPassed: number;
  inputTokensPerTurn: number | null;
}

export interface DeltaRow {
  caseId: string;
  baseline: Side | null;
  candidate: Side | null;
  /** Passed on the baseline, not on the candidate. */
  regressed: boolean;
}

export interface VersionDelta {
  rows: DeltaRow[];
  baseline: Totals;
  candidate: Totals;
  /** Every part of the benchmark bar holds. */
  meetsBar: boolean;
}

interface Totals {
  passed: number;
  stepsPassed: number;
  inputTokensPerTurn: number | null;
}

function firstScored(results: ParityReport["cases"][number]["results"]) {
  const result = results.find(
    (row) => row.status === "PASSED" || row.status === "FAILED",
  );
  if (!result) return null;
  const output = (result.output ?? {}) as {
    score?: { stepsPassed?: number };
    totals?: {
      inputTokens?: number;
      tokenTurns?: number;
      inputTokensPerTurn?: number | null;
    };
  };
  return {
    status: result.status,
    stepsPassed: output.score?.stepsPassed ?? 0,
    inputTokensPerTurn: output.totals?.inputTokensPerTurn ?? null,
    inputTokens: output.totals?.inputTokens ?? 0,
    tokenTurns: output.totals?.tokenTurns ?? 0,
  };
}

function totals(
  sides: readonly (ReturnType<typeof firstScored> | null)[],
): Totals {
  const scored = sides.filter((side) => side !== null);
  const measured = scored.filter((side) => side.inputTokensPerTurn !== null);
  // All input tokens over the turns they belong to (background runs
  // included), the same denominator each journey's own figure uses.
  const turns = measured.reduce((sum, side) => sum + side.tokenTurns, 0);
  const tokens = measured.reduce((sum, side) => sum + side.inputTokens, 0);
  return {
    passed: scored.filter((side) => side.status === "PASSED").length,
    stepsPassed: scored.reduce((sum, side) => sum + side.stepsPassed, 0),
    inputTokensPerTurn: turns ? Math.round(tokens / turns) : null,
  };
}

/**
 * The bar on each set: the dev journeys builders iterate on, and the held-out
 * ones nobody sees. It must hold on both; a gain on the dev set with a drop
 * on the held-out set is overfitting. Without held-out journeys in both runs,
 * that half is missing and the bar is not met.
 */
export function versionDeltaBySet(
  baseline: ParityReport,
  candidate: ParityReport,
  /** Every dev journey; the dev bar needs all of them scored in both runs. */
  devJourneyIds: readonly string[],
): { dev: VersionDelta; holdout: VersionDelta | null; meetsBar: boolean } {
  const only = (report: ParityReport, holdout: boolean): ParityReport => ({
    cases: report.cases.filter(
      (evalCase) => evalCase.caseId.startsWith(HOLDOUT_PREFIX) === holdout,
    ),
  });
  const dev = versionDelta(
    only(baseline, false),
    only(candidate, false),
    devJourneyIds,
  );
  const baselineHoldout = only(baseline, true).cases.map(
    (evalCase) => evalCase.caseId,
  );
  const hasHoldout = [baseline, candidate].every(
    (report) => only(report, true).cases.length > 0,
  );
  // The held-out file isn't in the repository: its journeys are whatever the
  // baseline ran, and the candidate must have run every one of them.
  const holdout = hasHoldout
    ? versionDelta(only(baseline, true), only(candidate, true), baselineHoldout)
    : null;
  return {
    dev,
    holdout,
    meetsBar: dev.meetsBar && Boolean(holdout?.meetsBar),
  };
}

export function versionDelta(
  baseline: ParityReport,
  candidate: ParityReport,
  /** Journeys both runs must have scored; a subset can't meet the bar. */
  required: readonly string[] = [],
): VersionDelta {
  const byCase = (report: ParityReport) =>
    new Map(
      report.cases
        .filter((evalCase) => evalCase.caseId.startsWith("owner-"))
        .map((evalCase) => [evalCase.caseId, firstScored(evalCase.results)]),
    );
  const left = byCase(baseline);
  const right = byCase(candidate);
  const ids = [...new Set([...left.keys(), ...right.keys()])];
  const rows = ids.map((caseId): DeltaRow => {
    const before = left.get(caseId) ?? null;
    const after = right.get(caseId) ?? null;
    const strip = (side: typeof before): Side | null =>
      side
        ? {
            status: side.status,
            stepsPassed: side.stepsPassed,
            inputTokensPerTurn: side.inputTokensPerTurn,
          }
        : null;
    return {
      caseId,
      baseline: strip(before),
      candidate: strip(after),
      regressed: before?.status === "PASSED" && after?.status !== "PASSED",
    };
  });
  // Totals over the journeys both runs scored, so a missing one can't help.
  const shared = rows.filter((row) => row.baseline && row.candidate);
  const base = totals(shared.map((row) => left.get(row.caseId) ?? null));
  const cand = totals(shared.map((row) => right.get(row.caseId) ?? null));
  return {
    rows,
    baseline: base,
    candidate: cand,
    meetsBar:
      shared.length === ids.length &&
      required.every((id) => shared.some((row) => row.caseId === id)) &&
      // Every journey measured its tokens on both sides: one missing count
      // would leave the average to the others.
      shared.every(
        (row) =>
          row.baseline?.inputTokensPerTurn != null &&
          row.candidate?.inputTokensPerTurn != null,
      ) &&
      cand.passed >= base.passed &&
      cand.stepsPassed >= base.stepsPassed &&
      !rows.some((row) => row.regressed) &&
      // No token count is no evidence the cost held.
      base.inputTokensPerTurn !== null &&
      cand.inputTokensPerTurn !== null &&
      cand.inputTokensPerTurn <= base.inputTokensPerTurn,
  };
}
