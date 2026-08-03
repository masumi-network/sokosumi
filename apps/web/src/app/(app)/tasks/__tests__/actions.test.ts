import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentJobStatus, TaskStatus } from "@/lib/clients/generated/core";

const listCoworkersMock = vi.fn();
const getAvailableAgentsWithCreditsPriceMock = vi.fn();
const resolveEffectiveDesignMdMock = vi.fn();
const getTasksColumnPageMock = vi.fn();
const listJobsMock = vi.fn();
const mapJobsToTasksViewDataMock = vi.fn();
const getSessionMock = vi.fn();

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

vi.mock("@/lib/services/design-md.service", () => ({
  designMdService: {
    resolveEffectiveDesignMd: (...args: unknown[]) =>
      resolveEffectiveDesignMdMock(...args),
  },
}));

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    listJobs: (...args: unknown[]) => listJobsMock(...args),
  },
}));

vi.mock("@/app/tasks/utils/jobs-view-data", () => ({
  mapJobsToTasksViewData: (...args: unknown[]) =>
    mapJobsToTasksViewDataMock(...args),
}));

vi.mock("../utils/tasks-column-page", () => ({
  getTasksColumnPage: (...args: unknown[]) => getTasksColumnPageMock(...args),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

import {
  loadCreateTaskModalData,
  loadJobsTabData,
  loadMoreJobs,
  loadMoreTasksColumn,
} from "../actions";

const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

describe("loadMoreTasksColumn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      session: { activeOrganizationId: "org-1" },
    });
  });

  it("loads one column page without fetching the full agents catalog", async () => {
    const coworker = { id: "coworker-1", name: "Coworker" };
    const tasks = [
      {
        id: "task-1",
        name: "Task 1",
      },
    ];

    listCoworkersMock.mockResolvedValue([coworker]);
    getTasksColumnPageMock.mockResolvedValue({
      tasks,
      nextCursor: "next-column-cursor",
    });

    const result = await loadMoreTasksColumn({
      columnId: "todo",
      cursor: "current-column-cursor",
      scope: "workspace",
      assigneeId: "coworker-1",
      status: null,
      projectId: PROJECT_ID,
    });

    expect(getAvailableAgentsWithCreditsPriceMock).not.toHaveBeenCalled();
    expect(getTasksColumnPageMock).toHaveBeenCalledTimes(1);
    const callArg = getTasksColumnPageMock.mock.calls[0][0];
    expect(callArg).toMatchObject({
      columnId: "todo",
      cursor: "current-column-cursor",
      limit: 20,
      scope: "workspace",
      assigneeId: "coworker-1",
      status: null,
      projectId: PROJECT_ID,
    });
    expect(callArg.coworkersById).toBeInstanceOf(Map);
    expect(callArg.coworkersById.get(coworker.id)).toEqual(coworker);
    expect(result).toEqual({
      tasks,
      nextCursor: "next-column-cursor",
    });
  });

  it("ignores assigneeId that is not in the current tasks coworker list", async () => {
    const coworker = { id: "coworker-1", name: "Coworker" };
    listCoworkersMock.mockResolvedValue([coworker]);
    getTasksColumnPageMock.mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });

    await loadMoreTasksColumn({
      columnId: "todo",
      cursor: null,
      scope: "owned",
      assigneeId: "removed-coworker",
      status: null,
      projectId: null,
    });

    expect(getTasksColumnPageMock).toHaveBeenCalledTimes(1);
    expect(getTasksColumnPageMock.mock.calls[0][0]).toMatchObject({
      assigneeId: null,
    });
  });

  it("falls back to default scope when scope is not a valid TasksScope value", async () => {
    listCoworkersMock.mockResolvedValue([]);
    getTasksColumnPageMock.mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });

    await loadMoreTasksColumn({
      columnId: "todo",
      cursor: null,
      scope: "malicious" as never,
      assigneeId: null,
      status: null,
      projectId: null,
    });

    // Default session has an active org (org-1), so the fallback is now
    // workspace, not owned.
    expect(getTasksColumnPageMock.mock.calls[0][0]).toMatchObject({
      scope: "workspace",
    });
  });

  it("rejects workspace scope when there is no active organization", async () => {
    getSessionMock.mockResolvedValue({
      session: { activeOrganizationId: null },
    });
    listCoworkersMock.mockResolvedValue([]);
    getTasksColumnPageMock.mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });

    await loadMoreTasksColumn({
      columnId: "todo",
      cursor: null,
      scope: "workspace",
      assigneeId: null,
      status: null,
      projectId: null,
    });

    expect(getTasksColumnPageMock.mock.calls[0][0]).toMatchObject({
      scope: "owned",
    });
  });

  it("ignores status that is not a valid TaskStatus value", async () => {
    listCoworkersMock.mockResolvedValue([]);
    getTasksColumnPageMock.mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });

    await loadMoreTasksColumn({
      columnId: "todo",
      cursor: null,
      scope: "owned",
      assigneeId: null,
      status: "malicious" as never,
      projectId: null,
    });

    expect(getTasksColumnPageMock.mock.calls[0][0]).toMatchObject({
      status: null,
    });
  });

  it("passes through a valid TaskStatus string", async () => {
    listCoworkersMock.mockResolvedValue([]);
    getTasksColumnPageMock.mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });

    await loadMoreTasksColumn({
      columnId: "todo",
      cursor: null,
      scope: "owned",
      assigneeId: null,
      status: TaskStatus.READY,
      projectId: null,
    });

    expect(getTasksColumnPageMock.mock.calls[0][0]).toMatchObject({
      status: TaskStatus.READY,
    });
  });
});

describe("loadMoreJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      session: { activeOrganizationId: "org-1" },
    });
  });

  it("loads jobs from taskService without prefetching the agents catalog", async () => {
    const coworkers = [{ id: "coworker-1", name: "Coworker" }];
    const jobsPage = {
      jobs: [{ id: "job-1" }],
      pagination: {
        cursor: null,
        limit: 20,
        total: 1,
        nextCursor: "job-2",
      },
    };
    const mappedJobs = [{ id: "job-1" }];
    const agentPreviewById = {
      "agent-1": { name: "Agent", icon: null },
    };

    listCoworkersMock.mockResolvedValue(coworkers);
    listJobsMock.mockResolvedValue(jobsPage);
    mapJobsToTasksViewDataMock.mockResolvedValue({
      jobs: mappedJobs,
      agentPreviewById,
    });

    const result = await loadMoreJobs(
      "job-1",
      "workspace",
      "agent-1",
      AgentJobStatus.RUNNING,
      PROJECT_ID,
    );

    expect(getAvailableAgentsWithCreditsPriceMock).not.toHaveBeenCalled();
    expect(listJobsMock).toHaveBeenCalledWith({
      scope: "workspace",
      agentId: "agent-1",
      status: AgentJobStatus.RUNNING,
      projectId: PROJECT_ID,
      cursor: "job-1",
      limit: 20,
    });
    expect(mapJobsToTasksViewDataMock).toHaveBeenCalledWith({
      jobs: jobsPage.jobs,
      coworkersById: new Map([["coworker-1", coworkers[0]]]),
    });
    expect(result).toEqual({
      jobs: mappedJobs,
      nextCursor: "job-2",
      agentPreviewById,
    });
  });

  it("falls back to owned jobs when workspace scope is requested without an organization", async () => {
    getSessionMock.mockResolvedValue({
      session: { activeOrganizationId: null },
    });
    listCoworkersMock.mockResolvedValue([]);
    listJobsMock.mockResolvedValue({
      jobs: [],
      pagination: null,
    });
    mapJobsToTasksViewDataMock.mockResolvedValue({
      jobs: [],
      agentPreviewById: {},
    });

    await loadMoreJobs(null, "workspace", null, null, null);

    expect(listJobsMock).toHaveBeenCalledWith({
      scope: "owned",
      agentId: undefined,
      status: undefined,
      projectId: undefined,
      cursor: null,
      limit: 20,
    });
  });

  it("keeps agent filter for pagination when agent is not in the availability catalog", async () => {
    listCoworkersMock.mockResolvedValue([]);
    listJobsMock.mockResolvedValue({
      jobs: [],
      pagination: null,
    });
    mapJobsToTasksViewDataMock.mockResolvedValue({
      jobs: [],
      agentPreviewById: {},
    });

    await loadMoreJobs(
      null,
      "workspace",
      "offline-agent",
      "not-a-status" as never,
      null,
    );

    expect(listJobsMock).toHaveBeenCalledWith({
      scope: "workspace",
      agentId: "offline-agent",
      status: undefined,
      projectId: undefined,
      cursor: null,
      limit: 20,
    });
  });

  it("drops invalid job status and rejects oversized agent id before loading more jobs", async () => {
    listCoworkersMock.mockResolvedValue([]);
    listJobsMock.mockResolvedValue({
      jobs: [],
      pagination: null,
    });
    mapJobsToTasksViewDataMock.mockResolvedValue({
      jobs: [],
      agentPreviewById: {},
    });

    const tooLongAgentId = "a".repeat(129);

    await loadMoreJobs(
      null,
      "workspace",
      tooLongAgentId,
      "not-a-status" as never,
      null,
    );

    expect(listJobsMock).toHaveBeenCalledWith({
      scope: "workspace",
      agentId: undefined,
      status: undefined,
      projectId: undefined,
      cursor: null,
      limit: 20,
    });
  });
});

describe("loadJobsTabData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      session: { activeOrganizationId: "org-1" },
      user: { id: "user-1" },
    });
  });

  it("returns first jobs page, agent filter options, and previews", async () => {
    const coworkers = [{ id: "coworker-1", name: "Coworker" }];
    const agents = [
      {
        id: "agent-1",
        name: "Agent One",
        icon: null,
      },
    ];
    const jobsPage = {
      jobs: [{ id: "job-1", agentId: "agent-1" }],
      pagination: { nextCursor: "job-2" },
    };

    listCoworkersMock.mockResolvedValue(coworkers);
    getAvailableAgentsWithCreditsPriceMock.mockResolvedValue(agents);
    listJobsMock.mockResolvedValue(jobsPage);
    mapJobsToTasksViewDataMock.mockResolvedValue({
      jobs: [{ id: "job-1" }],
      agentPreviewById: {
        "agent-1": { name: "Agent One", icon: null },
      },
    });

    const result = await loadJobsTabData(
      "workspace",
      "agent-1",
      AgentJobStatus.RUNNING,
      PROJECT_ID,
    );

    expect(listJobsMock).toHaveBeenCalledWith({
      scope: "workspace",
      agentId: "agent-1",
      status: AgentJobStatus.RUNNING,
      projectId: PROJECT_ID,
      cursor: null,
      limit: 20,
    });
    expect(result.jobAgentOptions).toEqual([
      { id: "agent-1", name: "Agent One", image: null },
    ]);
    expect(result.jobs).toEqual([{ id: "job-1" }]);
    expect(result.nextCursor).toBe("job-2");
  });
});

describe("loadCreateTaskModalData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads agent names and design.md attachment for signed-in users", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
    });
    getAvailableAgentsWithCreditsPriceMock.mockResolvedValue([
      { id: "agent-1", name: "Agent One" },
    ]);
    resolveEffectiveDesignMdMock.mockResolvedValue({
      label: "Design",
      url: "https://example.com/design.md",
      owner: { type: "organization", name: "Acme Inc" },
    });

    const result = await loadCreateTaskModalData();

    expect(result.agentNameById).toEqual({ "agent-1": "Agent One" });
    expect(result.designMdAttachment).toEqual({
      label: "Design",
      url: "https://example.com/design.md",
      owner: { type: "organization", name: "Acme Inc" },
    });
  });

  it("skips design.md when there is no session user", async () => {
    getSessionMock.mockResolvedValue(null);
    getAvailableAgentsWithCreditsPriceMock.mockResolvedValue([]);

    const result = await loadCreateTaskModalData();

    expect(resolveEffectiveDesignMdMock).not.toHaveBeenCalled();
    expect(result.designMdAttachment).toBeNull();
  });
});
