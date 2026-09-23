import { beforeEach, describe, expect, it, vi } from "vitest";

const getWorkspaceCalendarMock = vi.fn();
const getWorkspaceCalendarSourcesMock = vi.fn();
const listCoworkersMock = vi.fn();
const listTaskAssigneeMemberOptionsMock = vi.fn();
const getCoworkerOptionsMock = vi.fn();
const getProjectByIdMock = vi.fn();
const getProjectCalendarMock = vi.fn();
const getProjectFilterOptionsMock = vi.fn();
const getSessionMock = vi.fn();
const hasCurrentUserCalendarBetaAccessMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("next/server", () => ({
  connection: vi.fn(),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: () => getSessionMock(),
}));

vi.mock("@/lib/calendar-beta-access.server", () => ({
  hasCurrentUserCalendarBetaAccess: () =>
    hasCurrentUserCalendarBetaAccessMock(),
}));

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    getWorkspaceCalendar: (query: unknown) => getWorkspaceCalendarMock(query),
    getWorkspaceCalendarSources: () => getWorkspaceCalendarSourcesMock(),
  },
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

vi.mock("@/lib/helpers/project-filter-options", () => ({
  getProjectFilterOptions: (projectId?: string) =>
    getProjectFilterOptionsMock(projectId),
}));

vi.mock("@/app/tasks/utils/task-assignee-members", () => ({
  listTaskAssigneeMemberOptions: (organizationId: string | null) =>
    listTaskAssigneeMemberOptionsMock(organizationId),
}));

vi.mock("@/app/tasks/utils/coworker-options", () => ({
  getCoworkerOptions: (coworkers: unknown[]) =>
    getCoworkerOptionsMock(coworkers),
}));

import {
  loadCalendarPageContext,
  loadWorkspaceCalendarPage,
  resolveCalendarPageQuery,
} from "./load-calendar-page";

const PROJECT = {
  id: "project-1",
  name: "Launch plan",
  logo: null,
  designMd: null,
  briefingUrl: null,
  contextMd: null,
};

describe("resolveCalendarPageQuery", () => {
  it("parses a known Task status and a calendar date", () => {
    const result = resolveCalendarPageQuery("2026-06-18", "READY");

    expect(result.calendarStatus).toBe("READY");
    expect(result.initialDate).toBe("2026-06-18");
    expect(result.range.from).toBeInstanceOf(Date);
    expect(result.range.to).toBeInstanceOf(Date);
  });

  it("starts Agenda at today in the selected timezone and spans the supported horizon", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T01:00:00Z"));
    try {
      const result = resolveCalendarPageQuery(
        "2025-01-01",
        undefined,
        "agenda",
        "America/Los_Angeles",
      );
      expect(result.initialDate).toBe("2026-09-22");
      expect(result.range.from.toISOString()).toBe("2026-09-22T07:00:00.000Z");
      expect(result.range.to.getTime() - result.range.from.getTime()).toBe(
        90 * 24 * 60 * 60 * 1000,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops an unknown status filter", () => {
    const result = resolveCalendarPageQuery(undefined, "not-a-status");

    expect(result.calendarStatus).toBeUndefined();
  });
});

describe("loadCalendarPageContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspaceCalendarSourcesMock.mockResolvedValue([
      { sourceId: "project:1" },
    ]);
    listCoworkersMock.mockResolvedValue([{ id: "coworker-1" }]);
    listTaskAssigneeMemberOptionsMock.mockResolvedValue([
      { id: "user-1", kind: "user" },
    ]);
    getCoworkerOptionsMock.mockReturnValue([
      { id: "coworker-1", kind: "coworker" },
    ]);
  });

  it("joins member options with coworker options and returns sources", async () => {
    const result = await loadCalendarPageContext("org-1");

    expect(listTaskAssigneeMemberOptionsMock).toHaveBeenCalledWith("org-1");
    expect(result.sources).toEqual([{ sourceId: "project:1" }]);
    expect(result.coworkerOptions).toEqual([
      { id: "user-1", kind: "user" },
      { id: "coworker-1", kind: "coworker" },
    ]);
  });

  it("returns empty sources when optional sources fail to load", async () => {
    getWorkspaceCalendarSourcesMock.mockRejectedValue(new Error("offline"));
    const result = await loadCalendarPageContext(null);
    expect(result.sources).toEqual([]);
  });

  it("propagates failures to load authoritative calendar sources", async () => {
    getWorkspaceCalendarSourcesMock.mockRejectedValue(new Error("offline"));

    await expect(
      loadCalendarPageContext(null, { requireSources: true }),
    ).rejects.toThrow("offline");
  });
});

describe("loadWorkspaceCalendarPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasCurrentUserCalendarBetaAccessMock.mockResolvedValue(true);
    getSessionMock.mockResolvedValue({
      session: { activeOrganizationId: "org-1" },
      user: { id: "user-1" },
    });
    getWorkspaceCalendarMock.mockResolvedValue({
      items: [{ id: "occurrence-1" }],
      pagination: null,
    });
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
    listCoworkersMock.mockResolvedValue([]);
    listTaskAssigneeMemberOptionsMock.mockResolvedValue([]);
    getCoworkerOptionsMock.mockReturnValue([]);
    getProjectFilterOptionsMock.mockResolvedValue([
      { id: "project-1", name: "Open" },
      { id: "project-2", name: "Closed" },
    ]);
    getProjectByIdMock.mockResolvedValue(PROJECT);
    getProjectCalendarMock.mockResolvedValue({
      items: [{ id: "project-occurrence-1" }],
      pagination: null,
    });
  });

  it.each([undefined, PROJECT.id])(
    "loads the first ten Agenda occurrences for project %s",
    async (projectId) => {
      await loadWorkspaceCalendarPage({
        projectId,
        searchParams: Promise.resolve({ view: "agenda", timezone: "UTC" }),
      });
      if (projectId) {
        expect(getProjectCalendarMock).toHaveBeenCalledWith(
          projectId,
          expect.objectContaining({ limit: 10 }),
        );
      } else {
        expect(getWorkspaceCalendarMock).toHaveBeenCalledWith(
          expect.objectContaining({ limit: 10 }),
        );
      }
    },
  );

  it("does not load Calendar data outside the Calendar beta", async () => {
    hasCurrentUserCalendarBetaAccessMock.mockResolvedValue(false);

    await expect(
      loadWorkspaceCalendarPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(getWorkspaceCalendarMock).not.toHaveBeenCalled();
    expect(getProjectByIdMock).not.toHaveBeenCalled();
  });

  it("loads the workspace Calendar and keeps only schedulable Projects", async () => {
    const result = await loadWorkspaceCalendarPage({
      searchParams: Promise.resolve({
        assigneeId: "coworker-1",
        date: "2026-06-18",
        projectId: "project-1",
        sourceId: "legacy-unknown:workspace-1",
        scope: "owned",
        status: "READY",
      }),
    });

    expect(getWorkspaceCalendarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: "coworker-1",
        projectId: "project-1",
        sourceId: "legacy-unknown:workspace-1",
        scope: "owned",
        status: "READY",
      }),
    );
    expect(getProjectCalendarMock).not.toHaveBeenCalled();
    expect(result.project).toBeNull();
    expect(result.items).toEqual([{ id: "occurrence-1" }]);
    expect(result.projectOptions).toEqual([{ id: "project-1", name: "Open" }]);
    expect(result.activeOrganizationId).toBe("org-1");
    expect(result.workspaceId).toBe("workspace-1");
    expect(result.currentUserId).toBe("user-1");
  });

  it("loads the route Project Calendar and ignores query project/source filters", async () => {
    const result = await loadWorkspaceCalendarPage({
      projectId: PROJECT.id,
      searchParams: Promise.resolve({
        assigneeId: "coworker-1",
        date: "2026-06-18",
        projectId: "project-2",
        sourceId: "workspace:workspace-1",
        scope: "owned",
        status: "READY",
      }),
    });

    expect(getProjectByIdMock).toHaveBeenCalledWith(PROJECT.id);
    expect(getProjectCalendarMock).toHaveBeenCalledWith(
      PROJECT.id,
      expect.objectContaining({
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
    expect(getWorkspaceCalendarMock).not.toHaveBeenCalled();
    expect(getProjectFilterOptionsMock).not.toHaveBeenCalled();
    expect(result.project).toEqual(PROJECT);
    expect(result.sources).toEqual([
      expect.objectContaining({ sourceId: "project:project-1" }),
    ]);
    expect(result.projectOptions).toEqual([
      expect.objectContaining({ id: PROJECT.id }),
    ]);
  });

  it("does not load Project Calendar data when the route Project is missing", async () => {
    getProjectByIdMock.mockResolvedValue(null);

    await expect(
      loadWorkspaceCalendarPage({
        projectId: PROJECT.id,
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(getProjectCalendarMock).not.toHaveBeenCalled();
  });
});
