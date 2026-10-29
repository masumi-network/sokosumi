import type {
  NotificationItem,
  ProjectActivityItem,
} from "@sokosumi/core-client";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NeedsYouPanel,
  panelFeed,
  RecentActivityPanel,
} from "./workspace-column";

const { getProjectByIdMock, markReadMock, navigateMock, setViewMock } =
  vi.hoisted(() => ({
    getProjectByIdMock: vi.fn(),
    markReadMock: vi.fn(),
    navigateMock: vi.fn(),
    setViewMock: vi.fn(),
  }));

vi.mock("@/lib/services/project.service", () => ({
  projectService: { getProjectById: getProjectByIdMock },
}));

// Echoes the key with its values, so a row's copy names what it chose.
function translator(namespace: string) {
  return (key: string, values?: Record<string, unknown>) =>
    values
      ? `${namespace}.${key}(${Object.values(values).join(",")})`
      : `${namespace}.${key}`;
}

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
  getFormatter: async () => ({
    relativeTime: () => "2h ago",
    dateTime: () => "Oct 1",
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => translator(namespace),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: null }),
}));

vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: () => ({ handleSelectWorkspace: vi.fn() }),
}));

vi.mock("@/contexts/notification-provider", () => ({
  useOptionalNotifications: () => ({
    markRead: markReadMock,
    setView: setViewMock,
  }),
}));

vi.mock("@/lib/utils/notification-message", () => ({
  useNotificationMessage: () => (key: string) => `message:${key}`,
}));

vi.mock("@/lib/utils/notification-navigation", () => ({
  handleNotificationNavigation: navigateMock,
}));

const project = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Launch",
  identifier: "LAU",
  logo: null,
};
const HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000);

function notification(id: string, projectId?: string): NotificationItem {
  return {
    id,
    userId: "user-1",
    kind: "TASK",
    referenceId: `task-${id}`,
    eventId: `event-${id}`,
    messageKey: "Notifications.Task.inputRequired",
    messageParams: {},
    metadata: projectId ? { projectId } : null,
    isRead: false,
    readAt: null,
    createdAt: HOURS_AGO,
  };
}

describe("NeedsYouPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markReadMock.mockResolvedValue(undefined);
    navigateMock.mockResolvedValue(undefined);
  });

  it("lists the Needs you rows and opens them the way the Notification Center does", async () => {
    render(
      await NeedsYouPanel({
        feed: Promise.resolve([
          notification("n1", project.id),
          notification("n2"),
        ]),
        projects: { [project.id]: { name: "Launch", logo: null } },
      }),
    );

    const rows = screen.getAllByTestId("workspace-needs-you-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(
      "message:Notifications.Task.inputRequired",
    );
    // The row about an open project names it and shows its avatar.
    expect(rows[0]).toHaveTextContent("Launch");
    expect(within(rows[0]).getByTestId("project-avatar")).toBeInTheDocument();
    expect(within(rows[1]).queryByTestId("project-avatar")).toBeNull();
    expect(rows[0]).toHaveTextContent("2h ago");
    // The grid's page held the project, so nothing is read again.
    expect(getProjectByIdMock).not.toHaveBeenCalled();

    fireEvent.click(within(rows[0]).getByRole("button"));
    expect(markReadMock).toHaveBeenCalledWith("n1");
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "n1" }),
      null,
      expect.anything(),
      expect.any(Function),
      expect.any(Function),
    );

    const showAll = screen.getByRole("link", {
      name: "App.Projects.column.needsYou.showAll",
    });
    expect(showAll).toHaveAttribute("href", "/notifications");
    fireEvent.click(showAll);
    expect(setViewMock).toHaveBeenCalledWith("needs-action");
  });

  it("reads a row's project the grid's page does not hold", async () => {
    getProjectByIdMock.mockResolvedValue({
      id: project.id,
      name: "Launch",
      logo: null,
    });

    render(
      await NeedsYouPanel({
        feed: Promise.resolve([notification("n1", project.id)]),
        // The grid is filtered by `q`, so its page lacks this project.
        projects: {},
      }),
    );

    expect(getProjectByIdMock).toHaveBeenCalledWith(project.id);
    const row = screen.getByTestId("workspace-needs-you-row");
    expect(row).toHaveTextContent("Launch");
    expect(within(row).getByTestId("project-avatar")).toBeInTheDocument();
  });

  it("says nothing waits when the view is empty", async () => {
    render(await NeedsYouPanel({ feed: Promise.resolve([]), projects: {} }));

    expect(screen.getByTestId("workspace-needs-you-empty")).toHaveTextContent(
      "App.Projects.column.needsYou.empty",
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("says the feed failed rather than that nothing waits", async () => {
    render(await NeedsYouPanel({ feed: Promise.resolve(null), projects: {} }));

    expect(screen.getByTestId("workspace-needs-you-empty")).toHaveTextContent(
      "App.Projects.column.needsYou.error",
    );
  });
});

describe("RecentActivityPanel", () => {
  it("lists task, job and project events with their project and a link to each", async () => {
    const items: ProjectActivityItem[] = [
      {
        kind: "task",
        id: "e1",
        createdAt: HOURS_AGO,
        project,
        taskId: "task-1",
        title: "Draft the post",
        status: "COMPLETED",
      },
      {
        kind: "job",
        id: "e2",
        createdAt: HOURS_AGO,
        project,
        jobId: "job-1",
        agentId: "agent-1",
        title: null,
        status: "AWAITING_INPUT",
      },
      {
        kind: "project",
        id: "e3",
        createdAt: HOURS_AGO,
        project,
        event: "CLOSE_REQUESTED",
      },
    ];

    render(await RecentActivityPanel({ feed: Promise.resolve(items) }));

    const rows = screen.getAllByTestId("workspace-activity-row");
    expect(rows).toHaveLength(3);
    const ns = "App.Projects.column.activity";
    expect(rows[0]).toHaveTextContent("Draft the post");
    expect(rows[0]).toHaveTextContent(
      `${ns}.detail(Launch,${ns}.task(COMPLETED))`,
    );
    expect(within(rows[0]).getByRole("link")).toHaveAttribute(
      "href",
      "/tasks/task-1",
    );
    expect(rows[1]).toHaveTextContent(`${ns}.untitledJob`);
    expect(within(rows[1]).getByRole("link")).toHaveAttribute(
      "href",
      "/agents/agent-1/jobs/job-1",
    );
    expect(rows[2]).toHaveTextContent(`${ns}.project(CLOSE_REQUESTED)`);
    expect(within(rows[2]).getByRole("link")).toHaveAttribute(
      "href",
      `/projects/${project.id}`,
    );
    for (const row of rows) {
      expect(within(row).getByTestId("project-avatar")).toBeInTheDocument();
      expect(row).toHaveTextContent("2h ago");
    }
  });

  it("calls a comment-only task event a comment", async () => {
    render(
      await RecentActivityPanel({
        feed: Promise.resolve([
          {
            kind: "task",
            id: "e1",
            createdAt: HOURS_AGO,
            project,
            taskId: "task-1",
            title: "Draft the post",
            status: null,
          },
        ]),
      }),
    );

    expect(screen.getByTestId("workspace-activity-row")).toHaveTextContent(
      "App.Projects.column.activity.task(COMMENT)",
    );
  });

  it("says the workspace's open projects are quiet when nothing happened", async () => {
    render(await RecentActivityPanel({ feed: Promise.resolve([]) }));

    expect(screen.getByTestId("workspace-activity-empty")).toHaveTextContent(
      "App.Projects.column.activity.empty",
    );
  });

  it("says this project is quiet when the feed is one project's", async () => {
    render(
      await RecentActivityPanel({
        feed: Promise.resolve([]),
        projectScoped: true,
      }),
    );

    expect(screen.getByTestId("workspace-activity-empty")).toHaveTextContent(
      "App.Projects.column.activity.emptyProject",
    );
  });

  it("says the feed failed in a project's panel too", async () => {
    render(
      await RecentActivityPanel({
        feed: Promise.resolve(null),
        projectScoped: true,
      }),
    );

    expect(screen.getByTestId("workspace-activity-empty")).toHaveTextContent(
      "App.Projects.column.activity.error",
    );
  });
});

describe("panelFeed", () => {
  it("turns a failed feed into null so the panel can say so", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(panelFeed(Promise.reject(new Error("down")))).resolves.toBe(
      null,
    );
    await expect(panelFeed(Promise.resolve([1]))).resolves.toEqual([1]);
  });
});
