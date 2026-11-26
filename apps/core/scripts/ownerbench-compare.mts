/**
 * A candidate version against the baseline on the owner benchmark, and
 * whether the fleet-move bar holds on the dev set and on the held-out set
 * (both must). Dev journeys print side by side; the held-out set prints
 * totals and a verdict only. Run both from the same code; only the versions
 * differ. See docs/agents/evals.md.
 *
 *   pnpm --filter @sokosumi/core exec tsx scripts/ownerbench-compare.mts baseline.json candidate.json --holdout FILE
 *
 * Each report is `evals:local --plan --ownerbench --holdout FILE --json-out FILE`.
 * The held-out file says which journeys the set holds; without it the
 * held-out half can't be checked and the bar is not met.
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { holdoutJourneys } from "../src/services/evals/ownerbench/holdout";
import { OWNER_JOURNEYS } from "../src/services/evals/ownerbench/journeys";
import type { ParityReport } from "../src/services/evals/ownerbench/parity";
import {
  tokenCoverage,
  type VersionDelta,
  versionDeltaBySet,
} from "../src/services/evals/ownerbench/version-delta";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { holdout: { type: "string" } },
});
const [baselinePath, candidatePath] = positionals;
if (!baselinePath || !candidatePath) {
  console.error(
    "Usage: ownerbench-compare.mts baseline.json candidate.json --holdout FILE",
  );
  process.exit(1);
}
const read = async (path: string) =>
  JSON.parse(await readFile(path, "utf8")) as ParityReport;
const sets = versionDeltaBySet(
  await read(baselinePath),
  await read(candidatePath),
  OWNER_JOURNEYS.map((journey) => journey.id),
  holdoutJourneys(values.holdout).map((journey) => journey.id),
);

function totalsLine(label: string, totals: VersionDelta["baseline"]) {
  return `${label}: ${totals.passed} passed, ${totals.stepsPassed} steps right, ${totals.inputTokensPerTurn ?? "?"} input tokens per turn`;
}

function summary(delta: VersionDelta) {
  const coverage = tokenCoverage(delta);
  console.log(totalsLine("baseline", delta.baseline));
  console.log(totalsLine("candidate", delta.candidate));
  console.log(
    `${delta.rows.filter((row) => row.regressed).length} journey(s) passed before and fail now; tokens measured on ${coverage.measured} of ${coverage.total}`,
  );
  console.log(
    delta.meetsBar ? "Bar met on this set." : "Bar NOT met on this set.",
  );
}

console.log("## Dev journeys");
const cell = (side: VersionDelta["rows"][number]["baseline"]) =>
  side
    ? `${side.status} ${side.stepsPassed} steps, ${side.inputTokensPerTurn ?? "?"} tok/turn`
    : "-";
for (const row of sets.dev.rows)
  console.log(
    [
      row.caseId,
      cell(row.baseline),
      cell(row.candidate),
      row.regressed ? "REGRESSED" : "",
    ].join("\t"),
  );
summary(sets.dev);

// Totals and a verdict only: a held-out journey's id or wording here would
// show builders what the set asks.
if (sets.holdout) {
  console.log(
    `\n## Held-out journeys (${sets.holdout.rows.length}, ids not shown)`,
  );
  summary(sets.holdout);
} else
  console.log(
    values.holdout
      ? "\nThe reports hold no held-out journeys: the bar cannot be met."
      : "\nNo --holdout file: the held-out set can't be checked and the bar is not met.",
  );
console.log(
  sets.meetsBar
    ? "\nBenchmark bar met on both sets."
    : "\nBenchmark bar NOT met.",
);
