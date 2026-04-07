import { beforeEach, describe, expect, it, vi } from "vitest";

const listCoworkersMock = vi.fn();
const getAvailableAgentsWithCreditsPriceMock = vi.fn();
const getTasksColumnPageMock = vi.fn();
const listMyJobsForActiveContextPaginatedMock = vi.fn();
const mapJobsToTasksViewDataMock = vi.fn();

vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: {
    listCoworkers: (...args: unknown[]) => listCoworkersMock(...args),
  },
}));

vi.mock("@/lib/services/agent.service", () => ({
  agentService: {
    getAvailableAgentsWithCreditsPrice: (...args: unknown[]) =>
      getAvailableAgentsWithCreditsPriceMock(...args),
  },
}));

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    listMyJobsForActiveContextPaginated: (...args: unknown[]) =>
      listMyJobsForActiveContextPaginatedMock(...args),
  },
}));

vi.mock("../utils/tasks-column-page", () => ({
  getTasksColumnPage: (...args: unknown[]) => getTasksColumnPageMock(...args),
}));

vi.mock("../utils/jobs-view-data", () => ({
  mapJobsToTasksViewData: (...args: unknown[]) =>
    mapJobsToTasksViewDataMock(...args),
}));

import { loadMoreJobs, loadMoreTasksColumn } from "../actions";

describe("loadMoreTasksColumn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads one column page and returns mapped cursor result", async () => {
    const coworker = { id: "coworker-1", name: "Coworker" };
    const agent = { id: "agent-1", name: "Agent" };
    const tasks = [
      {
        id: "task-1",
        name: "Task 1",
      },
    ];

    listCoworkersMock.mockResolvedValue([coworker]);
    getAvailableAgentsWithCreditsPriceMock.mockResolvedValue([agent]);
    getTasksColumnPageMock.mockResolvedValue({
      tasks,
      nextCursor: "next-column-cursor",
    });

    const result = await loadMoreTasksColumn({
      columnId: "todo",
      cursor: "current-column-cursor",
      coworkerId: "coworker-1",
    });

    expect(getTasksColumnPageMock).toHaveBeenCalledTimes(1);
    const callArg = getTasksColumnPageMock.mock.calls[0][0];
    expect(callArg).toMatchObject({
      columnId: "todo",
      cursor: "current-column-cursor",
      limit: 20,
      coworkerId: "coworker-1",
    });
    expect(callArg.coworkersById).toBeInstanceOf(Map);
    expect(callArg.agentsById).toBeInstanceOf(Map);
    expect(callArg.coworkersById.get(coworker.id)).toEqual(coworker);
    expect(callArg.agentsById.get(agent.id)).toEqual(agent);
    expect(result).toEqual({
      tasks,
      nextCursor: "next-column-cursor",
    });
  });
});

describe("loadMoreJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads jobs through the core-backed user service and maps previews", async () => {
    const coworker = { id: "coworker-1", name: "Coworker" };
    const agent = { id: "agent-1", name: "Agent", icon: "icon.png" };

    listCoworkersMock.mockResolvedValue([coworker]);
    getAvailableAgentsWithCreditsPriceMock.mockResolvedValue([agent]);
    listMyJobsForActiveContextPaginatedMock.mockResolvedValue({
      jobs: [{ id: "job-1", agentId: "agent-1", userId: "user-1" }],
      nextCursor: "next-jobs-cursor",
    });
    mapJobsToTasksViewDataMock.mockResolvedValue({
      jobs: [{ id: "job-1" }],
      agentPreviewById: {
        "agent-1": {
          name: "Agent",
          icon: "icon.png",
        },
      },
    });

    const result = await loadMoreJobs({
      cursor: "job-cursor",
      memberId: "user-2",
      agentId: "agent-1",
      jobStatus: "COMPLETED",
      memberPreviews: [
        {
          id: "user-1",
          name: "Me",
          image: null,
        },
      ],
    });

    expect(listMyJobsForActiveContextPaginatedMock).toHaveBeenCalledWith({
      cursor: "job-cursor",
      limit: 20,
      memberId: "user-2",
      agentId: "agent-1",
      status: "COMPLETED",
    });
    expect(mapJobsToTasksViewDataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobs: [{ id: "job-1", agentId: "agent-1", userId: "user-1" }],
        coworkersById: expect.any(Map),
        memberPreviewByUserId: expect.any(Map),
        agentPreviewSeedById: expect.any(Map),
      }),
    );
    expect(result).toEqual({
      jobs: [{ id: "job-1" }],
      nextCursor: "next-jobs-cursor",
      agentPreviewById: {
        "agent-1": {
          name: "Agent",
          icon: "icon.png",
        },
      },
    });
  });
});
