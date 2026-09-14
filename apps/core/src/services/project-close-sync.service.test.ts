import {
  Prisma,
  ProjectCloseOperationState,
  TaskStatus,
} from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cloneRecurringTaskScheduleOccurrenceMock,
  lockCalendarScopeMock,
  lockTaskRowsMock,
  prismaMock,
  projectCloseOperationFindFirstMock,
  projectCloseOperationFindManyMock,
  projectCloseOperationUpdateManyMock,
  projectEventCreateMock,
  projectUpdateMock,
  retireTaskScheduleFutureOccurrencesMock,
  taskFindFirstMock,
  taskEventCreateMock,
  taskScheduleOccurrenceDeleteMock,
  taskScheduleOccurrenceDeleteManyMock,
  taskScheduleOccurrenceFindFirstMock,
  taskScheduleOccurrenceFindManyMock,
  taskScheduleOccurrenceUpdateManyMock,
  taskUpdateMock,
  transactionMock,
  txProjectCloseOperationFindFirstMock,
  txProjectCloseOperationUpdateManyMock,
} = vi.hoisted(() => ({
  cloneRecurringTaskScheduleOccurrenceMock: vi.fn(),
  lockCalendarScopeMock: vi.fn(),
  lockTaskRowsMock: vi.fn(),
  prismaMock: {
    $transaction: vi.fn(),
    projectCloseOperation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  projectCloseOperationFindFirstMock: vi.fn(),
  projectCloseOperationFindManyMock: vi.fn(),
  projectCloseOperationUpdateManyMock: vi.fn(),
  projectEventCreateMock: vi.fn(),
  projectUpdateMock: vi.fn(),
  retireTaskScheduleFutureOccurrencesMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskEventCreateMock: vi.fn(),
  taskScheduleOccurrenceDeleteMock: vi.fn(),
  taskScheduleOccurrenceDeleteManyMock: vi.fn(),
  taskScheduleOccurrenceFindFirstMock: vi.fn(),
  taskScheduleOccurrenceFindManyMock: vi.fn(),
  taskScheduleOccurrenceUpdateManyMock: vi.fn(),
  taskUpdateMock: vi.fn(),
  transactionMock: vi.fn(),
  txProjectCloseOperationFindFirstMock: vi.fn(),
  txProjectCloseOperationUpdateManyMock: vi.fn(),
}));

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
  lockTaskRows: lockTaskRowsMock,
}));
vi.mock("@/helpers/task-schedule-occurrence-index", () => ({
  retireTaskScheduleFutureOccurrences: retireTaskScheduleFutureOccurrencesMock,
}));
vi.mock("@/helpers/task-schedule-release", () => ({
  cloneRecurringTaskScheduleOccurrence:
    cloneRecurringTaskScheduleOccurrenceMock,
}));
vi.mock("@/lib/db/prisma", () => ({ default: prismaMock }));

import { projectCloseSyncService } from "@/services/project-close-sync.service";

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const PROJECT_ID = "22222222-2222-7222-8222-222222222222";
const CLOSE_ID = "33333333-3333-7333-8333-333333333333";
const CUTOFF = new Date("2026-09-14T10:00:00.000Z");

const operation = {
  id: CLOSE_ID,
  projectId: PROJECT_ID,
  cutoffAt: CUTOFF,
  seriesCursor: null,
  project: { workspaceId: WORKSPACE_ID },
};

const recurringTask = {
  id: "task_123",
  ownerId: "user_123",
  organizationId: null,
  workspaceId: WORKSPACE_ID,
  projectId: PROJECT_ID,
  assigneeId: "coworker_123",
  name: "Weekly report",
  description: null,
  status: TaskStatus.QUEUED,
  metadata: JSON.stringify({
    version: 2,
    epochId: "44444444-4444-7444-8444-444444444444",
    mode: "recurring",
    createdAt: "2026-09-01T08:00:00.000Z",
    ruleEffectiveFrom: "2026-09-01T08:00:00.000Z",
    timezone: "UTC",
    expr: "0 9 * * *",
    endsMode: "never",
    anchorAt: "2026-09-01T09:00:00.000Z",
    epochReleaseCount: 0,
  }),
  nextRunAt: new Date("2026-09-14T09:00:00.000Z"),
  scheduleQuarantine: null,
};

function txClient() {
  return {
    project: { update: projectUpdateMock },
    projectCloseOperation: {
      findFirst: txProjectCloseOperationFindFirstMock,
      updateMany: txProjectCloseOperationUpdateManyMock,
    },
    projectEvent: { create: projectEventCreateMock },
    task: { findFirst: taskFindFirstMock, update: taskUpdateMock },
    taskEvent: { create: taskEventCreateMock },
    taskScheduleOccurrence: {
      delete: taskScheduleOccurrenceDeleteMock,
      deleteMany: taskScheduleOccurrenceDeleteManyMock,
      findFirst: taskScheduleOccurrenceFindFirstMock,
      findMany: taskScheduleOccurrenceFindManyMock,
      update: vi.fn(),
      updateMany: taskScheduleOccurrenceUpdateManyMock,
    },
  };
}

function options() {
  return {
    abortSignal: new AbortController().signal,
    deadlineMs: Date.now() + 60_000,
    shouldContinue: () => true,
  };
}

describe("project close sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction = transactionMock;
    prismaMock.projectCloseOperation.findFirst =
      projectCloseOperationFindFirstMock;
    prismaMock.projectCloseOperation.findMany =
      projectCloseOperationFindManyMock;
    prismaMock.projectCloseOperation.updateMany =
      projectCloseOperationUpdateManyMock;
    transactionMock.mockImplementation(async (callback) =>
      callback(txClient()),
    );
    projectCloseOperationFindManyMock.mockResolvedValue([{ id: CLOSE_ID }]);
    projectCloseOperationUpdateManyMock.mockResolvedValue({ count: 1 });
    txProjectCloseOperationUpdateManyMock.mockResolvedValue({ count: 1 });
    txProjectCloseOperationFindFirstMock.mockResolvedValue(operation);
    lockCalendarScopeMock.mockResolvedValue(true);
    lockTaskRowsMock.mockResolvedValue(true);
    retireTaskScheduleFutureOccurrencesMock.mockResolvedValue({
      canceledCount: 1,
    });
    cloneRecurringTaskScheduleOccurrenceMock.mockResolvedValue("run_123");
    taskScheduleOccurrenceFindFirstMock.mockResolvedValue(null);
  });

  it("releases owed rows by effective time, retires equality/later, and closes", async () => {
    taskFindFirstMock
      .mockResolvedValueOnce({ id: recurringTask.id })
      .mockResolvedValueOnce(recurringTask)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([
      {
        id: "occ_owed",
        epochId: "66666666-6666-7666-8666-666666666666",
        scheduleVersion: 2,
        originalScheduledAt: new Date("2026-09-20T09:00:00.000Z"),
        effectiveScheduledAt: new Date("2026-09-14T09:59:59.999Z"),
        ruleSnapshot: {
          version: 2,
          epochId: "66666666-6666-7666-8666-666666666666",
          mode: "recurring",
          createdAt: "2026-08-01T08:00:00.000Z",
          ruleEffectiveFrom: "2026-08-01T08:00:00.000Z",
          timezone: "UTC",
          expr: "0 8 * * *",
          endsMode: "never",
          anchorAt: "2026-08-01T08:00:00.000Z",
          epochReleaseCount: 0,
        },
      },
    ]);

    const result = await projectCloseSyncService.syncProjectCloses(options());

    expect(result).toMatchObject({
      claimed: 1,
      processedSeries: 1,
      closed: 1,
      failed: 0,
    });
    expect(retireTaskScheduleFutureOccurrencesMock).toHaveBeenCalledWith(
      expect.any(Object),
      recurringTask.id,
      CUTOFF,
      { sourceProjectId: PROJECT_ID },
    );
    expect(taskScheduleOccurrenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          effectiveScheduledAt: { lt: CUTOFF },
          sourceProjectId: PROJECT_ID,
        }),
        take: 25,
      }),
    );
    expect(cloneRecurringTaskScheduleOccurrenceMock).toHaveBeenCalledWith(
      expect.any(Object),
      recurringTask,
      expect.objectContaining({
        mode: "recurring",
        epochId: "66666666-6666-7666-8666-666666666666",
      }),
      {
        originalScheduledAt: new Date("2026-09-20T09:00:00.000Z"),
        effectiveScheduledAt: new Date("2026-09-14T09:59:59.999Z"),
      },
      true,
    );
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: recurringTask.id },
      data: {
        status: TaskStatus.DRAFT,
        metadata: null,
        nextRunAt: null,
        scheduleRevision: { increment: 1 },
      },
    });
    expect(projectUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PROJECT_ID },
        data: expect.objectContaining({
          closedAt: expect.any(Date),
          projectRevision: { increment: 1 },
        }),
      }),
    );
  });

  it("keeps a series cursor fixed while a bounded owed batch remains", async () => {
    taskFindFirstMock
      .mockResolvedValueOnce({ id: recurringTask.id })
      .mockResolvedValueOnce(recurringTask);
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([]);
    taskScheduleOccurrenceFindFirstMock.mockResolvedValue({
      effectiveScheduledAt: new Date("2026-09-14T09:30:00.000Z"),
    });

    const result = await projectCloseSyncService.syncProjectCloses({
      ...options(),
      shouldContinue: () => taskFindFirstMock.mock.calls.length < 2,
    });

    expect(result.processedSeries).toBe(1);
    expect(txProjectCloseOperationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: CLOSE_ID,
        state: ProjectCloseOperationState.CLOSING,
        leaseToken: expect.any(String),
      },
      data: {
        attempts: 0,
        failureSummary: Prisma.DbNull,
        leasedAt: expect.any(Date),
      },
    });
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: recurringTask.id },
      data: {
        nextRunAt: new Date("2026-09-14T09:30:00.000Z"),
        scheduleRevision: { increment: 1 },
      },
    });
  });

  it("promotes an owed one-time schedule and records its task status", async () => {
    const oneTimeTask = {
      ...recurringTask,
      metadata: JSON.stringify({
        version: 2,
        epochId: "55555555-5555-7555-8555-555555555555",
        mode: "once",
        createdAt: "2026-09-01T08:00:00.000Z",
        ruleEffectiveFrom: "2026-09-01T08:00:00.000Z",
        timezone: "UTC",
        sourceRunAt: "2026-09-14T09:00:00.000Z",
        effectiveRunAt: "2026-09-14T09:00:00.000Z",
      }),
    };
    taskFindFirstMock
      .mockResolvedValueOnce({ id: oneTimeTask.id })
      .mockResolvedValueOnce(oneTimeTask)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    taskScheduleOccurrenceFindFirstMock
      .mockResolvedValueOnce({ id: "occ_owed", scheduleVersion: 2 })
      .mockResolvedValueOnce(null);

    const result = await projectCloseSyncService.syncProjectCloses(options());

    expect(result.closed).toBe(1);
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: oneTimeTask.id },
      data: {
        status: TaskStatus.READY,
        metadata: null,
        nextRunAt: null,
        scheduleRevision: { increment: 1 },
      },
    });
    expect(taskEventCreateMock).toHaveBeenCalledWith({
      data: {
        taskId: oneTimeTask.id,
        status: TaskStatus.READY,
        channel: "SOKOSUMI",
        userId: oneTimeTask.ownerId,
      },
    });
    expect(taskScheduleOccurrenceDeleteManyMock).toHaveBeenCalledWith({
      where: {
        seriesTaskId: oneTimeTask.id,
        sourceProjectId: PROJECT_ID,
        state: "PLANNED",
      },
    });
  });

  it("returns a one-time schedule without owed work to Draft", async () => {
    const oneTimeTask = {
      ...recurringTask,
      metadata: JSON.stringify({
        version: 2,
        epochId: "55555555-5555-7555-8555-555555555555",
        mode: "once",
        createdAt: "2026-09-01T08:00:00.000Z",
        ruleEffectiveFrom: "2026-09-01T08:00:00.000Z",
        timezone: "UTC",
        sourceRunAt: CUTOFF.toISOString(),
        effectiveRunAt: CUTOFF.toISOString(),
      }),
      nextRunAt: CUTOFF,
    };
    taskFindFirstMock
      .mockResolvedValueOnce({ id: oneTimeTask.id })
      .mockResolvedValueOnce(oneTimeTask)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    taskScheduleOccurrenceFindFirstMock.mockResolvedValue(null);

    const result = await projectCloseSyncService.syncProjectCloses(options());

    expect(result.closed).toBe(1);
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: oneTimeTask.id },
      data: {
        status: TaskStatus.DRAFT,
        metadata: null,
        nextRunAt: null,
        scheduleRevision: { increment: 1 },
      },
    });
    expect(taskEventCreateMock).not.toHaveBeenCalled();
  });

  it("clears a human recurring Calendar rule without releasing clones", async () => {
    const humanTask = { ...recurringTask, status: TaskStatus.READY };
    taskFindFirstMock
      .mockResolvedValueOnce({ id: humanTask.id })
      .mockResolvedValueOnce(humanTask)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([]);
    taskScheduleOccurrenceFindFirstMock.mockResolvedValue(null);

    const result = await projectCloseSyncService.syncProjectCloses(options());

    expect(result.closed).toBe(1);
    expect(cloneRecurringTaskScheduleOccurrenceMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: humanTask.id },
      data: {
        status: TaskStatus.DRAFT,
        metadata: null,
        nextRunAt: null,
        scheduleRevision: { increment: 1 },
      },
    });
  });

  it("does not release an elapsed human one-time reminder as agent work", async () => {
    const humanTask = {
      ...recurringTask,
      status: TaskStatus.READY,
      metadata: JSON.stringify({
        version: 2,
        epochId: "55555555-5555-7555-8555-555555555555",
        mode: "once",
        createdAt: "2026-09-01T08:00:00.000Z",
        ruleEffectiveFrom: "2026-09-01T08:00:00.000Z",
        timezone: "UTC",
        sourceRunAt: "2026-09-14T09:00:00.000Z",
        effectiveRunAt: "2026-09-14T09:00:00.000Z",
      }),
    };
    taskFindFirstMock
      .mockResolvedValueOnce({ id: humanTask.id })
      .mockResolvedValueOnce(humanTask)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    taskScheduleOccurrenceFindFirstMock
      .mockResolvedValueOnce({ id: "human_occurrence", scheduleVersion: 2 })
      .mockResolvedValueOnce(null);

    const result = await projectCloseSyncService.syncProjectCloses(options());

    expect(result.closed).toBe(1);
    expect(taskEventCreateMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: humanTask.id },
      data: {
        status: TaskStatus.DRAFT,
        metadata: null,
        nextRunAt: null,
        scheduleRevision: { increment: 1 },
      },
    });
  });

  it.each([
    ["recurring", recurringTask.metadata],
    [
      "one-time",
      JSON.stringify({
        version: 2,
        epochId: "55555555-5555-7555-8555-555555555555",
        mode: "once",
        createdAt: "2026-09-01T08:00:00.000Z",
        ruleEffectiveFrom: "2026-09-01T08:00:00.000Z",
        timezone: "UTC",
        sourceRunAt: CUTOFF.toISOString(),
        effectiveRunAt: CUTOFF.toISOString(),
      }),
    ],
  ])(
    "preserves a terminal Task status for a stale %s rule",
    async (_name, metadata) => {
      const terminalTask = {
        ...recurringTask,
        status: TaskStatus.COMPLETED,
        metadata,
      };
      taskFindFirstMock
        .mockResolvedValueOnce({ id: terminalTask.id })
        .mockResolvedValueOnce(terminalTask)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      taskScheduleOccurrenceFindFirstMock.mockResolvedValue(null);

      const result = await projectCloseSyncService.syncProjectCloses(options());

      expect(result.closed).toBe(1);
      expect(taskUpdateMock).toHaveBeenCalledWith({
        where: { id: terminalTask.id },
        data: {
          metadata: null,
          nextRunAt: null,
          scheduleRevision: { increment: 1 },
        },
      });
    },
  );

  it("backs off transient failures and exposes the failed series after exhaustion", async () => {
    taskFindFirstMock
      .mockResolvedValueOnce({ id: recurringTask.id })
      .mockResolvedValueOnce({ ...recurringTask, metadata: "invalid" });
    projectCloseOperationFindFirstMock.mockResolvedValue({
      attempts: 2,
      projectId: PROJECT_ID,
    });

    const result = await projectCloseSyncService.syncProjectCloses(options());

    expect(result.failed).toBe(1);
    expect(txProjectCloseOperationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: CLOSE_ID,
        state: ProjectCloseOperationState.CLOSING,
        leaseToken: expect.any(String),
      },
      data: expect.objectContaining({
        state: ProjectCloseOperationState.CLOSE_FAILED,
        attempts: 3,
        failureSummary: {
          seriesTaskId: recurringTask.id,
          message: "Scheduled work could not be closed",
        },
      }),
    });
  });

  it("refuses to finalize while project-sourced owed work remains", async () => {
    taskFindFirstMock.mockResolvedValueOnce(null);
    taskScheduleOccurrenceFindFirstMock.mockResolvedValue({
      seriesTaskId: "task_moved_elsewhere",
    });
    projectCloseOperationFindFirstMock.mockResolvedValue({
      attempts: 2,
      projectId: PROJECT_ID,
    });

    const result = await projectCloseSyncService.syncProjectCloses(options());

    expect(result).toMatchObject({ closed: 0, failed: 1 });
    expect(taskScheduleOccurrenceFindFirstMock).toHaveBeenCalledWith({
      where: {
        sourceProjectId: PROJECT_ID,
        state: "PLANNED",
        effectiveScheduledAt: { lt: CUTOFF },
        seriesTask: { status: TaskStatus.QUEUED },
      },
      orderBy: [{ effectiveScheduledAt: "asc" }, { id: "asc" }],
      select: { seriesTaskId: true },
    });
    expect(projectUpdateMock).not.toHaveBeenCalled();
    expect(txProjectCloseOperationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureSummary: {
            seriesTaskId: "task_moved_elsewhere",
            message: "Scheduled work could not be closed",
          },
        }),
      }),
    );
  });

  it("releases claims it cannot start before the deadline", async () => {
    projectCloseOperationFindManyMock.mockResolvedValue([
      { id: CLOSE_ID },
      { id: "77777777-7777-7777-8777-777777777777" },
    ]);

    const result = await projectCloseSyncService.syncProjectCloses({
      ...options(),
      shouldContinue: () => false,
    });

    expect(result.claimed).toBe(2);
    const releaseCalls = projectCloseOperationUpdateManyMock.mock.calls.filter(
      ([call]) => call.data.leaseToken === null,
    );
    expect(releaseCalls).toHaveLength(2);
    expect(releaseCalls[0]?.[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({ leaseToken: expect.any(String) }),
        data: expect.objectContaining({ leaseToken: null, leasedAt: null }),
      }),
    );
  });

  it("does not bypass backoff when a candidate changes before claim", async () => {
    projectCloseOperationUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const result = await projectCloseSyncService.syncProjectCloses(options());

    expect(result.claimed).toBe(0);
    expect(projectCloseOperationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: CLOSE_ID,
        state: ProjectCloseOperationState.CLOSING,
        AND: [
          {
            OR: [
              { nextAttemptAt: null },
              { nextAttemptAt: { lte: expect.any(Date) } },
            ],
          },
          {
            OR: [
              { leaseToken: null },
              { leasedAt: null },
              { leasedAt: { lte: expect.any(Date) } },
            ],
          },
        ],
      },
      data: { leaseToken: expect.any(String), leasedAt: expect.any(Date) },
    });
  });
});
