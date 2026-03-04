const listCoworkersMock = jest.fn();
const getAvailableAgentsWithCreditsPriceMock = jest.fn();
const listMyJobsForActiveContextPaginatedMock = jest.fn();
const getTasksColumnPageMock = jest.fn();
const mapJobsToTasksViewDataMock = jest.fn();

jest.mock("@/lib/services/coworker.service", () => ({
  coworkerService: {
    listCoworkers: (...args: unknown[]) => listCoworkersMock(...args),
  },
}));

jest.mock("@/lib/services/agent.service", () => ({
  agentService: {
    getAvailableAgentsWithCreditsPrice: (...args: unknown[]) =>
      getAvailableAgentsWithCreditsPriceMock(...args),
  },
}));

jest.mock("@/lib/services/user.service", () => ({
  userService: {
    listMyJobsForActiveContextPaginated: (...args: unknown[]) =>
      listMyJobsForActiveContextPaginatedMock(...args),
  },
}));

jest.mock("../utils/tasks-column-page", () => ({
  getTasksColumnPage: (...args: unknown[]) => getTasksColumnPageMock(...args),
}));

jest.mock(
  "@/app/tasks/utils/jobs-view-data",
  () => ({
    mapJobsToTasksViewData: (...args: unknown[]) =>
      mapJobsToTasksViewDataMock(...args),
  }),
  { virtual: true },
);

import { loadMoreTasksColumn } from "../actions";

describe("loadMoreTasksColumn", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    });

    expect(getTasksColumnPageMock).toHaveBeenCalledTimes(1);
    const callArg = getTasksColumnPageMock.mock.calls[0][0];
    expect(callArg).toMatchObject({
      columnId: "todo",
      cursor: "current-column-cursor",
      limit: 20,
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
