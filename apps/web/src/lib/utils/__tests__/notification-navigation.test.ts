import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationItem } from "@/lib/clients/generated/core";

const { getWorkspaceOrganizationIdMock, getMyMembersWithOrganizationsMock } =
  vi.hoisted(() => ({
    getWorkspaceOrganizationIdMock: vi.fn(),
    getMyMembersWithOrganizationsMock: vi.fn(),
  }));

vi.mock("@/lib/services/workspace.service", () => ({
  getWorkspaceOrganizationId: getWorkspaceOrganizationIdMock,
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getMyMembersWithOrganizations: getMyMembersWithOrganizationsMock,
  },
}));

import { handleNotificationNavigation } from "@/lib/utils/notification-navigation";

function createNotification(
  overrides: Partial<NotificationItem> = {},
): NotificationItem {
  return {
    id: "notification_1",
    kind: "TASK",
    referenceId: "task_1",
    messageKey: "Notifications.Task.completed",
    messageParams: {},
    metadata: {
      workspaceId: "11111111-1111-7111-8111-111111111111",
    },
    isRead: false,
    readAt: null,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("handleNotificationNavigation", () => {
  const pushMock = vi.fn();
  const router = { push: pushMock } as unknown as AppRouterInstance;
  const handleSelectWorkspace = vi.fn().mockResolvedValue(undefined);
  const t = vi.fn((key: string, values?: { account: string }) => {
    if (key === "switchedWorkspace" && values) {
      return `switched:${values.account}`;
    }

    if (key === "personalWorkspace") {
      return "Personal";
    }

    return key;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getMyMembersWithOrganizationsMock.mockResolvedValue({
      data: [
        {
          organizationId: "org_1",
          organization: {
            id: "org_1",
            name: "Org One",
            slug: "org-one",
          },
        },
      ],
    });
  });

  it("navigates directly when workspaceId is missing", async () => {
    await handleNotificationNavigation(
      createNotification({ metadata: { projectId: "project_1" } }),
      "org_1",
      router,
      handleSelectWorkspace,
      t,
    );

    expect(pushMock).toHaveBeenCalledWith("/tasks/task_1");
    expect(getWorkspaceOrganizationIdMock).not.toHaveBeenCalled();
    expect(handleSelectWorkspace).not.toHaveBeenCalled();
  });

  it("switches workspace before navigating when active org differs", async () => {
    getWorkspaceOrganizationIdMock.mockResolvedValueOnce("org_1");

    await handleNotificationNavigation(
      createNotification(),
      null,
      router,
      handleSelectWorkspace,
      t,
    );

    expect(handleSelectWorkspace).toHaveBeenCalledWith("org_1", {
      shouldRedirectAgentJobsBasePath: false,
      successMessage: "switched:Org One",
    });
    expect(pushMock).toHaveBeenCalledWith("/tasks/task_1");
  });

  it("navigates without switching when active org already matches", async () => {
    getWorkspaceOrganizationIdMock.mockResolvedValueOnce("org_1");

    await handleNotificationNavigation(
      createNotification(),
      "org_1",
      router,
      handleSelectWorkspace,
      t,
    );

    expect(handleSelectWorkspace).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/tasks/task_1");
  });

  it("navigates without switching when workspace lookup fails", async () => {
    getWorkspaceOrganizationIdMock.mockResolvedValueOnce(undefined);

    await handleNotificationNavigation(
      createNotification(),
      null,
      router,
      handleSelectWorkspace,
      t,
    );

    expect(handleSelectWorkspace).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/tasks/task_1");
  });
});
