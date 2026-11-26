import * as Sentry from "@sentry/node";

import vercelConfig from "../../../vercel.json" with { type: "json" };

/** Each cron path's schedule, as Vercel runs it. */
const CRON_SCHEDULES: ReadonlyMap<string, string> = new Map(
  vercelConfig.crons.map((cron) => [cron.path, cron.schedule]),
);

/** Failed runs in a row before Sentry opens an issue for a cron. */
const DEFAULT_FAILED_RUNS_ALERT = 3;
/** Minutes a run may start late before Sentry counts it missed. */
const CHECK_IN_MARGIN_MINUTES = 10;

export interface CronMonitor {
  /** Ends the run's check-in: `error` counts toward the monitor's issue. */
  finish(status: "ok" | "error"): void;
}

/**
 * The run's check-ins to the Sentry Cron monitor named after its lock key,
 * created on first check-in from the schedule in `vercel.json`. Sentry opens
 * an issue when runs are missed, time out, or fail `failedRunsAlert` times in
 * a row. A path Vercel does not schedule has no monitor.
 */
export function startCronMonitor(input: {
  path: string;
  lockKey: string;
  maxRuntimeMs: number;
  failedRunsAlert?: number;
}): CronMonitor | null {
  const schedule = CRON_SCHEDULES.get(input.path);
  if (!schedule) return null;
  const monitorSlug = input.lockKey;
  const startedAt = Date.now();
  const checkInId = Sentry.captureCheckIn(
    { monitorSlug, status: "in_progress" },
    {
      schedule: { type: "crontab", value: schedule },
      checkinMargin: CHECK_IN_MARGIN_MINUTES,
      maxRuntime: Math.ceil(input.maxRuntimeMs / 60_000) + 1,
      timezone: "UTC",
      failureIssueThreshold: input.failedRunsAlert ?? DEFAULT_FAILED_RUNS_ALERT,
      recoveryThreshold: 1,
    },
  );
  return {
    finish(status) {
      Sentry.captureCheckIn({
        checkInId,
        monitorSlug,
        status,
        duration: (Date.now() - startedAt) / 1000,
      });
    },
  };
}

/**
 * A run skipped because the last one still holds the lock: the cron is
 * alive, so its monitor hears from it rather than counting a miss.
 */
export function cronStillRunning(path: string, lockKey: string): void {
  if (!CRON_SCHEDULES.has(path)) return;
  Sentry.captureCheckIn({ monitorSlug: lockKey, status: "ok" });
}

/** Sends the run's check-ins before the function may freeze. */
export async function flushCronMonitor(): Promise<void> {
  await Sentry.flush(2_000);
}
