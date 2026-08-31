import { beforeEach, describe, expect, it, vi } from "vitest";

const taskEventFindFirstMock = vi.hoisted(() => vi.fn());
const taskEventCreateMock = vi.hoisted(() => vi.fn());
const quarantineFindUniqueMock = vi.hoisted(() => vi.fn());
const quarantineDeleteManyMock = vi.hoisted(() => vi.fn());
const taskUpdateMock = vi.hoisted(() => vi.fn());
const serializableTransactionMock = vi.hoisted(() => vi.fn());
const lockCalendarScopeMock = vi.hoisted(() => vi.fn());
const lockTaskRowsMock = vi.hoisted(() => vi.fn());
const createNotificationMock = vi.hoisted(() => vi.fn());
const accessibleTaskFindFirstMock = vi.hoisted(() => vi.fn());
const removeTaskSchedulePlannedOccurrencesMock = vi.hoisted(() => vi.fn());
const replaceTaskSchedulePlannedOccurrencesMock = vi.hoisted(() => vi.fn());
const TaskScheduleOccurrenceLimitErrorMock = vi.hoisted(
  () =>
    class TaskScheduleOccurrenceLimitError extends Error {
      constructor() {
        super("Schedule creates too many occurrences");
      }
    },
);

const tx = {
  taskEvent: {
    findFirst: taskEventFindFirstMock,
    create: taskEventCreateMock,
  },
  taskScheduleQuarantine: {
    findUnique: quarantineFindUniqueMock,
    deleteMany: quarantineDeleteManyMock,
  },
  task: {
    update: taskUpdateMock,
  },
};

vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: serializableTransactionMock,
}));

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
  lockTaskRows: lockTaskRowsMock,
}));

vi.mock("@/helpers/notifications", () => ({
  createNotification: createNotificationMock,
}));

vi.mock("@/helpers/task-schedule-occurrence-index", () => ({
  removeTaskSchedulePlannedOccurrences:
    removeTaskSchedulePlannedOccurrencesMock,
  replaceTaskSchedulePlannedOccurrences:
    replaceTaskSchedulePlannedOccurrencesMock,
  TaskScheduleOccurrenceLimitError: TaskScheduleOccurrenceLimitErrorMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: { findFirst: accessibleTaskFindFirstMock },
  },
}));

const { removeTaskScheduleQuarantine, repairTaskScheduleQuarantine } =
  await import("@/services/task-schedule-quarantine.service");

function createQuarantine() {
  return {
    id: "quarantine-1",
    taskId: "task-1",
    reason: "INVALID_METADATA",
    details: "metadata failed validation",
    capturedMetadata: "{broken",
    capturedNextRunAt: new Date("2026-08-25T09:00:00.000Z"),
    capturedStatus: "QUEUED",
    task: {
      id: "task-1",
      ownerId: "owner-1",
      name: "Quarantined task",
      assigneeId: "coworker-1",
      status: "QUEUED",
      metadata: "{broken",
      nextRunAt: new Date("2026-08-25T09:00:00.000Z"),
      archivedAt: null,
      workspaceId: "workspace-1",
      projectId: null,
    },
  };
}

describe("task schedule quarantine operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));
    serializableTransactionMock.mockImplementation(async (callback) =>
      callback(tx),
    );
    taskEventFindFirstMock.mockResolvedValue(null);
    quarantineFindUniqueMock.mockResolvedValue(createQuarantine());
    quarantineDeleteManyMock.mockResolvedValue({ count: 1 });
    taskUpdateMock.mockResolvedValue({ id: "task-1" });
    replaceTaskSchedulePlannedOccurrencesMock.mockResolvedValue(undefined);
    taskEventCreateMock.mockResolvedValue({ id: "event-1" });
    lockCalendarScopeMock.mockResolvedValue(true);
    lockTaskRowsMock.mockResolvedValue(true);
    createNotificationMock.mockResolvedValue({ created: true });
    accessibleTaskFindFirstMock.mockResolvedValue({
      owner: { notificationsOptIn: true },
    });
  });

  it("repairs a quarantined task with validated schedule metadata and an audit event", async () => {
    const schedule = {
      mode: "recurring" as const,
      expr: "0 9 * * *",
      timezone: "UTC",
      endsMode: "never" as const,
    };

    const result = await repairTaskScheduleQuarantine({
      taskId: "task-1",
      operationId: "123e4567-e89b-42d3-a456-426614174000",
      operatorId: "admin-1",
      reason: "Corrected the imported rule",
      schedule,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw new Error("Expected quarantine repair to succeed");
    }
    expect(result.value).toEqual({
      status: "repaired",
      taskId: "task-1",
      taskName: "Quarantined task",
      eventId: "event-1",
      ownerId: "owner-1",
      replayed: false,
    });
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: {
        metadata: expect.any(String),
        nextRunAt: new Date("2026-08-27T09:00:00.000Z"),
        status: "QUEUED",
      },
    });
    const metadata = JSON.parse(taskUpdateMock.mock.calls[0][0].data.metadata);
    expect(metadata).toMatchObject({
      version: 1,
      mode: "recurring",
      expr: "0 9 * * *",
      timezone: "UTC",
    });
    expect(quarantineDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "quarantine-1", taskId: "task-1" },
    });
    expect(replaceTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        id: "task-1",
        workspaceId: "workspace-1",
        projectId: null,
        schedule: expect.objectContaining({ version: 1 }),
        nextRunAt: new Date("2026-08-27T09:00:00.000Z"),
      }),
    );
    expect(taskEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: "task-1",
        userId: "admin-1",
        scheduleKind: "UPDATED",
        scheduleOperationId: "123e4567-e89b-42d3-a456-426614174000",
        schedulePayload: expect.objectContaining({
          action: "repair_quarantine",
          reason: "Corrected the imported rule",
          quarantineId: "quarantine-1",
          taskName: "Quarantined task",
          schedule,
        }),
      }),
      select: { id: true },
    });
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "owner-1",
        eventId: "event-1",
        messageKey: "Notifications.Task.scheduleRepaired",
      }),
    );
  });

  it("keeps a quarantined schedule when its repair exceeds the Calendar limit", async () => {
    replaceTaskSchedulePlannedOccurrencesMock.mockRejectedValue(
      new TaskScheduleOccurrenceLimitErrorMock(),
    );

    const result = await repairTaskScheduleQuarantine({
      taskId: "task-1",
      operationId: "123e4567-e89b-42d3-a456-426614174009",
      operatorId: "admin-1",
      reason: "Corrected the imported rule",
      schedule: {
        mode: "recurring",
        expr: "* * * * *",
        timezone: "UTC",
        endsMode: "never",
      },
    });

    expect(result).toMatchObject({
      error: {
        kind: "not_repairable",
        reason: "Schedule creates too many occurrences",
      },
    });
    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(quarantineDeleteManyMock).not.toHaveBeenCalled();
  });

  it("removes a quarantined schedule, returns the task to Draft, and audits the snapshot", async () => {
    const result = await removeTaskScheduleQuarantine({
      taskId: "task-1",
      operationId: "123e4567-e89b-42d3-a456-426614174001",
      operatorId: "admin-1",
      reason: "Schedule cannot be recovered",
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw new Error("Expected quarantined schedule removal to succeed");
    }
    expect(result.value).toEqual({
      status: "removed",
      taskId: "task-1",
      taskName: "Quarantined task",
      eventId: "event-1",
      ownerId: "owner-1",
      replayed: false,
    });
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: {
        metadata: null,
        nextRunAt: null,
        status: "DRAFT",
      },
    });
    expect(taskEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: "task-1",
        status: "DRAFT",
        scheduleKind: "REMOVED",
        schedulePayload: expect.objectContaining({
          action: "remove_quarantined_schedule",
          capturedMetadata: "{broken",
          capturedStatus: "QUEUED",
          taskName: "Quarantined task",
        }),
      }),
      select: { id: true },
    });
    expect(removeTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledWith(
      tx,
      "task-1",
    );
  });

  it("replays an exact audited removal without repeating side effects", async () => {
    taskEventFindFirstMock.mockResolvedValue({
      id: "event-existing",
      taskId: "task-1",
      schedulePayload: {
        action: "remove_quarantined_schedule",
        reason: "Schedule cannot be recovered",
        ownerId: "owner-1",
        taskName: "Quarantined task",
      },
    });

    const result = await removeTaskScheduleQuarantine({
      taskId: "task-1",
      operationId: "123e4567-e89b-42d3-a456-426614174001",
      operatorId: "admin-1",
      reason: "Schedule cannot be recovered",
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw new Error("Expected exact removal replay to succeed");
    }
    expect(result.value).toEqual({
      status: "removed",
      taskId: "task-1",
      taskName: "Quarantined task",
      eventId: "event-existing",
      ownerId: "owner-1",
      replayed: true,
    });
    expect(quarantineFindUniqueMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(taskEventCreateMock).not.toHaveBeenCalled();
  });

  it("replays a repair when jsonb returns schedule keys in a different order", async () => {
    taskEventFindFirstMock.mockResolvedValue({
      id: "event-existing",
      schedulePayload: {
        taskName: "Quarantined task",
        ownerId: "owner-1",
        reason: "Corrected the imported rule",
        action: "repair_quarantine",
        schedule: {
          endsMode: "never",
          timezone: "UTC",
          expr: "0 9 * * *",
          mode: "recurring",
        },
      },
    });

    const result = await repairTaskScheduleQuarantine({
      taskId: "task-1",
      operationId: "123e4567-e89b-42d3-a456-426614174000",
      operatorId: "admin-1",
      reason: "Corrected the imported rule",
      schedule: {
        mode: "recurring",
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "never",
      },
    });

    expect(result.isOk()).toBe(true);
    expect(quarantineFindUniqueMock).not.toHaveBeenCalled();
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  it("suppresses owner notification after workspace access is lost", async () => {
    accessibleTaskFindFirstMock.mockResolvedValue(null);

    const result = await removeTaskScheduleQuarantine({
      taskId: "task-1",
      operationId: "123e4567-e89b-42d3-a456-426614174002",
      operatorId: "admin-1",
      reason: "Schedule cannot be recovered",
    });

    expect(result.isOk()).toBe(true);
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("suppresses owner notification for a self-operated action", async () => {
    const result = await removeTaskScheduleQuarantine({
      taskId: "task-1",
      operationId: "123e4567-e89b-42d3-a456-426614174003",
      operatorId: "owner-1",
      reason: "Schedule cannot be recovered",
    });

    expect(result.isOk()).toBe(true);
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("rejects repair after the quarantined Task was archived", async () => {
    quarantineFindUniqueMock.mockResolvedValue({
      ...createQuarantine(),
      task: {
        ...createQuarantine().task,
        archivedAt: new Date("2026-08-26T10:00:00.000Z"),
      },
    });

    const result = await repairTaskScheduleQuarantine({
      taskId: "task-1",
      operationId: "123e4567-e89b-42d3-a456-426614174004",
      operatorId: "admin-1",
      reason: "Corrected the imported rule",
      schedule: {
        mode: "recurring",
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "never",
      },
    });

    expect(result).toMatchObject({
      error: {
        kind: "not_repairable",
        reason: "Archived Tasks cannot be rescheduled",
      },
    });
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });
});
