import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeSyncMetadata {
  key: string;
  lastSyncedAt: Date;
  cursorId: string | null;
}

interface FakeOccurrence {
  id: string;
  seriesTaskId: string;
  releasedTaskId: string;
  legacyLinkId: string | null;
}

interface FakeScheduleLink {
  id: string;
  createdAt: Date;
  fromTaskId: string;
  toTaskId: string;
  fromTask: {
    workspaceId: string;
    projectId: string | null;
  };
  toTask: {
    workspaceId: string;
    projectId: string | null;
    releasedScheduleOccurrence: FakeOccurrence | null;
  };
}

const state = vi.hoisted(() => ({
  syncMetadata: new Map<string, FakeSyncMetadata>(),
  links: [] as FakeScheduleLink[],
  occurrences: [] as FakeOccurrence[],
}));

const syncMetadataFindUniqueMock = vi.hoisted(() => vi.fn());
const syncMetadataCreateManyMock = vi.hoisted(() => vi.fn());
const syncMetadataUpdateManyMock = vi.hoisted(() => vi.fn());
const syncMetadataUpsertMock = vi.hoisted(() => vi.fn());
const syncMetadataDeleteManyMock = vi.hoisted(() => vi.fn());
const taskLinkFindFirstMock = vi.hoisted(() => vi.fn());
const taskLinkFindManyMock = vi.hoisted(() => vi.fn());
const taskLinkFindUniqueMock = vi.hoisted(() => vi.fn());
const occurrenceFindUniqueMock = vi.hoisted(() => vi.fn());
const occurrenceUpsertMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const lockCalendarScopeMock = vi.hoisted(() => vi.fn());
const lockTaskRowsMock = vi.hoisted(() => vi.fn());

const fakePrisma = {
  syncMetadata: {
    findUnique: syncMetadataFindUniqueMock,
    createMany: syncMetadataCreateManyMock,
    updateMany: syncMetadataUpdateManyMock,
    upsert: syncMetadataUpsertMock,
    deleteMany: syncMetadataDeleteManyMock,
  },
  taskLink: {
    findFirst: taskLinkFindFirstMock,
    findMany: taskLinkFindManyMock,
    findUnique: taskLinkFindUniqueMock,
  },
  taskScheduleOccurrence: {
    findUnique: occurrenceFindUniqueMock,
    upsert: occurrenceUpsertMock,
  },
};

vi.mock("@/lib/db/prisma", () => ({
  default: {
    ...fakePrisma,
    $transaction: transactionMock,
  },
}));

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
  lockTaskRows: lockTaskRowsMock,
}));

function createLink(id: string, createdAt: string): FakeScheduleLink {
  return {
    id,
    createdAt: new Date(createdAt),
    fromTaskId: `series-${id}`,
    toTaskId: `release-${id}`,
    fromTask: {
      workspaceId: "workspace-1",
      projectId: null,
    },
    toTask: {
      workspaceId: "workspace-1",
      projectId: "project-1",
      releasedScheduleOccurrence: null,
    },
  };
}

describe("taskScheduleReconciliationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));
    state.syncMetadata.clear();
    state.links = [createLink("link-1", "2026-08-20T09:00:00.000Z")];
    state.occurrences = [];
    lockCalendarScopeMock.mockResolvedValue(true);
    lockTaskRowsMock.mockResolvedValue(true);

    transactionMock.mockImplementation(async (callback) =>
      callback(fakePrisma),
    );
    syncMetadataFindUniqueMock.mockImplementation(({ where: { key } }) => {
      return state.syncMetadata.get(key) ?? null;
    });
    syncMetadataCreateManyMock.mockImplementation(({ data }) => {
      const rows = Array.isArray(data) ? data : [data];
      let count = 0;
      for (const row of rows) {
        if (!state.syncMetadata.has(row.key)) {
          state.syncMetadata.set(row.key, row);
          count += 1;
        }
      }
      return { count };
    });
    syncMetadataUpdateManyMock.mockImplementation(({ where, data }) => {
      const current = state.syncMetadata.get(where.key);
      if (
        !current ||
        current.lastSyncedAt.getTime() !== where.lastSyncedAt.getTime() ||
        current.cursorId !== where.cursorId
      ) {
        return { count: 0 };
      }
      state.syncMetadata.set(where.key, { ...current, ...data });
      return { count: 1 };
    });
    syncMetadataUpsertMock.mockImplementation(({ where, create, update }) => {
      const current = state.syncMetadata.get(where.key);
      const row = current ? { ...current, ...update } : create;
      state.syncMetadata.set(where.key, row);
      return row;
    });
    syncMetadataDeleteManyMock.mockImplementation(({ where: { key } }) => {
      const deleted = state.syncMetadata.delete(key);
      return { count: deleted ? 1 : 0 };
    });
    taskLinkFindFirstMock.mockImplementation(() => {
      return [...state.links].sort((a, b) => {
        return (
          b.createdAt.getTime() - a.createdAt.getTime() ||
          b.id.localeCompare(a.id)
        );
      })[0];
    });
    taskLinkFindManyMock.mockImplementation(({ where, take }) => {
      const missingOnly = where.toTask?.releasedScheduleOccurrence?.is === null;
      return [...state.links]
        .filter((link) => {
          return !missingOnly || link.toTask.releasedScheduleOccurrence == null;
        })
        .sort((a, b) => {
          return (
            a.createdAt.getTime() - b.createdAt.getTime() ||
            a.id.localeCompare(b.id)
          );
        })
        .slice(0, take);
    });
    taskLinkFindUniqueMock.mockImplementation(({ where: { id } }) => {
      return state.links.find((link) => link.id === id) ?? null;
    });
    occurrenceFindUniqueMock.mockImplementation(({ where }) => {
      if (where.legacyLinkId) {
        return (
          state.occurrences.find(
            (occurrence) => occurrence.legacyLinkId === where.legacyLinkId,
          ) ?? null
        );
      }
      return null;
    });
    occurrenceUpsertMock.mockImplementation(({ where, create }) => {
      const existing = state.occurrences.find(
        (occurrence) => occurrence.releasedTaskId === where.releasedTaskId,
      );
      if (existing) {
        return existing;
      }
      const occurrence = {
        id: `occurrence-${state.occurrences.length + 1}`,
        seriesTaskId: create.seriesTaskId,
        releasedTaskId: create.releasedTaskId,
        legacyLinkId: create.legacyLinkId,
      };
      state.occurrences.push(occurrence);
      const link = state.links.find(
        (candidate) => candidate.id === create.legacyLinkId,
      );
      if (link) {
        link.toTask.releasedScheduleOccurrence = occurrence;
      }
      return occurrence;
    });
  });

  it("captures a high-water mark, replays it, and creates legacy occurrences idempotently", async () => {
    const { taskScheduleReconciliationService } = await import(
      "@/services/task-schedule-reconciliation.service"
    );

    const result =
      await taskScheduleReconciliationService.reconcileScheduleHistory({
        shouldContinue: () => true,
      });

    expect(result).toEqual({
      scanned: 2,
      created: 1,
      finalMissing: 0,
      initialComplete: true,
      replayComplete: true,
      finalComplete: true,
    });
    expect(
      state.syncMetadata.get("task-schedule-reconciliation:high-water"),
    ).toMatchObject({
      lastSyncedAt: new Date("2026-08-20T09:00:00.000Z"),
      cursorId: "link-1",
    });
    expect(
      state.syncMetadata.get("task-schedule-reconciliation:final-complete"),
    ).toMatchObject({ cursorId: null });
    expect(syncMetadataDeleteManyMock.mock.invocationCallOrder[0]).toBeLessThan(
      syncMetadataUpsertMock.mock.invocationCallOrder[0],
    );
    expect(taskLinkFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: "SCHEDULE" }),
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    );
    expect(occurrenceUpsertMock).toHaveBeenCalledWith({
      where: { releasedTaskId: "release-link-1" },
      create: expect.objectContaining({
        seriesTaskId: "series-link-1",
        releasedTaskId: "release-link-1",
        legacyLinkId: "link-1",
        effectiveScheduledAt: new Date("2026-08-20T09:00:00.000Z"),
        sourceWorkspaceId: "workspace-1",
        sourceProjectId: "project-1",
        sourceType: "PROJECT",
        sourceAccuracy: "INFERRED",
        timeAccuracy: "APPROXIMATE",
      }),
      update: {},
      select: expect.any(Object),
    });
  });

  it("keeps the final missing-ledger pass active for late old-writer releases", async () => {
    const { taskScheduleReconciliationService } = await import(
      "@/services/task-schedule-reconciliation.service"
    );

    await taskScheduleReconciliationService.reconcileScheduleHistory({
      shouldContinue: () => true,
    });
    state.links.push(createLink("link-late", "2026-08-19T09:00:00.000Z"));

    const result =
      await taskScheduleReconciliationService.reconcileScheduleHistory({
        shouldContinue: () => true,
      });

    expect(result).toMatchObject({
      scanned: 1,
      created: 1,
      finalMissing: 1,
      initialComplete: true,
      replayComplete: true,
      finalComplete: true,
    });
    expect(state.occurrences).toHaveLength(2);
  });

  it("uses the legacy unknown source when current task placement conflicts", async () => {
    const { taskScheduleReconciliationService } = await import(
      "@/services/task-schedule-reconciliation.service"
    );
    const [link] = state.links;
    link.fromTask.workspaceId = "workspace-2";

    await taskScheduleReconciliationService.reconcileScheduleHistory({
      shouldContinue: () => true,
    });

    expect(occurrenceUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          sourceWorkspaceId: "workspace-1",
          sourceProjectId: null,
          sourceType: "LEGACY_UNKNOWN",
          sourceAccuracy: "UNKNOWN",
        }),
      }),
    );
  });
});
