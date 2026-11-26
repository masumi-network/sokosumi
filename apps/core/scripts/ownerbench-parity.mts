/**
 * Compares the owner journeys of two eval runs, usually a local in-process
 * run and the same journeys on a deployment (sandbox runtime), and flags
 * each journey whose outcome depends on the runtime. See docs/agents/evals.md.
 *
 *   pnpm --filter @sokosumi/core exec tsx scripts/ownerbench-parity.mts local.json deployed.json
 *
 * Each file is a run report: `evals:local --json-out FILE`, or
 * `sokosumi evals show RUN_ID --json > FILE` for a deployed run.
 */
import { readFile } from "node:fs/promises";
import {
  journeyParity,
  type ParityReport,
} from "../src/services/evals/ownerbench/parity";

const [first, second] = process.argv.slice(2);
if (!first || !second) {
  console.error("Usage: ownerbench-parity.mts A.json B.json");
  process.exit(1);
}
const read = async (path: string) =>
  JSON.parse(await readFile(path, "utf8")) as ParityReport;
const rows = journeyParity(await read(first), await read(second));
const cell = (row: (typeof rows)[number]["a"]) =>
  row
    ? `${row.status} ${row.stepsPassed ?? "?"}/${row.stepsTotal ?? "?"}`
    : "-";
for (const row of rows)
  console.log([row.caseId, cell(row.a), cell(row.b), row.flag].join("\t"));
const split = rows.filter((row) => row.flag).length;
console.log(
  `\n${rows.length - split} of ${rows.length} journeys agree across runtimes; trust deltas only on those.`,
);
