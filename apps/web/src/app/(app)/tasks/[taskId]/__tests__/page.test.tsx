import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getTaskByIdMock = vi.fn();
const getTaskWorkspaceMock = vi.fn();
const getMyMembersWithOrganizationsMock = vi.fn();
const getTranslationsMock = vi.fn();
const notFoundMock = vi.fn();
const taskDetailViewMock = vi.fn();
const taskWorkspaceSwitchDialogMock = vi.fn();

const sessionUser = {
  createdAt: "2025-01-01T00:00:00.000Z",
  email: "francis@example.com",
  emailVerified: true,
  id: "user_123",
  image: null,
  marketingOptIn: false,
  name: "Francis",
  onboardingCompleted: true,
  termsAccepted: true,
  updatedAt: "2025-01-01T00:00:00.000Z",
};

const targetOrganization = {
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  id: "org_workspace",
  logo: null,
  metadata: null,
  name: "Workspace Org",
  slug: "workspace-org",
  stripeCustomerId: null,
};

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: (...args: unknown[]) => getTranslationsMock(...args),
}));

vi.mock("@/app/tasks/components/task-detail-view", () => ({
  TaskDetailView: (props: unknown) => {
    taskDetailViewMock(props);
    return <div data-testid="task-detail-view" />;
  },
}));

vi.mock("@/app/tasks/components/task-workspace-switch-dialog", () => ({
  TaskWorkspaceSwitchDialog: (props: unknown) => {
    taskWorkspaceSwitchDialogMock(props);
    return <div data-testid="task-workspace-switch-dialog" />;
  },
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    getTaskById: (...args: unknown[]) => getTaskByIdMock(...args),
    getTaskWorkspace: (...args: unknown[]) => getTaskWorkspaceMock(...args),
  },
}));

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getMyMembersWithOrganizations: (...args: unknown[]) =>
      getMyMembersWithOrganizationsMock(...args),
  },
}));

describe("TaskDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notFoundMock.mockImplementation(() => {
      throw new Error("notFound");
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
  });

  it("renders a workspace switch dialog when a task belongs to another workspace", async () => {
    // Active-workspace read misses; workspace probe reveals the target org.
    getTaskByIdMock.mockResolvedValue(null);
    getTaskWorkspaceMock.mockResolvedValue({
      name: "Quarterly report",
      workspaceId: "11111111-1111-7111-8111-111111111111",
      organizationId: "org_workspace",
    });
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: null,
      },
      user: sessionUser,
    });
    getMyMembersWithOrganizationsMock.mockResolvedValue([
      {
        organizationId: "org_workspace",
        organization: targetOrganization,
      },
    ]);

    const { default: TaskDetailPage } = await import("../page");

    render(
      await TaskDetailPage({
        params: Promise.resolve({
          taskId: "task_1",
        }),
      }),
    );

    expect(getTaskByIdMock).toHaveBeenCalledWith("task_1");
    expect(getTaskWorkspaceMock).toHaveBeenCalledWith("task_1");
    expect(taskWorkspaceSwitchDialogMock).toHaveBeenCalledWith({
      currentAccountName: "Personal Account",
      currentOrganization: null,
      sessionUser,
      taskName: "Quarterly report",
      targetOrganization,
      targetOrganizationId: "org_workspace",
      targetAccountName: "Workspace Org",
      successMessage: 'switchedWorkspace:{"account":"Workspace Org"}',
    });
    expect(taskDetailViewMock).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("task-workspace-switch-dialog"),
    ).toBeInTheDocument();
  });

  it("renders the task detail view when the workspace is already active", async () => {
    const task = {
      id: "task_1",
      name: "Quarterly report",
    };
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: "org_workspace",
      },
      user: sessionUser,
    });
    getTaskByIdMock.mockResolvedValue(task);

    const { default: TaskDetailPage } = await import("../page");

    render(
      await TaskDetailPage({
        params: Promise.resolve({
          taskId: "task_1",
        }),
      }),
    );

    expect(getTaskByIdMock).toHaveBeenCalledWith("task_1");
    expect(getTaskWorkspaceMock).not.toHaveBeenCalled();
    expect(taskWorkspaceSwitchDialogMock).not.toHaveBeenCalled();
    expect(taskDetailViewMock).toHaveBeenCalledWith({
      task,
    });
    expect(screen.getByTestId("task-detail-view")).toBeInTheDocument();
  });

  it("returns not found when the task cannot be resolved in any accessible workspace", async () => {
    getTaskByIdMock.mockResolvedValue(null);
    getTaskWorkspaceMock.mockResolvedValue(null);
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: "org_workspace",
      },
      user: sessionUser,
    });

    const { default: TaskDetailPage } = await import("../page");

    await expect(
      TaskDetailPage({
        params: Promise.resolve({
          taskId: "task_1",
        }),
      }),
    ).rejects.toThrow("notFound");

    expect(getTaskByIdMock).toHaveBeenCalledWith("task_1");
    expect(getTaskWorkspaceMock).toHaveBeenCalledWith("task_1");
  });

  it("returns not found when the active-workspace task read fails but the workspace already matches", async () => {
    getTaskByIdMock.mockResolvedValue(null);
    getTaskWorkspaceMock.mockResolvedValue({
      name: "Quarterly report",
      workspaceId: "11111111-1111-7111-8111-111111111111",
      organizationId: "org_workspace",
    });
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: "org_workspace",
      },
      user: sessionUser,
    });

    const { default: TaskDetailPage } = await import("../page");

    await expect(
      TaskDetailPage({
        params: Promise.resolve({
          taskId: "task_1",
        }),
      }),
    ).rejects.toThrow("notFound");

    expect(taskWorkspaceSwitchDialogMock).not.toHaveBeenCalled();
  });
});
