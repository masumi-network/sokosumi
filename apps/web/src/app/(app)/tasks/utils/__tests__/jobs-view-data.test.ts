jest.mock("server-only", () => ({}));

import { SokosumiJobStatus } from "@sokosumi/database";

import type { TaskWithCoworker } from "@/lib/types/task";

import { mapJobsToTasksViewData } from "../jobs-view-data";

const getTaskByIdMock = jest.fn();

jest.mock("@/lib/services/task.service", () => ({
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
    jobType: "PAID",
    user: {
      name: "Fallback User",
      image: "fallback.png",
    },
    agent: {
      name: "Agent One",
      title: "Agent One",
      icon: null,
      customIconImageUrl: null,
    },
  } as const;
}

describe("mapJobsToTasksViewData", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      seedTasksById,
    });

    expect(getTaskByIdMock).not.toHaveBeenCalled();
    expect(result.jobs[0]?.coworker?.name).toBe("Seeded Coworker");
  });
});
