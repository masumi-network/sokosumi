import * as Sentry from "@sentry/node";
import {
  Channel,
  type Prisma,
  type TaskSchedule,
  TaskScheduleEndsMode,
  TaskScheduleOccurrenceState,
  TaskScheduleState,
  TaskStatus,
} from "@sokosumi/database";

import { computeNextRun } from "@/helpers/cron";
import { notifyTaskHumanAssignee } from "@/helpers/task-notifications";
import { computeIntervalNextRun } from "@/helpers/task-schedule";
import {
  CALENDAR_OCCURRENCE_HORIZON_MS,
  getOccurrenceSource,
  MAX_INDEXED_TASK_SCHEDULE_OCCURRENCES,
} from "@/helpers/task-schedule-occurrence-index";
import { publishTaskEventData } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";

/**
 * The Occurrence ledger of Task Schedules (ADR 0040): which Occurrences are
 * planned, and the release that turns each due one into a Task.
 *
 * An Active schedule keeps its planned Occurrences projected over the
 * calendar horizon, and always at least the next one. `nextOccurrenceAt` is
 * the earliest planned Occurrence, so the release scan wakes exactly when one
 * is due.
 */

export const TASK_SCHEDULE_RELEASE_BATCH_SIZE = 25;
/** Keeps one transaction well inside Prisma's interactive timeout. */
const MAX_RELEASES_PER_TRANSACTION = 50;

type RuleState = Pick<
  TaskSchedule,
  | "expr"
  | "timezone"
  | "intervalDays"
  | "anchorAt"
  | "endsMode"
  | "endsOn"
  | "targetOccurrenceCount"
  | "releasedCount"
>;

/** First Occurrence after `from`, or null once the end rule is reached. */
export function computeNextOccurrence(
  schedule: RuleState,
  from: Date,
): Date | null {
  if (
    schedule.endsMode === TaskScheduleEndsMode.AFTER &&
    schedule.targetOccurrenceCount != null &&
    schedule.releasedCount >= schedule.targetOccurrenceCount
  ) {
    return null;
  }
  const next =
    schedule.intervalDays != null && schedule.intervalDays > 1
      ? computeIntervalNextRun(
          schedule.anchorAt,
          schedule.intervalDays,
          from,
          schedule.timezone,
        )
      : computeNextRun({
          cron: schedule.expr,
          timezone: schedule.timezone,
          from,
        });
  if (
    next &&
    schedule.endsMode === TaskScheduleEndsMode.ON &&
    schedule.endsOn &&
    next > schedule.endsOn
  ) {
    return null;
  }
  return next;
}

/**
 * Rule times after `from` up to the horizon, at most `limit` of them, and the
 * first one even beyond the horizon when `includeFirst`. A dense rule is
 * capped instead of refused; the plan rolls forward on every release. Times
 * in `held` already have an Occurrence (a skipped one, say) and are passed
 * over without counting against an end-after-N rule.
 */
function projectOccurrenceTimes(
  schedule: RuleState,
  from: Date,
  {
    horizonEnd,
    limit,
    includeFirst,
    held,
  }: {
    horizonEnd: Date;
    limit: number;
    includeFirst: boolean;
    held: ReadonlySet<number>;
  },
): Date[] {
  const times: Date[] = [];
  let next = computeNextOccurrence(schedule, from);
  while (
    next &&
    ((includeFirst && times.length === 0) || next < horizonEnd) &&
    times.length < limit
  ) {
    if (!held.has(next.getTime())) times.push(next);
    next = computeNextOccurrence(
      { ...schedule, releasedCount: schedule.releasedCount + times.length },
      next,
    );
  }
  return times;
}

type ProjectedSchedule = RuleState &
  Pick<TaskSchedule, "id" | "epochId" | "workspaceId" | "projectId">;

/**
 * Extends the schedule's plan in its current epoch up to the horizon after
 * `now`, and returns the earliest planned Occurrence. Only the missing tail
 * is written: every insert runs the calendar invalidation trigger, even one
 * a conflict would skip.
 */
export async function projectTaskScheduleOccurrences(
  tx: Prisma.TransactionClient,
  schedule: ProjectedSchedule,
  now: Date,
): Promise<Date | null> {
  // Every planned Occurrence counts against an end-after-N rule, including
  // one owed from a run that stopped partway or from before a rule edit.
  const plannedCount = await tx.taskScheduleOccurrence.count({
    where: {
      scheduleId: schedule.id,
      state: TaskScheduleOccurrenceState.PLANNED,
    },
  });
  const last = await tx.taskScheduleOccurrence.findFirst({
    where: {
      scheduleId: schedule.id,
      epochId: schedule.epochId,
      state: TaskScheduleOccurrenceState.PLANNED,
      originalScheduledAt: { gt: now },
    },
    orderBy: [{ originalScheduledAt: "desc" }],
    select: { originalScheduledAt: true },
  });
  const from = last?.originalScheduledAt ?? now;
  // A skipped Occurrence keeps its rule time: it is not planned again, and it
  // frees its place under an end-after-N rule.
  const held = await tx.taskScheduleOccurrence.findMany({
    where: {
      scheduleId: schedule.id,
      epochId: schedule.epochId,
      originalScheduledAt: { gt: from },
    },
    select: { originalScheduledAt: true },
  });
  const times = projectOccurrenceTimes(
    { ...schedule, releasedCount: schedule.releasedCount + plannedCount },
    from,
    {
      horizonEnd: new Date(now.getTime() + CALENDAR_OCCURRENCE_HORIZON_MS),
      limit: MAX_INDEXED_TASK_SCHEDULE_OCCURRENCES - plannedCount,
      includeFirst: last == null,
      held: new Set(
        held.flatMap((row) =>
          row.originalScheduledAt ? [row.originalScheduledAt.getTime()] : [],
        ),
      ),
    },
  );
  if (times.length > 0) {
    await tx.taskScheduleOccurrence.createMany({
      data: times.map((at) => ({
        scheduleId: schedule.id,
        epochId: schedule.epochId,
        originalScheduledAt: at,
        effectiveScheduledAt: at,
        state: TaskScheduleOccurrenceState.PLANNED,
        scheduleVersion: 2,
        ...getOccurrenceSource(schedule),
        timezone: schedule.timezone,
      })),
      skipDuplicates: true,
    });
  }
  const next = await tx.taskScheduleOccurrence.findFirst({
    where: {
      scheduleId: schedule.id,
      state: TaskScheduleOccurrenceState.PLANNED,
    },
    orderBy: [{ effectiveScheduledAt: "asc" }, { id: "asc" }],
    select: { effectiveScheduledAt: true },
  });
  return next?.effectiveScheduledAt ?? null;
}

/** Drops planned Occurrences. Released ones and their Tasks stay. */
export async function removePlannedTaskScheduleOccurrences(
  tx: Prisma.TransactionClient,
  scheduleId: string,
): Promise<void> {
  await tx.taskScheduleOccurrence.deleteMany({
    where: { scheduleId, state: TaskScheduleOccurrenceState.PLANNED },
  });
}

/**
 * A rule edit drops the old rule's Occurrences after `now`; the ones already
 * owed still release. A skipped or moved one was someone's decision, so it
 * stays in the history as canceled instead.
 */
export async function retireUpcomingTaskScheduleOccurrences(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  now: Date,
): Promise<void> {
  const upcoming = await tx.taskScheduleOccurrence.findMany({
    where: {
      scheduleId,
      state: {
        in: [
          TaskScheduleOccurrenceState.PLANNED,
          TaskScheduleOccurrenceState.SKIPPED,
        ],
      },
      effectiveScheduledAt: { gt: now },
    },
    select: {
      id: true,
      state: true,
      originalScheduledAt: true,
      effectiveScheduledAt: true,
    },
  });
  const isException = (row: (typeof upcoming)[number]) =>
    row.state === TaskScheduleOccurrenceState.SKIPPED ||
    row.originalScheduledAt?.getTime() !== row.effectiveScheduledAt.getTime();
  await tx.taskScheduleOccurrence.updateMany({
    where: { id: { in: upcoming.filter(isException).map((row) => row.id) } },
    data: { state: TaskScheduleOccurrenceState.CANCELED },
  });
  await tx.taskScheduleOccurrence.deleteMany({
    where: {
      id: {
        in: upcoming.filter((row) => !isException(row)).map((row) => row.id),
      },
    },
  });
}

/**
 * Keeps an end-after-N plan at N once a restored Occurrence counts again: the
 * Occurrences planned last, which took the skipped one's place, go. `keepId`
 * is the restored one, which the person asked for.
 */
export async function trimPlannedTaskScheduleOccurrences(
  tx: Prisma.TransactionClient,
  schedule: Pick<
    TaskSchedule,
    "id" | "endsMode" | "targetOccurrenceCount" | "releasedCount"
  >,
  keepId: string,
): Promise<void> {
  if (
    schedule.endsMode !== TaskScheduleEndsMode.AFTER ||
    schedule.targetOccurrenceCount == null
  ) {
    return;
  }
  const planned = await tx.taskScheduleOccurrence.findMany({
    where: {
      scheduleId: schedule.id,
      state: TaskScheduleOccurrenceState.PLANNED,
    },
    orderBy: [{ originalScheduledAt: "desc" }],
    select: { id: true },
  });
  const excess =
    schedule.releasedCount + planned.length - schedule.targetOccurrenceCount;
  if (excess <= 0) return;
  await tx.taskScheduleOccurrence.deleteMany({
    where: {
      id: {
        in: planned
          .filter((row) => row.id !== keepId)
          .slice(0, excess)
          .map((row) => row.id),
      },
    },
  });
}

/** Planned Occurrences follow the blueprint's project on the calendar. */
export async function moveTaskScheduleOccurrencesToProject(
  tx: Prisma.TransactionClient,
  schedule: Pick<TaskSchedule, "id" | "workspaceId" | "projectId">,
): Promise<void> {
  await tx.taskScheduleOccurrence.updateMany({
    where: {
      scheduleId: schedule.id,
      state: TaskScheduleOccurrenceState.PLANNED,
    },
    data: getOccurrenceSource(schedule),
  });
}

export interface TaskScheduleReleaseOptions {
  abortSignal: AbortSignal;
  deadlineMs: number;
  shouldContinue: () => boolean;
}

export interface TaskScheduleReleaseResult {
  released: number;
  ended: number;
  failed: number;
}

/** A schedule changed under the release; its transaction rolls back. */
class ReleaseClaimLostError extends Error {
  constructor() {
    super("Task Schedule changed during release");
    this.name = "ReleaseClaimLostError";
  }
}

interface ReleasedTask {
  id: string;
  ownerId: string;
  assigneeUserId: string | null;
}

interface ScheduleReleaseOutcome {
  tasks: ReleasedTask[];
  ended: boolean;
}

function canContinue(options: TaskScheduleReleaseOptions): boolean {
  return (
    options.shouldContinue() &&
    !options.abortSignal.aborted &&
    Date.now() < options.deadlineMs
  );
}

/** Active, and not in a project that is closing (ticket 7 ends those). */
function releasableWhere(now: Date): Prisma.TaskScheduleWhereInput {
  return {
    state: TaskScheduleState.ACTIVE,
    nextOccurrenceAt: { lte: now },
    OR: [{ projectId: null }, { project: { closingAt: null, closedAt: null } }],
  };
}

function createTaskFromBlueprint(
  tx: Prisma.TransactionClient,
  schedule: TaskSchedule,
) {
  return tx.task.create({
    data: {
      scheduleId: schedule.id,
      ownerId: schedule.ownerId,
      organizationId: schedule.organizationId,
      workspaceId: schedule.workspaceId,
      projectId: schedule.projectId,
      name: schedule.name,
      description: schedule.description,
      visibility: schedule.visibility,
      assigneeId: schedule.assigneeId,
      assigneeSokoBotId: schedule.assigneeSokoBotId,
      assigneeUserId: schedule.assigneeUserId,
      creatorUserId: schedule.creatorUserId,
      creatorCoworkerId: schedule.creatorCoworkerId,
      creatorSokoBotId: schedule.creatorSokoBotId,
      status: TaskStatus.READY,
      events: {
        create: {
          status: TaskStatus.READY,
          channel: Channel.SOKOSUMI,
          userId: schedule.creatorUserId,
          coworkerId: schedule.creatorCoworkerId,
          sokoBotId: schedule.creatorSokoBotId,
        },
      },
    },
    select: { id: true, ownerId: true, assigneeUserId: true },
  });
}

/**
 * Releases up to {@link MAX_RELEASES_PER_TRANSACTION} due Occurrences of one
 * schedule in one transaction. Each Occurrence is claimed by moving it from
 * planned to released, so a retried run never creates a second Task for it,
 * and the schedule is claimed by its revision, so a concurrent edit, pause,
 * or end rolls the release back. No Seat check (ADR 0020).
 */
async function releaseSchedule(
  id: string,
  options: TaskScheduleReleaseOptions,
): Promise<ScheduleReleaseOutcome> {
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      const schedule = await tx.taskSchedule.findFirst({
        where: { id, ...releasableWhere(now) },
      });
      if (!schedule) return { tasks: [], ended: false };

      // Any epoch: a rule edit keeps the Occurrences already owed.
      const due = await tx.taskScheduleOccurrence.findMany({
        where: {
          scheduleId: id,
          state: TaskScheduleOccurrenceState.PLANNED,
          effectiveScheduledAt: { lte: now },
        },
        orderBy: [{ effectiveScheduledAt: "asc" }, { id: "asc" }],
        take: MAX_RELEASES_PER_TRANSACTION,
        select: { id: true },
      });

      const tasks: ReleasedTask[] = [];
      for (const occurrence of due) {
        if (!canContinue(options)) break;
        const task = await createTaskFromBlueprint(tx, schedule);
        const { count } = await tx.taskScheduleOccurrence.updateMany({
          where: {
            id: occurrence.id,
            state: TaskScheduleOccurrenceState.PLANNED,
          },
          data: {
            state: TaskScheduleOccurrenceState.RELEASED,
            releasedTaskId: task.id,
          },
        });
        if (count !== 1) throw new ReleaseClaimLostError();
        tasks.push(task);
      }

      const releasedCount = schedule.releasedCount + tasks.length;
      const nextOccurrenceAt = await projectTaskScheduleOccurrences(
        tx,
        { ...schedule, releasedCount },
        now,
      );
      // No planned Occurrence left means the end rule is met.
      const ended = nextOccurrenceAt === null;
      const { count } = await tx.taskSchedule.updateMany({
        where: {
          id,
          revision: schedule.revision,
          releasedCount: schedule.releasedCount,
        },
        data: {
          releasedCount,
          nextOccurrenceAt,
          state: ended ? TaskScheduleState.ENDED : TaskScheduleState.ACTIVE,
        },
      });
      if (count !== 1) throw new ReleaseClaimLostError();
      return { tasks, ended };
    });
  } catch (error) {
    if (error instanceof ReleaseClaimLostError) {
      return { tasks: [], ended: false };
    }
    throw error;
  }
}

async function announceReleasedTasks(tasks: ReleasedTask[]): Promise<void> {
  await Promise.all(
    tasks.map(async (task) => {
      try {
        await publishTaskEventData({
          userId: task.ownerId,
          taskId: task.id,
          eventType: "task_event",
        });
      } catch (error) {
        Sentry.captureException(error, {
          tags: { error_type: "publish_task_event" },
          extra: { taskId: task.id, source: "task-schedule-release" },
        });
      }
      if (task.assigneeUserId) {
        await notifyTaskHumanAssignee(task.id, task.assigneeUserId);
      }
    }),
  );
}

export const taskScheduleReleaseService = {
  /**
   * Behind the `/sync/task-schedules` cron: releases the due Occurrences of
   * every Active Task Schedule, and Ends the ones whose end rule is met.
   */
  async releaseDueSchedules(
    options: TaskScheduleReleaseOptions,
  ): Promise<TaskScheduleReleaseResult> {
    let released = 0;
    let ended = 0;
    let failed = 0;
    const attempted = new Set<string>();

    while (canContinue(options)) {
      const batch = await prisma.taskSchedule.findMany({
        where: {
          ...releasableWhere(new Date()),
          // Failures and lost claims stay due. Leaving them in the page would
          // fill every later read and starve schedules behind them.
          ...(attempted.size > 0 ? { id: { notIn: [...attempted] } } : {}),
        },
        orderBy: [{ nextOccurrenceAt: "asc" }, { id: "asc" }],
        take: TASK_SCHEDULE_RELEASE_BATCH_SIZE,
        select: { id: true },
      });
      if (batch.length === 0) break;

      for (const { id } of batch) {
        attempted.add(id);
        // A long backlog releases over several transactions.
        let outcome: ScheduleReleaseOutcome;
        do {
          if (!canContinue(options)) break;
          try {
            outcome = await releaseSchedule(id, options);
          } catch (error) {
            // One broken schedule must not hold back the others.
            failed += 1;
            Sentry.captureException(error, {
              tags: { error_type: "task_schedule_release" },
              extra: { scheduleId: id },
            });
            break;
          }
          await announceReleasedTasks(outcome.tasks);
          released += outcome.tasks.length;
          if (outcome.ended) ended += 1;
        } while (outcome.tasks.length === MAX_RELEASES_PER_TRANSACTION);
      }
    }

    return { released, ended, failed };
  },
};
