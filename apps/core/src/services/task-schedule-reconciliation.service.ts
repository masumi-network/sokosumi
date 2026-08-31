import {
  CalendarSourceAccuracy,
  CalendarSourceType,
  CalendarTimeAccuracy,
  type Prisma,
  TaskLinkType,
  TaskScheduleOccurrenceState,
} from "@sokosumi/database";

import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import prisma from "@/lib/db/prisma";

const RECONCILIATION_BATCH_SIZE = 100;
const HIGH_WATER_KEY = "task-schedule-reconciliation:high-water";
const INITIAL_CURSOR_KEY = "task-schedule-reconciliation:initial-cursor";
const INITIAL_COMPLETE_KEY = "task-schedule-reconciliation:initial-complete";
const REPLAY_CURSOR_KEY = "task-schedule-reconciliation:replay-cursor";
const REPLAY_COMPLETE_KEY = "task-schedule-reconciliation:replay-complete";
export const TASK_SCHEDULE_RECONCILIATION_FINAL_COMPLETE_KEY =
  "task-schedule-reconciliation:final-complete";

const RECONCILIATION_LINK_SELECT = {
  id: true,
  createdAt: true,
  fromTaskId: true,
  toTaskId: true,
  fromTask: {
    select: {
      workspaceId: true,
      projectId: true,
      owner: { select: { email: true } },
    },
  },
  toTask: {
    select: {
      workspaceId: true,
      projectId: true,
      releasedScheduleOccurrence: {
        select: {
          id: true,
          seriesTaskId: true,
          releasedTaskId: true,
          legacyLinkId: true,
        },
      },
    },
  },
} satisfies Prisma.TaskLinkSelect;

const OCCURRENCE_IDENTITY_SELECT = {
  id: true,
  seriesTaskId: true,
  releasedTaskId: true,
  legacyLinkId: true,
} satisfies Prisma.TaskScheduleOccurrenceSelect;

type ReconciliationLink = Prisma.TaskLinkGetPayload<{
  select: typeof RECONCILIATION_LINK_SELECT;
}>;

interface ReconciliationCursor {
  lastSyncedAt: Date;
  cursorId: string | null;
}

export interface TaskScheduleReconciliationExecutionOptions {
  shouldContinue: () => boolean;
}

export interface TaskScheduleReconciliationResult {
  scanned: number;
  created: number;
  finalMissing: number;
  initialComplete: boolean;
  replayComplete: boolean;
  finalComplete: boolean;
}

interface BatchResult {
  scanned: number;
  created: number;
  complete: boolean;
}

function assertCompatibleOccurrence(
  occurrence: {
    seriesTaskId: string;
    releasedTaskId: string | null;
    legacyLinkId: string | null;
  },
  link: ReconciliationLink,
): void {
  if (
    occurrence.seriesTaskId !== link.fromTaskId ||
    occurrence.releasedTaskId !== link.toTaskId ||
    (occurrence.legacyLinkId != null && occurrence.legacyLinkId !== link.id)
  ) {
    throw new Error(
      `Schedule occurrence identity conflicts with legacy link ${link.id}`,
    );
  }
}

function getLegacySource(link: ReconciliationLink) {
  if (link.fromTask.workspaceId !== link.toTask.workspaceId) {
    return {
      sourceWorkspaceId: link.toTask.workspaceId,
      sourceType: CalendarSourceType.LEGACY_UNKNOWN,
      sourceProjectId: null,
      sourceAccuracy: CalendarSourceAccuracy.UNKNOWN,
    };
  }

  return {
    sourceWorkspaceId: link.toTask.workspaceId,
    sourceType: link.toTask.projectId
      ? CalendarSourceType.PROJECT
      : CalendarSourceType.WORKSPACE,
    sourceProjectId: link.toTask.projectId,
    sourceAccuracy: CalendarSourceAccuracy.INFERRED,
  };
}

async function reconcileLink(
  tx: Prisma.TransactionClient,
  link: ReconciliationLink,
): Promise<boolean> {
  if (link.toTask.releasedScheduleOccurrence) {
    assertCompatibleOccurrence(link.toTask.releasedScheduleOccurrence, link);
    return false;
  }

  const existingByLink = await tx.taskScheduleOccurrence.findUnique({
    where: { legacyLinkId: link.id },
    select: OCCURRENCE_IDENTITY_SELECT,
  });
  if (existingByLink) {
    assertCompatibleOccurrence(existingByLink, link);
    return false;
  }

  const occurrence = await tx.taskScheduleOccurrence.upsert({
    where: { releasedTaskId: link.toTaskId },
    create: {
      seriesTaskId: link.fromTaskId,
      releasedTaskId: link.toTaskId,
      legacyLinkId: link.id,
      scheduleVersion: 1,
      effectiveScheduledAt: link.createdAt,
      state: TaskScheduleOccurrenceState.RELEASED,
      ...getLegacySource(link),
      timeAccuracy: CalendarTimeAccuracy.APPROXIMATE,
    },
    update: {},
    select: OCCURRENCE_IDENTITY_SELECT,
  });
  assertCompatibleOccurrence(occurrence, link);
  return true;
}

async function lockAndRefreshLinks(
  tx: Prisma.TransactionClient,
  links: ReconciliationLink[],
): Promise<ReconciliationLink[]> {
  const projectsByWorkspace = new Map<string, Set<string>>();
  for (const link of links) {
    const projectIds =
      projectsByWorkspace.get(link.toTask.workspaceId) ?? new Set();
    if (link.toTask.projectId) {
      projectIds.add(link.toTask.projectId);
    }
    projectsByWorkspace.set(link.toTask.workspaceId, projectIds);
  }

  for (const workspaceId of [...projectsByWorkspace.keys()].sort()) {
    const projectIds = [...(projectsByWorkspace.get(workspaceId) ?? [])];
    if (!(await lockCalendarScope(tx, workspaceId, projectIds))) {
      throw new Error(
        `Calendar source changed during schedule reconciliation for workspace ${workspaceId}`,
      );
    }
  }

  const taskIds = links.flatMap((link) => [link.fromTaskId, link.toTaskId]);
  if (!(await lockTaskRows(tx, taskIds))) {
    throw new Error("Task changed during schedule reconciliation");
  }

  const refreshed: ReconciliationLink[] = [];
  for (const link of links) {
    const current = await tx.taskLink.findUnique({
      where: { id: link.id },
      select: RECONCILIATION_LINK_SELECT,
    });
    if (!current) {
      continue;
    }
    if (
      current.toTask.workspaceId !== link.toTask.workspaceId ||
      current.toTask.projectId !== link.toTask.projectId
    ) {
      throw new Error(
        `Calendar source changed during schedule reconciliation for link ${link.id}`,
      );
    }
    refreshed.push(current);
  }

  return refreshed;
}

async function createMarker(
  tx: Prisma.TransactionClient,
  key: string,
  cursor: ReconciliationCursor,
): Promise<boolean> {
  const result = await tx.syncMetadata.createMany({
    data: {
      key,
      lastSyncedAt: cursor.lastSyncedAt,
      cursorId: cursor.cursorId,
    },
    skipDuplicates: true,
  });
  return result.count === 1;
}

async function getOrCreateHighWater(): Promise<ReconciliationCursor> {
  const existing = await prisma.syncMetadata.findUnique({
    where: { key: HIGH_WATER_KEY },
    select: { lastSyncedAt: true, cursorId: true },
  });
  if (existing) {
    return existing;
  }

  return prisma.$transaction(async (tx) => {
    const concurrent = await tx.syncMetadata.findUnique({
      where: { key: HIGH_WATER_KEY },
      select: { lastSyncedAt: true, cursorId: true },
    });
    if (concurrent) {
      return concurrent;
    }

    const latestLink = await tx.taskLink.findFirst({
      where: { type: TaskLinkType.SCHEDULE },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { createdAt: true, id: true },
    });
    const highWater = {
      lastSyncedAt: latestLink?.createdAt ?? new Date(0),
      cursorId: latestLink?.id ?? null,
    };
    const created = await createMarker(tx, HIGH_WATER_KEY, highWater);
    if (created) {
      return highWater;
    }

    const winner = await tx.syncMetadata.findUnique({
      where: { key: HIGH_WATER_KEY },
      select: { lastSyncedAt: true, cursorId: true },
    });
    if (!winner) {
      throw new Error(
        "Failed to initialize schedule reconciliation high-water",
      );
    }
    return winner;
  });
}

function cursorRangeWhere(
  cursor: ReconciliationCursor | null,
  highWater: ReconciliationCursor,
): Prisma.TaskLinkWhereInput {
  const bounds: Prisma.TaskLinkWhereInput[] = [
    {
      OR: [
        { createdAt: { lt: highWater.lastSyncedAt } },
        {
          createdAt: highWater.lastSyncedAt,
          id: { lte: highWater.cursorId ?? "" },
        },
      ],
    },
  ];

  if (cursor?.cursorId) {
    bounds.push({
      OR: [
        { createdAt: { gt: cursor.lastSyncedAt } },
        {
          createdAt: cursor.lastSyncedAt,
          id: { gt: cursor.cursorId },
        },
      ],
    });
  }

  return {
    type: TaskLinkType.SCHEDULE,
    AND: bounds,
  };
}

async function advanceCursor(
  tx: Prisma.TransactionClient,
  key: string,
  previous: ReconciliationCursor | null,
  next: ReconciliationCursor,
): Promise<void> {
  if (!previous) {
    const created = await createMarker(tx, key, next);
    if (!created) {
      throw new Error(`Schedule reconciliation cursor changed for ${key}`);
    }
    return;
  }

  const result = await tx.syncMetadata.updateMany({
    where: {
      key,
      lastSyncedAt: previous.lastSyncedAt,
      cursorId: previous.cursorId,
    },
    data: {
      lastSyncedAt: next.lastSyncedAt,
      cursorId: next.cursorId,
    },
  });
  if (result.count !== 1) {
    throw new Error(`Schedule reconciliation cursor changed for ${key}`);
  }
}

async function processBoundedBatch(
  cursorKey: string,
  completeKey: string,
  highWater: ReconciliationCursor,
): Promise<BatchResult> {
  if (!highWater.cursorId) {
    await createMarker(prisma, completeKey, {
      lastSyncedAt: new Date(),
      cursorId: null,
    });
    return { scanned: 0, created: 0, complete: true };
  }

  return prisma.$transaction(async (tx) => {
    const cursor = await tx.syncMetadata.findUnique({
      where: { key: cursorKey },
      select: { lastSyncedAt: true, cursorId: true },
    });
    const links = await tx.taskLink.findMany({
      where: {
        AND: [
          cursorRangeWhere(cursor, highWater),
          {
            fromTask: {
              owner: {
                email: { endsWith: "@nmkr.io", mode: "insensitive" },
              },
            },
          },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: RECONCILIATION_BATCH_SIZE,
      select: RECONCILIATION_LINK_SELECT,
    });

    const lockedLinks = await lockAndRefreshLinks(tx, links);
    let created = 0;
    for (const link of lockedLinks) {
      if (await reconcileLink(tx, link)) {
        created += 1;
      }
    }

    const lastLink = links.at(-1);
    if (lastLink) {
      await advanceCursor(tx, cursorKey, cursor, {
        lastSyncedAt: lastLink.createdAt,
        cursorId: lastLink.id,
      });
    }

    const complete = links.length < RECONCILIATION_BATCH_SIZE;
    if (complete) {
      await createMarker(tx, completeKey, {
        lastSyncedAt: new Date(),
        cursorId: null,
      });
    }

    return { scanned: links.length, created, complete };
  });
}

async function markerExists(key: string): Promise<boolean> {
  const marker = await prisma.syncMetadata.findUnique({
    where: { key },
    select: { key: true },
  });
  return marker != null;
}

async function processFinalBatch(): Promise<BatchResult> {
  await prisma.syncMetadata.deleteMany({
    where: { key: TASK_SCHEDULE_RECONCILIATION_FINAL_COMPLETE_KEY },
  });

  return prisma.$transaction(async (tx) => {
    const links = await tx.taskLink.findMany({
      where: {
        type: TaskLinkType.SCHEDULE,
        toTask: { releasedScheduleOccurrence: { is: null } },
        fromTask: {
          owner: {
            email: { endsWith: "@nmkr.io", mode: "insensitive" },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: RECONCILIATION_BATCH_SIZE,
      select: RECONCILIATION_LINK_SELECT,
    });

    const lockedLinks = await lockAndRefreshLinks(tx, links);
    let created = 0;
    for (const link of lockedLinks) {
      if (await reconcileLink(tx, link)) {
        created += 1;
      }
    }

    const complete = links.length < RECONCILIATION_BATCH_SIZE;
    if (complete) {
      await tx.syncMetadata.upsert({
        where: { key: TASK_SCHEDULE_RECONCILIATION_FINAL_COMPLETE_KEY },
        create: {
          key: TASK_SCHEDULE_RECONCILIATION_FINAL_COMPLETE_KEY,
          lastSyncedAt: new Date(),
          cursorId: null,
        },
        update: {
          lastSyncedAt: new Date(),
          cursorId: null,
        },
      });
    }

    return {
      scanned: links.length,
      created,
      complete,
    };
  });
}

export const taskScheduleReconciliationService = {
  async reconcileScheduleHistory(
    options: TaskScheduleReconciliationExecutionOptions,
  ): Promise<TaskScheduleReconciliationResult> {
    const highWater = await getOrCreateHighWater();
    const result: TaskScheduleReconciliationResult = {
      scanned: 0,
      created: 0,
      finalMissing: 0,
      initialComplete: await markerExists(INITIAL_COMPLETE_KEY),
      replayComplete: await markerExists(REPLAY_COMPLETE_KEY),
      finalComplete: false,
    };

    while (options.shouldContinue()) {
      if (!result.initialComplete) {
        const batch = await processBoundedBatch(
          INITIAL_CURSOR_KEY,
          INITIAL_COMPLETE_KEY,
          highWater,
        );
        result.scanned += batch.scanned;
        result.created += batch.created;
        result.initialComplete = batch.complete;
        continue;
      }

      if (!result.replayComplete) {
        const batch = await processBoundedBatch(
          REPLAY_CURSOR_KEY,
          REPLAY_COMPLETE_KEY,
          highWater,
        );
        result.scanned += batch.scanned;
        result.created += batch.created;
        result.replayComplete = batch.complete;
        continue;
      }

      const batch = await processFinalBatch();
      result.scanned += batch.scanned;
      result.created += batch.created;
      result.finalMissing += batch.scanned;
      result.finalComplete = batch.complete;
      if (batch.complete) {
        break;
      }
    }

    return result;
  },
};
