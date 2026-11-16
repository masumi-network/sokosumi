import { computeNextRun } from "@/helpers/cron";

/**
 * One run of a recurring schedule moved (`scheduledAt`) or skipped (null).
 * `originalAt` is the cron time it had.
 */
export interface ScheduleRunChange {
  originalAt: Date;
  scheduledAt: Date | null;
}

interface CronSchedule {
  cronExpression: string;
  timezone: string;
}

/** A run as it fires: at `at`, for the cron time `originalAt`. */
export interface EffectiveRun {
  at: Date;
  originalAt: Date;
}

/**
 * The runs of a recurring schedule strictly after `after`, in time order, at
 * most `max`, before `to`: every cron time with no change, plus every moved
 * run where it now fires. A skipped cron time fires never; a moved one only
 * at its new time. The scheduler and the Calendar both read runs through
 * here, so what the Calendar shows is what fires.
 *
 * `firstCron` is the first cron time after `after` when the caller already
 * has it.
 */
export function effectiveRuns(
  schedule: CronSchedule,
  changes: readonly ScheduleRunChange[],
  after: Date,
  to: Date,
  max: number,
  firstCron?: Date | null,
): EffectiveRun[] {
  const changed = new Set(changes.map((change) => change.originalAt.getTime()));
  const runs: EffectiveRun[] = changes.flatMap((change) =>
    change.scheduledAt && change.scheduledAt > after && change.scheduledAt < to
      ? [{ at: change.scheduledAt, originalAt: change.originalAt }]
      : [],
  );
  let cron =
    firstCron !== undefined
      ? firstCron
      : computeNextRun({
          cron: schedule.cronExpression,
          timezone: schedule.timezone,
          from: after,
        });
  // Changed cron times do not count toward `max`; there are only so many.
  let cronRuns = 0;
  while (cron && cron < to) {
    if (!changed.has(cron.getTime())) {
      runs.push({ at: cron, originalAt: cron });
      if (++cronRuns >= max) break;
    }
    cron = computeNextRun({
      cron: schedule.cronExpression,
      timezone: schedule.timezone,
      from: cron,
    });
  }
  return runs.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, max);
}

const FAR_FUTURE = new Date(8.64e15);

/** The schedule's first run strictly after `after`, changes applied. */
export function nextEffectiveRun(
  schedule: CronSchedule,
  changes: readonly ScheduleRunChange[],
  after: Date,
  firstCron?: Date | null,
): Date | null {
  return (
    effectiveRuns(schedule, changes, after, FAR_FUTURE, 1, firstCron)[0]?.at ??
    null
  );
}

/** Whether `at` is one of the schedule's cron times. */
export function isCronTime(schedule: CronSchedule, at: Date): boolean {
  return (
    computeNextRun({
      cron: schedule.cronExpression,
      timezone: schedule.timezone,
      from: new Date(at.getTime() - 1),
    })?.getTime() === at.getTime()
  );
}
