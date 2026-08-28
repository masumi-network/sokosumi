import { beforeEach, describe, expect, it, vi } from "vitest";

const taskFindManyMock = vi.hoisted(() => vi.fn());
const taskFindUniqueMock = vi.hoisted(() => vi.fn());
const syncMetadataFindUniqueMock = vi.hoisted(() => vi.fn());
const syncMetadataUpsertMock = vi.hoisted(() => vi.fn());
const quarantineUpsertMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const lockCalendarScopeMock = vi.hoisted(() => vi.fn());
const lockTaskRowsMock = vi.hoisted(() => vi.fn());
const taskScheduleOccurrenceCreateManyMock = vi.hoisted(() => vi.fn());
const taskScheduleOccurrenceDeleteManyMock = vi.hoisted(() => vi.fn());

const tx = {
  task: { findUnique: taskFindUniqueMock },
  taskScheduleOccurrence: {
    createMany: taskScheduleOccurrenceCreateManyMock,
    deleteMany: taskScheduleOccurrenceDeleteManyMock,
  },
  taskScheduleQuarantine: { upsert: quarantineUpsertMock },
};

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: transactionMock,
    task: { findMany: taskFindManyMock },
    syncMetadata: {
      findUnique: syncMetadataFindUniqueMock,
      upsert: syncMetadataUpsertMock,
    },
  },
}));

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
  lockTaskRows: lockTaskRowsMock,
}));

describe("taskScheduleValidationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));
    transactionMock.mockImplementation(async (callback) => callback(tx));
    syncMetadataFindUniqueMock.mockResolvedValue(null);
    syncMetadataUpsertMock.mockResolvedValue(undefined);
    lockCalendarScopeMock.mockResolvedValue(true);
    lockTaskRowsMock.mockResolvedValue(true);
    quarantineUpsertMock.mockResolvedValue({ id: "quarantine-1" });
    taskScheduleOccurrenceCreateManyMock.mockResolvedValue({ count: 1 });
    taskScheduleOccurrenceDeleteManyMock.mockResolvedValue({ count: 1 });
  });

  it("quarantines active schedule rows with invalid status or next-run state", async () => {
    const invalidStatus = {
      id: "task-1",
      workspaceId: "workspace-1",
      projectId: null,
      status: "READY",
      metadata: JSON.stringify({
        version: 1,
        mode: "once",
        scheduledAt: "2026-08-20T09:00:00.000Z",
        runAt: "2026-08-28T09:00:00.000Z",
      }),
      nextRunAt: new Date("2026-08-28T09:00:00.000Z"),
    };
    const mismatchedNextRun = {
      ...invalidStatus,
      id: "task-2",
      status: "QUEUED",
      nextRunAt: new Date("2026-08-29T09:00:00.000Z"),
    };
    taskFindManyMock.mockResolvedValue([
      { id: "task-1", workspaceId: "workspace-1", projectId: null },
      { id: "task-2", workspaceId: "workspace-1", projectId: null },
    ]);
    taskFindUniqueMock.mockImplementation(({ where: { id } }) => {
      return id === "task-1" ? invalidStatus : mismatchedNextRun;
    });
    const { taskScheduleValidationService } = await import(
      "@/services/task-schedule-validation.service"
    );

    const result = await taskScheduleValidationService.validateActiveSchedules({
      shouldContinue: () => true,
    });

    expect(result).toEqual({ scanned: 2, quarantined: 2, passComplete: true });
    expect(quarantineUpsertMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        create: expect.objectContaining({ reason: "INVALID_STATUS" }),
      }),
    );
    expect(quarantineUpsertMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        create: expect.objectContaining({ reason: "NEXT_RUN_MISMATCH" }),
      }),
    );
  });

  it("advances a resumable cursor after validating a bounded batch", async () => {
    const task = {
      id: "task-1",
      workspaceId: "workspace-1",
      projectId: null,
      status: "QUEUED",
      metadata: JSON.stringify({
        version: 1,
        mode: "recurring",
        scheduledAt: "2026-08-20T12:00:00.000Z",
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "never",
      }),
      nextRunAt: new Date("2026-08-21T09:00:00.000Z"),
    };
    taskFindManyMock.mockResolvedValue([
      { id: task.id, workspaceId: task.workspaceId, projectId: null },
    ]);
    taskFindUniqueMock.mockResolvedValue(task);
    const { taskScheduleValidationService } = await import(
      "@/services/task-schedule-validation.service"
    );

    const result = await taskScheduleValidationService.validateActiveSchedules({
      shouldContinue: () => true,
    });

    expect(result).toEqual({ scanned: 1, quarantined: 0, passComplete: true });
    expect(quarantineUpsertMock).not.toHaveBeenCalled();
    expect(syncMetadataUpsertMock).toHaveBeenCalledWith({
      where: { key: "task-schedule-validation:cursor" },
      create: expect.objectContaining({ cursorId: "task-1" }),
      update: expect.objectContaining({ cursorId: "task-1" }),
    });
  });

  it("preserves the cursor when the deadline prevents all progress", async () => {
    syncMetadataFindUniqueMock.mockResolvedValue({ cursorId: "task-before" });
    taskFindManyMock.mockResolvedValue([{ id: "task-after" }]);
    const { taskScheduleValidationService } = await import(
      "@/services/task-schedule-validation.service"
    );

    const result = await taskScheduleValidationService.validateActiveSchedules({
      shouldContinue: () => false,
    });

    expect(result).toEqual({
      scanned: 0,
      quarantined: 0,
      passComplete: false,
    });
    expect(syncMetadataUpsertMock).not.toHaveBeenCalled();
  });
});
