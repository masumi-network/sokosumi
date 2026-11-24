/**
 * Checks the JSON report of CI's pending run on the split layout
 * (`SPLIT_LAYOUT_RUN=pending`): every file of `src/test/split-layout-pending.txt`
 * ran and still fails. Vitest's own exit code is not the verdict there: the
 * listed files are expected to fail. The files that must pass ran before, in
 * the `must-pass` run, where Vitest's exit code is the verdict.
 *
 *   tsx scripts/split-layout-pending.mts <vitest-json-report>
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  parsePending,
  pendingProblems,
} from "../src/test/split-layout-pending";

interface Report {
  testResults: { name: string; status: string }[];
}

const reportPath = process.argv[2];
if (!reportPath) {
  console.error(
    "usage: tsx scripts/split-layout-pending.mts <vitest-json-report>",
  );
  process.exit(1);
}

const core = path.resolve(import.meta.dirname, "..");
const report = JSON.parse(readFileSync(reportPath, "utf8")) as Report;
const results = report.testResults.map((result) => ({
  file: path.relative(core, result.name),
  failed: result.status !== "passed",
}));
const pending = parsePending(
  readFileSync(path.join(core, "src/test/split-layout-pending.txt"), "utf8"),
);

const problems = pendingProblems(results, pending);
for (const problem of problems) console.error(problem);
console.log(
  `Split layout: ${results.filter((result) => result.failed).length} of ${pending.size} listed files still fail.`,
);
process.exit(problems.length > 0 ? 1 : 0);
