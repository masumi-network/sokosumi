import { expectConsole } from "@sokosumi/utils/test-console";
import { err, ok } from "neverthrow";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectionMock = vi.fn(async () => undefined);
const getSessionResultMock = vi.fn();
const getSessionMock = vi.fn();
const getTasksColumnPageMock = vi.fn(async (_params: { sort?: string }) => ({
  tasks: [],
  nextCursor: null,
  total: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => undefined }));
vi.mock("next/server", () => ({ connection: () => connectionMock() }));
vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: () => getSessionResultMock(),
  getSession: () => getSessionMock(),
}));
vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: { listCoworkers: async () => [] },
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: {
    listProjects: async () => ({ projects: [] }),
    getProjectById: async () => null,
  },
}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: { getMine: async () => null },
}));
const getSavedTasksViewQueryMock = vi.fn(
  async (): Promise<string | null> => null,
);
vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    listTasks: async () => ({ tasks: [], pagination: null }),
    getSavedTasksViewQuery: () => getSavedTasksViewQueryMock(),
  },
}));
vi.mock("@/lib/services/organization-seat.service", () => ({
  organizationSeatService: { hasAssignedSeat: async () => true },
}));
vi.mock("@/app/tasks/utils/task-assignee-members", () => ({
  listTaskAssigneeMemberOptions: async () => [],
}));
vi.mock("@/app/tasks/utils/task-assignee-options", () => ({
  listTaskAssigneeOptions: async () => [],
}));
vi.mock("@/app/tasks/utils/tasks-column-page", () => ({
  getTasksColumnPage: (params: { sort?: string }) =>
    getTasksColumnPageMock(params),
}));
vi.mock("@/app/tasks/utils/tasks-list-page", () => ({
  getTasksListPage: async () => ({ tasks: [], nextCursor: null }),
}));

const { loadTasksPageData } = await import("./tasks-page-data");

const SESSION = {
  user: { id: "user-1" },
  session: { activeOrganizationId: "org-1" },
};

function load(
  viewMode: "list" | "board" = "list",
  {
    filterParams = {},
    restoreSavedView = false,
  }: {
    filterParams?: Record<string, string>;
    restoreSavedView?: boolean;
  } = {},
) {
  return loadTasksPageData({
    filterParams,
    viewMode,
    personalAssistantFallback: "Personal assistant",
    createAssigneeSlug: null,
    restoreSavedView,
  });
}

describe("loadTasksPageData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionResultMock.mockReset();
    getSessionMock.mockReset();
  });

  // connection() would drop the page from every link prefetch.
  it("reads the page without deferring to the request", async () => {
    getSessionResultMock.mockResolvedValue(ok(SESSION));

    const data = await load();

    expect(data.activeOrganizationId).toBe("org-1");
    expect(connectionMock).not.toHaveBeenCalled();
  });

  // The cached read must not keep an outage as "signed out", so the click
  // renders fresh and the page degrades as before.
  it("renders a session outage fresh on the click", async () => {
    getSessionResultMock.mockResolvedValue(err({ reason: "timeout" }));
    getSessionMock.mockResolvedValue(null);

    const data = await load();

    expect(connectionMock).toHaveBeenCalledOnce();
    expect(data.activeOrganizationId).toBeNull();
  });

  // Any redirect thrown inside the cached read, such as a Core 401 from a
  // service, must reach the prefetch instead of the fresh fallback.
  it("keeps a sign-in redirect from the cached read", async () => {
    getSessionResultMock.mockImplementation(async () => redirect("/signin"));

    await expect(load()).rejects.toThrow("NEXT_REDIRECT");

    expect(connectionMock).not.toHaveBeenCalled();
  });

  // The view options menu says "Last updated" for the board by default.
  it("pages board columns by last update when no sort is picked", async () => {
    getSessionResultMock.mockResolvedValue(ok(SESSION));

    await load("board");

    expect(getTasksColumnPageMock).toHaveBeenCalled();
    for (const [params] of getTasksColumnPageMock.mock.calls) {
      expect(params.sort).toBe("updatedAt");
    }
  });

  it("opens the saved view when the URL names none, and keeps the URL's project", async () => {
    getSessionResultMock.mockResolvedValue(ok(SESSION));
    getSavedTasksViewQueryMock.mockResolvedValue(
      "status=READY&sort=priority&projectId=saved-project",
    );

    const data = await load("list", {
      filterParams: { projectId: "url-project" },
      restoreSavedView: true,
    });

    expect(data.activeFilters).toMatchObject({
      status: "READY",
      sort: "priority",
    });
    expect(data.restoredQuery).toBe(
      "scope=workspace&sort=priority&status=READY",
    );
  });

  it("drops a saved assignee who is no longer a member", async () => {
    getSessionResultMock.mockResolvedValue(ok(SESSION));
    getSavedTasksViewQueryMock.mockResolvedValue("assigneeUserId=gone-user");

    const data = await load("list", { restoreSavedView: true });

    expect(data.activeFilters.assigneeUserId).toBeNull();
    expect(data.restoredQuery).toBe("scope=workspace");
  });

  it("never reads the saved view for a URL that names one", async () => {
    getSessionResultMock.mockResolvedValue(ok(SESSION));

    const data = await load("list", { filterParams: { status: "READY" } });

    expect(getSavedTasksViewQueryMock).not.toHaveBeenCalled();
    expect(data.restoredQuery).toBeNull();
  });

  it("opens the defaults uncached when the saved view cannot be read", async () => {
    getSessionResultMock.mockResolvedValue(ok(SESSION));
    getSessionMock.mockResolvedValue(SESSION);
    getSavedTasksViewQueryMock.mockRejectedValue(new Error("Core down"));
    expectConsole("error", "Failed to load the saved Tasks view");

    const data = await load("list", { restoreSavedView: true });

    // The cached read threw, so the page rendered from the uncached retry.
    expect(connectionMock).toHaveBeenCalled();
    expect(data.activeFilters.status).toBeNull();
    expect(data.restoredQuery).toBe("");
  });
});
