import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTransaction = vi.fn();
const mockFindMany = vi.fn();
const mockFindFirst = vi.fn();
const mockTaskCreate = vi.fn();
const mockTaskUpdate = vi.fn();
const mockTaskUpdateMany = vi.fn();
const mockTaskLinkCreate = vi.fn();
const mockTaskEventCreate = vi.fn();
const publishTaskEventDataMock = vi.fn();

vi.mock("@/lib/ably/publish", () => ({
  publishTaskEventData: publishTaskEventDataMock,
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
    vi.resetModules();
    publishTaskEventDataMock.mockResolvedValue(undefined);
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
    expect(mockTaskCreate).toHaveBeenCalledTimes(3);
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
          nextRunAt: new Date("2026-06-08T09:00:00.000Z"),
        },
        data: expect.objectContaining({
          nextRunAt: new Date("2026-06-11T09:00:00.000Z"),
        }),
      }),
    );
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

  it("skips promote when the template is no longer queued", async () => {
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

    mockTaskUpdateMany.mockResolvedValue({ count: 0 });

    const result = await taskSchedulesSyncService.syncDueSchedules({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(result.promoted).toBe(0);
    expect(mockTaskEventCreate).not.toHaveBeenCalled();
    expect(publishTaskEventDataMock).not.toHaveBeenCalled();
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
          nextRunAt: claimedNextRunAt,
        },
      }),
    );
  });
});
