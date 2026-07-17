import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getTaskByIdMock = vi.fn();
const listCoworkersMock = vi.fn();
const listProjectsMock = vi.fn();
const getAvailableAgentsWithCreditsPriceMock = vi.fn();
const getSessionMock = vi.fn();
const getMyMembersWithOrganizationsMock = vi.fn();
const getTranslationsMock = vi.fn();
const autoContextSwitchMock = vi.fn();
const taskEditModalMock = vi.fn();
const getCoworkerOptionsMock = vi.fn();
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
  getCoworkerOptions: (...args: unknown[]) => getCoworkerOptionsMock(...args),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/services", () => ({
  agentService: {
    getAvailableAgentsWithCreditsPrice: (...args: unknown[]) =>
      getAvailableAgentsWithCreditsPriceMock(...args),
  },
}));

vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: {
    listCoworkers: (...args: unknown[]) => listCoworkersMock(...args),
  },
}));

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    getTaskById: (...args: unknown[]) => getTaskByIdMock(...args),
  },
}));

vi.mock("@/lib/services/project.service", () => ({
  projectService: {
    listProjects: (...args: unknown[]) => listProjectsMock(...args),
    getProjectById: vi.fn(),
  },
}));

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getMyMembersWithOrganizations: (...args: unknown[]) =>
      getMyMembersWithOrganizationsMock(...args),
  },
}));

describe("EditTaskPage", () => {
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
    getCoworkerOptionsMock.mockReturnValue([
      { value: "cow_123", label: "Coworker" },
    ]);
    buildAgentNameByIdMock.mockReturnValue({
      agent_123: "Agent",
    });
  });

  it("switches workspace before loading edit options when the task moved", async () => {
    getTaskByIdMock.mockResolvedValue({
      id: "task_1",
      name: "Task",
      description: "Desc",
      assigneeId: "cow_123",
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

    const { default: EditTaskPage } = await import("../page");

    render(
      await EditTaskPage({
        params: Promise.resolve({
          taskId: "task_1",
        }),
      }),
    );

    expect(autoContextSwitchMock).toHaveBeenCalledWith({
      activeOrganizationId: null,
      targetOrganizationId: "org-workspace",
      successMessage: 'switchedWorkspace:{"account":"Workspace Org"}',
    });
    expect(listCoworkersMock).not.toHaveBeenCalled();
    expect(getAvailableAgentsWithCreditsPriceMock).not.toHaveBeenCalled();
    expect(taskEditModalMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("auto-context-switch")).toBeInTheDocument();
  });

  it("renders the edit modal once the active workspace is aligned", async () => {
    getTaskByIdMock.mockResolvedValue({
      id: "task_1",
      name: "Task",
      description: "Desc",
      assigneeId: "cow_123",
      status: "READY",
      workspace: {
        organizationId: "org-current",
      },
    });
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: "org-current",
      },
    });
    listCoworkersMock.mockResolvedValue([{ id: "cow_123", name: "Coworker" }]);
    listProjectsMock.mockResolvedValue({
      projects: [{ id: "project_1", name: "Project" }],
      pagination: { nextCursor: null },
    });
    getAvailableAgentsWithCreditsPriceMock.mockResolvedValue([
      { id: "agent_123", name: "Agent" },
    ]);

    const { default: EditTaskPage } = await import("../page");

    render(
      await EditTaskPage({
        params: Promise.resolve({
          taskId: "task_1",
        }),
      }),
    );

    expect(autoContextSwitchMock).not.toHaveBeenCalled();
    expect(listCoworkersMock).toHaveBeenCalledWith("tasks");
    expect(listProjectsMock).toHaveBeenCalledWith({ limit: 100 });
    expect(getAvailableAgentsWithCreditsPriceMock).toHaveBeenCalled();
    expect(taskEditModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task_1",
        coworkerOptions: [{ value: "cow_123", label: "Coworker" }],
        projectOptions: [{ id: "project_1", name: "Project" }],
        agentNameById: {
          agent_123: "Agent",
        },
        initialValues: {
          name: "Task",
          description: "Desc",
          assigneeId: "cow_123",
          projectId: null,
          status: "READY",
          metadata: undefined,
          nextRunAt: null,
        },
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
      status: "QUEUED",
      metadata: { schedule: { mode: "daily", timezone: "UTC" } },
      nextRunAt: new Date("2026-06-25T09:00:00.000Z"),
      workspace: {
        organizationId: "org-current",
      },
    });
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: "org-current",
      },
    });
    listCoworkersMock.mockResolvedValue([{ id: "cow_123", name: "Coworker" }]);
    listProjectsMock.mockResolvedValue({
      projects: [],
      pagination: { nextCursor: null },
    });
    getAvailableAgentsWithCreditsPriceMock.mockResolvedValue([]);

    const { default: EditTaskPage } = await import("../page");

    render(
      await EditTaskPage({
        params: Promise.resolve({
          taskId: "task_1",
        }),
      }),
    );

    expect(redirectMock).not.toHaveBeenCalled();
    expect(taskEditModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialValues: expect.objectContaining({
          status: "QUEUED",
        }),
      }),
    );
    expect(screen.getByTestId("task-edit-modal")).toBeInTheDocument();
  });
});
