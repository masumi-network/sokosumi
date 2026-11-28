import * as Sentry from "@sentry/node";

import vercelConfig from "../../../vercel.json" with { type: "json" };

/** Each cron path's schedule, as Vercel runs it. */
const CRON_SCHEDULES: ReadonlyMap<string, string> = new Map(
  vercelConfig.crons.map((cron) => [cron.path, cron.schedule]),
);

/** Failed runs in a row before Sentry opens an issue for a cron. */
const FAILED_RUNS_ALERT = 3;
/** Minutes a run may start late before Sentry counts it missed. */
const CHECK_IN_MARGIN_MINUTES = 10;

export interface CronMonitor {
  /** Ends the run's check-in: `error` counts toward the monitor's issue. */
  finish(status: "ok" | "error"): void;
}

function monitorSlugFor(lockKey: string) {
  return lockKey.replace(/^preprod:/, "preprod-");
}

function monitorConfig(schedule: string, failureIssueThreshold: number) {
  return {
    schedule: { type: "crontab" as const, value: schedule },
    checkinMargin: CHECK_IN_MARGIN_MINUTES,
    timezone: "UTC",
    failureIssueThreshold,
    recoveryThreshold: 1,
  };
}

/**
 * The run's check-ins to the Sentry Cron monitor named after its lock key,
 * created on first check-in from the schedule in `vercel.json`. Sentry opens
 * an issue when runs are missed, time out, or fail three times in a row. A
 * path Vercel does not schedule has no monitor.
 */
export function startCronMonitor(input: {
  path: string;
  lockKey: string;
  maxRuntimeMs: number;
}): CronMonitor | null {
  const schedule = CRON_SCHEDULES.get(input.path);
  if (!schedule) return null;
  const monitorSlug = monitorSlugFor(input.lockKey);
  const startedAt = Date.now();
  const checkInId = Sentry.captureCheckIn(
    { monitorSlug, status: "in_progress" },
    {
      ...monitorConfig(schedule, FAILED_RUNS_ALERT),
      maxRuntime: Math.ceil(input.maxRuntimeMs / 60_000) + 1,
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
 * A tick on the cron's idle monitor (`<lock key>-idle`), apart from its
 * failures: `idleRunsAlert` observed runs in a row with no work open an issue
 * there. Every tick checks in, so the monitor never counts a miss; a tick
 * that threw or overlapped the last run (`idle: false`) shows nothing about
 * idleness and checks in ok.
 */
export function reportCronIdleness(input: {
  path: string;
  lockKey: string;
  idle: boolean;
  idleRunsAlert: number;
}): void {
  const schedule = CRON_SCHEDULES.get(input.path);
  if (!schedule) return;
  Sentry.captureCheckIn(
    {
      monitorSlug: `${monitorSlugFor(input.lockKey)}-idle`,
      status: input.idle ? "error" : "ok",
    },
    monitorConfig(schedule, input.idleRunsAlert),
  );
}

/**
 * A run skipped because the last one still holds the lock: the cron is
 * alive, so its monitors hear from it rather than counting a miss.
 */
export function cronStillRunning(
  path: string,
  lockKey: string,
  idleRunsAlert?: number,
): void {
  if (!CRON_SCHEDULES.has(path)) return;
  Sentry.captureCheckIn({ monitorSlug: monitorSlugFor(lockKey), status: "ok" });
  if (idleRunsAlert !== undefined)
    reportCronIdleness({ path, lockKey, idle: false, idleRunsAlert });
}

/** Sends the run's check-ins before the function may freeze. */
export async function flushCronMonitor(): Promise<void> {
  await Sentry.flush(2_000);
}
