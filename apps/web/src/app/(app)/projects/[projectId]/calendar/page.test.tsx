import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getProjectByIdMock = vi.fn();
const getProjectCalendarMock = vi.fn();
const getWorkspaceCalendarSourcesMock = vi.fn();
const listCoworkersMock = vi.fn();
const workspaceCalendarMock = vi.fn();
const calendarCreateTaskModalMock = vi.fn();
const createTaskModalProviderMock = vi.fn();

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("next/server", () => ({
  connection: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
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
  CreateTaskModalProvider: (props: {
    children: ReactNode;
    initialProjectId?: string;
  }) => {
    createTaskModalProviderMock(props);
    return props.children;
  },
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: () => getSessionMock(),
}));

vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: {
    listCoworkers: () => listCoworkersMock(),
  },
}));

vi.mock("@/lib/services/project.service", () => ({
  projectService: {
    getProjectById: (projectId: string) => getProjectByIdMock(projectId),
    getProjectCalendar: (projectId: string, query: unknown) =>
      getProjectCalendarMock(projectId, query),
  },
}));

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    getWorkspaceCalendarSources: () => getWorkspaceCalendarSourcesMock(),
  },
}));

import ProjectCalendarPage from "./page";

const PROJECT = {
  id: "project-1",
  name: "Launch plan",
  logo: null,
  websiteUrl: null,
  closingAt: null,
  closedAt: null,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-02T00:00:00.000Z"),
};

describe("ProjectCalendarPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { email: "ada@nmkr.io" } });
    getProjectByIdMock.mockResolvedValue(PROJECT);
    getProjectCalendarMock.mockResolvedValue({
      items: [],
      pagination: null,
    });
    getWorkspaceCalendarSourcesMock.mockResolvedValue([
      {
        sourceId: "project:project-1",
        sourceType: "PROJECT",
        displayName: PROJECT.name,
        logoUrl: PROJECT.logo,
        paletteToken: "violet",
        isSchedulable: true,
      },
    ]);
    listCoworkersMock.mockResolvedValue([]);
  });

  it("does not load Project data for non-NMKR users", async () => {
    getSessionMock.mockResolvedValue({ user: { email: "ada@example.com" } });

    await expect(
      ProjectCalendarPage({
        params: Promise.resolve({ projectId: PROJECT.id }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(getProjectByIdMock).not.toHaveBeenCalled();
    expect(getProjectCalendarMock).not.toHaveBeenCalled();
  });

  it("loads only the route Project Calendar", async () => {
    render(
      await ProjectCalendarPage({
        params: Promise.resolve({ projectId: PROJECT.id }),
        searchParams: Promise.resolve({
          assigneeId: "coworker-1",
          date: "2026-06-18",
          projectId: "project-2",
          sourceId: "workspace:workspace-1",
          scope: "owned",
          status: "READY",
        }),
      }),
    );

    expect(getProjectByIdMock).toHaveBeenCalledWith(PROJECT.id);
    expect(getProjectCalendarMock).toHaveBeenCalledWith(
      PROJECT.id,
      expect.objectContaining({
        from: expect.any(Date),
        to: expect.any(Date),
        limit: 100,
        assigneeId: "coworker-1",
        scope: "owned",
        status: "READY",
      }),
    );
    expect(getProjectCalendarMock).toHaveBeenCalledWith(
      PROJECT.id,
      expect.not.objectContaining({
        projectId: expect.anything(),
        sourceId: expect.anything(),
      }),
    );
    expect(screen.getByRole("link", { name: "backToProject" })).toHaveAttribute(
      "href",
      "/projects/project-1",
    );
    expect(
      screen.getByRole("link", { name: "backToProject" }).className,
    ).not.toContain("hidden");
    const calendarProps = workspaceCalendarMock.mock.calls.at(-1)?.[0] as {
      lockedProjectId?: string;
      projectId?: string;
      sources: Array<{
        isSchedulable: boolean;
        sourceId: string;
        sourceType: string;
      }>;
    };
    expect(calendarProps.lockedProjectId).toBe(PROJECT.id);
    expect(calendarProps).not.toHaveProperty("projectId");
    expect(calendarProps.sources).toEqual([
      expect.objectContaining({
        isSchedulable: true,
        sourceId: "project:project-1",
        sourceType: "PROJECT",
      }),
    ]);
    expect(createTaskModalProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({ initialProjectId: PROJECT.id }),
    );
    expect(calendarCreateTaskModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lockProjectSelection: true,
        projectOptions: [expect.objectContaining({ id: PROJECT.id })],
      }),
    );
  });

  it("passes a closed Project as an unschedulable source", async () => {
    getProjectByIdMock.mockResolvedValue({
      ...PROJECT,
      closedAt: new Date("2026-06-03T00:00:00.000Z"),
    });
    getWorkspaceCalendarSourcesMock.mockResolvedValue([
      {
        sourceId: "project:project-1",
        sourceType: "PROJECT",
        displayName: PROJECT.name,
        logoUrl: PROJECT.logo,
        paletteToken: "violet",
        isSchedulable: false,
      },
    ]);

    render(
      await ProjectCalendarPage({
        params: Promise.resolve({ projectId: PROJECT.id }),
        searchParams: Promise.resolve({}),
      }),
    );

    const calendarProps = workspaceCalendarMock.mock.calls.at(-1)?.[0] as {
      sources: Array<{ isSchedulable: boolean }>;
    };
    expect(calendarProps.sources[0]?.isSchedulable).toBe(false);
  });

  it("does not offer creation for an open Project without an assigned Seat", async () => {
    getWorkspaceCalendarSourcesMock.mockResolvedValue([
      {
        sourceId: "project:project-1",
        sourceType: "PROJECT",
        displayName: PROJECT.name,
        logoUrl: PROJECT.logo,
        paletteToken: "violet",
        isSchedulable: false,
      },
    ]);

    render(
      await ProjectCalendarPage({
        params: Promise.resolve({ projectId: PROJECT.id }),
        searchParams: Promise.resolve({}),
      }),
    );

    const calendarProps = workspaceCalendarMock.mock.calls.at(-1)?.[0] as {
      sources: Array<{ isSchedulable: boolean }>;
    };
    expect(getWorkspaceCalendarSourcesMock).toHaveBeenCalledOnce();
    expect(calendarProps.sources[0]?.isSchedulable).toBe(false);
  });
});
