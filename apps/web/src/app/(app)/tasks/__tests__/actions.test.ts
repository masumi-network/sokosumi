import { beforeEach, describe, expect, it, vi } from "vitest";

const listCoworkersMock = vi.fn();
const getAvailableAgentsWithCreditsPriceMock = vi.fn();
const getTasksColumnPageMock = vi.fn();

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
    listMyJobsForActiveContextPaginated: vi.fn(),
  },
}));

vi.mock("../utils/tasks-column-page", () => ({
  getTasksColumnPage: (...args: unknown[]) => getTasksColumnPageMock(...args),
}));

import { loadMoreTasksColumn } from "../actions";

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
      scope: "workspace",
      coworkerId: "coworker-1",
      status: null,
    });

    expect(getTasksColumnPageMock).toHaveBeenCalledTimes(1);
    const callArg = getTasksColumnPageMock.mock.calls[0][0];
    expect(callArg).toMatchObject({
      columnId: "todo",
      cursor: "current-column-cursor",
      limit: 20,
      scope: "workspace",
      coworkerId: "coworker-1",
      status: null,
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
