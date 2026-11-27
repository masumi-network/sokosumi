/**
 * A candidate version against the baseline on the owner benchmark, for the
 * fleet-move bar: journeys passed and steps right no worse, no journey that
 * passed on the baseline failing on the candidate, and input tokens per
 * turn no worse. Both runs should come from the same code, only the
 * versions differ. A journey with repeats passes only when all of them did
 * (pass^k); its pass^1 share and mean steps count too.
 */
import { HOLDOUT_PREFIX, HOLDOUT_REPEATS } from "./holdout";
import type { ParityReport } from "./parity";

interface Side {
  /** PASSED when every repeat scored and passed (pass^k); INCOMPLETE when repeats are missing. */
  status: string;
  /** Scored repeats, how many of them passed, and repeats that never scored (ERROR). */
  runs: number;
  passes: number;
  unscored: number;
  /** Steps right, averaged over the repeats. */
  stepsPassed: number;
  inputTokensPerTurn: number | null;
}

export interface DeltaRow {
  caseId: string;
  baseline: Side | null;
  candidate: Side | null;
  /** Passed on the baseline, scored and not passed on the candidate. */
  regressed: boolean;
}

export interface VersionDelta {
  rows: DeltaRow[];
  /** Each run on its own, over every expected journey (the bar compares pairs). */
  baseline: Totals;
  candidate: Totals;
  /** Every part of the benchmark bar holds. */
  meetsBar: boolean;
}

interface Totals {
  /** Journeys whose every repeat scored and passed (pass^k). */
  passed: number;
  /** Journeys short of scored repeats (an ERROR, a stand-in Jev, or too few): neither passed nor failed. */
  incomplete: number;
  /** Repeats whose Jev fell back to the stand-in: not real-Jev evidence, rerun them. */
  standIn: number;
  /** Passed repeats over scored repeats (pass^1). */
  passRate: number | null;
  stepsPassed: number;
  inputTokensPerTurn: number | null;
}

/**
 * A journey's scored repeats as one side: pass^k, pass^1, mean steps and all
 * tokens. Short of `minimumRepeats` scored repeats, or with one that never
 * scored, it is INCOMPLETE: pass^k can't be read from it.
 */
export function scoredSide(
  results: ParityReport["cases"][number]["results"],
  minimumRepeats = 1,
  /** A real-Jev plan run: only repeats labelled `jev: "real"` are evidence. */
  requireRealJev = false,
) {
  // A repeat whose Jev fell back to the plan's stand-in, or that a real-Jev
  // run left unlabelled, may have routed unlike production: it is no
  // real-Jev evidence, so it counts as unscored.
  const notRealJev = (row: (typeof results)[number]) =>
    requireRealJev ? jevLabel(row) !== "real" : jevLabel(row) === "stand-in";
  const standIn = results.filter(notRealJev).length;
  const scored = results.filter(
    (row) =>
      (row.status === "PASSED" || row.status === "FAILED") && !notRealJev(row),
  );
  if (!results.length) return null;
  const outputs = scored.map(
    (result) =>
      (result.output ?? {}) as {
        score?: { stepsPassed?: number };
        totals?: {
          inputTokens?: number;
          tokenTurns?: number;
          inputTokensPerTurn?: number | null;
        };
      },
  );
  const passes = scored.filter((row) => row.status === "PASSED").length;
  // One repeat without a token count leaves the cost unproven for all.
  const measured = outputs.every(
    (output) => output.totals?.inputTokensPerTurn != null,
  );
  const inputTokens = outputs.reduce(
    (sum, output) => sum + (output.totals?.inputTokens ?? 0),
    0,
  );
  const tokenTurns = outputs.reduce(
    (sum, output) => sum + (output.totals?.tokenTurns ?? 0),
    0,
  );
  const unscored = results.length - scored.length;
  return {
    status:
      unscored > 0 || scored.length < minimumRepeats
        ? "INCOMPLETE"
        : passes === scored.length
          ? "PASSED"
          : "FAILED",
    runs: scored.length,
    passes,
    unscored,
    standIn,
    stepsPassed:
      outputs.reduce(
        (sum, output) => sum + (output.score?.stepsPassed ?? 0),
        0,
      ) / Math.max(scored.length, 1),
    inputTokensPerTurn:
      measured && tokenTurns ? Math.round(inputTokens / tokenTurns) : null,
    inputTokens,
    tokenTurns,
  };
}

/** Which Jev a plan run says answered a result; undefined when unlabelled. */
function jevLabel(row: { output?: unknown }): unknown {
  return (row.output as { jev?: unknown } | null)?.jev;
}

function totals(
  sides: readonly (ReturnType<typeof scoredSide> | null)[],
): Totals {
  const scored = sides.filter((side) => side !== null);
  const measured = scored.filter((side) => side.inputTokensPerTurn !== null);
  // All input tokens over the turns they belong to (background runs
  // included), the same denominator each journey's own figure uses.
  const turns = measured.reduce((sum, side) => sum + side.tokenTurns, 0);
  const tokens = measured.reduce((sum, side) => sum + side.inputTokens, 0);
  const runs = scored.reduce((sum, side) => sum + side.runs, 0);
  return {
    passed: scored.filter((side) => side.status === "PASSED").length,
    incomplete: scored.filter((side) => side.status === "INCOMPLETE").length,
    standIn: scored.reduce((sum, side) => sum + side.standIn, 0),
    passRate: runs
      ? scored.reduce((sum, side) => sum + side.passes, 0) / runs
      : null,
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
  /**
   * Every held-out journey, from the held-out file. Without it nothing says
   * what the set should hold, and a run of one of them could pass.
   */
  holdoutJourneyIds: readonly string[] = [],
): {
  dev: VersionDelta;
  holdout: VersionDelta | null;
  environmentProblem: string | null;
  meetsBar: boolean;
} {
  const environmentProblem = environmentMismatch(baseline, candidate);
  const only = (report: ParityReport, holdout: boolean): ParityReport => ({
    cases: report.cases.filter(
      (evalCase) => evalCase.caseId.startsWith(HOLDOUT_PREFIX) === holdout,
    ),
  });
  const requireRealJev =
    baseline.run?.environment === "local-chatgpt-plan-real-jev" ||
    candidate.run?.environment === "local-chatgpt-plan-real-jev";
  const dev = versionDelta(
    only(baseline, false),
    only(candidate, false),
    devJourneyIds,
    1,
    requireRealJev,
  );
  const hasHoldout =
    holdoutJourneyIds.length > 0 &&
    [baseline, candidate].every(
      (report) => only(report, true).cases.length > 0,
    );
  // Both runs must have scored every journey the held-out file holds.
  const holdout = hasHoldout
    ? versionDelta(
        only(baseline, true),
        only(candidate, true),
        holdoutJourneyIds,
        HOLDOUT_REPEATS,
        requireRealJev,
      )
    : null;
  return {
    dev,
    holdout,
    environmentProblem,
    meetsBar:
      environmentProblem === null && dev.meetsBar && Boolean(holdout?.meetsBar),
  };
}

/**
 * Why two runs can't be compared, or null. Both must come from the same
 * environment, and a plan run's must use real Jev: the stand-in routes
 * unlike production, so it is never fleet evidence.
 */
export function environmentMismatch(
  baseline: ParityReport,
  candidate: ParityReport,
): string | null {
  const [before, after] = [baseline, candidate].map(
    (report) => report.run?.environment ?? null,
  );
  if (before === null || after === null)
    return "a report has no run environment, so nothing says which Jev it used";
  if (before !== after)
    return `the runs come from different environments (${before ?? "unknown"} vs ${after ?? "unknown"})`;
  if (before === "local-chatgpt-plan")
    return "both runs used the plan's Jev stand-in, which routes unlike production; rerun with real Jev (SOKO_BOT_PLAN_REAL_JEV=1)";
  return null;
}

/** How many journeys measured their tokens on both sides, of how many. */
export function tokenCoverage(delta: VersionDelta): {
  measured: number;
  total: number;
} {
  return {
    measured: delta.rows.filter(
      (row) =>
        row.baseline?.inputTokensPerTurn != null &&
        row.candidate?.inputTokensPerTurn != null,
    ).length,
    total: delta.rows.length,
  };
}

export function versionDelta(
  baseline: ParityReport,
  candidate: ParityReport,
  /** Journeys both runs must have scored; a subset can't meet the bar. */
  required: readonly string[] = [],
  /** Scored repeats each journey needs on each side (pass^k is read over this many). */
  minimumRepeats = 1,
  /** Real-Jev plan runs: an unlabelled or stand-in repeat is no evidence. */
  requireRealJev = false,
): VersionDelta {
  const byCase = (report: ParityReport) =>
    new Map(
      report.cases
        .filter((evalCase) => evalCase.caseId.startsWith("owner-"))
        .map((evalCase) => [
          evalCase.caseId,
          scoredSide(evalCase.results, minimumRepeats, requireRealJev),
        ]),
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
            runs: side.runs,
            passes: side.passes,
            unscored: side.unscored,
            stepsPassed: side.stepsPassed,
            inputTokensPerTurn: side.inputTokensPerTurn,
          }
        : null;
    return {
      caseId,
      baseline: strip(before),
      candidate: strip(after),
      // An unscored or incomplete candidate is not a regression: the bar fails on it anyway.
      regressed: before?.status === "PASSED" && after?.status === "FAILED",
    };
  });
  // The bar's totals: over the journeys both runs scored, so a missing one can't help.
  const shared = rows.filter((row) => row.baseline && row.candidate);
  const base = totals(shared.map((row) => left.get(row.caseId) ?? null));
  const cand = totals(shared.map((row) => right.get(row.caseId) ?? null));
  // What each run did on its own, over every journey either run or the set
  // expects: one side's errors must not hide the other side's passes.
  const expected = [...new Set([...ids, ...required])];
  const shown = (side: typeof left) => {
    const own = totals(expected.map((id) => side.get(id) ?? null));
    return {
      ...own,
      incomplete:
        own.incomplete + expected.filter((id) => !side.get(id)).length,
    };
  };
  return {
    rows,
    baseline: shown(left),
    candidate: shown(right),
    meetsBar:
      shared.length === ids.length &&
      required.every((id) => shared.some((row) => row.caseId === id)) &&
      // Every repeat scored, at least `minimumRepeats` of them, on each side:
      // a lost or short repeat can't pass as pass^k.
      shared.every((row) =>
        [row.baseline, row.candidate].every(
          (side) =>
            side !== null && side.unscored === 0 && side.runs >= minimumRepeats,
        ),
      ) &&
      shared.every((row) => row.baseline?.runs === row.candidate?.runs) &&
      (base.passRate === null ||
        (cand.passRate !== null && cand.passRate >= base.passRate)) &&
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
