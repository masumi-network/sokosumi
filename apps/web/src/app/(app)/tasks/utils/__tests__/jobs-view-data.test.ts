import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { JobType, SokosumiJobStatus } from "@sokosumi/database";

import type { TaskWithCoworker } from "@/lib/types/task";

import { mapJobsToTasksViewData } from "../jobs-view-data";

const getTaskByIdMock = vi.fn();

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    getTaskById: (...args: unknown[]) => getTaskByIdMock(...args),
  },
}));

function buildJob(taskId: string) {
  return {
    id: "job-1",
    taskId,
    agentId: "agent-1",
    name: "Job 1",
    createdAt: new Date("2026-03-01T10:00:00.000Z"),
    completedAt: null,
    status: SokosumiJobStatus.PROCESSING,
    jobType: JobType.PAID,
    userId: "user-1",
  } as const;
}

describe("mapJobsToTasksViewData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses seedTasksById and skips getTaskById for seeded tasks", async () => {
    const jobs = [buildJob("task-seeded")];
    const coworkersById = new Map<string, TaskWithCoworker["coworker"]>([
      [
        "coworker-1",
        {
          id: "coworker-1",
          name: "Seeded Coworker",
          image: null,
        } as TaskWithCoworker["coworker"],
      ],
    ]);
    const seedTasksById = new Map([
      ["task-seeded", { id: "task-seeded", coworkerId: "coworker-1" }],
    ]);

    const result = await mapJobsToTasksViewData({
      jobs: jobs as never,
      coworkersById,
      memberPreviewByUserId: new Map([
        ["user-1", { name: "Fallback User", image: "fallback.png" }],
      ]),
      agentPreviewSeedById: new Map([
        ["agent-1", { name: "Agent One", icon: null }],
      ]),
      seedTasksById,
    });

    expect(getTaskByIdMock).not.toHaveBeenCalled();
    expect(result.jobs[0]?.coworker?.name).toBe("Seeded Coworker");
  });

  it("falls back to member previews for jobs without a linked task", async () => {
    const result = await mapJobsToTasksViewData({
      jobs: [buildJob("task-missing")] as never,
      coworkersById: new Map(),
      memberPreviewByUserId: new Map([
        ["user-1", { name: "Alice", image: "alice.png" }],
      ]),
      agentPreviewSeedById: new Map([
        ["agent-1", { name: "Agent One", icon: null }],
      ]),
    });

    expect(getTaskByIdMock).toHaveBeenCalledWith("task-missing");
    expect(result.jobs[0]?.coworker).toEqual({
      name: "Alice",
      image: "alice.png",
    });
  });
});
