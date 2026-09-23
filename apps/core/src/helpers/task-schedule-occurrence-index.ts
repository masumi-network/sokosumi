import {
  CalendarSourceAccuracy,
  CalendarSourceType,
  CalendarTimeAccuracy,
  type Prisma,
  TaskScheduleOccurrenceState,
  TaskStatus,
} from "@sokosumi/database";
import type { TaskScheduleMetadata } from "@sokosumi/utils";

import {
  computeNextRuleOccurrence,
  iterateTaskScheduleOccurrences,
  resolveTaskScheduleRuleAnchor,
} from "@/helpers/task-schedule";
import { quarantineTaskSchedule } from "@/helpers/task-schedule-quarantine";
import { validatePersistedTaskSchedule } from "@/helpers/task-schedule-validation";

export const CALENDAR_OCCURRENCE_HORIZON_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_INDEXED_TASK_SCHEDULE_OCCURRENCES = 2_000;

export class TaskScheduleOccurrenceLimitError extends Error {
  constructor() {
    super(
      `Schedule creates too many occurrences in the next 90 days (maximum ${MAX_INDEXED_TASK_SCHEDULE_OCCURRENCES})`,
    );
    this.name = "TaskScheduleOccurrenceLimitError";
  }
}

export interface TaskScheduleOccurrenceIndexTask {
  id: string;
  workspaceId: string;
  projectId: string | null;
  schedule: TaskScheduleMetadata;
  nextRunAt: Date;
}

export interface TaskScheduleOccurrenceIndexCandidate {
  id: string;
  workspaceId: string;
  projectId: string | null;
  status: TaskStatus;
  metadata: string | null;
  nextRunAt: Date | null;
}

interface TaskScheduleOccurrenceDeleteClient {
  taskScheduleOccurrence: Pick<
    Prisma.TransactionClient["taskScheduleOccurrence"],
    "deleteMany"
  >;
}

interface TaskScheduleOccurrenceCreateClient {
  taskScheduleOccurrence: Pick<
    Prisma.TransactionClient["taskScheduleOccurrence"],
    "createMany"
  >;
}

interface TaskScheduleOccurrenceIndexClient {
  taskScheduleOccurrence: Pick<
    Prisma.TransactionClient["taskScheduleOccurrence"],
    "createMany" | "deleteMany" | "findMany" | "updateMany"
  >;
}

interface TaskScheduleOccurrenceRetireClient {
  taskScheduleOccurrence: Pick<
    Prisma.TransactionClient["taskScheduleOccurrence"],
    "findMany" | "updateMany" | "deleteMany"
  >;
}

interface TaskScheduleOccurrenceReadClient {
  taskScheduleOccurrence: Pick<
    Prisma.TransactionClient["taskScheduleOccurrence"],
    "findMany"
  >;
}

interface TaskScheduleOccurrenceRefreshClient
  extends TaskScheduleOccurrenceIndexClient {
  taskScheduleQuarantine: Pick<
    Prisma.TransactionClient["taskScheduleQuarantine"],
    "upsert"
  >;
}

/** Calendar source of the Occurrences a series or Task Schedule plans. */
export function getOccurrenceSource(task: {
  workspaceId: string;
  projectId: string | null;
}) {
  return {
    sourceWorkspaceId: task.workspaceId,
    sourceType: task.projectId
      ? CalendarSourceType.PROJECT
      : CalendarSourceType.WORKSPACE,
    sourceProjectId: task.projectId,
    sourceAccuracy: CalendarSourceAccuracy.EXACT,
    timeAccuracy: CalendarTimeAccuracy.EXACT,
  };
}

export async function removeTaskSchedulePlannedOccurrences(
  tx: TaskScheduleOccurrenceDeleteClient,
  seriesTaskId: string,
): Promise<void> {
  await tx.taskScheduleOccurrence.deleteMany({
    where: {
      seriesTaskId,
      state: TaskScheduleOccurrenceState.PLANNED,
    },
  });
}

function projectPlannedOccurrenceRows(
  task: TaskScheduleOccurrenceIndexTask,
  now: Date,
) {
  const horizonEnd = new Date(now.getTime() + CALENDAR_OCCURRENCE_HORIZON_MS);
  // For v2 the wake time (`nextRunAt`) is not a rule time once an occurrence is
  // moved, so the projection walks the rule from its stored anchor instead.
  const projectionStart =
    task.schedule.mode === "recurring" && task.schedule.version === 2
      ? (computeNextRuleOccurrence(task.schedule) ?? task.nextRunAt)
      : task.nextRunAt;
  const occurrences = Array.from(
    iterateTaskScheduleOccurrences(
      task.id,
      task.schedule,
      projectionStart,
      now,
      horizonEnd,
      MAX_INDEXED_TASK_SCHEDULE_OCCURRENCES + 1,
    ),
  );
  if (occurrences.length > MAX_INDEXED_TASK_SCHEDULE_OCCURRENCES) {
    throw new TaskScheduleOccurrenceLimitError();
  }

  const source = getOccurrenceSource(task);
  return occurrences.map((occurrence) => ({
    seriesTaskId: task.id,
    epochId: task.schedule.version === 2 ? task.schedule.epochId : null,
    originalScheduledAt: occurrence.originalScheduledAt,
    effectiveScheduledAt: occurrence.scheduledAt,
    state: TaskScheduleOccurrenceState.PLANNED,
    scheduleVersion: task.schedule.version,
    ...source,
    timezone:
      task.schedule.version === 2 || task.schedule.mode === "recurring"
        ? task.schedule.timezone
        : null,
    ruleSnapshot: task.schedule,
  }));
}

/**
 * Adds the rolling-horizon projection for a schedule epoch without touching
 * rows that already exist. Series edits pair this with
 * {@link retireTaskScheduleFutureOccurrences} so past and released history
 * survives the rule change.
 */
export async function createTaskSchedulePlannedOccurrences(
  tx: TaskScheduleOccurrenceCreateClient,
  task: TaskScheduleOccurrenceIndexTask,
  now = new Date(),
): Promise<void> {
  const rows = projectPlannedOccurrenceRows(task, now);
  if (rows.length === 0) {
    return;
  }

  await tx.taskScheduleOccurrence.createMany({ data: rows });
}

async function projectPlannedOccurrenceRowsWithSkippedCapacity(
  tx: TaskScheduleOccurrenceIndexClient,
  task: TaskScheduleOccurrenceIndexTask,
  now: Date,
) {
  if (
    task.schedule.version !== 2 ||
    task.schedule.mode !== "recurring" ||
    task.schedule.endsMode !== "after" ||
    task.schedule.targetReleaseCount == null
  ) {
    return projectPlannedOccurrenceRows(task, now);
  }

  const ruleAnchor = resolveTaskScheduleRuleAnchor(task.schedule);
  const skipped = await tx.taskScheduleOccurrence.findMany({
    where: {
      seriesTaskId: task.id,
      epochId: task.schedule.epochId,
      state: TaskScheduleOccurrenceState.SKIPPED,
      originalScheduledAt: { gt: ruleAnchor },
    },
    select: { originalScheduledAt: true },
  });
  const skippedOriginalTimes = new Set(
    skipped.flatMap((occurrence) =>
      occurrence.originalScheduledAt
        ? [occurrence.originalScheduledAt.toISOString()]
        : [],
    ),
  );
  let projectionSchedule = task.schedule;
  let nextRuleOccurrence = computeNextRuleOccurrence(projectionSchedule);
  while (
    nextRuleOccurrence &&
    nextRuleOccurrence < now &&
    skippedOriginalTimes.delete(nextRuleOccurrence.toISOString())
  ) {
    projectionSchedule = {
      ...projectionSchedule,
      lastProcessedSourceAt: nextRuleOccurrence.toISOString(),
    };
    nextRuleOccurrence = computeNextRuleOccurrence(projectionSchedule);
  }

  return projectPlannedOccurrenceRows(
    {
      ...task,
      schedule: {
        ...projectionSchedule,
        targetReleaseCount:
          task.schedule.targetReleaseCount + skippedOriginalTimes.size,
      },
    },
    now,
  ).map((row) => ({ ...row, ruleSnapshot: task.schedule }));
}

interface OccurrenceProjectionIdentity {
  epochId: string | null;
  originalScheduledAt: Date | null;
}

function getOccurrenceProjectionIdentity(
  occurrence: OccurrenceProjectionIdentity,
): string | null {
  return occurrence.originalScheduledAt
    ? `${occurrence.epochId ?? "legacy"}:${occurrence.originalScheduledAt.toISOString()}`
    : null;
}

/**
 * Reconciles stored projections with the current projection: obsolete ordinary
 * rows are deleted, retained rows keep their IDs and receive the current
 * Calendar source, and stored identities are returned so the caller can create
 * missing rows. A moved occurrence is a durable human decision and survives;
 * a skipped row is not `PLANNED`, so it is never in the candidate set at all.
 */
async function reconcileExistingPlannedOccurrences(
  tx: TaskScheduleOccurrenceIndexClient,
  seriesTaskId: string,
  now: Date,
  projectedRows: OccurrenceProjectionIdentity[],
  projectedSource: ReturnType<typeof getOccurrenceSource>,
): Promise<Set<string>> {
  const planned = await tx.taskScheduleOccurrence.findMany({
    where: {
      seriesTaskId,
      state: TaskScheduleOccurrenceState.PLANNED,
      effectiveScheduledAt: { gte: now },
    },
    select: {
      id: true,
      epochId: true,
      state: true,
      scheduleVersion: true,
      originalScheduledAt: true,
      effectiveScheduledAt: true,
      sourceWorkspaceId: true,
      sourceType: true,
      sourceProjectId: true,
      sourceAccuracy: true,
      timeAccuracy: true,
    },
  });
  const projectedIdentities = new Set(
    projectedRows
      .map(getOccurrenceProjectionIdentity)
      .filter((identity): identity is string => identity !== null),
  );
  const existingIdentities = new Set(
    planned
      .map(getOccurrenceProjectionIdentity)
      .filter((identity): identity is string => identity !== null),
  );
  const obsoleteOrdinaryIds = planned
    .filter((row) => {
      if (isDurableScheduleException(row)) {
        return false;
      }
      const identity = getOccurrenceProjectionIdentity(row);
      return identity === null || !projectedIdentities.has(identity);
    })
    .map((row) => row.id);
  const obsoleteOrdinaryIdSet = new Set(obsoleteOrdinaryIds);
  const staleSourceIds = planned
    .filter(
      (row) =>
        !obsoleteOrdinaryIdSet.has(row.id) &&
        (row.sourceWorkspaceId !== projectedSource.sourceWorkspaceId ||
          row.sourceType !== projectedSource.sourceType ||
          row.sourceProjectId !== projectedSource.sourceProjectId ||
          row.sourceAccuracy !== projectedSource.sourceAccuracy ||
          row.timeAccuracy !== projectedSource.timeAccuracy),
    )
    .map((row) => row.id);

  if (staleSourceIds.length > 0) {
    await tx.taskScheduleOccurrence.updateMany({
      where: { id: { in: staleSourceIds } },
      data: projectedSource,
    });
  }

  if (obsoleteOrdinaryIds.length > 0) {
    await tx.taskScheduleOccurrence.deleteMany({
      where: { id: { in: obsoleteOrdinaryIds } },
    });
  }
  return existingIdentities;
}

export async function replaceTaskSchedulePlannedOccurrences(
  tx: TaskScheduleOccurrenceIndexClient,
  task: TaskScheduleOccurrenceIndexTask,
  now = new Date(),
): Promise<void> {
  const rows = await projectPlannedOccurrenceRowsWithSkippedCapacity(
    tx,
    task,
    now,
  );

  await replaceTaskSchedulePlannedOccurrenceRows(tx, task, now, rows);
}

async function replaceTaskSchedulePlannedOccurrenceRows(
  tx: TaskScheduleOccurrenceIndexClient,
  task: TaskScheduleOccurrenceIndexTask,
  now: Date,
  rows: ReturnType<typeof projectPlannedOccurrenceRows>,
): Promise<void> {
  const existingIdentities = await reconcileExistingPlannedOccurrences(
    tx,
    task.id,
    now,
    rows,
    getOccurrenceSource(task),
  );
  const missingRows = rows.filter((row) => {
    const identity = getOccurrenceProjectionIdentity(row);
    return identity === null || !existingIdentities.has(identity);
  });
  if (missingRows.length === 0) {
    return;
  }

  // A projected time still owned by a moved or skipped exception stays with
  // that row, so the rebuild must not collide with its identity.
  await tx.taskScheduleOccurrence.createMany({
    data: missingRows,
    skipDuplicates: true,
  });
}

export interface TaskScheduleOccurrenceReleaseCandidate {
  id: string;
  epochId: string | null;
  originalScheduledAt: Date | null;
  effectiveScheduledAt: Date;
}

interface TaskScheduleOccurrenceNextClient {
  taskScheduleOccurrence: Pick<
    Prisma.TransactionClient["taskScheduleOccurrence"],
    "findFirst"
  >;
}

/**
 * The earliest occurrence the series still owes a release for, including an
 * overdue row left behind when a scheduler invocation exhausts its budget.
 * This is the ledger-driven next run for v2 series, so a moved occurrence pulls
 * the next run to its new time and a skipped one never becomes the next run.
 */
export async function findNextReleaseableOccurrence(
  tx: TaskScheduleOccurrenceNextClient,
  seriesTaskId: string,
  epochId: string | null,
): Promise<TaskScheduleOccurrenceReleaseCandidate | null> {
  return tx.taskScheduleOccurrence.findFirst({
    where: {
      seriesTaskId,
      epochId,
      state: TaskScheduleOccurrenceState.PLANNED,
    },
    orderBy: [{ effectiveScheduledAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      epochId: true,
      originalScheduledAt: true,
      effectiveScheduledAt: true,
    },
  });
}

export interface RetiredTaskScheduleOccurrences {
  canceledCount: number;
}

function isDurableScheduleException(occurrence: {
  state: TaskScheduleOccurrenceState;
  scheduleVersion: number;
  originalScheduledAt: Date | null;
  effectiveScheduledAt: Date;
}): boolean {
  // A legacy row carries no epoch and the identity check constraint requires
  // `state = 'PLANNED'` for it, so it can only ever be deleted.
  if (occurrence.scheduleVersion === 1) {
    return false;
  }

  return (
    occurrence.state === TaskScheduleOccurrenceState.SKIPPED ||
    (occurrence.originalScheduledAt != null &&
      occurrence.originalScheduledAt.getTime() !==
        occurrence.effectiveScheduledAt.getTime())
  );
}

function futureScheduleOccurrenceCandidatesWhere(
  seriesTaskId: string,
  now: Date,
  sourceProjectId?: string,
): Prisma.TaskScheduleOccurrenceWhereInput {
  return {
    seriesTaskId,
    ...(sourceProjectId ? { sourceProjectId } : {}),
    effectiveScheduledAt: { gte: now },
    state: {
      in: [
        TaskScheduleOccurrenceState.PLANNED,
        TaskScheduleOccurrenceState.SKIPPED,
      ],
    },
  };
}

/**
 * Retires the future half of a series ledger when its rule is replaced or the
 * series is removed.
 *
 * A durable exception — a skipped occurrence, or a planned one a human moved
 * away from its original time — becomes `CANCELED` so the decision stays
 * visible in history. Ordinary future projections carry no decision and are
 * deleted. Released occurrences and everything already in the past are never
 * touched.
 *
 * The candidate read is unbounded on purpose: every series edit and removal
 * retires the whole future half before projecting again, so at most one live
 * epoch's projection is ever in this set, and that projection is capped at
 * {@link MAX_INDEXED_TASK_SCHEDULE_OCCURRENCES} rows inside the
 * {@link CALENDAR_OCCURRENCE_HORIZON_MS} horizon. A `take` here would silently
 * strand rows instead of retiring them if that invariant ever broke.
 */
export async function retireTaskScheduleFutureOccurrences(
  tx: TaskScheduleOccurrenceRetireClient,
  seriesTaskId: string,
  now = new Date(),
  options: { sourceProjectId?: string } = {},
): Promise<RetiredTaskScheduleOccurrences> {
  const futureOccurrences = await tx.taskScheduleOccurrence.findMany({
    where: futureScheduleOccurrenceCandidatesWhere(
      seriesTaskId,
      now,
      options.sourceProjectId,
    ),
    select: {
      id: true,
      state: true,
      scheduleVersion: true,
      originalScheduledAt: true,
      effectiveScheduledAt: true,
    },
  });

  const canceledIds: string[] = [];
  const deletedIds: string[] = [];
  for (const occurrence of futureOccurrences) {
    if (isDurableScheduleException(occurrence)) {
      canceledIds.push(occurrence.id);
    } else {
      deletedIds.push(occurrence.id);
    }
  }

  if (canceledIds.length > 0) {
    await tx.taskScheduleOccurrence.updateMany({
      where: { id: { in: canceledIds } },
      data: { state: TaskScheduleOccurrenceState.CANCELED },
    });
  }
  if (deletedIds.length > 0) {
    await tx.taskScheduleOccurrence.deleteMany({
      where: { id: { in: deletedIds } },
    });
  }

  return { canceledCount: canceledIds.length };
}

/**
 * How many durable exceptions a full-series edit or removal would cancel right
 * now.
 *
 * It reads the same bounded future candidate set as
 * {@link retireTaskScheduleFutureOccurrences} and applies the same predicate,
 * so the number a confirmation dialog shows is exactly the number the mutation
 * would retire — a `count` with its own hand-written predicate could drift
 * from the retirement rule.
 */
export async function countTaskScheduleFutureExceptions(
  tx: TaskScheduleOccurrenceReadClient,
  seriesTaskId: string,
  now = new Date(),
): Promise<number> {
  const futureOccurrences = await tx.taskScheduleOccurrence.findMany({
    where: futureScheduleOccurrenceCandidatesWhere(seriesTaskId, now),
    select: {
      state: true,
      scheduleVersion: true,
      originalScheduledAt: true,
      effectiveScheduledAt: true,
    },
  });

  return futureOccurrences.filter(isDurableScheduleException).length;
}

export async function refreshTaskSchedulePlannedOccurrences(
  tx: TaskScheduleOccurrenceRefreshClient,
  task: TaskScheduleOccurrenceIndexCandidate,
): Promise<void> {
  if (task.metadata === null && task.nextRunAt === null) {
    await removeTaskSchedulePlannedOccurrences(tx, task.id);
    return;
  }

  const validation = validatePersistedTaskSchedule(task);
  if (!validation.valid) {
    await quarantineTaskSchedule(
      tx,
      task,
      validation.reason,
      validation.details,
    );
    return;
  }
  if (!task.nextRunAt) {
    return;
  }

  try {
    await replaceTaskSchedulePlannedOccurrences(tx, {
      id: task.id,
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      schedule: validation.metadata,
      nextRunAt: task.nextRunAt,
    });
  } catch (error) {
    if (!(error instanceof TaskScheduleOccurrenceLimitError)) {
      throw error;
    }
    await removeTaskSchedulePlannedOccurrences(tx, task.id);
  }
}
