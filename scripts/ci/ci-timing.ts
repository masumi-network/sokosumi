// Per-job CI timing over GitHub Actions job JSON. Pure; `ci-timing-report.ts`
// fetches the JSON through `gh` and prints the result.

interface Step {
  name: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface Job {
  name: string;
  conclusion: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  steps?: Step[];
}

export interface RunJobs {
  run: { id: number; created_at: string };
  jobs: Job[];
}

export interface Percentiles {
  p50: number;
  p95: number;
}

export interface JobTiming {
  name: string;
  samples: number;
  waiting: Percentiles;
  setup: Percentiles;
  running: Percentiles;
}

export interface TimingSummary {
  runs: number;
  wallClock: Percentiles;
  jobs: JobTiming[];
}

const SETUP_STEP =
  /set up job|checkout|setup|install|cache|restore|pnpm|node|prisma generate|wait for postgres|start postgres|post |complete job/i;

// A path-gated job "runs" for a second or two without doing anything.
const SKIPPED_BELOW_SECONDS = 3;

function seconds(from: string, to: string) {
  return (Date.parse(to) - Date.parse(from)) / 1000;
}

/** Linear interpolation between closest ranks; 0 for no samples. */
export function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

function percentiles(values: number[]): Percentiles {
  return { p50: percentile(values, 50), p95: percentile(values, 95) };
}

export function summarizeRuns(runs: RunJobs[]): TimingSummary {
  const walls: number[] = [];
  const byJob = new Map<
    string,
    { waiting: number[]; setup: number[]; running: number[] }
  >();

  for (const { run, jobs } of runs) {
    const ran = jobs.filter(
      (job): job is Job & { started_at: string; completed_at: string } =>
        Boolean(job.started_at && job.completed_at) &&
        (job.conclusion === "success" || job.conclusion === "failure"),
    );
    if (ran.length === 0) continue;
    const lastDone = ran
      .map((job) => job.completed_at)
      .reduce((a, b) => (Date.parse(a) > Date.parse(b) ? a : b));
    walls.push(seconds(run.created_at, lastDone));

    for (const job of ran) {
      const total = seconds(job.started_at, job.completed_at);
      if (total < SKIPPED_BELOW_SECONDS) continue;
      const setup = (job.steps ?? [])
        .filter((step) => SETUP_STEP.test(step.name))
        .reduce(
          (sum, step) =>
            step.started_at && step.completed_at
              ? sum + seconds(step.started_at, step.completed_at)
              : sum,
          0,
        );
      const timing = byJob.get(job.name) ?? {
        waiting: [],
        setup: [],
        running: [],
      };
      timing.waiting.push(seconds(job.created_at, job.started_at));
      timing.setup.push(setup);
      timing.running.push(Math.max(0, total - setup));
      byJob.set(job.name, timing);
    }
  }

  return {
    runs: walls.length,
    wallClock: percentiles(walls),
    jobs: [...byJob].map(([name, timing]) => ({
      name,
      samples: timing.waiting.length,
      waiting: percentiles(timing.waiting),
      setup: percentiles(timing.setup),
      running: percentiles(timing.running),
    })),
  };
}
