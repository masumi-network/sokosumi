import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getWorkspaceCalendarMock = vi.fn();
const getWorkspaceCalendarSourcesMock = vi.fn();
const listTaskAssigneeOptionsMock = vi.fn();
const getProjectByIdMock = vi.fn();
const getProjectCalendarMock = vi.fn();
const getProjectFilterOptionsMock = vi.fn();
const getSessionMock = vi.fn();
const hasSocialBetaAccessMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/social-beta-access.server", () => ({
  hasCurrentUserSocialBetaAccess: () => hasSocialBetaAccessMock(),
}));

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

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    getWorkspaceCalendar: (query: unknown) => getWorkspaceCalendarMock(query),
    getWorkspaceCalendarSources: (query?: unknown) =>
      getWorkspaceCalendarSourcesMock(query),
  },
}));

vi.mock("@/app/tasks/utils/task-assignee-options", () => ({
  listTaskAssigneeOptions: (organizationId: string | null) =>
    listTaskAssigneeOptionsMock(organizationId),
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
    listTaskAssigneeOptionsMock.mockResolvedValue([
      { id: "user-1", kind: "user" },
      { id: "coworker-1", kind: "coworker" },
    ]);
  });

  it("loads Core-backed task assignee options with sources", async () => {
    const result = await loadCalendarPageContext("org-1");

    expect(listTaskAssigneeOptionsMock).toHaveBeenCalledWith("org-1");
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
    hasSocialBetaAccessMock.mockResolvedValue(false);
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
    listTaskAssigneeOptionsMock.mockResolvedValue([]);
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

  it.each([
    [undefined, false],
    [undefined, true],
    [PROJECT.id, false],
    [PROJECT.id, true],
  ] as const)(
    "preserves Social eligibility for project %s with access %s",
    async (projectId, allowed) => {
      hasSocialBetaAccessMock.mockResolvedValue(allowed);
      const result = await loadWorkspaceCalendarPage({
        projectId,
        searchParams: Promise.resolve({}),
      });
      expect(result.includeSocialPosts).toBe(allowed);
      const query = expect.objectContaining({
        includeSocialPosts: allowed ? "true" : undefined,
      });
      if (projectId)
        expect(getProjectCalendarMock).toHaveBeenCalledWith(projectId, query);
      else expect(getWorkspaceCalendarMock).toHaveBeenCalledWith(query);
    },
  );

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

  it("loads the workspace Calendar and keeps only schedulable Projects", async () => {
    const result = await loadWorkspaceCalendarPage({
      searchParams: Promise.resolve({
        assigneeId: "coworker-1",
        date: "2026-06-18",
        projectId: "project-1",
        sourceId: "workspace:workspace-1",
        scope: "owned",
        status: "READY",
      }),
    });

    expect(getWorkspaceCalendarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: "coworker-1",
        projectId: "project-1",
        sourceId: "workspace:workspace-1",
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

  describe("scheduled Social post horizon", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-01-10T12:00:00Z"));
      hasSocialBetaAccessMock.mockResolvedValue(true);
      getWorkspaceCalendarSourcesMock.mockResolvedValue([
        { sourceId: "workspace:workspace-1", sourceType: "WORKSPACE" },
        {
          sourceId: "project:project-1",
          sourceType: "PROJECT",
          latestScheduledSocialPostAt: new Date("2026-12-31T12:00:00Z"),
        },
        {
          sourceId: "project:project-2",
          sourceType: "PROJECT",
          latestScheduledSocialPostAt: new Date("2027-02-15T12:00:00Z"),
        },
      ]);
    });

    afterEach(() => vi.useRealTimers());

    it("extends the calendar to a scheduled newsletter beyond the Social post horizon", async () => {
      getWorkspaceCalendarSourcesMock.mockResolvedValue([
        { sourceId: "workspace:workspace-1", sourceType: "WORKSPACE" },
        {
          sourceId: "project:project-1",
          sourceType: "PROJECT",
          latestScheduledSocialPostAt: new Date("2027-02-15T12:00:00Z"),
          latestScheduledNewsletterIssueAt: new Date("2027-09-15T12:00:00Z"),
        },
      ]);
      const result = await loadWorkspaceCalendarPage({
        searchParams: Promise.resolve({ date: "2027-10-15" }),
      });
      expect(result.latestDate).toBe("2027-09-01");
      expect(result.initialDate).toBe("2027-09-01");
    });

    it("extends the workspace limit to the latest post across projects and clamps later URLs", async () => {
      const result = await loadWorkspaceCalendarPage({
        searchParams: Promise.resolve({ date: "2027-03-15" }),
      });

      expect(result.latestDate).toBe("2027-02-01");
      expect(result.initialDate).toBe("2027-02-01");
      expect(result.range.to.getTime()).toBeGreaterThan(
        new Date("2027-02-15T12:00:00Z").getTime(),
      );
      expect(getWorkspaceCalendarMock).toHaveBeenCalledWith(
        expect.objectContaining(result.range),
      );
    });

    it.each([undefined, PROJECT.id])(
      "uses only the selected project's posts for route project %s",
      async (routeProjectId) => {
        const result = await loadWorkspaceCalendarPage({
          projectId: routeProjectId,
          searchParams: Promise.resolve({
            date: "2026-12-31",
            projectId: routeProjectId ? "project-2" : PROJECT.id,
            sourceId: routeProjectId ? "workspace:workspace-1" : undefined,
          }),
        });

        expect(result.latestDate).toBe("2026-12-01");
        expect(result.initialDate).toBe("2026-12-31");
        expect(result.range.to.getTime()).toBeGreaterThan(
          new Date("2026-12-31T12:00:00Z").getTime(),
        );
      },
    );

    it("loads the owned horizon through the existing sources query", async () => {
      await loadWorkspaceCalendarPage({
        searchParams: Promise.resolve({ scope: "owned" }),
      });

      expect(getWorkspaceCalendarSourcesMock).toHaveBeenCalledWith({
        includeSocialPosts: "true",
        scope: "owned",
      });
    });

    it("includes the latest post's month in the calendar timezone", async () => {
      getWorkspaceCalendarSourcesMock.mockResolvedValue([
        { sourceId: "workspace:workspace-1", sourceType: "WORKSPACE" },
        {
          sourceId: "project:project-1",
          latestScheduledSocialPostAt: new Date("2026-07-31T23:00:00Z"),
        },
      ]);
      const result = await loadWorkspaceCalendarPage({
        searchParams: Promise.resolve({
          date: "2026-08-15",
          timezone: "Pacific/Kiritimati",
        }),
      });

      expect(result.latestDate).toBe("2026-08-01");
      expect(result.initialDate).toBe("2026-08-15");
    });

    it.each([
      { sourceId: "workspace:workspace-1" },
      { assigneeId: "coworker-1" },
      { assigneeUserId: "user-1" },
      { status: "READY" },
    ])("keeps the default when filters exclude posts: %s", async (filters) => {
      const result = await loadWorkspaceCalendarPage({
        searchParams: Promise.resolve({ ...filters, date: "2027-03-15" }),
      });

      expect(result.latestDate).toBe("2026-03-01");
      expect(result.initialDate).toBe("2026-03-01");
    });

    it("keeps the default for callers without Social access", async () => {
      hasSocialBetaAccessMock.mockResolvedValue(false);
      const result = await loadWorkspaceCalendarPage({
        searchParams: Promise.resolve({ date: "2027-03-15" }),
      });

      expect(result.latestDate).toBe("2026-03-01");
    });

    it("propagates a project horizon load failure", async () => {
      getWorkspaceCalendarSourcesMock.mockRejectedValue(new Error("offline"));

      await expect(
        loadWorkspaceCalendarPage({
          projectId: PROJECT.id,
          searchParams: Promise.resolve({}),
        }),
      ).rejects.toThrow("offline");
      expect(getProjectCalendarMock).not.toHaveBeenCalled();
    });
  });
});
