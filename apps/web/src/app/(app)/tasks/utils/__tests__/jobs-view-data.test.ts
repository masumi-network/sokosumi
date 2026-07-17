import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockCoreAgent } from "@/lib/helpers/__tests__/fixtures/core-agent";

vi.mock("server-only", () => ({}));

import type { TaskWithCoworker } from "@/app/tasks/types/task-board";

import { mapJobsToTasksViewData } from "../jobs-view-data";

const getTaskByIdMock = vi.fn();
const getAgentByIdMock = vi.fn();

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    getTaskById: (...args: unknown[]) => getTaskByIdMock(...args),
  },
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getAgentById: (...args: unknown[]) => getAgentByIdMock(...args),
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
    updatedAt: new Date("2026-03-01T10:00:00.000Z"),
    userId: "user-1",
    organizationId: null,
    status: "processing",
    jobType: "PAID",
    credits: 5,
    onChainStatus: null,
    onChainTransactionHash: null,
    result: null,
    resultHash: null,
    workspace: {
      id: "workspace-1",
      organizationId: null,
      organization: null,
    },
  } as const;
}

describe("mapJobsToTasksViewData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAgentByIdMock.mockResolvedValue({
      data: createMockCoreAgent({
        id: "agent-1",
        name: "Agent One",
        icon: null,
      }),
    });
  });

  it("uses seedTasksById and skips getTaskById for seeded tasks", async () => {
    const jobs = [buildJob("task-seeded")];
    const coworkersById = new Map<string, TaskWithCoworker["assignee"]>([
      [
        "coworker-1",
        {
          id: "coworker-1",
          name: "Seeded Coworker",
          image: null,
        } as TaskWithCoworker["assignee"],
      ],
    ]);
    const seedTasksById = new Map([
      ["task-seeded", { id: "task-seeded", assigneeId: "coworker-1" }],
    ]);

    const result = await mapJobsToTasksViewData({
      jobs: jobs as never,
      coworkersById,
      seedTasksById,
    });

    expect(getTaskByIdMock).not.toHaveBeenCalled();
    expect(getAgentByIdMock).toHaveBeenCalledWith("agent-1");
    expect(result.jobs[0]?.coworker?.name).toBe("Seeded Coworker");
    expect(result.agentPreviewById).toEqual({
      "agent-1": { name: "Agent One", icon: null },
    });
  });

  it("sets coworker to null when the task cannot be resolved", async () => {
    getTaskByIdMock.mockResolvedValue(null);

    const result = await mapJobsToTasksViewData({
      jobs: [buildJob("task-missing")] as never,
      coworkersById: new Map(),
    });

    expect(getTaskByIdMock).toHaveBeenCalledWith("task-missing");
    expect(result.jobs[0]?.coworker).toBeNull();
  });

  it("uses knownAgentsById and skips getAgentById for catalog agents", async () => {
    const jobs = [buildJob("task-seeded")];
    const coworkersById = new Map<string, TaskWithCoworker["assignee"]>([
      [
        "coworker-1",
        {
          id: "coworker-1",
          name: "Seeded Coworker",
          image: null,
        } as TaskWithCoworker["assignee"],
      ],
    ]);
    const seedTasksById = new Map([
      ["task-seeded", { id: "task-seeded", assigneeId: "coworker-1" }],
    ]);
    const preloaded = createMockCoreAgent({
      id: "agent-1",
      name: "Catalog Agent",
      icon: null,
    });

    const result = await mapJobsToTasksViewData({
      jobs: jobs as never,
      coworkersById,
      knownAgentsById: new Map([["agent-1", preloaded]]),
      seedTasksById,
    });

    expect(getAgentByIdMock).not.toHaveBeenCalled();
    expect(result.agentPreviewById).toEqual({
      "agent-1": { name: "Catalog Agent", icon: null },
    });
  });
});
