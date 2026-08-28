import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  lockCalendarScopeMock,
  lockTaskRowsMock,
  removeTaskSchedulePlannedOccurrencesMock,
  replaceTaskSchedulePlannedOccurrencesMock,
  TaskScheduleOccurrenceLimitErrorMock,
  taskScheduleOccurrenceCreateManyMock,
  taskScheduleOccurrenceDeleteManyMock,
  taskFindManyMock,
  taskFindUniqueMock,
} = vi.hoisted(() => ({
  lockCalendarScopeMock: vi.fn(),
  lockTaskRowsMock: vi.fn(),
  removeTaskSchedulePlannedOccurrencesMock: vi.fn(),
  replaceTaskSchedulePlannedOccurrencesMock: vi.fn(),
  TaskScheduleOccurrenceLimitErrorMock: class TaskScheduleOccurrenceLimitError extends Error {},
  taskScheduleOccurrenceCreateManyMock: vi.fn(),
  taskScheduleOccurrenceDeleteManyMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskFindUniqueMock: vi.fn(),
}));

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
  lockTaskRows: lockTaskRowsMock,
}));

vi.mock("@/helpers/task-schedule-occurrence-index", () => ({
  removeTaskSchedulePlannedOccurrences:
    removeTaskSchedulePlannedOccurrencesMock,
  TaskScheduleOccurrenceLimitError: TaskScheduleOccurrenceLimitErrorMock,
  replaceTaskSchedulePlannedOccurrences:
    replaceTaskSchedulePlannedOccurrencesMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      await callback({
        task: { findUnique: taskFindUniqueMock },
        taskScheduleOccurrence: {
          createMany: taskScheduleOccurrenceCreateManyMock,
          deleteMany: taskScheduleOccurrenceDeleteManyMock,
        },
      }),
    syncMetadata: { findUnique: vi.fn(), upsert: vi.fn() },
    task: { findMany: taskFindManyMock },
  },
}));

describe("taskScheduleValidationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockCalendarScopeMock.mockResolvedValue(true);
    lockTaskRowsMock.mockResolvedValue(true);
    replaceTaskSchedulePlannedOccurrencesMock.mockResolvedValue(undefined);
  });

  it("indexes valid active schedules while validating them", async () => {
    const task = {
      id: "tsk_123",
      workspaceId: "11111111-1111-7111-8111-111111111111",
      projectId: null,
      status: TaskStatus.QUEUED,
      metadata: JSON.stringify({
        version: 1,
        mode: "once",
        scheduledAt: "2026-06-01T00:00:00.000Z",
        runAt: "2026-06-02T09:00:00.000Z",
      }),
      nextRunAt: new Date("2026-06-02T09:00:00.000Z"),
      archivedAt: null,
      scheduleQuarantine: null,
    };
    taskFindManyMock.mockResolvedValue([{ id: task.id }]);
    taskFindUniqueMock.mockResolvedValue(task);

    const { taskScheduleValidationService } = await import(
      "./task-schedule-validation.service"
    );
    await taskScheduleValidationService.validateActiveSchedules({
      shouldContinue: () => true,
    });

    expect(replaceTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: task.id,
        schedule: expect.objectContaining({ version: 1 }),
      }),
    );
  });

  it("continues when an existing schedule exceeds the occurrence limit", async () => {
    const task = {
      id: "tsk_123",
      workspaceId: "11111111-1111-7111-8111-111111111111",
      projectId: null,
      status: TaskStatus.QUEUED,
      metadata: JSON.stringify({
        version: 1,
        mode: "once",
        scheduledAt: "2026-06-01T00:00:00.000Z",
        runAt: "2026-06-02T09:00:00.000Z",
      }),
      nextRunAt: new Date("2026-06-02T09:00:00.000Z"),
      archivedAt: null,
      scheduleQuarantine: null,
    };
    taskFindManyMock.mockResolvedValue([{ id: task.id }]);
    taskFindUniqueMock.mockResolvedValue(task);
    replaceTaskSchedulePlannedOccurrencesMock.mockRejectedValue(
      new TaskScheduleOccurrenceLimitErrorMock(),
    );

    const { taskScheduleValidationService } = await import(
      "./task-schedule-validation.service"
    );
    const result = await taskScheduleValidationService.validateActiveSchedules({
      shouldContinue: () => true,
    });

    expect(result).toEqual({ scanned: 1, quarantined: 0, passComplete: true });
    expect(removeTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledWith(
      expect.anything(),
      task.id,
    );
  });
});
