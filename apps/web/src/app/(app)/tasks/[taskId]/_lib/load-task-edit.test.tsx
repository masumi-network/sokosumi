import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getTaskByIdMock = vi.fn();
const listTaskAssigneeOptionsMock = vi.fn();
const getProjectFilterOptionsMock = vi.fn();
const getAvailableAgentsWithCreditsPriceMock = vi.fn();
const resolveEffectiveDesignMdMock = vi.fn();
const getSessionMock = vi.fn();
const getMyMembersWithOrganizationsMock = vi.fn();
const getTranslationsMock = vi.fn();
const autoContextSwitchMock = vi.fn();
const taskEditModalMock = vi.fn();
const buildAgentNameByIdMock = vi.fn();
const notFoundMock = vi.fn();
const redirectMock = vi.fn();

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: (path: string) => redirectMock(path),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: (...args: unknown[]) => getTranslationsMock(...args),
}));

vi.mock("@/app/components/auto-context-switch", () => ({
  AutoContextSwitch: (props: unknown) => {
    autoContextSwitchMock(props);
    return <div data-testid="auto-context-switch" />;
  },
}));

vi.mock("@/app/tasks/components/task-edit-modal", () => ({
  TaskEditModal: (props: unknown) => {
    taskEditModalMock(props);
    return <div data-testid="task-edit-modal" />;
  },
}));

vi.mock("@/app/tasks/utils/agent-names", () => ({
  buildAgentNameById: (...args: unknown[]) => buildAgentNameByIdMock(...args),
}));

vi.mock("@/app/tasks/utils/coworker-options", () => ({
  getUserOptions: () => [],
  withOwnerSokoBotOption: (options: unknown) => options,
  withCurrentTaskAssigneeOption: (options: unknown) => options,
  taskFormAssigneeId: (task: { assigneeId?: string | null }) =>
    task.assigneeId ?? "",
}));

vi.mock("@/app/tasks/utils/task-assignee-options", () => ({
  listTaskAssigneeOptions: (...args: unknown[]) =>
    listTaskAssigneeOptionsMock(...args),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/services/agent.service", () => ({
  agentService: {
    getAvailableAgentsWithCreditsPrice: (...args: unknown[]) =>
      getAvailableAgentsWithCreditsPriceMock(...args),
  },
}));

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    getTaskById: (...args: unknown[]) => getTaskByIdMock(...args),
  },
}));

vi.mock("@/lib/helpers/project-filter-options", () => ({
  getProjectFilterOptions: (...args: unknown[]) =>
    getProjectFilterOptionsMock(...args),
}));

vi.mock("@/lib/services/design-md.service", () => ({
  designMdService: {
    resolveEffectiveDesignMd: (...args: unknown[]) =>
      resolveEffectiveDesignMdMock(...args),
  },
}));

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getMyMembersWithOrganizations: (...args: unknown[]) =>
      getMyMembersWithOrganizationsMock(...args),
  },
}));

async function renderTaskEdit(taskId = "task_1") {
  const { loadTaskEdit, TaskEditView } = await import("./load-task-edit");
  const result = await loadTaskEdit(taskId);
  return render(<TaskEditView result={result} />);
}

describe("loadTaskEdit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notFoundMock.mockImplementation(() => {
      throw new Error("notFound");
    });
    redirectMock.mockImplementation((path: string) => {
      throw new Error(`redirect:${path}`);
    });
    getTranslationsMock.mockImplementation(async (namespace: string) => {
      if (namespace === "Components.OrganizationSwitcher") {
        const translator = (key: string) =>
          key === "personalAccount" ? "Personal Account" : key;
        translator.raw = (key: string) => key;
        return translator;
      }

      const translator = (key: string, values?: Record<string, unknown>) =>
        values ? `${key}:${JSON.stringify(values)}` : key;
      translator.raw = (key: string) => key;
      return translator;
    });
    listTaskAssigneeOptionsMock.mockResolvedValue([
      { value: "cow_123", label: "Coworker" },
    ]);
    buildAgentNameByIdMock.mockReturnValue({
      agent_123: "Agent",
    });
    getProjectFilterOptionsMock.mockResolvedValue([
      { id: "project_1", name: "Project" },
    ]);
  });

  it("switches workspace before loading edit options when the task moved", async () => {
    getTaskByIdMock.mockResolvedValue({
      id: "task_1",
      name: "Task",
      description: "Desc",
      assigneeId: "cow_123",
      assigneeSokoBotId: null,
      status: "READY",
      workspace: {
        organizationId: "org-workspace",
      },
    });
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: null,
      },
    });
    getMyMembersWithOrganizationsMock.mockResolvedValue([
      {
        organizationId: "org-workspace",
        organization: { id: "org-workspace", name: "Workspace Org" },
      },
    ]);

    await renderTaskEdit();

    expect(autoContextSwitchMock).toHaveBeenCalledWith({
      activeOrganizationId: null,
      targetOrganizationId: "org-workspace",
      successMessage: 'switchedWorkspace:{"account":"Workspace Org"}',
    });
    expect(listTaskAssigneeOptionsMock).not.toHaveBeenCalled();
    expect(getAvailableAgentsWithCreditsPriceMock).not.toHaveBeenCalled();
    expect(getProjectFilterOptionsMock).not.toHaveBeenCalled();
    expect(taskEditModalMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("auto-context-switch")).toBeInTheDocument();
  });

  it("switches workspace when the intercepted modal opens in the wrong org", async () => {
    getTaskByIdMock.mockResolvedValue({
      id: "task_1",
      name: "Task",
      description: "Desc",
      assigneeId: "cow_123",
      assigneeSokoBotId: null,
      status: "DRAFT",
      workspace: {
        organizationId: "org-workspace",
      },
    });
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: "org-current",
      },
    });
    getMyMembersWithOrganizationsMock.mockResolvedValue([
      {
        organizationId: "org-workspace",
        organization: { id: "org-workspace", name: "Workspace Org" },
      },
    ]);

    await renderTaskEdit();

    expect(autoContextSwitchMock).toHaveBeenCalledWith({
      activeOrganizationId: "org-current",
      targetOrganizationId: "org-workspace",
      successMessage: 'switchedWorkspace:{"account":"Workspace Org"}',
    });
    expect(taskEditModalMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("auto-context-switch")).toBeInTheDocument();
  });

  it("renders the edit modal once the active workspace is aligned", async () => {
    getTaskByIdMock.mockResolvedValue({
      id: "task_1",
      name: "Task",
      description: "Desc",
      assigneeId: "cow_123",
      assigneeSokoBotId: null,
      status: "READY",
      workspace: {
        organizationId: "org-current",
      },
    });
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: "org-current",
      },
      user: { id: "user_1" },
    });
    getAvailableAgentsWithCreditsPriceMock.mockResolvedValue([
      { id: "agent_123", name: "Agent" },
    ]);
    resolveEffectiveDesignMdMock.mockResolvedValue({
      label: "DESIGN.md",
      url: "https://blob.example/design.md",
      owner: { type: "organization", name: "Acme", logo: null },
    });

    await renderTaskEdit();

    expect(autoContextSwitchMock).not.toHaveBeenCalled();
    expect(listTaskAssigneeOptionsMock).toHaveBeenCalledWith("org-current");
    expect(getProjectFilterOptionsMock).toHaveBeenCalledWith(null);
    expect(getAvailableAgentsWithCreditsPriceMock).toHaveBeenCalled();
    expect(resolveEffectiveDesignMdMock).toHaveBeenCalled();
    expect(taskEditModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task_1",
        coworkerOptions: [{ value: "cow_123", label: "Coworker" }],
        projectOptions: [{ id: "project_1", name: "Project" }],
        agentNameById: {
          agent_123: "Agent",
        },
        initialDesignMdAttachment: {
          label: "DESIGN.md",
          url: "https://blob.example/design.md",
          owner: { type: "organization", name: "Acme", logo: null },
        },
        initialValues: expect.objectContaining({
          name: "Task",
          description: "Desc",
          assigneeId: "cow_123",
          assigneeSokoBotId: null,
          assigneeUserId: null,
          projectId: null,
          status: "READY",
          runAt: null,
        }),
      }),
    );
    expect(screen.getByTestId("task-edit-modal")).toBeInTheDocument();
  });

  it("renders the edit modal for a queued task", async () => {
    getTaskByIdMock.mockResolvedValue({
      id: "task_1",
      name: "Scheduled task",
      description: "Desc",
      assigneeId: "cow_123",
      assigneeSokoBotId: null,
      status: "QUEUED",
      runAt: new Date("2030-06-25T09:00:00.000Z"),
      workspace: {
        organizationId: "org-current",
      },
    });
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: "org-current",
      },
      user: { id: "user_1" },
    });
    getProjectFilterOptionsMock.mockResolvedValue([]);
    getAvailableAgentsWithCreditsPriceMock.mockResolvedValue([]);
    resolveEffectiveDesignMdMock.mockResolvedValue(null);

    await renderTaskEdit();

    expect(redirectMock).not.toHaveBeenCalled();
    expect(taskEditModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialValues: expect.objectContaining({
          status: "QUEUED",
          runAt: "2030-06-25T09:00:00.000Z",
        }),
      }),
    );
    expect(screen.getByTestId("task-edit-modal")).toBeInTheDocument();
  });

  it("loads project options for the task's selected project", async () => {
    getTaskByIdMock.mockResolvedValue({
      id: "task_1",
      name: "Task",
      description: "Desc",
      assigneeId: "cow_123",
      assigneeSokoBotId: null,
      status: "READY",
      projectId: "project_selected",
      workspace: {
        organizationId: "org-current",
      },
    });
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: "org-current",
      },
      user: { id: "user_1" },
    });
    getProjectFilterOptionsMock.mockResolvedValue([
      { id: "project_selected", name: "Selected" },
    ]);
    getAvailableAgentsWithCreditsPriceMock.mockResolvedValue([]);
    resolveEffectiveDesignMdMock.mockResolvedValue(null);

    await renderTaskEdit();

    expect(getProjectFilterOptionsMock).toHaveBeenCalledWith(
      "project_selected",
    );
    expect(taskEditModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectOptions: [{ id: "project_selected", name: "Selected" }],
        initialValues: expect.objectContaining({
          projectId: "project_selected",
        }),
      }),
    );
  });
});
