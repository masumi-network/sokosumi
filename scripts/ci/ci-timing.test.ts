import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  type Job,
  percentile,
  type RunJobs,
  summarizeRuns,
} from "./ci-timing.ts";

// One real `ci.yml` PR run (#43872559434), recorded from the GitHub API.
const recorded: RunJobs = JSON.parse(
  readFileSync(
    new URL("./__tests__/fixtures/ci-timing-run.json", import.meta.url),
    "utf8",
  ),
);

test("splits a job into waiting, setup and running", () => {
  const summary = summarizeRuns([recorded]);
  const web = summary.jobs.find((job) => job.name === "Test Web");
  // Created 13:06:16, started 13:06:18, done 13:15:25. Setup steps: Set up
  // job 1s, Checkout repository 7s, Setup 24s; the Post/Complete steps take 0s.
  assert.deepEqual(web, {
    name: "Test Web",
    samples: 1,
    waiting: { p50: 2, p95: 2 },
    setup: { p50: 32, p95: 32 },
    running: { p50: 515, p95: 515 },
  });
  // Run created 13:06:03; its last job (Test Web) finished 13:15:25.
  assert.deepEqual(summary.wallClock, { p50: 562, p95: 562 });
  assert.equal(summary.runs, 1);
});

test("leaves path-gated jobs out of the job rows", () => {
  const names = summarizeRuns([recorded]).jobs.map((job) => job.name);
  // `skipped` conclusions (Test CLI, Lint DESIGN.md, ...) and jobs that ran
  // under 3 seconds never become a row.
  assert.ok(!names.includes("Test CLI"));
  assert.ok(!names.includes("Lint DESIGN.md"));
  const gated = summarizeRuns([
    {
      run: { id: 1, created_at: "2026-11-16T10:00:00Z" },
      jobs: [
        job("Build", "10:00:01", "10:00:02", "10:01:02"),
        job("Test Web", "10:00:01", "10:00:02", "10:00:04"),
      ],
    },
  ]);
  assert.deepEqual(
    gated.jobs.map((row) => row.name),
    ["Build"],
  );
});

test("skips jobs and steps whose timestamps are missing", () => {
  const summary = summarizeRuns([
    {
      run: { id: 2, created_at: "2026-11-16T10:00:00Z" },
      jobs: [
        job("Build", "10:00:01", "10:00:02", "10:01:02", [
          step("Setup", "10:00:02", "10:00:12"),
          { name: "Install deps", started_at: "10:00:12", completed_at: null },
        ]),
        {
          ...job("Test Core", "10:00:01", "10:00:02", "10:09:00"),
          started_at: null,
        },
      ],
    },
    // A run whose every job lacks a start counts for nothing.
    {
      run: { id: 3, created_at: "2026-11-16T11:00:00Z" },
      jobs: [
        {
          ...job("Build", "11:00:01", "11:00:02", "11:01:00"),
          started_at: null,
        },
      ],
    },
  ]);
  assert.equal(summary.runs, 1);
  assert.deepEqual(summary.wallClock, { p50: 62, p95: 62 });
  assert.deepEqual(summary.jobs, [
    {
      name: "Build",
      samples: 1,
      waiting: { p50: 1, p95: 1 },
      setup: { p50: 10, p95: 10 },
      running: { p50: 50, p95: 50 },
    },
  ]);
});

test("percentiles of one sample are that sample", () => {
  assert.equal(percentile([42], 50), 42);
  assert.equal(percentile([42], 95), 42);
  assert.equal(percentile([], 50), 0);
});

test("percentiles of an even count interpolate between neighbours", () => {
  assert.equal(percentile([40, 10, 30, 20], 50), 25);
  // rank 0.95 * 3 = 2.85: 30 + 0.85 * (40 - 30)
  assert.equal(percentile([40, 10, 30, 20], 95), 38.5);
});

function step(name: string, started: string, completed: string) {
  return {
    name,
    started_at: `2026-11-16T${started}Z`,
    completed_at: `2026-11-16T${completed}Z`,
  };
}

function job(
  name: string,
  created: string,
  started: string,
  completed: string,
  steps: Job["steps"] = [],
): Job {
  return {
    name,
    conclusion: "success",
    created_at: `2026-11-16T${created}Z`,
    started_at: `2026-11-16T${started}Z`,
    completed_at: `2026-11-16T${completed}Z`,
    steps,
  };
}
