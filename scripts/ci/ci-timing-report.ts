// Usage: pnpm ci:timing [workflow file] [PR runs]   (default: ci.yml 150)
// Prints a Markdown table of per-job waiting / setup / running at p50 and p95
// over the most recent completed PR runs, through the `gh` CLI's auth.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { type Job, type RunJobs, summarizeRuns } from "./ci-timing.ts";

const exec = promisify(execFile);

async function gh<T>(path: string): Promise<T> {
  // `{owner}/{repo}` is filled in by `gh` from the current checkout.
  const { stdout } = await exec("gh", ["api", path], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

interface Run {
  id: number;
  created_at: string;
  conclusion: string | null;
}

async function recentRuns(workflow: string, count: number) {
  const runs: Run[] = [];
  for (let page = 1; runs.length < count; page++) {
    const { workflow_runs } = await gh<{ workflow_runs: Run[] }>(
      `repos/{owner}/{repo}/actions/workflows/${workflow}/runs?event=pull_request&status=completed&per_page=100&page=${page}`,
    );
    if (workflow_runs.length === 0) break;
    // Cancelled runs say nothing about how long CI takes. Draft runs, whose
    // jobs all skip, drop out in summarizeRuns.
    runs.push(
      ...workflow_runs.filter(
        (run) => run.conclusion === "success" || run.conclusion === "failure",
      ),
    );
  }
  return runs.slice(0, count);
}

async function withJobs(runs: Run[]) {
  const results: RunJobs[] = [];
  let next = 0;
  // Twelve requests at a time keeps 150 runs to a few seconds.
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      while (next < runs.length) {
        const run = runs[next++];
        const { jobs } = await gh<{ jobs: Job[] }>(
          `repos/{owner}/{repo}/actions/runs/${run.id}/jobs?per_page=100`,
        );
        results.push({ run, jobs });
      }
    }),
  );
  return results;
}

const workflow = process.argv[2] ?? "ci.yml";
const count = Number(process.argv[3] ?? 150);
if (!Number.isInteger(count) || count < 1)
  throw new Error(`PR runs must be a positive integer, got ${process.argv[3]}`);

const summary = summarizeRuns(
  await withJobs(await recentRuns(workflow, count)),
);
const s = (value: number) => `${Math.round(value)}s`;
const pair = ({ p50, p95 }: { p50: number; p95: number }) =>
  `${s(p50)} / ${s(p95)}`;

console.log(
  `${workflow}: ${summary.runs} PR runs. Wall clock (run created to last job done) p50 ${(summary.wallClock.p50 / 60).toFixed(1)}m, p95 ${(summary.wallClock.p95 / 60).toFixed(1)}m.\n`,
);
console.log(
  "| Job | Runs | Waiting p50 / p95 | Setup p50 / p95 | Running p50 / p95 |",
);
console.log("| --- | ---: | ---: | ---: | ---: |");
for (const job of summary.jobs.sort(
  (a, b) =>
    b.waiting.p50 +
    b.setup.p50 +
    b.running.p50 -
    (a.waiting.p50 + a.setup.p50 + a.running.p50),
))
  console.log(
    `| ${job.name} | ${job.samples} | ${pair(job.waiting)} | ${pair(job.setup)} | ${pair(job.running)} |`,
  );
