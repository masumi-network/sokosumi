import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const hasCurrentUserCalendarBetaAccessMock = vi.fn();
const getWorkspaceCalendarMock = vi.fn();
const getWorkspaceCalendarSourcesMock = vi.fn();
const listSchedulesMock = vi.fn();
const listCoworkersMock = vi.fn();
const listTaskAssigneeMemberOptionsMock = vi.fn();
const getProjectFilterOptionsMock = vi.fn();
const calendarCreateTaskModalMock = vi.fn();
const workspaceCalendarMock = vi.fn();

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("next/server", () => ({
  connection: vi.fn(),
}));

vi.mock("@/app/calendar/components/workspace-calendar", () => ({
  WorkspaceCalendar: (props: unknown) => {
    workspaceCalendarMock(props);
    return null;
  },
}));

vi.mock("@/app/calendar/components/calendar-create-task-modal", () => ({
  CalendarCreateTaskModal: (props: unknown) => {
    calendarCreateTaskModalMock(props);
    return null;
  },
}));

vi.mock("@/app/tasks/components/create-task-modal", () => ({
  CreateTaskModalProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: () => getSessionMock(),
}));

vi.mock("@/lib/calendar-beta-access.server", () => ({
  hasCurrentUserCalendarBetaAccess: () =>
    hasCurrentUserCalendarBetaAccessMock(),
}));

vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: {
    listCoworkers: () => listCoworkersMock(),
  },
}));

vi.mock("@/app/tasks/utils/task-assignee-members", () => ({
  listTaskAssigneeMemberOptions: (organizationId: string | null) =>
    listTaskAssigneeMemberOptionsMock(organizationId),
}));

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    getWorkspaceCalendar: (query: unknown) => getWorkspaceCalendarMock(query),
    getWorkspaceCalendarSources: () => getWorkspaceCalendarSourcesMock(),
  },
}));

vi.mock("@/lib/services/task-schedule.service", () => ({
  taskScheduleService: {
    listSchedules: (params: unknown) => listSchedulesMock(params),
  },
}));

vi.mock("@/lib/helpers/project-filter-options", () => ({
  getProjectFilterOptions: (projectId?: string) =>
    getProjectFilterOptionsMock(projectId),
}));

import CalendarPage from "./page";

describe("CalendarPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasCurrentUserCalendarBetaAccessMock.mockResolvedValue(true);
    getSessionMock.mockResolvedValue(null);
    getWorkspaceCalendarMock.mockResolvedValue({
      items: [],
      pagination: {
        cursor: null,
        limit: 100,
        nextCursor: null,
        total: 0,
      },
    });
    getWorkspaceCalendarSourcesMock.mockResolvedValue([
      {
        sourceId: "workspace:workspace-1",
        sourceType: "WORKSPACE",
        isSchedulable: true,
      },
    ]);
    listSchedulesMock.mockResolvedValue({ schedules: [], nextCursor: null });
    listCoworkersMock.mockResolvedValue([]);
    listTaskAssigneeMemberOptionsMock.mockResolvedValue([]);
    getProjectFilterOptionsMock.mockResolvedValue([]);
  });

  it("does not load Calendar data outside the Calendar beta", async () => {
    hasCurrentUserCalendarBetaAccessMock.mockResolvedValue(false);

    await expect(
      CalendarPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(getWorkspaceCalendarMock).not.toHaveBeenCalled();
    expect(getWorkspaceCalendarSourcesMock).not.toHaveBeenCalled();
  });

  it("loads Calendar data for Calendar beta users", async () => {
    render(await CalendarPage({ searchParams: Promise.resolve({}) }));

    expect(getWorkspaceCalendarMock).toHaveBeenCalledOnce();
    expect(getWorkspaceCalendarSourcesMock).toHaveBeenCalledOnce();
    expect(getProjectFilterOptionsMock).toHaveBeenCalledOnce();
  });

  it("passes the exact active workspace and user identities to Calendar realtime", async () => {
    getSessionMock.mockResolvedValue({
      session: { activeOrganizationId: "org-1" },
      user: { id: "user-1" },
    });
    getWorkspaceCalendarSourcesMock.mockResolvedValue([
      {
        sourceId: "workspace:workspace-1",
        sourceType: "WORKSPACE",
        isSchedulable: true,
      },
    ]);

    render(await CalendarPage({ searchParams: Promise.resolve({}) }));

    expect(workspaceCalendarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        currentUserId: "user-1",
        workspaceId: "workspace-1",
      }),
    );
  });

  it("offers only schedulable Projects in the shared task modal", async () => {
    getWorkspaceCalendarSourcesMock.mockResolvedValue([
      {
        sourceId: "workspace:workspace-1",
        sourceType: "WORKSPACE",
        isSchedulable: true,
      },
      {
        sourceId: "project:project-1",
        sourceType: "PROJECT",
        isSchedulable: true,
      },
      {
        sourceId: "project:project-2",
        sourceType: "PROJECT",
        isSchedulable: false,
      },
    ]);
    getProjectFilterOptionsMock.mockResolvedValue([
      { id: "project-1", name: "Open" },
      { id: "project-2", name: "Closed" },
    ]);

    render(await CalendarPage({ searchParams: Promise.resolve({}) }));

    expect(calendarCreateTaskModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectOptions: [{ id: "project-1", name: "Open" }],
      }),
    );
  });

  it("passes the Calendar status filter to the initial read", async () => {
    await CalendarPage({
      searchParams: Promise.resolve({ status: "READY" }),
    });

    expect(getWorkspaceCalendarMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "READY" }),
    );
  });

  it("passes the selected Project filter to the initial Calendar read", async () => {
    await CalendarPage({
      searchParams: Promise.resolve({ projectId: "project-1" }),
    });

    expect(getWorkspaceCalendarMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1" }),
    );
  });

  it("does not render without a workspace source", async () => {
    getWorkspaceCalendarSourcesMock.mockResolvedValue([]);

    await expect(
      CalendarPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("Calendar workspace source unavailable");
    expect(workspaceCalendarMock).not.toHaveBeenCalled();
  });

  it("loads Task Schedules instead of Runs for the Schedules view", async () => {
    listSchedulesMock.mockResolvedValue({
      schedules: [{ id: "schedule-1", name: "Daily report" }],
      nextCursor: "cursor-2",
    });

    render(
      await CalendarPage({
        searchParams: Promise.resolve({
          assigneeId: "coworker-1",
          projectId: "project-1",
          scope: "owned",
          status: "READY",
          view: "schedules",
        }),
      }),
    );

    expect(getWorkspaceCalendarMock).not.toHaveBeenCalled();
    expect(listSchedulesMock).toHaveBeenCalledWith({
      projectId: "project-1",
      limit: 100,
    });
    expect(workspaceCalendarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [],
        pagination: null,
        schedules: [{ id: "schedule-1", name: "Daily report" }],
        schedulesPagination: { limit: 100, nextCursor: "cursor-2" },
      }),
    );
  });

  it("keeps loading Runs for the other Calendar views", async () => {
    await CalendarPage({
      searchParams: Promise.resolve({ view: "week" }),
    });

    expect(getWorkspaceCalendarMock).toHaveBeenCalledOnce();
    expect(listSchedulesMock).not.toHaveBeenCalled();
  });

  it("passes the selected non-Project source filter to the initial Calendar read", async () => {
    await CalendarPage({
      searchParams: Promise.resolve({
        sourceId: "workspace:workspace-1",
      }),
    });

    expect(getWorkspaceCalendarMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "workspace:workspace-1" }),
    );
  });

  it("includes workspace members in the create-task modal assignee options", async () => {
    getSessionMock.mockResolvedValue({
      session: { activeOrganizationId: "org-1" },
    });
    listTaskAssigneeMemberOptionsMock.mockResolvedValue([
      {
        id: "user-1",
        kind: "user",
        name: "Alice",
        slug: "alice@example.com",
        image: "",
        vendor: {
          id: "workspace-members",
          name: "Members",
          slug: "workspace-members",
          logos: { light: null, dark: null },
        },
      },
    ]);

    render(await CalendarPage({ searchParams: Promise.resolve({}) }));

    expect(listTaskAssigneeMemberOptionsMock).toHaveBeenCalledWith("org-1");
    expect(calendarCreateTaskModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        coworkerOptions: expect.arrayContaining([
          expect.objectContaining({ id: "user-1", kind: "user" }),
        ]),
      }),
    );
  });
});
