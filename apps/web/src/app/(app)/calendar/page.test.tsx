import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getWorkspaceCalendarMock = vi.fn();
const getWorkspaceCalendarSourcesMock = vi.fn();
const listCoworkersMock = vi.fn();
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

vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: {
    listCoworkers: () => listCoworkersMock(),
  },
}));

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    getWorkspaceCalendar: (query: unknown) => getWorkspaceCalendarMock(query),
    getWorkspaceCalendarSources: () => getWorkspaceCalendarSourcesMock(),
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
    getWorkspaceCalendarSourcesMock.mockResolvedValue([]);
    listCoworkersMock.mockResolvedValue([]);
    getProjectFilterOptionsMock.mockResolvedValue([]);
  });

  it("does not load Calendar data for non-NMKR users", async () => {
    getSessionMock.mockResolvedValue({ user: { email: "ada@example.com" } });

    await expect(
      CalendarPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(getWorkspaceCalendarMock).not.toHaveBeenCalled();
    expect(getWorkspaceCalendarSourcesMock).not.toHaveBeenCalled();
  });

  it("loads Calendar data for NMKR users", async () => {
    getSessionMock.mockResolvedValue({ user: { email: "ada@nmkr.io" } });

    await CalendarPage({ searchParams: Promise.resolve({}) });

    expect(getWorkspaceCalendarMock).toHaveBeenCalledOnce();
    expect(getWorkspaceCalendarSourcesMock).toHaveBeenCalledOnce();
    expect(getProjectFilterOptionsMock).toHaveBeenCalledOnce();
  });

  it("offers only schedulable Projects in the shared task modal", async () => {
    getSessionMock.mockResolvedValue({ user: { email: "ada@nmkr.io" } });
    getWorkspaceCalendarSourcesMock.mockResolvedValue([
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
    getSessionMock.mockResolvedValue({ user: { email: "ada@nmkr.io" } });

    await CalendarPage({
      searchParams: Promise.resolve({ status: "READY" }),
    });

    expect(getWorkspaceCalendarMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "READY" }),
    );
  });

  it("passes the selected Project filter to the initial Calendar read", async () => {
    getSessionMock.mockResolvedValue({ user: { email: "ada@nmkr.io" } });

    await CalendarPage({
      searchParams: Promise.resolve({ projectId: "project-1" }),
    });

    expect(getWorkspaceCalendarMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1" }),
    );
  });

  it("still renders Calendar items when Calendar sources fail to load", async () => {
    getSessionMock.mockResolvedValue({ user: { email: "ada@nmkr.io" } });
    getWorkspaceCalendarMock.mockResolvedValue({
      items: [{ id: "occurrence-1" }],
      pagination: null,
    });
    getWorkspaceCalendarSourcesMock.mockRejectedValue(
      new Error("Calendar sources unavailable"),
    );

    render(await CalendarPage({ searchParams: Promise.resolve({}) }));

    expect(workspaceCalendarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ id: "occurrence-1" }],
        sources: [],
      }),
    );
  });

  it("passes the selected non-Project source filter to the initial Calendar read", async () => {
    getSessionMock.mockResolvedValue({ user: { email: "ada@nmkr.io" } });

    await CalendarPage({
      searchParams: Promise.resolve({
        sourceId: "legacy-unknown:workspace-1",
      }),
    });

    expect(getWorkspaceCalendarMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "legacy-unknown:workspace-1" }),
    );
  });
});
