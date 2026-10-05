import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { listRunsMock } = vi.hoisted(() => ({ listRunsMock: vi.fn() }));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: { listTaskScheduleRuns: listRunsMock },
  CoreApiRequestError: class extends Error {},
}));

import { taskScheduleService } from "./task-schedule.service";

describe("Task Schedule Run lists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads beyond archived Tasks' ledger rows to find current manual Tasks", async () => {
    const archivedRuns = Array.from({ length: 100 }, (_, index) => ({
      id: `archived-run-${index}`,
      releasedTaskId: `archived-task-${index}`,
      manual: true,
    }));
    const currentRun = {
      id: "current-run",
      releasedTaskId: "current-task",
      manual: true,
    };
    listRunsMock
      .mockResolvedValueOnce({
        data: archivedRuns,
        meta: { pagination: { nextCursor: "archived-run-99" } },
      })
      .mockResolvedValueOnce({
        data: [currentRun],
        meta: { pagination: { nextCursor: null } },
      });
    const from = new Date("2026-09-01T00:00:00Z");

    const runs = await taskScheduleService.listManualRuns("schedule", {
      from,
      limit: 100,
    });

    expect(runs).toContainEqual(currentRun);
    expect(listRunsMock).toHaveBeenCalledTimes(2);
    // No upper bound: a Run now made a moment ago carries Core's clock.
    expect(listRunsMock).toHaveBeenNthCalledWith(1, "schedule", {
      from,
      manual: "true",
      limit: 100,
      cursor: undefined,
    });
    expect(listRunsMock).toHaveBeenNthCalledWith(2, "schedule", {
      from,
      manual: "true",
      limit: 100,
      cursor: "archived-run-99",
    });
  });

  it("keeps manual Runs out of the upcoming rule list", async () => {
    listRunsMock.mockResolvedValue({ data: [] });
    const from = new Date("2026-10-01T00:00:00Z");

    await taskScheduleService.listUpcomingRuns("schedule", {
      from,
      limit: 100,
    });

    expect(listRunsMock).toHaveBeenCalledWith("schedule", {
      from,
      manual: "false",
      limit: 100,
    });
  });
});
