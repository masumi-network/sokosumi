import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getTaskByIdMock = vi.fn();
const listCoworkersMock = vi.fn();
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

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getMyMembersWithOrganizations: (...args: unknown[]) =>
      getMyMembersWithOrganizationsMock(...args),
  },
}));

describe("TaskEditModalPage", () => {
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
        return (key: string) =>
          key === "personalAccount" ? "Personal Account" : key;
      }

      return (key: string, values?: Record<string, unknown>) =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    });
  });

  it("switches workspace before loading modal edit options when the task moved", async () => {
    getTaskByIdMock.mockResolvedValue({
      id: "task_1",
      name: "Task",
      description: "Desc",
      coworkerId: "cow_123",
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

    const { default: TaskEditModalPage } = await import("../page");

    render(
      await TaskEditModalPage({
        params: Promise.resolve({
          taskId: "task_1",
        }),
      }),
    );

    expect(autoContextSwitchMock).toHaveBeenCalledWith({
      activeOrganizationId: "org-current",
      targetOrganizationId: "org-workspace",
      successMessage: 'switchedWorkspace:{"account":"Workspace Org"}',
    });
    expect(listCoworkersMock).not.toHaveBeenCalled();
    expect(getAvailableAgentsWithCreditsPriceMock).not.toHaveBeenCalled();
    expect(taskEditModalMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("auto-context-switch")).toBeInTheDocument();
  });
});
