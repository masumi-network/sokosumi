import { TaskScheduleQuarantineReason, TaskStatus } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

const removeTaskSchedulePlannedOccurrencesMock = vi.hoisted(() => vi.fn());

vi.mock("@/helpers/task-schedule-occurrence-index", () => ({
  removeTaskSchedulePlannedOccurrences:
    removeTaskSchedulePlannedOccurrencesMock,
}));

const { quarantineTaskSchedule } = await import("./task-schedule-quarantine");

describe("quarantineTaskSchedule", () => {
  it("removes planned occurrences after quarantining a schedule", async () => {
    const tx = {
      taskScheduleQuarantine: { upsert: vi.fn().mockResolvedValue({}) },
      taskScheduleOccurrence: { deleteMany: vi.fn() },
    };

    await quarantineTaskSchedule(
      tx,
      {
        id: "task-1",
        metadata: "{broken",
        nextRunAt: new Date("2026-08-28T09:00:00.000Z"),
        status: TaskStatus.QUEUED,
      },
      TaskScheduleQuarantineReason.INVALID_METADATA,
      "metadata failed validation",
    );

    expect(removeTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledWith(
      tx,
      "task-1",
    );
  });
});
