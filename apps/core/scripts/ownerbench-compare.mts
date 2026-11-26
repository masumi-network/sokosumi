/**
 * A candidate version against the baseline on the owner benchmark: per
 * journey status, steps right and input tokens per turn, the journeys that
 * passed on the baseline and fail on the candidate, and whether the
 * fleet-move bar holds. Run both from the same code; only the versions
 * differ. See docs/agents/evals.md.
 *
 *   pnpm --filter @sokosumi/core exec tsx scripts/ownerbench-compare.mts baseline.json candidate.json
 *
 * Each file is `evals:local --plan --ownerbench --json-out FILE`.
 */
import { readFile } from "node:fs/promises";
import type { ParityReport } from "../src/services/evals/ownerbench/parity";
import { versionDelta } from "../src/services/evals/ownerbench/version-delta";

const [baselinePath, candidatePath] = process.argv.slice(2);
if (!baselinePath || !candidatePath) {
  console.error("Usage: ownerbench-compare.mts baseline.json candidate.json");
  process.exit(1);
}
const read = async (path: string) =>
  JSON.parse(await readFile(path, "utf8")) as ParityReport;
const delta = versionDelta(await read(baselinePath), await read(candidatePath));
const cell = (side: (typeof delta.rows)[number]["baseline"]) =>
  side
    ? `${side.status} ${side.stepsPassed} steps, ${side.inputTokensPerTurn ?? "?"} tok/turn`
    : "-";
for (const row of delta.rows)
  console.log(
    [
      row.caseId,
      cell(row.baseline),
      cell(row.candidate),
      row.regressed ? "REGRESSED" : "",
    ].join("\t"),
  );
const line = (name: string, totals: typeof delta.baseline) =>
  `${name}: ${totals.passed} passed, ${totals.stepsPassed} steps right, ${totals.inputTokensPerTurn ?? "?"} input tokens per turn`;
console.log(`\n${line("baseline", delta.baseline)}`);
console.log(line("candidate", delta.candidate));
console.log(
  delta.meetsBar
    ? "Benchmark bar met."
    : "Benchmark bar NOT met (see REGRESSED rows and totals).",
);
