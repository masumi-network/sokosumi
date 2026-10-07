import { TaskStatus } from "@sokosumi/core-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listCoworkersMock = vi.fn();
const getMineMock = vi.fn();
const getAvailableAgentsWithCreditsPriceMock = vi.fn();
const resolveEffectiveDesignMdMock = vi.fn();
const getTasksColumnPageMock = vi.fn();
const getTasksListPageMock = vi.fn();
const getSessionMock = vi.fn();
const listTaskAssigneeOptionsMock = vi.fn();
const listTaskScheduleAssigneeOptionsMock = vi.fn();
const getProjectFilterOptionsMock = vi.fn();

vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: {
    listCoworkers: (...args: unknown[]) => listCoworkersMock(...args),
  },
}));

vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: {
    getMine: (...args: unknown[]) => getMineMock(...args),
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

vi.mock("./utils/tasks-column-page", () => ({
  getTasksColumnPage: (...args: unknown[]) => getTasksColumnPageMock(...args),
}));

vi.mock("./utils/tasks-list-page", () => ({
  getTasksListPage: (...args: unknown[]) => getTasksListPageMock(...args),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

vi.mock("./utils/task-assignee-options", () => ({
  listTaskAssigneeOptions: (...args: unknown[]) =>
    listTaskAssigneeOptionsMock(...args),
}));

vi.mock("./utils/task-schedule-assignee-options", () => ({
  listTaskScheduleAssigneeOptions: () => listTaskScheduleAssigneeOptionsMock(),
}));

vi.mock("@/lib/helpers/project-filter-options", () => ({
  getProjectFilterOptions: (...args: unknown[]) =>
    getProjectFilterOptionsMock(...args),
}));

import {
  loadCreateTaskModalData,
  loadMoreTasksColumn,
  loadMoreTasksList,
  loadNewTaskWizardOptions,
  loadTaskScheduleDialogOptions,
} from "./actions";

const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

describe("loadTaskScheduleDialogOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTaskScheduleAssigneeOptionsMock.mockResolvedValue([
      { id: "cow-1", kind: "coworker" },
    ]);
    getProjectFilterOptionsMock.mockResolvedValue([]);
  });

  it("uses Core's schedule assignee choices", async () => {
    expect(await loadTaskScheduleDialogOptions()).toMatchObject({
      coworkerOptions: [{ id: "cow-1", kind: "coworker" }],
    });
    expect(listTaskScheduleAssigneeOptionsMock).toHaveBeenCalledOnce();
    expect(listTaskAssigneeOptionsMock).not.toHaveBeenCalled();
  });
});

describe("loadMoreTasksColumn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMineMock.mockResolvedValue(null);
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
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: null,
      projectId: PROJECT_ID,
      visibility: null,
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
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: null,
      projectId: PROJECT_ID,
      visibility: null,
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
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: null,
      projectId: null,
      visibility: null,
    });

    expect(getTasksColumnPageMock).toHaveBeenCalledTimes(1);
    expect(getTasksColumnPageMock.mock.calls[0][0]).toMatchObject({
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
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
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: null,
      projectId: null,
      visibility: null,
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
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: null,
      projectId: null,
      visibility: null,
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
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: "malicious" as never,
      projectId: null,
      visibility: null,
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
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: TaskStatus.READY,
      projectId: null,
      visibility: null,
    });

    expect(getTasksColumnPageMock.mock.calls[0][0]).toMatchObject({
      status: TaskStatus.READY,
    });
  });
});

describe("loadMoreTasksList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMineMock.mockResolvedValue(null);
    getSessionMock.mockResolvedValue({
      session: { activeOrganizationId: "org-1" },
    });
  });

  it("loads one list page without fetching the full agents catalog", async () => {
    const coworker = { id: "coworker-1", name: "Coworker" };
    const tasks = [
      {
        id: "task-1",
        name: "Task 1",
      },
    ];

    listCoworkersMock.mockResolvedValue([coworker]);
    getTasksListPageMock.mockResolvedValue({
      tasks,
      nextCursor: "next-list-cursor",
    });

    const result = await loadMoreTasksList({
      cursor: "current-list-cursor",
      scope: "workspace",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: null,
      projectId: PROJECT_ID,
      visibility: null,
    });

    expect(getAvailableAgentsWithCreditsPriceMock).not.toHaveBeenCalled();
    expect(getTasksListPageMock).toHaveBeenCalledTimes(1);
    const callArg = getTasksListPageMock.mock.calls[0][0];
    expect(callArg).toMatchObject({
      cursor: "current-list-cursor",
      limit: 20,
      scope: "workspace",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: null,
      projectId: PROJECT_ID,
      visibility: null,
    });
    expect(callArg.coworkersById).toBeInstanceOf(Map);
    expect(callArg.coworkersById.get(coworker.id)).toEqual(coworker);
    expect(result).toEqual({
      tasks,
      nextCursor: "next-list-cursor",
    });
  });

  it("ignores assigneeId that is not in the current tasks coworker list", async () => {
    const coworker = { id: "coworker-1", name: "Coworker" };
    listCoworkersMock.mockResolvedValue([coworker]);
    getTasksListPageMock.mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });

    await loadMoreTasksList({
      cursor: null,
      scope: "owned",
      assigneeId: "removed-coworker",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: null,
      projectId: null,
      visibility: null,
    });

    expect(getTasksListPageMock).toHaveBeenCalledTimes(1);
    expect(getTasksListPageMock.mock.calls[0][0]).toMatchObject({
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
    });
  });

  it("falls back to default scope when scope is not a valid TasksScope value", async () => {
    listCoworkersMock.mockResolvedValue([]);
    getTasksListPageMock.mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });

    await loadMoreTasksList({
      cursor: null,
      scope: "malicious" as never,
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: null,
      projectId: null,
      visibility: null,
    });

    expect(getTasksListPageMock.mock.calls[0][0]).toMatchObject({
      scope: "workspace",
    });
  });

  it("rejects workspace scope when there is no active organization", async () => {
    getSessionMock.mockResolvedValue({
      session: { activeOrganizationId: null },
    });
    listCoworkersMock.mockResolvedValue([]);
    getTasksListPageMock.mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });

    await loadMoreTasksList({
      cursor: null,
      scope: "workspace",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: null,
      projectId: null,
      visibility: null,
    });

    expect(getTasksListPageMock.mock.calls[0][0]).toMatchObject({
      scope: "owned",
    });
  });

  it("passes through a valid TaskStatus string", async () => {
    listCoworkersMock.mockResolvedValue([]);
    getTasksListPageMock.mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });

    await loadMoreTasksList({
      cursor: null,
      scope: "owned",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      status: TaskStatus.READY,
      projectId: null,
      visibility: null,
    });

    expect(getTasksListPageMock.mock.calls[0][0]).toMatchObject({
      status: TaskStatus.READY,
    });
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
      owner: { type: "organization", name: "Acme Inc", logo: null },
    });

    getProjectFilterOptionsMock.mockResolvedValue([
      { id: "project-1", name: "Sokosumi" },
    ]);

    const result = await loadCreateTaskModalData();

    expect(result.agentNameById).toEqual({ "agent-1": "Agent One" });
    expect(result.designMdAttachment).toEqual({
      label: "Design",
      url: "https://example.com/design.md",
      owner: { type: "organization", name: "Acme Inc", logo: null },
    });
    expect(result.projectOptions).toEqual([
      { id: "project-1", name: "Sokosumi" },
    ]);
  });

  it("skips design.md when there is no session user", async () => {
    getSessionMock.mockResolvedValue(null);
    getAvailableAgentsWithCreditsPriceMock.mockResolvedValue([]);
    getProjectFilterOptionsMock.mockResolvedValue([]);

    const result = await loadCreateTaskModalData();

    expect(resolveEffectiveDesignMdMock).not.toHaveBeenCalled();
    expect(result.designMdAttachment).toBeNull();
    expect(result.projectOptions).toEqual([]);
  });
});

describe("loadNewTaskWizardOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    });
    listTaskAssigneeOptionsMock.mockResolvedValue([
      { id: "coworker-1", kind: "coworker" },
    ]);
    getProjectFilterOptionsMock.mockResolvedValue([
      { id: "project-1", name: "Project One" },
    ]);
    getAvailableAgentsWithCreditsPriceMock.mockResolvedValue([
      { id: "agent-1", name: "Agent One" },
    ]);
    resolveEffectiveDesignMdMock.mockResolvedValue({
      label: "Design",
      url: "https://example.com/design.md",
      owner: { type: "organization", name: "Acme Inc", logo: null },
    });
  });

  it("loads the workspace's assignees, projects, and create data in one call", async () => {
    const result = await loadNewTaskWizardOptions();

    expect(listTaskAssigneeOptionsMock).toHaveBeenCalledWith("org-1");
    expect(result).toEqual({
      coworkerOptions: [{ id: "coworker-1", kind: "coworker" }],
      projectOptions: [{ id: "project-1", name: "Project One" }],
      agentNameById: { "agent-1": "Agent One" },
      designMdAttachment: {
        label: "Design",
        url: "https://example.com/design.md",
        owner: { type: "organization", name: "Acme Inc", logo: null },
      },
    });
  });

  it("includes the selected project when it is outside the first page", async () => {
    const selectedProject = {
      id: "selected-project",
      name: "Selected project",
      contextMd: "Project context",
    };
    getProjectFilterOptionsMock.mockImplementation(
      async (projectId?: string | null) =>
        projectId === selectedProject.id ? [selectedProject] : [],
    );

    const result = await loadNewTaskWizardOptions(selectedProject.id);

    expect(getProjectFilterOptionsMock).toHaveBeenCalledWith(
      selectedProject.id,
    );
    expect(result.projectOptions).toEqual([selectedProject]);
  });

  it("treats a personal workspace as no organization", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: null },
    });

    await loadNewTaskWizardOptions();

    expect(listTaskAssigneeOptionsMock).toHaveBeenCalledWith(null);
  });
});
