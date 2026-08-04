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

import { VENDOR_GRANT_PENDING_MESSAGE_KEY } from "@sokosumi/utils";

import { handleNotificationNavigation } from "@/lib/utils/notification-navigation";

function createNotification(
  overrides: Partial<NotificationItem> = {},
): NotificationItem {
  const base: NotificationItem = {
    id: "notification_1",
    userId: "user_1",
    kind: "TASK",
    referenceId: "task_1",
    eventId: "event_1",
    messageKey: "Notifications.Task.completed",
    messageParams: {},
    metadata: {
      workspaceId: "11111111-1111-7111-8111-111111111111",
    },
    isRead: false,
    readAt: null,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
  };

  return { ...base, ...overrides };
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

  it("still switches and navigates when account name lookup fails", async () => {
    getWorkspaceOrganizationIdMock.mockResolvedValueOnce("org_1");
    getMyMembersWithOrganizationsMock.mockRejectedValueOnce(
      new Error("members unavailable"),
    );

    await handleNotificationNavigation(
      createNotification(),
      null,
      router,
      handleSelectWorkspace,
      t,
    );

    expect(handleSelectWorkspace).toHaveBeenCalledWith("org_1", {
      shouldRedirectAgentJobsBasePath: false,
      successMessage: undefined,
    });
    expect(pushMock).toHaveBeenCalledWith("/tasks/task_1");
  });

  it("does not navigate when workspace switch fails", async () => {
    getWorkspaceOrganizationIdMock.mockResolvedValueOnce("org_1");
    handleSelectWorkspace.mockRejectedValueOnce(new Error("switch failed"));

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
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("deep-links pending vendor grant and switches workspace when needed", async () => {
    getWorkspaceOrganizationIdMock.mockResolvedValueOnce("org_1");

    await handleNotificationNavigation(
      createNotification({
        kind: "SYSTEM",
        referenceId: "grant_1",
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
        metadata: {
          workspaceId: "11111111-1111-7111-8111-111111111111",
          organizationId: "org_1",
          vendorGrantId: "grant_1",
        },
      }),
      null,
      router,
      handleSelectWorkspace,
      t,
    );

    expect(handleSelectWorkspace).toHaveBeenCalledWith("org_1", {
      shouldRedirectAgentJobsBasePath: false,
      successMessage: "switched:Org One",
    });
    expect(pushMock).toHaveBeenCalledWith(
      "/organizations/org_1#vendor-workspace-access",
    );
  });
});
