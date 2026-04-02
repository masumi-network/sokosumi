import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const coreClientMock = {
  getAgentById: vi.fn(),
  getCoworkers: vi.fn(),
  getJobById: vi.fn(),
  getJobs: vi.fn(),
  getTaskById: vi.fn(),
  getTasks: vi.fn(),
};

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: coreClientMock,
}));

describe("feed.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coreClientMock.getCoworkers.mockResolvedValue({ data: [] });
    coreClientMock.getJobs.mockResolvedValue({
      data: [],
      meta: { pagination: { nextCursor: null } },
    });
    coreClientMock.getTasks.mockResolvedValue({
      data: [],
      meta: { pagination: { nextCursor: null } },
    });
    coreClientMock.getAgentById.mockResolvedValue({ data: null });
  });

  it("loads feed jobs without a scope query", async () => {
    const { feedService } = await import("../feed.service");
    await feedService.getMyFeedInitialPool({ limitPerSource: 5 });

    expect(coreClientMock.getJobs).toHaveBeenCalledWith({
      status: "COMPLETED",
      cursor: undefined,
      limit: 5,
    });
  });

  it("fetches individual feed jobs without shared scope", async () => {
    coreClientMock.getJobById.mockResolvedValue({
      data: {
        id: "job-1",
        agentId: "agent-1",
        name: "Job 1",
        status: "completed",
        result: "# Heading\n\nResult body",
        completedAt: "2026-02-13T10:00:00.000Z",
        updatedAt: "2026-02-13T10:00:00.000Z",
      },
    });
    coreClientMock.getAgentById.mockResolvedValue({
      data: {
        id: "agent-1",
        name: "Agent 1",
        icon: null,
      },
    });

    const { feedService } = await import("../feed.service");
    const item = await feedService.getMyFeedItemByFeedId("job-job-1");

    expect(coreClientMock.getJobById).toHaveBeenCalledWith("job-1");
    expect(item?.type).toBe("job");
  });

  it("fetches individual feed tasks without shared scope", async () => {
    coreClientMock.getTaskById.mockResolvedValue({
      data: {
        id: "task-1",
        userId: "user-1",
        organizationId: null,
        coworkerId: null,
        name: "Task 1",
        description: "Task body",
        status: "COMPLETED",
        createdAt: "2026-02-13T10:00:00.000Z",
        updatedAt: "2026-02-13T10:00:00.000Z",
        events: [],
        jobs: [],
      },
    });

    const { feedService } = await import("../feed.service");
    const item = await feedService.getMyFeedItemByFeedId("task-task-1");

    expect(coreClientMock.getTaskById).toHaveBeenCalledWith("task-1");
    expect(item?.type).toBe("task");
  });
});
