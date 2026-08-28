import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTransaction = vi.fn();
const mockFindMany = vi.fn();
const mockFindFirst = vi.fn();
const mockTaskCreate = vi.fn();
const mockTaskUpdate = vi.fn();
const mockTaskUpdateMany = vi.fn();
const mockTaskLinkCreate = vi.fn();
const mockTaskEventCreate = vi.fn();
const mockTaskScheduleOccurrenceCreate = vi.fn();
const mockTaskScheduleOccurrenceDeleteMany = vi.fn();
const mockTaskScheduleQuarantineUpsert = vi.fn();
const replaceTaskSchedulePlannedOccurrencesMock = vi.fn();
const removeTaskSchedulePlannedOccurrencesMock = vi.fn();
const publishTaskEventDataMock = vi.fn();
const lockCalendarScopeMock = vi.fn();
const lockTaskRowsMock = vi.fn();
const isNmkrEmailMock = vi.fn();

vi.mock("@sokosumi/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/utils")>()),
  isNmkrEmail: isNmkrEmailMock,
}));
const TaskScheduleOccurrenceLimitErrorMock = vi.hoisted(
  () => class TaskScheduleOccurrenceLimitError extends Error {},
);

vi.mock("@/lib/ably/publish", () => ({
  publishTaskEventData: publishTaskEventDataMock,
}));

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
  lockTaskRows: lockTaskRowsMock,
}));

vi.mock("@/helpers/task-schedule-occurrence-index", () => ({
  TaskScheduleOccurrenceLimitError: TaskScheduleOccurrenceLimitErrorMock,
  replaceTaskSchedulePlannedOccurrences:
    replaceTaskSchedulePlannedOccurrencesMock,
  removeTaskSchedulePlannedOccurrences:
    removeTaskSchedulePlannedOccurrencesMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: mockTransaction,
    task: {
      findMany: mockFindMany,
      findFirst: mockFindFirst,
      create: mockTaskCreate,
      update: mockTaskUpdate,
      updateMany: mockTaskUpdateMany,
    },
    taskLink: {
      create: mockTaskLinkCreate,
    },
    taskEvent: {
      create: mockTaskEventCreate,
    },
    taskScheduleOccurrence: {
      create: mockTaskScheduleOccurrenceCreate,
      deleteMany: mockTaskScheduleOccurrenceDeleteMany,
    },
    taskScheduleQuarantine: {
      upsert: mockTaskScheduleQuarantineUpsert,
    },
  },
}));

describe("taskSchedulesSyncService", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockTransaction.mockReset();
    mockFindMany.mockReset();
    mockFindFirst.mockReset();
    mockTaskCreate.mockReset();
    mockTaskUpdate.mockReset();
    mockTaskUpdateMany.mockReset();
    mockTaskLinkCreate.mockReset();
    mockTaskEventCreate.mockReset();
    mockTaskScheduleOccurrenceCreate.mockReset();
    mockTaskScheduleOccurrenceDeleteMany.mockReset();
    mockTaskScheduleQuarantineUpsert.mockReset();
    lockCalendarScopeMock.mockReset();
    lockTaskRowsMock.mockReset();
    vi.resetModules();
    publishTaskEventDataMock.mockResolvedValue(undefined);
    mockTaskLinkCreate.mockResolvedValue({ id: "schedule-link-1" });
    mockTaskScheduleOccurrenceCreate.mockResolvedValue({ id: "occurrence-1" });
    mockTaskScheduleOccurrenceDeleteMany.mockResolvedValue({ count: 1 });
    mockTaskScheduleQuarantineUpsert.mockResolvedValue({ id: "quarantine-1" });
    lockCalendarScopeMock.mockResolvedValue(true);
    lockTaskRowsMock.mockResolvedValue(true);
    isNmkrEmailMock.mockReturnValue(true);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"));
  });

  it("creates multiple clones when recurring runs were missed", async () => {
    const { taskSchedulesSyncService } = await import(
      "@/services/task-schedules-sync"
    );

    let metadata = JSON.stringify({
      version: 1,
      mode: "recurring",
      scheduledAt: "2026-06-01T09:00:00.000Z",
      lastRunAt: "2026-06-07T09:00:00.000Z",
      expr: "0 9 * * *",
      timezone: "UTC",
      endsMode: "never",
    });

    mockFindMany
      .mockResolvedValueOnce([{ id: "template-1" }])
      .mockResolvedValueOnce([]);

    mockTransaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: mockFindFirst,
          create: mockTaskCreate,
          update: mockTaskUpdate,
          updateMany: mockTaskUpdateMany,
        },
        taskLink: {
          create: mockTaskLinkCreate,
        },
        taskEvent: {
          create: mockTaskEventCreate,
        },
        taskScheduleOccurrence: {
          create: mockTaskScheduleOccurrenceCreate,
          deleteMany: mockTaskScheduleOccurrenceDeleteMany,
        },
        taskScheduleQuarantine: {
          upsert: mockTaskScheduleQuarantineUpsert,
        },
      }),
    );

    mockFindFirst.mockResolvedValue({
      id: "template-1",
      ownerId: "user-1",
      organizationId: null,
      workspaceId: "workspace-1",
      projectId: null,
      assigneeId: null,
      name: "Template",
      description: "Run me",
      metadata,
      nextRunAt: new Date("2026-06-08T09:00:00.000Z"),
    });

    mockTaskCreate.mockResolvedValue({ id: "clone-1" });
    mockTaskUpdateMany.mockResolvedValue({ count: 1 });
    mockTaskUpdate.mockImplementation(async ({ data }) => {
      if (typeof data.metadata === "string") {
        metadata = data.metadata;
      }
      return { id: "template-1" };
    });

    const result = await taskSchedulesSyncService.syncDueSchedules({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(result.cloned).toBe(1);
    expect(mockFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ scheduleQuarantine: null }),
      }),
    );
    expect(mockFindFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ scheduleQuarantine: null }),
      }),
    );
    expect(mockFindFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ scheduleQuarantine: null }),
      }),
    );
    expect(mockTaskCreate).toHaveBeenCalledTimes(3);
    expect(mockTaskScheduleOccurrenceCreate).toHaveBeenCalledTimes(3);
    expect(mockTaskScheduleOccurrenceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        seriesTaskId: "template-1",
        releasedTaskId: "clone-1",
        legacyLinkId: "schedule-link-1",
        state: "RELEASED",
        sourceWorkspaceId: "workspace-1",
        sourceType: "WORKSPACE",
        sourceProjectId: null,
        sourceAccuracy: "INFERRED",
        timeAccuracy: "APPROXIMATE",
      }),
    });
    expect(publishTaskEventDataMock).toHaveBeenCalledTimes(3);
    expect(publishTaskEventDataMock).toHaveBeenCalledWith({
      userId: "user-1",
      taskId: "clone-1",
      eventType: "task_event",
    });
    expect(mockTaskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "template-1",
          status: "QUEUED",
          archivedAt: null,
          nextRunAt: new Date("2026-06-08T09:00:00.000Z"),
        },
        data: expect.objectContaining({
          nextRunAt: new Date("2026-06-11T09:00:00.000Z"),
        }),
      }),
    );
  });

  it("still clones a due organization schedule after the creator is unseated", async () => {
    const { taskSchedulesSyncService } = await import(
      "@/services/task-schedules-sync"
    );

    mockFindMany
      .mockResolvedValueOnce([{ id: "template-1" }])
      .mockResolvedValueOnce([]);
    mockTransaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: mockFindFirst,
          create: mockTaskCreate,
          update: mockTaskUpdate,
          updateMany: mockTaskUpdateMany,
        },
        taskLink: { create: mockTaskLinkCreate },
        taskEvent: { create: mockTaskEventCreate },
        taskScheduleOccurrence: { create: mockTaskScheduleOccurrenceCreate },
        taskScheduleQuarantine: { upsert: mockTaskScheduleQuarantineUpsert },
      }),
    );
    mockFindFirst.mockResolvedValue({
      id: "template-1",
      ownerId: "user-1",
      owner: { email: "user@nmkr.io" },
      organizationId: "org-1",
      workspaceId: "workspace-1",
      projectId: null,
      assigneeId: null,
      name: "Template",
      description: "Run me",
      metadata: JSON.stringify({
        version: 1,
        mode: "recurring",
        scheduledAt: "2026-06-01T09:00:00.000Z",
        lastRunAt: "2026-06-09T09:00:00.000Z",
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "never",
      }),
      nextRunAt: new Date("2026-06-10T09:00:00.000Z"),
    });
    mockTaskCreate.mockResolvedValue({ id: "clone-1" });
    mockTaskUpdateMany.mockResolvedValue({ count: 1 });
    mockTaskUpdate.mockResolvedValue({ id: "template-1" });

    const result = await taskSchedulesSyncService.syncDueSchedules({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(result.cloned).toBe(1);
    expect(mockTaskCreate).toHaveBeenCalled();
  });

  it("does not create calendar history for a non-NMKR schedule", async () => {
    isNmkrEmailMock.mockReturnValue(false);
    const { taskSchedulesSyncService } = await import(
      "@/services/task-schedules-sync"
    );

    mockFindMany
      .mockResolvedValueOnce([{ id: "template-1" }])
      .mockResolvedValueOnce([]);
    mockTransaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: mockFindFirst,
          create: mockTaskCreate,
          update: mockTaskUpdate,
          updateMany: mockTaskUpdateMany,
        },
        taskLink: { create: mockTaskLinkCreate },
        taskEvent: { create: mockTaskEventCreate },
        taskScheduleOccurrence: { create: mockTaskScheduleOccurrenceCreate },
        taskScheduleQuarantine: { upsert: mockTaskScheduleQuarantineUpsert },
      }),
    );
    mockFindFirst.mockResolvedValue({
      id: "template-1",
      ownerId: "user-1",
      owner: { email: "external@example.com" },
      organizationId: null,
      workspaceId: "workspace-1",
      projectId: null,
      assigneeId: null,
      name: "Template",
      description: "Run me",
      metadata: JSON.stringify({
        version: 1,
        mode: "recurring",
        scheduledAt: "2026-06-01T09:00:00.000Z",
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "never",
      }),
      nextRunAt: new Date("2026-06-10T09:00:00.000Z"),
    });
    mockTaskCreate.mockResolvedValue({ id: "clone-1" });
    mockTaskUpdateMany.mockResolvedValue({ count: 1 });

    await taskSchedulesSyncService.syncDueSchedules({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(mockTaskScheduleOccurrenceCreate).not.toHaveBeenCalled();
    expect(mockTaskScheduleQuarantineUpsert).not.toHaveBeenCalled();
  });

  it("processes version 2 recurring metadata without downgrading it", async () => {
    const { taskSchedulesSyncService } = await import(
      "@/services/task-schedules-sync"
    );
    const metadata = JSON.stringify({
      version: 2,
      epochId: "123e4567-e89b-42d3-a456-426614174001",
      mode: "recurring",
      createdAt: "2026-06-01T08:00:00.000Z",
      ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
      timezone: "UTC",
      expr: "0 9 * * *",
      endsMode: "never",
      epochReleaseCount: 0,
      anchorAt: "2026-06-01T09:00:00.000Z",
    });

    mockFindMany
      .mockResolvedValueOnce([{ id: "template-v2" }])
      .mockResolvedValueOnce([]);
    mockTransaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: mockFindFirst,
          create: mockTaskCreate,
          update: mockTaskUpdate,
          updateMany: mockTaskUpdateMany,
        },
        taskLink: { create: mockTaskLinkCreate },
        taskEvent: { create: mockTaskEventCreate },
        taskScheduleOccurrence: {
          create: mockTaskScheduleOccurrenceCreate,
          deleteMany: mockTaskScheduleOccurrenceDeleteMany,
        },
        taskScheduleQuarantine: {
          upsert: mockTaskScheduleQuarantineUpsert,
        },
      }),
    );
    mockFindFirst.mockResolvedValue({
      id: "template-v2",
      ownerId: "user-1",
      organizationId: null,
      workspaceId: "workspace-1",
      projectId: null,
      assigneeId: null,
      name: "Template",
      description: "Run me",
      metadata,
      nextRunAt: new Date("2026-06-10T09:00:00.000Z"),
    });
    mockTaskCreate.mockResolvedValue({ id: "clone-v2" });
    mockTaskUpdateMany.mockResolvedValue({ count: 1 });
    replaceTaskSchedulePlannedOccurrencesMock.mockRejectedValue(
      new TaskScheduleOccurrenceLimitErrorMock(),
    );

    const result = await taskSchedulesSyncService.syncDueSchedules({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(result.cloned).toBe(1);
    const update = mockTaskUpdateMany.mock.calls.at(-1)?.[0];
    expect(JSON.parse(update.data.metadata)).toMatchObject({
      version: 2,
      epochReleaseCount: 1,
      lastProcessedSourceAt: "2026-06-10T09:00:00.000Z",
    });
    expect(update.data.nextRunAt).toEqual(new Date("2026-06-11T09:00:00.000Z"));
    expect(mockTaskScheduleOccurrenceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        seriesTaskId: "template-v2",
        releasedTaskId: "clone-v2",
        epochId: "123e4567-e89b-42d3-a456-426614174001",
        originalScheduledAt: new Date("2026-06-10T09:00:00.000Z"),
        effectiveScheduledAt: new Date("2026-06-10T09:00:00.000Z"),
        state: "RELEASED",
        sourceAccuracy: "EXACT",
        timeAccuracy: "EXACT",
      }),
    });
    expect(mockTaskScheduleOccurrenceDeleteMany).toHaveBeenCalledWith({
      where: {
        seriesTaskId: "template-v2",
        epochId: "123e4567-e89b-42d3-a456-426614174001",
        originalScheduledAt: new Date("2026-06-10T09:00:00.000Z"),
        state: "PLANNED",
      },
    });
    expect(replaceTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        id: "template-v2",
        nextRunAt: new Date("2026-06-11T09:00:00.000Z"),
      }),
      new Date("2026-06-10T12:00:00.000Z"),
    );
    expect(removeTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledWith(
      expect.any(Object),
      "template-v2",
    );
  });

  it("processes version 2 recurring metadata without downgrading it", async () => {
    const { taskSchedulesSyncService } = await import(
      "@/services/task-schedules-sync"
    );
    const metadata = JSON.stringify({
      version: 2,
      epochId: "123e4567-e89b-42d3-a456-426614174001",
      mode: "recurring",
      createdAt: "2026-06-01T08:00:00.000Z",
      ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
      timezone: "UTC",
      expr: "0 9 * * *",
      endsMode: "never",
      epochReleaseCount: 0,
      anchorAt: "2026-06-01T09:00:00.000Z",
    });

    mockFindMany
      .mockResolvedValueOnce([{ id: "template-v2" }])
      .mockResolvedValueOnce([]);
    mockTransaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: mockFindFirst,
          create: mockTaskCreate,
          update: mockTaskUpdate,
          updateMany: mockTaskUpdateMany,
        },
        taskLink: { create: mockTaskLinkCreate },
        taskEvent: { create: mockTaskEventCreate },
        taskScheduleOccurrence: {
          create: mockTaskScheduleOccurrenceCreate,
          deleteMany: mockTaskScheduleOccurrenceDeleteMany,
        },
        taskScheduleQuarantine: {
          upsert: mockTaskScheduleQuarantineUpsert,
        },
      }),
    );
    mockFindFirst.mockResolvedValue({
      id: "template-v2",
      ownerId: "user-1",
      organizationId: null,
      workspaceId: "workspace-1",
      projectId: null,
      assigneeId: null,
      name: "Template",
      description: "Run me",
      metadata,
      nextRunAt: new Date("2026-06-10T09:00:00.000Z"),
    });
    mockTaskCreate.mockResolvedValue({ id: "clone-v2" });
    mockTaskUpdateMany.mockResolvedValue({ count: 1 });

    const result = await taskSchedulesSyncService.syncDueSchedules({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(result.cloned).toBe(1);
    const update = mockTaskUpdateMany.mock.calls.at(-1)?.[0];
    expect(JSON.parse(update.data.metadata)).toMatchObject({
      version: 2,
      epochReleaseCount: 1,
      lastProcessedSourceAt: "2026-06-10T09:00:00.000Z",
    });
    expect(update.data.nextRunAt).toEqual(new Date("2026-06-11T09:00:00.000Z"));
    expect(mockTaskScheduleOccurrenceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        seriesTaskId: "template-v2",
        releasedTaskId: "clone-v2",
        epochId: "123e4567-e89b-42d3-a456-426614174001",
        originalScheduledAt: new Date("2026-06-10T09:00:00.000Z"),
        effectiveScheduledAt: new Date("2026-06-10T09:00:00.000Z"),
        state: "RELEASED",
        sourceAccuracy: "EXACT",
        timeAccuracy: "EXACT",
      }),
    });
  });

  it("stops recurring catch-up when the sync deadline is reached", async () => {
    const { taskSchedulesSyncService } = await import(
      "@/services/task-schedules-sync"
    );

    mockFindMany
      .mockResolvedValueOnce([{ id: "template-1" }])
      .mockResolvedValueOnce([]);

    mockTransaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: mockFindFirst,
          create: mockTaskCreate,
          update: mockTaskUpdate,
          updateMany: mockTaskUpdateMany,
        },
        taskLink: {
          create: mockTaskLinkCreate,
        },
        taskEvent: {
          create: mockTaskEventCreate,
        },
        taskScheduleOccurrence: {
          create: mockTaskScheduleOccurrenceCreate,
        },
        taskScheduleQuarantine: {
          upsert: mockTaskScheduleQuarantineUpsert,
        },
      }),
    );

    mockFindFirst.mockResolvedValue({
      id: "template-1",
      ownerId: "user-1",
      organizationId: null,
      workspaceId: "workspace-1",
      projectId: null,
      assigneeId: null,
      name: "Template",
      description: "Run me",
      metadata: JSON.stringify({
        version: 1,
        mode: "recurring",
        scheduledAt: "2026-06-01T09:00:00.000Z",
        lastRunAt: "2026-06-07T09:00:00.000Z",
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "never",
      }),
      nextRunAt: new Date("2026-06-08T09:00:00.000Z"),
    });

    const result = await taskSchedulesSyncService.syncDueSchedules({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() - 1,
      shouldContinue: () => true,
    });

    expect(result.cloned).toBe(0);
    expect(mockTaskCreate).not.toHaveBeenCalled();
    expect(publishTaskEventDataMock).not.toHaveBeenCalled();
  });

  it("limits recurring catch-up when the sync is aborted", async () => {
    const { taskSchedulesSyncService } = await import(
      "@/services/task-schedules-sync"
    );

    let metadata = JSON.stringify({
      version: 1,
      mode: "recurring",
      scheduledAt: "2026-06-01T09:00:00.000Z",
      lastRunAt: "2026-06-07T09:00:00.000Z",
      expr: "0 9 * * *",
      timezone: "UTC",
      endsMode: "never",
    });

    const abortController = new AbortController();

    mockFindMany
      .mockResolvedValueOnce([{ id: "template-1" }])
      .mockResolvedValueOnce([]);

    mockTransaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: mockFindFirst,
          create: mockTaskCreate,
          update: mockTaskUpdate,
          updateMany: mockTaskUpdateMany,
        },
        taskLink: {
          create: mockTaskLinkCreate,
        },
        taskEvent: {
          create: mockTaskEventCreate,
        },
        taskScheduleOccurrence: {
          create: mockTaskScheduleOccurrenceCreate,
        },
        taskScheduleQuarantine: {
          upsert: mockTaskScheduleQuarantineUpsert,
        },
      }),
    );

    mockFindFirst.mockResolvedValue({
      id: "template-1",
      ownerId: "user-1",
      organizationId: null,
      workspaceId: "workspace-1",
      projectId: null,
      assigneeId: null,
      name: "Template",
      description: "Run me",
      metadata,
      nextRunAt: new Date("2026-06-08T09:00:00.000Z"),
    });

    mockTaskCreate.mockImplementation(async () => {
      abortController.abort();
      return { id: "clone-1" };
    });
    mockTaskUpdateMany.mockResolvedValue({ count: 1 });
    mockTaskUpdate.mockImplementation(async ({ data }) => {
      if (typeof data.metadata === "string") {
        metadata = data.metadata;
      }
      return { id: "template-1" };
    });

    const result = await taskSchedulesSyncService.syncDueSchedules({
      abortSignal: abortController.signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(result.cloned).toBe(1);
    expect(mockTaskCreate).toHaveBeenCalledTimes(1);
    expect(publishTaskEventDataMock).toHaveBeenCalledTimes(1);
    expect(publishTaskEventDataMock).toHaveBeenCalledWith({
      userId: "user-1",
      taskId: "clone-1",
      eventType: "task_event",
    });
  });

  it("quarantines malformed metadata without clearing the schedule", async () => {
    const { taskSchedulesSyncService } = await import(
      "@/services/task-schedules-sync"
    );

    mockFindMany
      .mockResolvedValueOnce([{ id: "template-1" }])
      .mockResolvedValueOnce([]);

    mockTransaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: mockFindFirst,
          create: mockTaskCreate,
          update: mockTaskUpdate,
          updateMany: mockTaskUpdateMany,
        },
        taskLink: {
          create: mockTaskLinkCreate,
        },
        taskEvent: {
          create: mockTaskEventCreate,
        },
        taskScheduleOccurrence: {
          create: mockTaskScheduleOccurrenceCreate,
        },
        taskScheduleQuarantine: {
          upsert: mockTaskScheduleQuarantineUpsert,
        },
      }),
    );

    mockFindFirst.mockResolvedValue({
      id: "template-1",
      ownerId: "user-1",
      organizationId: null,
      workspaceId: "workspace-1",
      projectId: null,
      assigneeId: null,
      name: "Template",
      description: "Run once",
      metadata: JSON.stringify({
        version: 1,
        mode: "once",
        scheduledAt: "2026-06-01T09:00:00.000Z",
        timezone: "UTC",
      }),
      nextRunAt: new Date("2026-06-08T09:00:00.000Z"),
    });

    const result = await taskSchedulesSyncService.syncDueSchedules({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(result.promoted).toBe(0);
    expect(mockTaskScheduleQuarantineUpsert).toHaveBeenCalledWith({
      where: { taskId: "template-1" },
      create: expect.objectContaining({
        taskId: "template-1",
        reason: "INVALID_METADATA",
      }),
      update: expect.objectContaining({
        reason: "INVALID_METADATA",
      }),
    });
    expect(mockTaskUpdateMany).not.toHaveBeenCalled();
    expect(mockTaskEventCreate).not.toHaveBeenCalled();
    expect(publishTaskEventDataMock).not.toHaveBeenCalled();
  });

  it("quarantines an invalid schedule timezone without releasing it", async () => {
    const { taskSchedulesSyncService } = await import(
      "@/services/task-schedules-sync"
    );

    mockFindMany
      .mockResolvedValueOnce([{ id: "template-1" }])
      .mockResolvedValueOnce([]);
    mockTransaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: mockFindFirst,
          create: mockTaskCreate,
          update: mockTaskUpdate,
          updateMany: mockTaskUpdateMany,
        },
        taskLink: { create: mockTaskLinkCreate },
        taskEvent: { create: mockTaskEventCreate },
        taskScheduleOccurrence: {
          create: mockTaskScheduleOccurrenceCreate,
        },
        taskScheduleQuarantine: {
          upsert: mockTaskScheduleQuarantineUpsert,
        },
      }),
    );
    mockFindFirst.mockResolvedValue({
      id: "template-1",
      ownerId: "user-1",
      organizationId: null,
      workspaceId: "workspace-1",
      projectId: null,
      assigneeId: null,
      name: "Template",
      description: "Run me",
      metadata: JSON.stringify({
        version: 1,
        mode: "recurring",
        scheduledAt: "2026-06-01T09:00:00.000Z",
        lastRunAt: "2026-06-09T09:00:00.000Z",
        expr: "0 9 * * *",
        timezone: "Not/A_Timezone",
        endsMode: "never",
      }),
      nextRunAt: new Date("2026-06-10T09:00:00.000Z"),
    });

    const result = await taskSchedulesSyncService.syncDueSchedules({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(result).toMatchObject({ cloned: 0, promoted: 0 });
    expect(mockTaskScheduleQuarantineUpsert).toHaveBeenCalledWith({
      where: { taskId: "template-1" },
      create: expect.objectContaining({ reason: "INVALID_TIMEZONE" }),
      update: expect.objectContaining({ reason: "INVALID_TIMEZONE" }),
    });
    expect(mockTaskCreate).not.toHaveBeenCalled();
    expect(mockTaskUpdateMany).not.toHaveBeenCalled();
  });

  it("quarantines a due row whose nextRunAt does not match metadata", async () => {
    const { taskSchedulesSyncService } = await import(
      "@/services/task-schedules-sync"
    );

    mockFindMany
      .mockResolvedValueOnce([{ id: "template-1" }])
      .mockResolvedValueOnce([]);
    mockTransaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: mockFindFirst,
          create: mockTaskCreate,
          update: mockTaskUpdate,
          updateMany: mockTaskUpdateMany,
        },
        taskLink: { create: mockTaskLinkCreate },
        taskEvent: { create: mockTaskEventCreate },
        taskScheduleOccurrence: {
          create: mockTaskScheduleOccurrenceCreate,
        },
        taskScheduleQuarantine: {
          upsert: mockTaskScheduleQuarantineUpsert,
        },
      }),
    );
    mockFindFirst.mockResolvedValue({
      id: "template-1",
      ownerId: "user-1",
      organizationId: null,
      workspaceId: "workspace-1",
      projectId: null,
      assigneeId: null,
      name: "Template",
      description: "Run once",
      metadata: JSON.stringify({
        version: 1,
        mode: "once",
        scheduledAt: "2026-06-01T09:00:00.000Z",
        runAt: "2026-06-10T09:00:00.000Z",
      }),
      nextRunAt: new Date("2026-06-10T10:00:00.000Z"),
    });

    const result = await taskSchedulesSyncService.syncDueSchedules({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(result).toMatchObject({ cloned: 0, promoted: 0 });
    expect(mockTaskScheduleQuarantineUpsert).toHaveBeenCalledWith({
      where: { taskId: "template-1" },
      create: expect.objectContaining({ reason: "NEXT_RUN_MISMATCH" }),
      update: expect.objectContaining({ reason: "NEXT_RUN_MISMATCH" }),
    });
    expect(mockTaskCreate).not.toHaveBeenCalled();
    expect(mockTaskUpdateMany).not.toHaveBeenCalled();
  });

  it("skips release when the Calendar source changes before the Task lock", async () => {
    const { taskSchedulesSyncService } = await import(
      "@/services/task-schedules-sync"
    );
    const candidate = {
      id: "template-1",
      ownerId: "user-1",
      organizationId: null,
      workspaceId: "workspace-1",
      projectId: "project-1",
      assigneeId: null,
      name: "Template",
      description: "Run once",
      metadata: JSON.stringify({
        version: 1,
        mode: "once",
        scheduledAt: "2026-06-01T09:00:00.000Z",
        runAt: "2026-06-10T09:00:00.000Z",
      }),
      nextRunAt: new Date("2026-06-10T09:00:00.000Z"),
    };
    mockFindMany
      .mockResolvedValueOnce([{ id: "template-1" }])
      .mockResolvedValueOnce([]);
    mockFindFirst
      .mockResolvedValueOnce(candidate)
      .mockResolvedValueOnce({ ...candidate, projectId: "project-2" });
    mockTransaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: mockFindFirst,
          create: mockTaskCreate,
          update: mockTaskUpdate,
          updateMany: mockTaskUpdateMany,
        },
        taskLink: { create: mockTaskLinkCreate },
        taskEvent: { create: mockTaskEventCreate },
        taskScheduleOccurrence: {
          create: mockTaskScheduleOccurrenceCreate,
        },
        taskScheduleQuarantine: {
          upsert: mockTaskScheduleQuarantineUpsert,
        },
      }),
    );

    const result = await taskSchedulesSyncService.syncDueSchedules({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(result).toMatchObject({ cloned: 0, promoted: 0 });
    expect(mockTaskCreate).not.toHaveBeenCalled();
    expect(mockTaskUpdateMany).not.toHaveBeenCalled();
    expect(mockTaskScheduleQuarantineUpsert).not.toHaveBeenCalled();
  });

  it("rolls back recurring clones when re-arm fails after cancel", async () => {
    const { taskSchedulesSyncService } = await import(
      "@/services/task-schedules-sync"
    );

    mockFindMany
      .mockResolvedValueOnce([{ id: "template-1" }])
      .mockResolvedValueOnce([]);

    mockTransaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: mockFindFirst,
          create: mockTaskCreate,
          update: mockTaskUpdate,
          updateMany: mockTaskUpdateMany,
        },
        taskLink: {
          create: mockTaskLinkCreate,
        },
        taskEvent: {
          create: mockTaskEventCreate,
        },
        taskScheduleOccurrence: {
          create: mockTaskScheduleOccurrenceCreate,
        },
        taskScheduleQuarantine: {
          upsert: mockTaskScheduleQuarantineUpsert,
        },
      }),
    );

    mockFindFirst.mockResolvedValue({
      id: "template-1",
      ownerId: "user-1",
      organizationId: null,
      workspaceId: "workspace-1",
      projectId: null,
      assigneeId: null,
      name: "Template",
      description: "Run me",
      metadata: JSON.stringify({
        version: 1,
        mode: "recurring",
        scheduledAt: "2026-06-01T09:00:00.000Z",
        lastRunAt: "2026-06-09T09:00:00.000Z",
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "never",
      }),
      // Single due occurrence relative to fake now 2026-06-10T12:00Z
      nextRunAt: new Date("2026-06-10T09:00:00.000Z"),
    });

    mockTaskCreate.mockResolvedValue({ id: "clone-orphan" });
    // Claim lost: template already canceled/cleared before re-arm
    mockTaskUpdateMany.mockResolvedValue({ count: 0 });

    const result = await taskSchedulesSyncService.syncDueSchedules({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(result.cloned).toBe(0);
    expect(result.promoted).toBe(0);
    // Clone create ran in-tx; TemplateClaimLostError rolls the tx back
    expect(mockTaskCreate).toHaveBeenCalledTimes(1);
    expect(publishTaskEventDataMock).not.toHaveBeenCalled();
    expect(mockTaskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "template-1",
          status: "QUEUED",
          archivedAt: null,
          nextRunAt: new Date("2026-06-10T09:00:00.000Z"),
        },
      }),
    );
  });

  it("rolls back recurring clones when nextRunAt changed by concurrent schedule PUT", async () => {
    const { taskSchedulesSyncService } = await import(
      "@/services/task-schedules-sync"
    );

    const claimedNextRunAt = new Date("2026-06-10T09:00:00.000Z");

    mockFindMany
      .mockResolvedValueOnce([{ id: "template-1" }])
      .mockResolvedValueOnce([]);

    mockTransaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: mockFindFirst,
          create: mockTaskCreate,
          update: mockTaskUpdate,
          updateMany: mockTaskUpdateMany,
        },
        taskLink: {
          create: mockTaskLinkCreate,
        },
        taskEvent: {
          create: mockTaskEventCreate,
        },
        taskScheduleOccurrence: {
          create: mockTaskScheduleOccurrenceCreate,
        },
        taskScheduleQuarantine: {
          upsert: mockTaskScheduleQuarantineUpsert,
        },
      }),
    );

    mockFindFirst.mockResolvedValue({
      id: "template-1",
      ownerId: "user-1",
      organizationId: null,
      workspaceId: "workspace-1",
      projectId: null,
      assigneeId: null,
      name: "Template",
      description: "Run me",
      metadata: JSON.stringify({
        version: 1,
        mode: "recurring",
        scheduledAt: "2026-06-01T09:00:00.000Z",
        lastRunAt: "2026-06-09T09:00:00.000Z",
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "never",
      }),
      nextRunAt: claimedNextRunAt,
    });

    mockTaskCreate.mockResolvedValue({ id: "clone-stale" });
    // Concurrent PUT changed nextRunAt while status stayed QUEUED — CAS misses
    mockTaskUpdateMany.mockResolvedValue({ count: 0 });

    const result = await taskSchedulesSyncService.syncDueSchedules({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(result.cloned).toBe(0);
    expect(mockTaskCreate).toHaveBeenCalledTimes(1);
    expect(publishTaskEventDataMock).not.toHaveBeenCalled();
    expect(mockTaskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "template-1",
          status: "QUEUED",
          archivedAt: null,
          nextRunAt: claimedNextRunAt,
        },
      }),
    );
  });

  it("rolls back recurring clones when template is archived concurrently", async () => {
    const { taskSchedulesSyncService } = await import(
      "@/services/task-schedules-sync"
    );

    const claimedNextRunAt = new Date("2026-06-10T09:00:00.000Z");

    mockFindMany
      .mockResolvedValueOnce([{ id: "template-1" }])
      .mockResolvedValueOnce([]);

    mockTransaction.mockImplementation(async (callback) =>
      callback({
        task: {
          findFirst: mockFindFirst,
          create: mockTaskCreate,
          update: mockTaskUpdate,
          updateMany: mockTaskUpdateMany,
        },
        taskLink: {
          create: mockTaskLinkCreate,
        },
        taskEvent: {
          create: mockTaskEventCreate,
        },
        taskScheduleOccurrence: {
          create: mockTaskScheduleOccurrenceCreate,
        },
        taskScheduleQuarantine: {
          upsert: mockTaskScheduleQuarantineUpsert,
        },
      }),
    );

    // Open claim still sees unarchived QUEUED template (archive only sets archivedAt)
    mockFindFirst.mockResolvedValue({
      id: "template-1",
      ownerId: "user-1",
      organizationId: null,
      workspaceId: "workspace-1",
      projectId: null,
      assigneeId: null,
      name: "Template",
      description: "Run me",
      metadata: JSON.stringify({
        version: 1,
        mode: "recurring",
        scheduledAt: "2026-06-01T09:00:00.000Z",
        lastRunAt: "2026-06-09T09:00:00.000Z",
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "never",
      }),
      nextRunAt: claimedNextRunAt,
    });

    mockTaskCreate.mockResolvedValue({ id: "clone-after-archive" });
    // Concurrent archive: status/nextRunAt unchanged, archivedAt set → CAS misses
    mockTaskUpdateMany.mockResolvedValue({ count: 0 });

    const result = await taskSchedulesSyncService.syncDueSchedules({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(result.cloned).toBe(0);
    expect(mockTaskCreate).toHaveBeenCalledTimes(1);
    expect(publishTaskEventDataMock).not.toHaveBeenCalled();
    expect(mockTaskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "template-1",
          status: "QUEUED",
          archivedAt: null,
          nextRunAt: claimedNextRunAt,
        },
      }),
    );
  });
});
