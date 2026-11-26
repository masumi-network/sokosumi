/**
 * A candidate version against the baseline on the owner benchmark: per
 * journey status, steps right and input tokens per turn, the journeys that
 * passed on the baseline and fail on the candidate, and whether the
 * fleet-move bar holds on the dev set and on the held-out set (both must).
 * Run both from the same code; only the versions differ. See
 * docs/agents/evals.md.
 *
 *   pnpm --filter @sokosumi/core exec tsx scripts/ownerbench-compare.mts baseline.json candidate.json
 *
 * Each file is `evals:local --plan --ownerbench [--holdout FILE] --json-out FILE`.
 */
import { readFile } from "node:fs/promises";
import type { ParityReport } from "../src/services/evals/ownerbench/parity";
import {
  type VersionDelta,
  versionDeltaBySet,
} from "../src/services/evals/ownerbench/version-delta";

const [baselinePath, candidatePath] = process.argv.slice(2);
if (!baselinePath || !candidatePath) {
  console.error("Usage: ownerbench-compare.mts baseline.json candidate.json");
  process.exit(1);
}
const read = async (path: string) =>
  JSON.parse(await readFile(path, "utf8")) as ParityReport;
const sets = versionDeltaBySet(
  await read(baselinePath),
  await read(candidatePath),
);

function print(name: string, delta: VersionDelta) {
  const cell = (side: VersionDelta["rows"][number]["baseline"]) =>
    side
      ? `${side.status} ${side.stepsPassed} steps, ${side.inputTokensPerTurn ?? "?"} tok/turn`
      : "-";
  console.log(`\n## ${name}`);
  for (const row of delta.rows)
    console.log(
      [
        row.caseId,
        cell(row.baseline),
        cell(row.candidate),
        row.regressed ? "REGRESSED" : "",
      ].join("\t"),
    );
  const line = (label: string, totals: VersionDelta["baseline"]) =>
    `${label}: ${totals.passed} passed, ${totals.stepsPassed} steps right, ${totals.inputTokensPerTurn ?? "?"} input tokens per turn`;
  console.log(line("baseline", delta.baseline));
  console.log(line("candidate", delta.candidate));
  console.log(
    delta.meetsBar ? "Bar met on this set." : "Bar NOT met on this set.",
  );
}

print("Dev journeys", sets.dev);
if (sets.holdout) print("Held-out journeys", sets.holdout);
else console.log("\nNo held-out journeys in both runs: the bar cannot be met.");
console.log(
  sets.meetsBar
    ? "\nBenchmark bar met on both sets."
    : "\nBenchmark bar NOT met.",
);
