import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listOccurrencesMock = vi.fn();

vi.mock("@/lib/services/task-schedule.service", () => ({
  taskScheduleService: {
    listOccurrences: (...args: unknown[]) => listOccurrencesMock(...args),
  },
}));

import type { Task } from "@/lib/clients/generated/core";

import { readTaskScheduleSeriesPrecondition } from "./task-schedule-precondition";

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    metadata: null,
    nextRunAt: null,
    scheduleRevision: 4,
    ...overrides,
  } as Task;
}

const ACTIVE_SERIES = {
  metadata: JSON.stringify({ version: 2, mode: "recurring" }),
  nextRunAt: new Date("2026-06-25T09:00:00.000Z"),
};

describe("readTaskScheduleSeriesPrecondition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the revision and exact exception count of a live series", async () => {
    listOccurrencesMock.mockResolvedValue({
      scheduleRevision: 4,
      futureExceptionCount: 3,
      occurrences: [],
      nextCursor: null,
    });

    await expect(
      readTaskScheduleSeriesPrecondition(buildTask(ACTIVE_SERIES)),
    ).resolves.toEqual({ scheduleRevision: 4, futureExceptionCount: 3 });
    expect(listOccurrencesMock).toHaveBeenCalledWith("task-1", {
      view: "upcoming",
      limit: 1,
    });
  });

  it("does not combine a newer ledger revision with stale Task metadata", async () => {
    listOccurrencesMock.mockResolvedValue({
      scheduleRevision: 5,
      futureExceptionCount: 0,
      occurrences: [],
      nextCursor: null,
    });

    await expect(
      readTaskScheduleSeriesPrecondition(buildTask(ACTIVE_SERIES)),
    ).resolves.toEqual({ scheduleRevision: 4, futureExceptionCount: null });
  });

  it("skips the ledger read for a Task with no live rule", async () => {
    await expect(
      readTaskScheduleSeriesPrecondition(buildTask()),
    ).resolves.toEqual({ scheduleRevision: 4, futureExceptionCount: 0 });
    expect(listOccurrencesMock).not.toHaveBeenCalled();
  });

  it("reports an unknown exception count when the read is refused", async () => {
    listOccurrencesMock.mockRejectedValue(new Error("beta access required"));

    await expect(
      readTaskScheduleSeriesPrecondition(buildTask(ACTIVE_SERIES)),
    ).resolves.toEqual({ scheduleRevision: 4, futureExceptionCount: null });
  });

  it("treats a Task without a revision as revision zero", async () => {
    await expect(
      readTaskScheduleSeriesPrecondition(
        buildTask({ scheduleRevision: undefined }),
      ),
    ).resolves.toEqual({ scheduleRevision: 0, futureExceptionCount: 0 });
  });
});
