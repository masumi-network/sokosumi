/**
 * Applies the split-layout ratchet (`src/test/split-layout-ratchet.ts`) to the
 * JSON report of the PostgreSQL run on the split layout, and exits 1 when the
 * run breaks it. Vitest's own exit code is not the verdict there: the listed
 * files are expected to fail.
 *
 *   tsx scripts/split-layout-ratchet.mts <vitest-json-report>
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  parsePending,
  ratchetProblems,
} from "../src/test/split-layout-ratchet";

interface Report {
  testResults: { name: string; status: string }[];
}

const reportPath = process.argv[2];
if (!reportPath) {
  console.error(
    "usage: tsx scripts/split-layout-ratchet.mts <vitest-json-report>",
  );
  process.exit(1);
}

const core = path.resolve(import.meta.dirname, "..");
const report = JSON.parse(readFileSync(reportPath, "utf8")) as Report;
if (report.testResults.length === 0) {
  console.error("The split-layout run reported no test files.");
  process.exit(1);
}
const results = report.testResults.map((result) => ({
  file: path.relative(core, result.name),
  failed: result.status !== "passed",
}));
const pending = parsePending(
  readFileSync(path.join(core, "src/test/split-layout-pending.txt"), "utf8"),
);

const problems = ratchetProblems(results, pending);
for (const problem of problems) console.error(problem);
const failing = results.filter((result) => result.failed).length;
console.log(
  `Split layout: ${results.length - failing} files pass, ${failing} fail, ${pending.size} listed in src/test/split-layout-pending.txt.`,
);
process.exit(problems.length > 0 ? 1 : 0);
