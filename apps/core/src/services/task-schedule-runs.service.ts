import * as Sentry from "@sentry/node";
import {
  CalendarSourceType,
  Channel,
  type Prisma,
  type TaskSchedule,
  TaskScheduleEndsMode,
  type TaskScheduleRun,
  TaskScheduleRunState,
  TaskScheduleState,
  TaskStatus,
} from "@sokosumi/database";

import { computeNextRun } from "@/helpers/cron";
import { notifyTaskHumanAssignee } from "@/helpers/task-notifications";
import { computeIntervalNextRun } from "@/helpers/task-schedule";
import { publishTaskEventData } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";

/**
 * The Run ledger of Task Schedules (ADR 0041): which Runs are
 * planned, and the release that turns each due one into a Task.
 *
 * An Active schedule keeps its planned Runs projected over the
 * calendar horizon, and always at least the next one. `nextRunAt` is
 * the earliest planned Run, so the release scan wakes exactly when one
 * is due.
 */

/** How far ahead planned Runs are projected, and the calendar can look. */
export const RUN_HORIZON_MS = 90 * 24 * 60 * 60 * 1000;
/** Most planned Runs one schedule keeps over the horizon. */
const MAX_PLANNED_RUNS = 2_000;
export const TASK_SCHEDULE_RELEASE_BATCH_SIZE = 25;
/** Keeps one transaction well inside Prisma's interactive timeout. */
const MAX_RELEASES_PER_TRANSACTION = 50;

/** Calendar source of the Runs a schedule plans: its project, or its workspace. */
function getRunSource(schedule: {
  workspaceId: string;
  projectId: string | null;
}) {
  return {
    sourceWorkspaceId: schedule.workspaceId,
    sourceType: schedule.projectId
      ? CalendarSourceType.PROJECT
      : CalendarSourceType.WORKSPACE,
    sourceProjectId: schedule.projectId,
  };
}

type RuleState = Pick<
  TaskSchedule,
  | "expr"
  | "timezone"
  | "intervalDays"
  | "anchorAt"
  | "endsMode"
  | "endsOn"
  | "targetRunCount"
  | "releasedCount"
>;

/** First Run after `from`, or null once the end rule is reached. */
export function computeNextScheduleRun(
  schedule: RuleState,
  from: Date,
): Date | null {
  if (
    schedule.endsMode === TaskScheduleEndsMode.AFTER &&
    schedule.targetRunCount != null &&
    schedule.releasedCount >= schedule.targetRunCount
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
 * in `occupied` already have a Run (a skipped one, say) and are
 * passed over without counting against an end-after-N rule.
 */
function projectRunTimes(
  schedule: RuleState,
  from: Date,
  {
    horizonEnd,
    limit,
    includeFirst,
    occupied,
  }: {
    horizonEnd: Date;
    limit: number;
    includeFirst: boolean;
    occupied: ReadonlySet<number>;
  },
): Date[] {
  const times: Date[] = [];
  let next = computeNextScheduleRun(schedule, from);
  while (
    next &&
    ((includeFirst && times.length === 0) || next < horizonEnd) &&
    times.length < limit
  ) {
    if (!occupied.has(next.getTime())) times.push(next);
    next = computeNextScheduleRun(
      { ...schedule, releasedCount: schedule.releasedCount + times.length },
      next,
    );
  }
  return times;
}

type ProjectedSchedule = RuleState &
  Pick<TaskSchedule, "id" | "epochId" | "workspaceId" | "projectId">;

/**
 * Plans the schedule's current epoch up to the horizon after `now`, and
 * returns the earliest planned Run. Only rule times without an
 * Run are written: every insert runs the calendar invalidation
 * trigger, even one a conflict would skip.
 */
export async function projectTaskScheduleRuns(
  tx: Prisma.TransactionClient,
  schedule: ProjectedSchedule,
  now: Date,
): Promise<Date | null> {
  // Every planned Run counts against an end-after-N rule, including
  // one owed from a release that stopped partway or from before a rule edit.
  const plannedCount = await tx.taskScheduleRun.count({
    where: {
      scheduleId: schedule.id,
      state: TaskScheduleRunState.PLANNED,
    },
  });
  // A rule time can already hold a Run: planned, moved, or skipped.
  // It is not planned again, and a skipped one frees its place under an
  // end-after-N rule.
  const occupied = await tx.taskScheduleRun.findMany({
    where: {
      scheduleId: schedule.id,
      epochId: schedule.epochId,
      originalScheduledAt: { gt: now },
    },
    select: { state: true, originalScheduledAt: true },
  });
  const times = projectRunTimes(
    { ...schedule, releasedCount: schedule.releasedCount + plannedCount },
    now,
    {
      horizonEnd: new Date(now.getTime() + RUN_HORIZON_MS),
      limit: MAX_PLANNED_RUNS - plannedCount,
      includeFirst: !occupied.some(
        (row) => row.state === TaskScheduleRunState.PLANNED,
      ),
      occupied: new Set(
        occupied.flatMap((row) =>
          row.originalScheduledAt ? [row.originalScheduledAt.getTime()] : [],
        ),
      ),
    },
  );
  if (times.length > 0) {
    await tx.taskScheduleRun.createMany({
      data: times.map((at) => ({
        scheduleId: schedule.id,
        epochId: schedule.epochId,
        originalScheduledAt: at,
        effectiveScheduledAt: at,
        state: TaskScheduleRunState.PLANNED,
        ...getRunSource(schedule),
        timezone: schedule.timezone,
      })),
      skipDuplicates: true,
    });
  }
  const next = await tx.taskScheduleRun.findFirst({
    where: {
      scheduleId: schedule.id,
      state: TaskScheduleRunState.PLANNED,
    },
    orderBy: [{ effectiveScheduledAt: "asc" }, { id: "asc" }],
    select: { effectiveScheduledAt: true },
  });
  return next?.effectiveScheduledAt ?? null;
}

/** Whether the Run is still skipped, or planned at a moved time. */
export function isRunException(
  run: Pick<
    TaskScheduleRun,
    "state" | "originalScheduledAt" | "effectiveScheduledAt"
  >,
): boolean {
  return (
    run.state === TaskScheduleRunState.SKIPPED ||
    (run.state === TaskScheduleRunState.PLANNED &&
      run.originalScheduledAt?.getTime() !== run.effectiveScheduledAt.getTime())
  );
}

/**
 * Takes a schedule's planned Runs off the plan; released ones and
 * their Tasks stay. With `keepOwed`, ones already due still release, as after
 * a rule edit. Skipped and moved ones were someone's decision: a pause keeps
 * them for the resume, and a rule edit or an end cancels them into the
 * history.
 */
export async function stopPlannedTaskScheduleRuns(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  now: Date,
  {
    keepOwed,
    exceptions,
  }: { keepOwed: boolean; exceptions: "keep" | "cancel" },
): Promise<void> {
  const rows = await tx.taskScheduleRun.findMany({
    where: {
      scheduleId,
      OR: [
        {
          state: TaskScheduleRunState.PLANNED,
          ...(keepOwed ? { effectiveScheduledAt: { gt: now } } : {}),
        },
        {
          state: TaskScheduleRunState.SKIPPED,
          effectiveScheduledAt: { gt: now },
        },
      ],
    },
    select: {
      id: true,
      state: true,
      originalScheduledAt: true,
      effectiveScheduledAt: true,
    },
  });
  const ordinaryIds = rows
    .filter((row) => !isRunException(row))
    .map((row) => row.id);
  const exceptionIds = rows
    .filter((row) => isRunException(row))
    .map((row) => row.id);
  if (ordinaryIds.length > 0) {
    await tx.taskScheduleRun.deleteMany({
      where: { id: { in: ordinaryIds } },
    });
  }
  if (exceptions === "cancel" && exceptionIds.length > 0) {
    await tx.taskScheduleRun.updateMany({
      where: { id: { in: exceptionIds } },
      data: { state: TaskScheduleRunState.CANCELED },
    });
  }
}

/**
 * On resume, a move whose time passed while the schedule was Paused is
 * missed, like the rule's own Runs then: it is canceled, not made up.
 */
export async function cancelMissedTaskScheduleRuns(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  now: Date,
): Promise<void> {
  await tx.taskScheduleRun.updateMany({
    where: {
      scheduleId,
      state: TaskScheduleRunState.PLANNED,
      effectiveScheduledAt: { lte: now },
    },
    data: { state: TaskScheduleRunState.CANCELED },
  });
}

/**
 * Keeps an end-after-N plan at N once a restored Run counts again: the
 * Runs planned last, which took the skipped one's place, go. `keepId`
 * is the restored one, which the person asked for.
 */
export async function trimPlannedTaskScheduleRuns(
  tx: Prisma.TransactionClient,
  schedule: Pick<
    TaskSchedule,
    "id" | "endsMode" | "targetRunCount" | "releasedCount"
  >,
  keepId: string,
): Promise<void> {
  if (
    schedule.endsMode !== TaskScheduleEndsMode.AFTER ||
    schedule.targetRunCount == null
  ) {
    return;
  }
  const planned = await tx.taskScheduleRun.findMany({
    where: {
      scheduleId: schedule.id,
      state: TaskScheduleRunState.PLANNED,
    },
    orderBy: [{ originalScheduledAt: "desc" }],
    select: { id: true },
  });
  const excess =
    schedule.releasedCount + planned.length - schedule.targetRunCount;
  if (excess <= 0) return;
  await tx.taskScheduleRun.deleteMany({
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

/** Planned Runs follow the blueprint's project on the calendar. */
export async function moveTaskScheduleRunsToProject(
  tx: Prisma.TransactionClient,
  schedule: Pick<TaskSchedule, "id" | "workspaceId" | "projectId">,
): Promise<void> {
  await tx.taskScheduleRun.updateMany({
    where: {
      scheduleId: schedule.id,
      state: TaskScheduleRunState.PLANNED,
    },
    data: getRunSource(schedule),
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

export interface ReleasedTask {
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

/** Active, and not in a project that is closing: the project close ends those. */
function releasableWhere(now: Date): Prisma.TaskScheduleWhereInput {
  return {
    state: TaskScheduleState.ACTIVE,
    nextRunAt: { lte: now },
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
 * Creates the Task of each planned Run due in `due`, oldest first and of any
 * epoch (a rule edit keeps the Runs already owed). Each Run is claimed by
 * moving it from planned to released, so a retried release never creates a
 * second Task for it.
 */
async function releaseRuns(
  tx: Prisma.TransactionClient,
  schedule: TaskSchedule,
  {
    due,
    limit,
    shouldContinue,
  }: {
    due: Prisma.DateTimeFilter;
    limit: number;
    shouldContinue: () => boolean;
  },
): Promise<ReleasedTask[]> {
  const runs = await tx.taskScheduleRun.findMany({
    where: {
      scheduleId: schedule.id,
      state: TaskScheduleRunState.PLANNED,
      effectiveScheduledAt: due,
    },
    orderBy: [{ effectiveScheduledAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true },
  });

  const tasks: ReleasedTask[] = [];
  for (const run of runs) {
    if (!shouldContinue()) break;
    const task = await createTaskFromBlueprint(tx, schedule);
    const { count } = await tx.taskScheduleRun.updateMany({
      where: { id: run.id, state: TaskScheduleRunState.PLANNED },
      data: {
        state: TaskScheduleRunState.RELEASED,
        releasedTaskId: task.id,
      },
    });
    if (count !== 1) throw new ReleaseClaimLostError();
    tasks.push(task);
  }
  return tasks;
}

/**
 * Releases up to {@link MAX_RELEASES_PER_TRANSACTION} due Runs of one
 * schedule in one transaction. The schedule is claimed by its revision, so a
 * concurrent edit, pause, or end rolls the release back. No Seat check
 * (ADR 0020).
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

      const tasks = await releaseRuns(tx, schedule, {
        due: { lte: now },
        limit: MAX_RELEASES_PER_TRANSACTION,
        shouldContinue: () => canContinue(options),
      });

      const releasedCount = schedule.releasedCount + tasks.length;
      const nextRunAt = await projectTaskScheduleRuns(
        tx,
        { ...schedule, releasedCount },
        now,
      );
      // No planned Run left means the end rule is met.
      const ended = nextRunAt === null;
      const { count } = await tx.taskSchedule.updateMany({
        where: {
          id,
          revision: schedule.revision,
          releasedCount: schedule.releasedCount,
        },
        data: {
          releasedCount,
          nextRunAt,
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

/**
 * One project close batch for a schedule (ADR 0041): an Active schedule's
 * Runs owed before the cutoff still create their Tasks, `limit` at a time;
 * once none is owed, the schedule Ends and its later Runs leave the plan as on
 * a manual end. A Paused schedule releases nothing. The release scan skips
 * closing projects, and a release that read the schedule before the close
 * began loses its Run claim; a concurrent edit or Run change fails the batch.
 */
export async function closeTaskScheduleForProject(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  { cutoffAt, limit }: { cutoffAt: Date; limit: number },
): Promise<ScheduleReleaseOutcome> {
  const schedule = await tx.taskSchedule.findUniqueOrThrow({
    where: { id: scheduleId },
  });
  const owed: Prisma.DateTimeFilter = { lt: cutoffAt };
  const tasks =
    schedule.state === TaskScheduleState.ACTIVE
      ? await releaseRuns(tx, schedule, {
          due: owed,
          limit,
          shouldContinue: () => true,
        })
      : [];
  const releasedCount = schedule.releasedCount + tasks.length;
  const nextOwed =
    schedule.state === TaskScheduleState.ACTIVE
      ? await tx.taskScheduleRun.findFirst({
          where: {
            scheduleId,
            state: TaskScheduleRunState.PLANNED,
            effectiveScheduledAt: owed,
          },
          orderBy: [{ effectiveScheduledAt: "asc" }, { id: "asc" }],
          select: { effectiveScheduledAt: true },
        })
      : null;
  const stillOwed = nextOwed !== null;
  if (!stillOwed) {
    await stopPlannedTaskScheduleRuns(tx, scheduleId, new Date(), {
      keepOwed: false,
      exceptions: "cancel",
    });
  }

  const { count } = await tx.taskSchedule.updateMany({
    where: {
      id: scheduleId,
      revision: schedule.revision,
      releasedCount: schedule.releasedCount,
    },
    data: nextOwed
      ? { releasedCount, nextRunAt: nextOwed.effectiveScheduledAt }
      : {
          releasedCount,
          state: TaskScheduleState.ENDED,
          nextRunAt: null,
          revision: { increment: 1 },
        },
  });
  if (count !== 1) throw new ReleaseClaimLostError();
  return { tasks, ended: !stillOwed };
}

export async function announceReleasedTasks(
  tasks: ReleasedTask[],
): Promise<void> {
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

export interface RunAtReleaseResult {
  released: number;
  failed: number;
}

/**
 * Claims a Queued Task by its Run at, so a concurrent edit, status move, or
 * retried release leaves it alone. No Run row is involved.
 */
async function releaseRunAt(
  task: ReleasedTask & { runAt: Date | null },
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.task.updateMany({
      where: {
        id: task.id,
        status: TaskStatus.QUEUED,
        runAt: task.runAt,
        archivedAt: null,
      },
      data: { status: TaskStatus.READY, runAt: null },
    });
    if (count !== 1) return false;
    await tx.taskEvent.create({
      data: {
        taskId: task.id,
        status: TaskStatus.READY,
        channel: Channel.SOKOSUMI,
        userId: task.ownerId,
      },
    });
    return true;
  });
}

export const taskScheduleReleaseService = {
  /**
   * Behind the `/sync/task-schedules` cron: releases the due Runs of
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
        orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
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

  /**
   * Behind the same cron: moves every Queued Task whose Run at has passed
   * to Ready and clears its Run at (ADR 0041).
   */
  async releaseDueRunAts(
    options: TaskScheduleReleaseOptions,
  ): Promise<RunAtReleaseResult> {
    let released = 0;
    let failed = 0;
    const attempted = new Set<string>();

    while (canContinue(options)) {
      const batch = await prisma.task.findMany({
        where: {
          status: TaskStatus.QUEUED,
          runAt: { lte: new Date() },
          archivedAt: null,
          ...(attempted.size > 0 ? { id: { notIn: [...attempted] } } : {}),
        },
        orderBy: [{ runAt: "asc" }, { id: "asc" }],
        take: TASK_SCHEDULE_RELEASE_BATCH_SIZE,
        select: { id: true, runAt: true, ownerId: true, assigneeUserId: true },
      });
      if (batch.length === 0) break;

      for (const task of batch) {
        if (!canContinue(options)) break;
        attempted.add(task.id);
        try {
          if (!(await releaseRunAt(task))) continue;
        } catch (error) {
          failed += 1;
          Sentry.captureException(error, {
            tags: { error_type: "task_run_at_release" },
            extra: { taskId: task.id },
          });
          continue;
        }
        await announceReleasedTasks([task]);
        released += 1;
      }
    }

    return { released, failed };
  },
};
